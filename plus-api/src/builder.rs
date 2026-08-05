//! Gerador de Cliente Customizado (branding por tenant) via GitHub Actions.
//! Opt-in por env (CLIENT_BUILDER_*). Dispara o workflow, faz polling do run,
//! baixa o artifact (.exe) e guarda no storage (local por ora; s3 em seguida).

use anyhow::anyhow;
use sqlx::PgPool;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

/// Liga/desliga todo o recurso. Padrão: desligado.
pub fn enabled() -> bool {
    std::env::var("CLIENT_BUILDER_ENABLED")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[derive(Clone)]
pub struct BuilderConfig {
    pub repo: String,
    pub workflow: String,
    pub git_ref: String,
    pub token: String,
    pub rustdesk_ref: String,
    pub storage: String,
    pub generated_dir: PathBuf,
}

impl BuilderConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let token = env_or("CLIENT_BUILDER_GH_TOKEN", "");
        let repo = env_or("CLIENT_BUILDER_GH_REPO", "");
        if token.is_empty() || repo.is_empty() {
            return Err(anyhow!(
                "CLIENT_BUILDER_GH_TOKEN e CLIENT_BUILDER_GH_REPO sao obrigatorios"
            ));
        }
        let generated = env_or("INSTALLER_PATH", "/app/generated/rustdesk-installer.exe");
        let generated_dir = std::path::Path::new(&generated)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("/app/generated"))
            .to_path_buf();
        Ok(Self {
            repo,
            workflow: env_or("CLIENT_BUILDER_GH_WORKFLOW", "build-plain.yml"),
            git_ref: env_or("CLIENT_BUILDER_GH_REF", "master"),
            token,
            rustdesk_ref: env_or("CLIENT_BUILDER_RUSTDESK_REF", "1.4.8"),
            storage: env_or("CLIENT_BUILDER_STORAGE", "local"),
            generated_dir,
        })
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("rustdesk-plus")
        .build()
        .expect("reqwest client")
}

fn auth_headers(req: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    req.header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

async fn get_json(cfg: &BuilderConfig, url: &str) -> anyhow::Result<serde_json::Value> {
    let resp = auth_headers(client().get(url), &cfg.token)
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}

async fn latest_run_id(cfg: &BuilderConfig) -> anyhow::Result<i64> {
    let url = format!(
        "https://api.github.com/repos/{}/actions/workflows/{}/runs?per_page=1",
        cfg.repo, cfg.workflow
    );
    let v = get_json(cfg, &url).await?;
    v["workflow_runs"]
        .get(0)
        .and_then(|r| r["id"].as_i64())
        .ok_or_else(|| anyhow!("nenhum run encontrado"))
}

/// Dispara o workflow e retorna o run_id do run recem-criado.
pub async fn dispatch(cfg: &BuilderConfig, inputs: serde_json::Value) -> anyhow::Result<i64> {
    let before = latest_run_id(cfg).await.unwrap_or(0);
    let url = format!(
        "https://api.github.com/repos/{}/actions/workflows/{}/dispatches",
        cfg.repo, cfg.workflow
    );
    let body = serde_json::json!({ "ref": cfg.git_ref, "inputs": inputs });
    auth_headers(client().post(&url), &cfg.token)
        .json(&body)
        .send()
        .await?
        .error_for_status()?;
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if let Ok(id) = latest_run_id(cfg).await {
            if id > before {
                return Ok(id);
            }
        }
    }
    Err(anyhow!("run nao apareceu apos o dispatch"))
}

/// (status, conclusion) do run.
pub async fn run_status(cfg: &BuilderConfig, run_id: i64) -> anyhow::Result<(String, Option<String>)> {
    let url = format!("https://api.github.com/repos/{}/actions/runs/{}", cfg.repo, run_id);
    let v = get_json(cfg, &url).await?;
    let status = v["status"].as_str().unwrap_or("unknown").to_string();
    let conclusion = v["conclusion"].as_str().map(|s| s.to_string());
    Ok((status, conclusion))
}

/// Baixa o artifact (por nome) do run e extrai os bytes do primeiro .exe do zip.
pub async fn download_exe(
    cfg: &BuilderConfig,
    run_id: i64,
    artifact_name: &str,
) -> anyhow::Result<Vec<u8>> {
    let url = format!(
        "https://api.github.com/repos/{}/actions/runs/{}/artifacts",
        cfg.repo, run_id
    );
    let v = get_json(cfg, &url).await?;
    let arts = v["artifacts"].as_array().ok_or_else(|| anyhow!("sem artifacts"))?;
    let art = arts
        .iter()
        .find(|a| a["name"].as_str() == Some(artifact_name))
        .ok_or_else(|| anyhow!("artifact nao encontrado"))?;
    let art_id = art["id"].as_i64().ok_or_else(|| anyhow!("artifact sem id"))?;
    let dl = format!(
        "https://api.github.com/repos/{}/actions/artifacts/{}/zip",
        cfg.repo, art_id
    );
    let zip_bytes = auth_headers(client().get(&dl), &cfg.token)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec();
    tokio::task::spawn_blocking(move || extract_exe(zip_bytes)).await?
}

