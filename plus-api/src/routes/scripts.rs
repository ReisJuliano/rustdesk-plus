use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::AppError,
    state::{agent_key, AppState},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/scripts", get(list_scripts).post(create_script))
        .route(
            "/admin/scripts/:id",
            get(get_script).put(update_script).delete(delete_script),
        )
        .route("/admin/scripts/:id/run", post(run_script))
        .route("/admin/script-runs", get(list_script_runs))
        .route("/admin/script-runs/:run_id", get(get_script_run))
}

fn tenant_from_headers(auth: &AuthUser, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let override_tid = headers
        .get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok());
    auth.effective_tenant(override_tid)
}

// ── Models ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct Script {
    id: Uuid,
    tenant_id: Uuid,
    name: String,
    description: String,
    definition: Value,
    created_by: Option<Uuid>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ScriptRun {
    id: Uuid,
    script_id: Option<Uuid>,
    script_name: String,
    tenant_id: Uuid,
    triggered_by: Option<Uuid>,
    target_type: String,
    target_ids: Vec<String>,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
    finished_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ScriptRunResult {
    id: Uuid,
    run_id: Uuid,
    device_id: Uuid,
    status: String,
    error: Option<String>,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
    finished_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ScriptRunStep {
    id: Uuid,
    run_result_id: Uuid,
    node_id: String,
    node_label: String,
    status: String,
    output: String,
    exit_code: Option<i32>,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
    finished_at: Option<chrono::DateTime<chrono::Utc>>,
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CreateScriptBody {
    name: String,
    description: Option<String>,
    definition: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct UpdateScriptBody {
    name: Option<String>,
    description: Option<String>,
    definition: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RunScriptBody {
    target_type: String, // 'all' | 'devices' | 'tag'
    target_ids: Option<Vec<String>>,
    tag_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct ListRunsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async fn list_scripts(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    let scripts = sqlx::query_as::<_, Script>(
        "SELECT * FROM scripts WHERE tenant_id = $1 ORDER BY updated_at DESC",
    )
    .bind(tid)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!(scripts)))
}

async fn create_script(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<CreateScriptBody>,
) -> Result<Json<Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    let definition = body
        .definition
        .unwrap_or_else(|| json!({"nodes": [], "edges": []}));

    let script = sqlx::query_as::<_, Script>(
        r#"
        INSERT INTO scripts (tenant_id, name, description, definition, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(tid)
    .bind(&body.name)
    .bind(body.description.unwrap_or_default())
    .bind(&definition)
    .bind(auth.id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!(script)))
}

async fn get_script(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;

    let script = sqlx::query_as::<_, Script>(
        "SELECT * FROM scripts WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(json!(script)))
}

async fn update_script(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateScriptBody>,
) -> Result<Json<Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    let script = sqlx::query_as::<_, Script>(
        r#"
        UPDATE scripts
        SET name        = COALESCE($3, name),
            description = COALESCE($4, description),
            definition  = COALESCE($5, definition),
            updated_at  = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(tid)
    .bind(body.name.as_deref())
    .bind(body.description.as_deref())
    .bind(body.definition.as_ref())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(json!(script)))
}

async fn delete_script(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    let rows = sqlx::query(
        "DELETE FROM scripts WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tid)
    .execute(&state.db)
    .await?
    .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(json!({"ok": true})))
}

// ── Execução ──────────────────────────────────────────────────────────────────

async fn run_script(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(script_id): Path<Uuid>,
    Json(body): Json<RunScriptBody>,
) -> Result<Json<Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    // Busca o script
    let script = sqlx::query_as::<_, Script>(
        "SELECT * FROM scripts WHERE id = $1 AND tenant_id = $2",
    )
    .bind(script_id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    // Determina os dispositivos alvo
    let target_device_uuids: Vec<String> = match body.target_type.as_str() {
        "devices" => {
            let ids = body.target_ids.unwrap_or_default();
            sqlx::query_scalar::<_, String>(
                "SELECT uuid FROM devices WHERE uuid = ANY($1) AND tenant_id = $2",
            )
            .bind(&ids)
            .bind(tid)
            .fetch_all(&state.db)
            .await?
        }
        "tag" => {
            let tag_id = body.tag_id.ok_or_else(|| AppError::BadRequest("tag_id obrigatório para target_type=tag".into()))?;
            sqlx::query_scalar::<_, String>(
                r#"
                SELECT d.uuid FROM devices d
                JOIN device_tags dt ON dt.device_id = d.id
                WHERE dt.tag_id = $1 AND d.tenant_id = $2
                "#,
            )
            .bind(tag_id)
            .bind(tid)
            .fetch_all(&state.db)
            .await?
        }
        _ => {
            // 'all' — todos os dispositivos do tenant (online ou não, agente decide)
            sqlx::query_scalar::<_, String>(
                "SELECT uuid FROM devices WHERE tenant_id = $1",
            )
            .bind(tid)
            .fetch_all(&state.db)
            .await?
        }
    };

    // Cria o script_run
    let recorded_target_ids: Vec<String> = target_device_uuids.clone();
    let run_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO script_runs
            (script_id, script_name, tenant_id, triggered_by, target_type, target_ids, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'running')
        RETURNING id
        "#,
    )
    .bind(script_id)
    .bind(&script.name)
    .bind(tid)
    .bind(auth.id)
    .bind(&body.target_type)
    .bind(&recorded_target_ids)
    .fetch_one(&state.db)
    .await?;

    // Busca device rows (id + uuid)
    let device_rows: Vec<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, uuid FROM devices WHERE uuid = ANY($1) AND tenant_id = $2",
    )
    .bind(&target_device_uuids)
    .bind(tid)
    .fetch_all(&state.db)
    .await?;

    // Cria script_run_results para cada device e envia ao agente
    let nodes = script.definition.get("nodes").cloned().unwrap_or(json!([]));
    let edges = script.definition.get("edges").cloned().unwrap_or(json!([]));

    let script_msg_base = json!({
        "type": "script_run",
        "run_id": run_id,
        "nodes": nodes,
        "edges": edges,
    });

    let agents = state.agents.lock().await;
    let mut sent = 0usize;
    let mut unsent_device_ids = Vec::new();

    for (device_id, device_uuid) in &device_rows {
        // Cria resultado pendente para o device
        let result_id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO script_run_results (run_id, device_id, status)
            VALUES ($1, $2, 'pending')
            ON CONFLICT (run_id, device_id) DO NOTHING
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(device_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or_else(Uuid::new_v4);

        let key = agent_key(tid, device_uuid);
        if let Some(tx) = agents.get(&key) {
            let mut msg = script_msg_base.clone();
            msg["result_id"] = json!(result_id);
            let msg_str = serde_json::to_string(&msg).unwrap();
            if tx.send(msg_str).is_ok() {
                // Marca como running
                let _ = sqlx::query(
                    "UPDATE script_run_results SET status = 'running', started_at = now() WHERE id = $1",
                )
                .bind(result_id)
                .execute(&state.db)
                .await;
                sent += 1;
                continue;
            }
        }
        unsent_device_ids.push((*device_id, result_id));
    }
    drop(agents);

    // Marca como falho devices sem agente conectado
    for (_, result_id) in &unsent_device_ids {
        sqlx::query(
            r#"
            UPDATE script_run_results
            SET status = 'failed',
                error = 'Agente não conectado.',
                started_at = now(),
                finished_at = now()
            WHERE id = $1
            "#,
        )
        .bind(result_id)
        .execute(&state.db)
        .await?;
    }

    // Se todos falharam por falta de agente, marca o run como failed
    if sent == 0 && !device_rows.is_empty() {
        sqlx::query(
            "UPDATE script_runs SET status = 'failed', finished_at = now() WHERE id = $1",
        )
        .bind(run_id)
        .execute(&state.db)
        .await?;
    }

    Ok(Json(json!({
        "run_id": run_id,
        "targets": device_rows.len(),
        "sent": sent,
    })))
}

// ── Histórico ─────────────────────────────────────────────────────────────────

async fn list_script_runs(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Query(q): Query<ListRunsQuery>,
) -> Result<Json<Value>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    #[derive(Debug, Serialize, sqlx::FromRow)]
    struct RunRow {
        id: Uuid,
        script_id: Option<Uuid>,
        script_name: String,
        target_type: String,
        target_ids: Vec<String>,
        status: String,
        created_at: chrono::DateTime<chrono::Utc>,
        finished_at: Option<chrono::DateTime<chrono::Utc>>,
        total_devices: i64,
        done_devices: i64,
        failed_devices: i64,
    }

    let runs = sqlx::query_as::<_, RunRow>(
        r#"
        SELECT
            sr.id,
            sr.script_id,
            sr.script_name,
            sr.target_type,
            sr.target_ids,
            sr.status,
            sr.created_at,
            sr.finished_at,
            COUNT(srr.id)                                       AS total_devices,
            COUNT(srr.id) FILTER (WHERE srr.status = 'done')   AS done_devices,
            COUNT(srr.id) FILTER (WHERE srr.status = 'failed') AS failed_devices
        FROM script_runs sr
        LEFT JOIN script_run_results srr ON srr.run_id = sr.id
        WHERE sr.tenant_id = $1
        GROUP BY sr.id
        ORDER BY sr.created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(tid)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!(runs)))
}

async fn get_script_run(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(run_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;

    let run = sqlx::query_as::<_, ScriptRun>(
        "SELECT * FROM script_runs WHERE id = $1 AND tenant_id = $2",
    )
    .bind(run_id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    #[derive(Debug, Serialize, sqlx::FromRow)]
    struct ResultWithDevice {
        id: Uuid,
        device_id: Uuid,
        hostname: Option<String>,
        alias: Option<String>,
        rustdesk_id: String,
        status: String,
        error: Option<String>,
        started_at: Option<chrono::DateTime<chrono::Utc>>,
        finished_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let results = sqlx::query_as::<_, ResultWithDevice>(
        r#"
        SELECT
            srr.id,
            srr.device_id,
            d.hostname,
            d.alias,
            d.rustdesk_id,
            srr.status,
            srr.error,
            srr.started_at,
            srr.finished_at
        FROM script_run_results srr
        JOIN devices d ON d.id = srr.device_id
        WHERE srr.run_id = $1
        ORDER BY d.hostname, d.alias
        "#,
    )
    .bind(run_id)
    .fetch_all(&state.db)
    .await?;

    // Busca os steps de cada resultado
    let result_ids: Vec<Uuid> = results.iter().map(|r| r.id).collect();
    let steps = sqlx::query_as::<_, ScriptRunStep>(
        r#"
        SELECT * FROM script_run_steps
        WHERE run_result_id = ANY($1)
        ORDER BY started_at ASC NULLS LAST
        "#,
    )
    .bind(&result_ids)
    .fetch_all(&state.db)
    .await?;

    // Agrupa steps por run_result_id
    let results_with_steps: Vec<Value> = results
        .iter()
        .map(|r| {
            let device_steps: Vec<&ScriptRunStep> =
                steps.iter().filter(|s| s.run_result_id == r.id).collect();
            json!({
                "id": r.id,
                "device_id": r.device_id,
                "hostname": r.hostname,
                "alias": r.alias,
                "rustdesk_id": r.rustdesk_id,
                "status": r.status,
                "error": r.error,
                "started_at": r.started_at,
                "finished_at": r.finished_at,
                "steps": device_steps,
            })
        })
        .collect();

    Ok(Json(json!({
        "run": run,
        "results": results_with_steps,
    })))
}

// ── Persistência de progresso (chamado por agent.rs) ─────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct ScriptProgress {
    pub run_id: Uuid,
    pub result_id: Uuid,
    pub node_id: String,
    pub node_label: String,
    pub status: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub all_done: bool,
}

pub async fn persist_script_progress(
    state: &AppState,
    progress: ScriptProgress,
) -> anyhow::Result<()> {
    // Upsert no step (mesmo padrão de exec_results)
    sqlx::query(
        r#"
        INSERT INTO script_run_steps
            (run_result_id, node_id, node_label, status, output, exit_code, started_at, finished_at)
        VALUES
            ($1, $2, $3, $4, $5, $6,
             CASE WHEN $4 = 'running' THEN now() ELSE NULL END,
             CASE WHEN $4 IN ('done', 'failed') THEN now() ELSE NULL END)
        ON CONFLICT (run_result_id, node_id) DO UPDATE SET
            status      = EXCLUDED.status,
            output      = script_run_steps.output || EXCLUDED.output,
            exit_code   = COALESCE(EXCLUDED.exit_code, script_run_steps.exit_code),
            started_at  = COALESCE(script_run_steps.started_at, EXCLUDED.started_at),
            finished_at = CASE WHEN EXCLUDED.status IN ('done', 'failed') THEN now()
                               ELSE script_run_steps.finished_at END
        "#,
    )
    .bind(progress.result_id)
    .bind(&progress.node_id)
    .bind(&progress.node_label)
    .bind(&progress.status)
    .bind(&progress.output)
    .bind(progress.exit_code)
    .execute(&state.db)
    .await?;

    if progress.all_done {
        // Determina o status final do device: done se o último step foi ok, senão failed
        let final_status = if progress.status == "failed" { "failed" } else { "done" };

        sqlx::query(
            r#"
            UPDATE script_run_results
            SET status = $2, finished_at = now()
            WHERE id = $1
            "#,
        )
        .bind(progress.result_id)
        .bind(final_status)
        .execute(&state.db)
        .await?;

        // Checa se todos os devices terminaram para fechar o run
        let (total, pending_or_running): (i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*),
                COUNT(*) FILTER (WHERE status IN ('pending', 'running'))
            FROM script_run_results
            WHERE run_id = (SELECT run_id FROM script_run_results WHERE id = $1)
            "#,
        )
        .bind(progress.result_id)
        .fetch_one(&state.db)
        .await?;

        if total > 0 && pending_or_running == 0 {
            let (done_count, failed_count): (i64, i64) = sqlx::query_as(
                r#"
                SELECT
                    COUNT(*) FILTER (WHERE status = 'done'),
                    COUNT(*) FILTER (WHERE status = 'failed')
                FROM script_run_results
                WHERE run_id = (SELECT run_id FROM script_run_results WHERE id = $1)
                "#,
            )
            .bind(progress.result_id)
            .fetch_one(&state.db)
            .await?;

            let run_status = if failed_count == 0 {
                "done"
            } else if done_count == 0 {
                "failed"
            } else {
                "partial"
            };

            sqlx::query(
                r#"
                UPDATE script_runs
                SET status = $2, finished_at = now()
                WHERE id = (SELECT run_id FROM script_run_results WHERE id = $1)
                "#,
            )
            .bind(progress.result_id)
            .bind(run_status)
            .execute(&state.db)
            .await?;
        }
    }

    Ok(())
}
