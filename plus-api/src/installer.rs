use crate::config::ServerConfig;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

// Bump este número ao mudar agent/main.go ou installer/rustdesk-plus.iss.
// Todos os agentes já instalados se auto-atualizarão ao detectar a divergência.
pub const INSTALLER_BUILD: &str = "16";

const RUSTDESK_VERSION: &str = "1.3.9";
const RUSTDESK_URL: &str =
    "https://github.com/rustdesk/rustdesk/releases/download/1.3.9/rustdesk-1.3.9-x86_64.exe";
const VCREDIST_URL: &str = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

fn run(command: &mut Command, description: &str) -> anyhow::Result<()> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }
    anyhow::bail!(
        "{description} falhou: {}{}",
        String::from_utf8_lossy(&output.stdout).trim(),
        String::from_utf8_lossy(&output.stderr).trim()
    )
}

fn copy_file(source: impl AsRef<Path>, target: impl AsRef<Path>) -> anyhow::Result<()> {
    fs::copy(source, target)?;
    Ok(())
}

fn generated_dir() -> PathBuf {
    let base = PathBuf::from(
        std::env::var("INSTALLER_PATH")
            .unwrap_or_else(|_| "/app/generated/rustdesk-installer.exe".to_string()),
    );
    base.parent()
        .unwrap_or_else(|| Path::new("/app/generated"))
        .to_path_buf()
}

/// Caminho do binário do agente para o tenant (salvo ao lado do installer).
pub fn agent_binary_path(tenant_id: Uuid) -> PathBuf {
    generated_dir().join(format!("agent-{tenant_id}.exe"))
}

fn cache_dir() -> PathBuf {
    generated_dir().join("cache")
}

fn download_to(url: &str, dest: &Path) -> anyhow::Result<()> {
    let bytes = reqwest::blocking::get(url)?.error_for_status()?.bytes()?;
    fs::write(dest, &bytes)?;
    Ok(())
}

/// Baixa (uma única vez, ficam em cache) os binários oficiais que o instalador
/// empacota. Empacotar em vez de baixar em tempo de instalação evita depender
/// da rede do PC de destino e reduz o padrão "baixa e executa" que antivírus
/// heurísticos costumam sinalizar.
fn cached_rustdesk_setup() -> anyhow::Result<PathBuf> {
    let dir = cache_dir();
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("rustdesk-{RUSTDESK_VERSION}-setup.exe"));
    if !path.exists() {
        download_to(RUSTDESK_URL, &path)?;
    }
    Ok(path)
}

fn cached_vcredist() -> anyhow::Result<PathBuf> {
    let dir = cache_dir();
    fs::create_dir_all(&dir)?;
    let path = dir.join("vc_redist.x64.exe");
    if !path.exists() {
        download_to(VCREDIST_URL, &path)?;
    }
    Ok(path)
}

/// Monta o comando do compilador do Inno Setup (ISCC). Em produção o plus-api
/// roda em container Linux, então ISCC.exe precisa do Wine — configurável via
/// ISCC_BIN (comando completo) ou WINE_BIN + ISCC_PATH (padrão: wine +
/// /opt/innosetup/ISCC.exe). Em Windows nativo (dev), usa ISCC.exe direto.
fn iscc_command() -> Command {
    if let Ok(bin) = std::env::var("ISCC_BIN") {
        return Command::new(bin);
    }
    if cfg!(target_os = "windows") {
        return Command::new("ISCC.exe");
    }
    let mut cmd = Command::new(std::env::var("WINE_BIN").unwrap_or_else(|_| "wine".to_string()));
    cmd.arg(std::env::var("ISCC_PATH").unwrap_or_else(|_| "/opt/innosetup/ISCC.exe".to_string()));
    cmd
}

