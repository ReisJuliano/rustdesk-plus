use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{
        header::{CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE},
        Response,
    },
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::{hash_password, issue_token, verify_password, AuthUser},
    config::ServerConfig,
    error::AppError,
    models::{
        Branch, CreateBranch, CreateTag, CreateUser, Device, ExecRequest, ExecResult,
        LoginRequest, PatchDevice, SaveServerConfig, SetDeviceBranch,
        Stats, Tag, User,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/login", post(login))
        .route("/admin/users", get(list_users).post(create_user))
        .route("/admin/users/:id", delete(delete_user))
        .route("/admin/branches", get(list_branches).post(create_branch))
        .route("/admin/branches/:id", delete(delete_branch))
        .route("/admin/devices", get(list_devices))
        .route(
            "/admin/devices/:id",
            get(get_device).delete(delete_device).patch(patch_device),
        )
        .route("/admin/devices/:id/branch", post(set_device_branch))
        .route("/admin/devices/:id/favorite", post(toggle_favorite))
        .route("/admin/devices/:id/tags", get(list_device_tags).post(add_device_tag))
        .route("/admin/devices/:id/tags/:tag_id", delete(remove_device_tag))
        .route("/admin/tags", get(list_tags).post(create_tag))
        .route("/admin/tags/:id", delete(delete_tag))
        .route("/admin/device-tags", get(all_device_tags))
        .route("/admin/exec", post(exec_command))
        .route("/admin/exec/:job_id", get(get_exec_results))
        .route("/admin/stats", get(get_stats))
        .route(
            "/admin/server-config",
            get(get_server_config).post(save_server_config),
        )
        .route("/admin/installer", get(download_installer))
}

async fn download_installer(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Response<Body>, AppError> {
    let _build_guard = state.installer_build.lock().await;
    let config = crate::config::load(&state.db).await?;
    let path = tokio::task::spawn_blocking(move || crate::installer::build(&config))
        .await
        .map_err(anyhow::Error::new)??;
    let bytes = tokio::fs::read(path)
        .await
        .map_err(anyhow::Error::new)?;

    Response::builder()
        .header(CONTENT_TYPE, "application/vnd.microsoft.portable-executable")
        .header(
            CONTENT_DISPOSITION,
            "attachment; filename=\"rustdesk-installer.exe\"",
        )
        .header(CONTENT_LENGTH, bytes.len().to_string())
        .body(Body::from(bytes))
        .map_err(|error| anyhow::Error::new(error).into())
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&body.email)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

    if !verify_password(&body.password, &user.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let token = issue_token(user.id, &user.role)?;
    Ok(Json(json!({ "token": token, "user": user })))
}

async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<User>>, AppError> {
    auth.require_admin()?;
    let users = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY created_at")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(users))
}

async fn create_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateUser>,
) -> Result<Json<User>, AppError> {
    auth.require_admin()?;
    if !["admin", "operator", "viewer"].contains(&body.role.as_str()) {
        return Err(AppError::BadRequest("invalid role".to_string()));
    }
    let password_hash = hash_password(&body.password)?;
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.name)
    .bind(&body.role)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(user))
}

async fn delete_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_branches(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<Branch>>, AppError> {
    let branches = sqlx::query_as::<_, Branch>("SELECT * FROM branches ORDER BY name")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(branches))
}

async fn create_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateBranch>,
) -> Result<Json<Branch>, AppError> {
    auth.require_admin()?;
    let branch = sqlx::query_as::<_, Branch>(
        "INSERT INTO branches (name, parent_id) VALUES ($1, $2) RETURNING *",
    )
    .bind(&body.name)
    .bind(body.parent_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(branch))
}

async fn delete_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query("DELETE FROM branches WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct DeviceFilter {
    pub branch_id: Option<Uuid>,
    pub search: Option<String>,
    pub online: Option<bool>,
    pub favorite: Option<bool>,
}

