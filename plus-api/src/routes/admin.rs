use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{
        header::{CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE},
        HeaderMap, Response,
    },
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::{hash_password, issue_token, verify_password, AuthUser},
    config::{self, ServerConfig},
    error::AppError,
    models::{
        Branch, CreateBranch, CreateTag, CreateTenant, CreateUser, Device, ExecRequest,
        LoginRequest, PatchDevice, SaveServerConfig, SetDeviceBranch, Stats, Tag, Tenant, User,
    },
    state::{agent_key, AppState},
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
            get(get_device).delete(delete_device).post(patch_device),
        )
        .route("/admin/devices/:id", axum::routing::patch(patch_device_patch))
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
        // Endpoints públicos — por código de instalação (sem auth)
        .route("/i/:code", get(install_script))
        .route("/install/:code", get(install_binary))
        // Super admin — gestão de tenants
        .route("/super/tenants", get(list_tenants).post(create_tenant))
        .route("/super/tenants/:id", delete(delete_tenant))
}

// ── Helper: extrai tenant_id efetivo (JWT ou X-Tenant-Id para super_admin) ───

fn tenant_from_headers(auth: &AuthUser, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let override_tid = headers
        .get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok());
    auth.effective_tenant(override_tid)
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Super admin: tenant_id IS NULL
    // Outros usuários: UNIQUE(tenant_id, email) — localiza pelo email diretamente
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE email = $1 ORDER BY (tenant_id IS NULL) DESC LIMIT 1",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if !verify_password(&body.password, &user.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let token = issue_token(user.id, &user.role, user.tenant_id)?;
    Ok(Json(json!({ "token": token, "user": user })))
}

// ── Tenants (super admin) ─────────────────────────────────────────────────────

async fn list_tenants(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    if !auth.is_super_admin() {
        return Err(AppError::Forbidden);
    }
    #[derive(sqlx::FromRow, serde::Serialize)]
    struct TenantStats {
        id: Uuid,
        name: String,
        slug: String,
        created_at: chrono::DateTime<chrono::Utc>,
        device_count: i64,
        online_count: i64,
        user_count: i64,
    }
    let tenants = sqlx::query_as::<_, TenantStats>(
        r#"
        SELECT t.id, t.name, t.slug, t.created_at,
               (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id)              AS device_count,
               (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id AND d.online) AS online_count,
               (SELECT COUNT(*) FROM users   u WHERE u.tenant_id = t.id)              AS user_count
        FROM tenants t
        ORDER BY t.created_at
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!(tenants)))
}

async fn create_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateTenant>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !auth.is_super_admin() {
        return Err(AppError::Forbidden);
    }
    if body.name.trim().is_empty() || body.slug.trim().is_empty() {
        return Err(AppError::BadRequest("nome e slug são obrigatórios".to_string()));
    }
    let tenant = sqlx::query_as::<_, Tenant>(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *",
    )
    .bind(body.name.trim())
    .bind(body.slug.trim())
    .fetch_one(&state.db)
    .await?;
    // Gera senha e código de instalação do tenant
    config::ensure_tenant_password(&state.db, tenant.id).await?;
    config::ensure_tenant_install_code(&state.db, tenant.id).await?;
    Ok(Json(json!(tenant)))
}

async fn delete_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !auth.is_super_admin() {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM tenants WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    config::invalidate_tenant_installer(id).await;
    Ok(Json(json!({ "ok": true })))
}

// ── Instalador ────────────────────────────────────────────────────────────────

async fn download_installer(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Response<Body>, AppError> {
    let tenant_id = tenant_from_headers(&auth, &headers)?;
    let _build_guard = state.installer_build.lock().await;
    let config = config::load(&state.db).await?;
    let password = config::load_tenant_password(&state.db, tenant_id).await?;
    let path = tokio::task::spawn_blocking(move || {
        crate::installer::build(&config, tenant_id, &password)
    })
    .await
    .map_err(anyhow::Error::new)??;
    let bytes = tokio::fs::read(path).await.map_err(anyhow::Error::new)?;

    Response::builder()
        .header(CONTENT_TYPE, "application/vnd.microsoft.portable-executable")
        .header(CONTENT_DISPOSITION, "attachment; filename=\"rustdesk-installer.exe\"")
        .header(CONTENT_LENGTH, bytes.len().to_string())
        .body(Body::from(bytes))
        .map_err(|e| anyhow::Error::new(e).into())
}

// ── Users ─────────────────────────────────────────────────────────────────────

async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<Vec<User>>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let users = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at",
    )
    .bind(tid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(users))
}