fn extract_exe(zip_bytes: Vec<u8>) -> anyhow::Result<Vec<u8>> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut zip = zip::ZipArchive::new(reader)?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        if f.name().to_ascii_lowercase().ends_with(".exe") {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            return Ok(buf);
        }
    }
    Err(anyhow!("nenhum .exe no artifact"))
}

/// Caminho do binario com marca do tenant (backend local).
pub fn branded_exe_path(cfg: &BuilderConfig, tenant_id: Uuid) -> PathBuf {
    cfg.generated_dir.join(format!("branded-{tenant_id}.exe"))
}

async fn store_local(cfg: &BuilderConfig, tenant_id: Uuid, bytes: &[u8]) -> anyhow::Result<String> {
    tokio::fs::create_dir_all(&cfg.generated_dir).await?;
    let path = branded_exe_path(cfg, tenant_id);
    tokio::fs::write(&path, bytes).await?;
    Ok(path.to_string_lossy().to_string())
}

async fn store(cfg: &BuilderConfig, tenant_id: Uuid, bytes: &[u8]) -> anyhow::Result<String> {
    match cfg.storage.as_str() {
        "local" => store_local(cfg, tenant_id, bytes).await,
        "s3" => Err(anyhow!("backend s3 ainda nao implementado (proximo passo)")),
        other => Err(anyhow!("CLIENT_BUILDER_STORAGE invalido: {other}")),
    }
}

/// Dispara o build em background (nao bloqueia o request). Atualiza o estado no DB.
pub fn spawn_build(
    db: PgPool,
    tenant_id: Uuid,
    cfg: BuilderConfig,
    inputs: serde_json::Value,
    artifact_name: String,
) {
    tokio::spawn(async move {
        if let Err(e) = run_build(&db, tenant_id, &cfg, inputs, &artifact_name).await {
            tracing::warn!("build do tenant {tenant_id} falhou: {e:?}");
            let _ = sqlx::query(
                "UPDATE tenant_branding SET build_status='failed', build_error=$2, updated_at=now() WHERE tenant_id=$1",
            )
            .bind(tenant_id)
            .bind(e.to_string())
            .execute(&db)
            .await;
        }
    });
}

async fn run_build(
    db: &PgPool,
    tenant_id: Uuid,
    cfg: &BuilderConfig,
    inputs: serde_json::Value,
    artifact_name: &str,
) -> anyhow::Result<()> {
    let run_id = dispatch(cfg, inputs).await?;
    sqlx::query(
        "UPDATE tenant_branding SET build_status='building', build_run_id=$2, build_error=NULL, updated_at=now() WHERE tenant_id=$1",
    )
    .bind(tenant_id)
    .bind(run_id)
    .execute(db)
    .await?;

    poll_and_store(db, tenant_id, cfg, run_id, artifact_name).await
}

/// Faz polling do run ate concluir, baixa o artifact e grava no storage.
async fn poll_and_store(
    db: &PgPool,
    tenant_id: Uuid,
    cfg: &BuilderConfig,
    run_id: i64,
    artifact_name: &str,
) -> anyhow::Result<()> {
    // Polling ate ~90 min (180 x 30s).
    for _ in 0..180 {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let (status, conclusion) = match run_status(cfg, run_id).await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if status != "completed" {
            continue;
        }
        if conclusion.as_deref() == Some("success") {
            let bytes = download_exe(cfg, run_id, artifact_name).await?;
            let url = store(cfg, tenant_id, &bytes).await?;
            sqlx::query(
                "UPDATE tenant_branding SET build_status='ready', artifact_url=$2, built_at=now(), updated_at=now(), build_error=NULL WHERE tenant_id=$1",
            )
            .bind(tenant_id)
            .bind(url)
            .execute(db)
            .await?;
            return Ok(());
        }
        return Err(anyhow!("run concluido sem sucesso"));
    }
    Err(anyhow!("timeout aguardando o build"))
}

/// Retoma builds que ficaram em "queued"/"building" — o polling vive em memoria,
/// entao um restart do plus-api deixaria o status preso para sempre.
/// Chamado no boot (main.rs).
pub async fn resume_pending(db: PgPool) {
    if !enabled() {
        return;
    }
    let cfg = match BuilderConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("resume_pending: config invalida: {e:?}");
            return;
        }
    };
    let rows: Vec<(Uuid, i64, String)> = match sqlx::query_as(
        "SELECT tenant_id, build_run_id, file_name FROM tenant_branding \
         WHERE build_status IN ('queued', 'building') AND build_run_id IS NOT NULL",
    )
    .fetch_all(&db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("resume_pending: query falhou: {e:?}");
            return;
        }
    };
    for (tenant_id, run_id, artifact_name) in rows {
        tracing::info!("retomando polling do build do tenant {tenant_id} (run {run_id})");
        let db2 = db.clone();
        let cfg2 = cfg.clone();
        tokio::spawn(async move {
            if let Err(e) = poll_and_store(&db2, tenant_id, &cfg2, run_id, &artifact_name).await {
                tracing::warn!("retomada do build do tenant {tenant_id} falhou: {e:?}");
                let _ = sqlx::query(
                    "UPDATE tenant_branding SET build_status='failed', build_error=$2, updated_at=now() WHERE tenant_id=$1",
                )
                .bind(tenant_id)
                .bind(e.to_string())
                .execute(&db2)
                .await;
            }
        });
    }
}