async fn list_devices(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(filter): Query<DeviceFilter>,
) -> Result<Json<Vec<Device>>, AppError> {
    let devices = sqlx::query_as::<_, Device>(
        r#"
        SELECT * FROM devices
        WHERE ($1::uuid IS NULL OR branch_id = $1)
          AND ($2::text IS NULL OR hostname ILIKE '%' || $2 || '%'
                                OR rustdesk_id ILIKE '%' || $2 || '%'
                                OR alias ILIKE '%' || $2 || '%')
          AND ($3::boolean IS NULL OR online = $3)
          AND ($4::boolean IS NULL OR favorite = $4)
        ORDER BY favorite DESC, online DESC, last_seen_at DESC NULLS LAST
        "#,
    )
    .bind(filter.branch_id)
    .bind(filter.search)
    .bind(filter.online)
    .bind(filter.favorite)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(devices))
}

async fn get_device(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Device>, AppError> {
    let device = sqlx::query_as::<_, Device>("SELECT * FROM devices WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

async fn delete_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query("DELETE FROM devices WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn patch_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchDevice>,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let device = sqlx::query_as::<_, Device>(
        r#"
        UPDATE devices
        SET
          alias       = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE alias END,
          description = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE description END
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(body.alias)
    .bind(body.description)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

async fn set_device_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetDeviceBranch>,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let device = sqlx::query_as::<_, Device>(
        "UPDATE devices SET branch_id = $1 WHERE id = $2 RETURNING *",
    )
    .bind(body.branch_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

async fn toggle_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let device = sqlx::query_as::<_, Device>(
        "UPDATE devices SET favorite = NOT favorite WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

// ── Tags ──────────────────────────────────────────────────────────────────────

async fn list_tags(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<Tag>>, AppError> {
    let tags = sqlx::query_as::<_, Tag>("SELECT * FROM tags ORDER BY name")
        .fetch_all(&state.db)
        .await?;
    Ok(Json(tags))
}

async fn create_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateTag>,
) -> Result<Json<Tag>, AppError> {
    auth.require_admin()?;
    let color = body.color.unwrap_or_else(|| "#3b82f6".to_string());
    let tag = sqlx::query_as::<_, Tag>(
        "INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *",
    )
    .bind(&body.name)
    .bind(&color)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(tag))
}

async fn delete_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_device_tags(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Tag>>, AppError> {
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT t.* FROM tags t JOIN device_tags dt ON dt.tag_id = t.id WHERE dt.device_id = $1 ORDER BY t.name",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(tags))
}

#[derive(Debug, serde::Deserialize)]
struct AddTagBody {
    tag_id: Uuid,
}

async fn add_device_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AddTagBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query(
        "INSERT INTO device_tags (device_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(id)
    .bind(body.tag_id)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn remove_device_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    sqlx::query("DELETE FROM device_tags WHERE device_id = $1 AND tag_id = $2")
        .bind(id)
        .bind(tag_id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// Returns all (device_id, tag) pairs — used by frontend to show tags on cards efficiently
async fn all_device_tags(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    #[derive(sqlx::FromRow, serde::Serialize)]
    struct Row {
        device_id: Uuid,
        tag_id: Uuid,
        name: String,
        color: String,
    }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT dt.device_id, t.id AS tag_id, t.name, t.color FROM device_tags dt JOIN tags t ON t.id = dt.tag_id ORDER BY t.name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!(rows)))
}

// ── Remote exec ───────────────────────────────────────────────────────────────

async fn exec_command(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<ExecRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;

    // Determine target device UUIDs
    let targets: Vec<String> = if let Some(t) = body.targets {
        t
    } else if let Some(tag_id) = body.tag_id {
        sqlx::query_scalar::<_, String>(
            "SELECT d.uuid FROM devices d JOIN device_tags dt ON dt.device_id = d.id WHERE dt.tag_id = $1 AND d.online = true",
        )
        .bind(tag_id)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_scalar::<_, String>("SELECT uuid FROM devices WHERE online = true")
            .fetch_all(&state.db)
            .await?
    };

    // Create job in DB
    let job_id: Uuid = sqlx::query_scalar(
        "INSERT INTO exec_jobs (cmd, powershell, created_by) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&body.cmd)
    .bind(body.powershell.unwrap_or(false))
    .bind(auth.id)
    .fetch_one(&state.db)
    .await?;

    // Get device IDs and create result rows (one per target device)
    let device_rows: Vec<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, uuid FROM devices WHERE uuid = ANY($1)",
    )
    .bind(&targets)
    .fetch_all(&state.db)
    .await?;

    for (device_id, _) in &device_rows {
        sqlx::query(
            "INSERT INTO exec_results (job_id, device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(job_id)
        .bind(device_id)
        .execute(&state.db)
        .await?;
    }

    // Send command to connected agents
    let cmd_msg = serde_json::to_string(&json!({
        "job_id": job_id,
        "cmd": &body.cmd,
        "powershell": body.powershell.unwrap_or(false),
    }))
    .unwrap();

    let agents = state.agents.lock().await;
    let mut sent = 0usize;
    let mut unsent_device_ids = Vec::new();
    for (device_id, device_uuid) in &device_rows {
        if let Some(tx) = agents.get(device_uuid) {
            if tx.send(cmd_msg.clone()).is_ok() {
                sent += 1;
                continue;
            }
        }
        unsent_device_ids.push(*device_id);
    }
    drop(agents);

    for device_id in unsent_device_ids {
        sqlx::query(
            r#"
            UPDATE exec_results
            SET output = 'Agente não conectado.',
                exit_code = -1,
                done = true,
                finished_at = now()
            WHERE job_id = $1 AND device_id = $2
            "#,
        )
        .bind(job_id)
        .bind(device_id)
        .execute(&state.db)
        .await?;
    }

    Ok(Json(json!({
        "job_id": job_id,
        "targets": device_rows.len(),
        "sent": sent,
    })))
}

async fn get_exec_results(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(job_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    #[derive(sqlx::FromRow, serde::Serialize)]
    struct Row {
        device_id: Uuid,
        hostname: Option<String>,
        alias: Option<String>,
        rustdesk_id: String,
        ip_address: Option<String>,
        output: String,
        exit_code: Option<i32>,
        done: bool,
        started_at: chrono::DateTime<chrono::Utc>,
        finished_at: Option<chrono::DateTime<chrono::Utc>>,
    }
    let rows = sqlx::query_as::<_, Row>(
        r#"
        SELECT er.device_id, d.hostname, d.alias, d.rustdesk_id, d.ip_address,
               er.output, er.exit_code, er.done, er.started_at, er.finished_at
        FROM exec_results er
        JOIN devices d ON d.id = er.device_id
        WHERE er.job_id = $1
        ORDER BY d.hostname NULLS LAST
        "#,
    )
    .bind(job_id)
    .fetch_all(&state.db)
    .await?;

    let job = sqlx::query_as::<_, (String, bool)>(
        "SELECT cmd, powershell FROM exec_jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "job_id": job_id,
        "cmd": job.as_ref().map(|j| &j.0),
        "powershell": job.as_ref().map(|j| j.1).unwrap_or(false),
        "results": rows,
    })))
}

async fn get_stats(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Stats>, AppError> {
    let stats = sqlx::query_as::<_, Stats>(
        r#"
        SELECT
          (SELECT COUNT(*)::bigint FROM devices)                          AS total_devices,
          (SELECT COUNT(*)::bigint FROM devices WHERE online = true)      AS online_devices,
          (SELECT COUNT(*)::bigint FROM devices WHERE online = false)     AS offline_devices,
          (SELECT COUNT(*)::bigint FROM branches)                         AS total_branches,
          (SELECT COUNT(*)::bigint FROM users)                            AS total_users
        "#,
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(stats))
}

async fn get_server_config(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(json!(crate::config::load(&state.db).await?)))
}

async fn save_server_config(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SaveServerConfig>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;

    let existing = crate::config::load(&state.db).await?;
    crate::config::save(
        &state.db,
        &ServerConfig {
            server_ip: body.server_ip,
            server_key: body.server_key,
            api_url: body.api_url,
            rustdesk_password: body.rustdesk_password.unwrap_or(existing.rustdesk_password),
        },
    )
    .await?;

    Ok(Json(json!({ "ok": true })))
}