pub fn build(
    config: &ServerConfig,
    tenant_id: Uuid,
    rustdesk_password: &str,
    install_code: &str,
) -> anyhow::Result<PathBuf> {
    if config.server_ip.trim().is_empty()
        || config.server_key.trim().is_empty()
        || config.api_url.trim().is_empty()
    {
        anyhow::bail!("configure o servidor antes de baixar o instalador");
    }

    let agent_on = crate::config::agent_enabled();

    let generated_dir = generated_dir();
    let output_path = generated_dir.join(format!("installer-{tenant_id}.exe"));
    let agent_path = generated_dir.join(format!("agent-{tenant_id}.exe"));
    let metadata_path = generated_dir.join(format!("installer-config-{tenant_id}.json"));

    let expected_metadata = {
        let mut m = serde_json::to_value(config)?;
        m["rustdesk_password"] = serde_json::Value::String(rustdesk_password.to_string());
        m["_build"] = serde_json::Value::String(INSTALLER_BUILD.to_string());
        m["_tenant"] = serde_json::Value::String(tenant_id.to_string());
        m["_install_code"] = serde_json::Value::String(install_code.to_string());
        m["_agent"] = serde_json::Value::Bool(agent_on);
        serde_json::to_vec(&m)?
    };

    if output_path.exists()
        && (!agent_on || agent_path.exists())
        && fs::read(&metadata_path)
            .map(|value| value == expected_metadata)
            .unwrap_or(false)
    {
        return Ok(output_path);
    }

    let source_root = PathBuf::from(
        std::env::var("INSTALLER_SOURCE_DIR").unwrap_or_else(|_| "/app/build-src".to_string()),
    );
    let work_root = std::env::temp_dir().join(format!("rustdesk-plus-{}", Uuid::new_v4()));
    let agent_dir = work_root.join("agent");
    fs::create_dir_all(&agent_dir)?;
    fs::create_dir_all(&work_root)?;

    for file in ["go.mod", "main.go"] {
        copy_file(source_root.join("agent").join(file), agent_dir.join(file))?;
    }

    let agent_exe = work_root.join("rustdesk-agent.exe");
    if agent_on {
        run(
            Command::new("go")
                .current_dir(&agent_dir)
                .args(["mod", "tidy"]),
            "preparação das dependências do agente",
        )?;

        let agent_ldflags = format!(
            "-s -w -H=windowsgui -X main.apiURL={} -X main.tenantID={} -X main.installCode={} -X main.agentVersion={}",
            config.api_url, tenant_id, install_code, INSTALLER_BUILD
        );
        run(
            Command::new("go")
                .current_dir(&agent_dir)
                .env("CGO_ENABLED", "0")
                .env("GOOS", "windows")
                .env("GOARCH", "amd64")
                .args(["build", "-trimpath", "-ldflags", &agent_ldflags, "-o"])
                .arg(&agent_exe)
                .arg("."),
            "build do agente",
        )?;

        // Salva o binário do agente separado (usado pelo auto-update)
        fs::create_dir_all(&generated_dir)?;
        fs::copy(&agent_exe, &agent_path)?;
    } else {
        // Agente desligado: placeholder vazio; o .iss só inclui esse Source
        // quando AgentEnabled=="true" (via #if), então o arquivo nunca é usado.
        fs::write(&agent_exe, [])?;
        let _ = fs::remove_file(&agent_path);
    }

    let rustdesk_setup = cached_rustdesk_setup()?;
    let vc_redist = cached_vcredist()?;
    let iss_path = source_root.join("installer").join("rustdesk-plus.iss");
    let output_basename = format!("installer-{tenant_id}");

    run(
        iscc_command()
            .arg(format!("/DServerIP={}", config.server_ip))
            .arg(format!("/DServerKey={}", config.server_key))
            .arg(format!("/DApiUrl={}", config.api_url))
            .arg(format!("/DTenantID={tenant_id}"))
            .arg(format!("/DInstallCode={install_code}"))
            .arg(format!("/DUnattendedPassword={rustdesk_password}"))
            .arg(format!("/DAgentEnabled={agent_on}"))
            .arg(format!("/DRustdeskSetupPath={}", rustdesk_setup.display()))
            .arg(format!("/DVCRedistPath={}", vc_redist.display()))
            .arg(format!("/DAgentExePath={}", agent_exe.display()))
            .arg(format!("/O{}", work_root.display()))
            .arg(format!("/F{output_basename}"))
            .arg(&iss_path),
        "compilação do instalador (Inno Setup)",
    )?;

    let temporary_output = work_root.join(format!("{output_basename}.exe"));
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&temporary_output, &output_path)
        .or_else(|_| fs::copy(&temporary_output, &output_path).map(|_| ()))?;
    fs::write(metadata_path, expected_metadata)?;
    let _ = fs::remove_dir_all(work_root);
    Ok(output_path)
}