async fn create_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<CreateUser>,
) -> Result<Json<User>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let valid_roles = ["admin", "operator", "viewer"];
    if !valid_roles.contains(&body.role.as_str()) {
        return Err(AppError::BadRequest("role inválido".to_string()));
    }
    let password_hash = hash_password(&body.password)?;
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, name, role, tenant_id) \
         VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.name)
    .bind(&body.role)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(user))
}

async fn delete_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    sqlx::query("DELETE FROM users WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tid)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

// ── Branches ──────────────────────────────────────────────────────────────────

async fn list_branches(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<Vec<Branch>>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let branches = sqlx::query_as::<_, Branch>(
        "SELECT * FROM branches WHERE tenant_id = $1 ORDER BY name",
    )
    .bind(tid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(branches))
}

async fn create_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<CreateBranch>,
) -> Result<Json<Branch>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let branch = sqlx::query_as::<_, Branch>(
        "INSERT INTO branches (name, parent_id, tenant_id) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&body.name)
    .bind(body.parent_id)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(branch))
}

async fn delete_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    sqlx::query("DELETE FROM branches WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tid)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

// ── Devices ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DeviceFilter {
    pub branch_id: Option<Uuid>,
    pub search: Option<String>,
    pub online: Option<bool>,
    pub favorite: Option<bool>,
}

async fn list_devices(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Query(filter): Query<DeviceFilter>,
) -> Result<Json<Vec<Device>>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let devices = sqlx::query_as::<_, Device>(
        r#"
        SELECT * FROM devices
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR branch_id = $2)
          AND ($3::text IS NULL OR hostname ILIKE '%' || $3 || '%'
                                OR rustdesk_id ILIKE '%' || $3 || '%'
                                OR alias ILIKE '%' || $3 || '%')
          AND ($4::boolean IS NULL OR online = $4)
          AND ($5::boolean IS NULL OR favorite = $5)
        ORDER BY favorite DESC, online DESC, last_seen_at DESC NULLS LAST
        "#,
    )
    .bind(tid)
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
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Device>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let device = sqlx::query_as::<_, Device>(
        "SELECT * FROM devices WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

async fn delete_device(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    sqlx::query("DELETE FROM devices WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tid)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

// POST /admin/devices/:id é ambíguo com PATCH — mantemos PATCH como principal
async fn patch_device(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchDevice>,
) -> Result<Json<Device>, AppError> {
    patch_device_inner(&state, auth, headers, id, body).await
}

async fn patch_device_patch(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchDevice>,
) -> Result<Json<Device>, AppError> {
    patch_device_inner(&state, auth, headers, id, body).await
}

async fn patch_device_inner(
    state: &AppState,
    auth: AuthUser,
    headers: HeaderMap,
    id: Uuid,
    body: PatchDevice,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let device = sqlx::query_as::<_, Device>(
        r#"
        UPDATE devices
        SET alias       = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE alias END,
            description = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE description END
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(tid)
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
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<SetDeviceBranch>,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let device = sqlx::query_as::<_, Device>(
        "UPDATE devices SET branch_id = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *",
    )
    .bind(body.branch_id)
    .bind(id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

async fn toggle_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Device>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let device = sqlx::query_as::<_, Device>(
        "UPDATE devices SET favorite = NOT favorite WHERE id = $1 AND tenant_id = $2 RETURNING *",
    )
    .bind(id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(device))
}

// ── Tags ──────────────────────────────────────────────────────────────────────

async fn list_tags(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<Vec<Tag>>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT * FROM tags WHERE tenant_id = $1 ORDER BY name",
    )
    .bind(tid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(tags))
}

async fn create_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<CreateTag>,
) -> Result<Json<Tag>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    let color = body.color.unwrap_or_else(|| "#3b82f6".to_string());
    let tag = sqlx::query_as::<_, Tag>(
        "INSERT INTO tags (name, color, tenant_id) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&body.name)
    .bind(&color)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(tag))
}

async fn delete_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    sqlx::query("DELETE FROM tags WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tid)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_device_tags(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<Tag>>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let tags = sqlx::query_as::<_, Tag>(
        r#"
        SELECT t.* FROM tags t
        JOIN device_tags dt ON dt.tag_id = t.id
        JOIN devices d ON d.id = dt.device_id
        WHERE dt.device_id = $1 AND d.tenant_id = $2
        ORDER BY t.name
        "#,
    )
    .bind(id)
    .bind(tid)
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
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<AddTagBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    // Garante que device e tag pertencem ao mesmo tenant
    let device_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM devices WHERE id = $1 AND tenant_id = $2)",
    )
    .bind(id)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    let tag_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tags WHERE id = $1 AND tenant_id = $2)",
    )
    .bind(body.tag_id)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    if !device_ok || !tag_ok {
        return Err(AppError::NotFound);
    }
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
    headers: HeaderMap,
    Path((id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;
    sqlx::query(
        r#"
        DELETE FROM device_tags
        WHERE device_id = $1 AND tag_id = $2
          AND EXISTS (SELECT 1 FROM devices WHERE id = $1 AND tenant_id = $3)
        "#,
    )
    .bind(id)
    .bind(tag_id)
    .bind(tid)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn all_device_tags(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    #[derive(sqlx::FromRow, serde::Serialize)]
    struct Row {
        device_id: Uuid,
        tag_id: Uuid,
        name: String,
        color: String,
    }
    let rows = sqlx::query_as::<_, Row>(
        r#"
        SELECT dt.device_id, t.id AS tag_id, t.name, t.color
        FROM device_tags dt
        JOIN tags t ON t.id = dt.tag_id
        JOIN devices d ON d.id = dt.device_id
        WHERE d.tenant_id = $1
        ORDER BY t.name
        "#,
    )
    .bind(tid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!(rows)))
}

// ── Remote exec ───────────────────────────────────────────────────────────────

async fn exec_command(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<ExecRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;
    let tid = tenant_from_headers(&auth, &headers)?;

    let targets: Vec<String> = if let Some(t) = body.targets {
        t
    } else if let Some(tag_id) = body.tag_id {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT d.uuid FROM devices d
            JOIN device_tags dt ON dt.device_id = d.id
            WHERE dt.tag_id = $1 AND d.online = true AND d.tenant_id = $2
            "#,
        )
        .bind(tag_id)
        .bind(tid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT uuid FROM devices WHERE online = true AND tenant_id = $1",
        )
        .bind(tid)
        .fetch_all(&state.db)
        .await?
    };

    let job_id: Uuid = sqlx::query_scalar(
        "INSERT INTO exec_jobs (cmd, powershell, created_by, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(&body.cmd)
    .bind(body.powershell.unwrap_or(false))
    .bind(auth.id)
    .bind(tid)
    .fetch_one(&state.db)
    .await?;

    let device_rows: Vec<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, uuid FROM devices WHERE uuid = ANY($1) AND tenant_id = $2",
    )
    .bind(&targets)
    .bind(tid)
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
        let key = agent_key(tid, device_uuid);
        if let Some(tx) = agents.get(&key) {
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
    auth: AuthUser,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
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
        JOIN exec_jobs j ON j.id = er.job_id
        WHERE er.job_id = $1 AND j.tenant_id = $2
        ORDER BY d.hostname NULLS LAST
        "#,
    )
    .bind(job_id)
    .bind(tid)
    .fetch_all(&state.db)
    .await?;

    let job = sqlx::query_as::<_, (String, bool)>(
        "SELECT cmd, powershell FROM exec_jobs WHERE id = $1 AND tenant_id = $2",
    )
    .bind(job_id)
    .bind(tid)
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(json!({
        "job_id": job_id,
        "cmd": job.as_ref().map(|j| &j.0),
        "powershell": job.as_ref().map(|j| j.1).unwrap_or(false),
        "results": rows,
    })))
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async fn get_stats(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<Stats>, AppError> {
    let tid = tenant_from_headers(&auth, &headers)?;
    let stats = sqlx::query_as::<_, Stats>(
        r#"
        SELECT
          (SELECT COUNT(*)::bigint FROM devices  WHERE tenant_id = $1)                      AS total_devices,
          (SELECT COUNT(*)::bigint FROM devices  WHERE tenant_id = $1 AND online = true)    AS online_devices,
          (SELECT COUNT(*)::bigint FROM devices  WHERE tenant_id = $1 AND online = false)   AS offline_devices,
          (SELECT COUNT(*)::bigint FROM branches WHERE tenant_id = $1)                      AS total_branches,
          (SELECT COUNT(*)::bigint FROM users    WHERE tenant_id = $1)                      AS total_users
        "#,
    )
    .bind(tid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(stats))
}

// ── Server Config ─────────────────────────────────────────────────────────────

// ── Instalação por código (sem autenticação) ──────────────────────────────────

async fn tenant_by_install_code(db: &sqlx::PgPool, code: &str) -> Option<uuid::Uuid> {
    sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT tenant_id FROM tenant_config WHERE key = 'install_code' AND value = $1",
    )
    .bind(code)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

/// GET /i/:code — retorna script PowerShell que baixa e executa o instalador
async fn install_script(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let tenant_id = tenant_by_install_code(&state.db, &code)
        .await
        .ok_or(AppError::NotFound)?;
    let global = config::load(&state.db).await?;
    let api_url = global.api_url.trim_end_matches('/').to_string();

    let script = format!(
        r#"# RustDesk Plus — Instalação automática
# Execute com: irm "{api_url}/i/{code}" | iex
$ErrorActionPreference = 'Stop'
If (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {{
    Write-Host "Solicitando permissão de administrador..." -ForegroundColor Yellow
    $arg = "-NoProfile -ExecutionPolicy Bypass -Command `"irm '{api_url}/i/{code}' | iex`""
    Start-Process PowerShell -Verb RunAs -ArgumentList $arg
    exit
}}
Write-Host "RustDesk Plus — Baixando instalador..." -ForegroundColor Cyan
$tmp = "$env:TEMP\rustdesk-installer-{tenant_id}.exe"
Invoke-WebRequest -Uri "{api_url}/install/{code}" -OutFile $tmp -UseBasicParsing
Write-Host "Executando instalador..." -ForegroundColor Cyan
Start-Process $tmp -Wait
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
"#,
        api_url = api_url,
        code = code,
        tenant_id = tenant_id,
    );

    Ok((
        [
            ("Content-Type", "text/plain; charset=utf-8"),
            ("Content-Disposition", "inline"),
        ],
        script,
    ))
}

/// GET /install/:code — serve o binário .exe do instalador para o tenant
async fn install_binary(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Response<Body>, AppError> {
    let tenant_id = tenant_by_install_code(&state.db, &code)
        .await
        .ok_or(AppError::NotFound)?;
    let _build_guard = state.installer_build.lock().await;
    let config = config::load(&state.db).await?;
    let password = config::load_tenant_password(&state.db, tenant_id).await?;
    let path = tokio::task::spawn_blocking(move || {
        crate::installer::build(&config, tenant_id, &password)
    })
    .await
    .map_err(anyhow::Error::new)??;
    let bytes = tokio::fs::read(path).await.map_err(anyhow::Error::new)?;

    Response::builder()
        .header(CONTENT_TYPE, "application/vnd.microsoft.portable-executable")
        .header(CONTENT_DISPOSITION, "attachment; filename=\"rustdesk-installer.exe\"")
        .header(CONTENT_LENGTH, bytes.len().to_string())
        .body(Body::from(bytes))
        .map_err(|e| anyhow::Error::new(e).into())
}

async fn get_server_config(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let global = config::load(&state.db).await?;
    let tid = tenant_from_headers(&auth, &headers).ok();
    let (password, install_code) = if let Some(tid) = tid {
        let pwd = config::load_tenant_password(&state.db, tid).await.unwrap_or_default();
        let code = config::ensure_tenant_install_code(&state.db, tid).await.unwrap_or_default();
        (pwd, code)
    } else {
        (String::new(), String::new())
    };
    Ok(Json(json!({
        "server_ip": global.server_ip,
        "server_key": global.server_key,
        "api_url": global.api_url,
        "rustdesk_password": password,
        "install_code": install_code,
    })))
}

async fn save_server_config(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(body): Json<SaveServerConfig>,
) -> Result<Json<serde_json::Value>, AppError> {
    auth.require_admin()?;

    // Apenas super_admin altera a config global
    if auth.is_super_admin() {
        config::save(
            &state.db,
            &ServerConfig {
                server_ip: body.server_ip,
                server_key: body.server_key,
                api_url: body.api_url,
            },
        )
        .await?;
    }

    // Qualquer admin pode atualizar a senha do seu tenant
    if let Some(pwd) = body.rustdesk_password.filter(|p| !p.trim().is_empty()) {
        let tid = tenant_from_headers(&auth, &headers)?;
        config::save_tenant_password(&state.db, tid, pwd.trim()).await?;
    }

    Ok(Json(json!({ "ok": true })))
}
