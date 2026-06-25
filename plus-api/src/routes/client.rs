use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // Rotas legadas sem tenant (mantidas para compatibilidade)
        .route("/api/login-options", get(login_options))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/currentUser", post(current_user))
        .route("/api/heartbeat", post(heartbeat))
        .route("/api/sysinfo", post(sysinfo))
        .route("/api/sysinfo_ver", post(sysinfo_ver))
        .route("/api/ab/get", post(ab_get))
        .route("/api/ab", post(ab_set))
        // Rotas com tenant_id no path — usadas pelo instalador v2
        // O RustDesk cliente faz POST /t/<tenant_id>/api/heartbeat
        .route("/t/:tenant_id/api/login-options", get(login_options))
        .route("/t/:tenant_id/api/login", post(login))
        .route("/t/:tenant_id/api/logout", post(logout))
        .route("/t/:tenant_id/api/currentUser", post(current_user))
        .route("/t/:tenant_id/api/heartbeat", post(heartbeat_tenant_path))
        .route("/t/:tenant_id/api/sysinfo", post(sysinfo_tenant_path))
        .route("/t/:tenant_id/api/sysinfo_ver", post(sysinfo_ver))
        .route("/t/:tenant_id/api/ab/get", post(ab_get))
        .route("/t/:tenant_id/api/ab", post(ab_set))
}

fn extract_ip(addr: SocketAddr, headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| addr.ip().to_string())
}

async fn login_options() -> impl IntoResponse {
    Json(Value::Array(vec![]))
}

#[derive(Debug, Deserialize)]
struct LoginBody {
    #[allow(dead_code)]
    username: Option<String>,
}

async fn login(Json(_body): Json<LoginBody>) -> impl IntoResponse {
    Json(json!({ "error": "account login not enabled on this server" }))
}

async fn logout() -> impl IntoResponse {
    Json(json!({}))
}

async fn current_user() -> impl IntoResponse {
    Json(json!({ "error": "not logged in" }))
}

#[derive(Debug, Deserialize)]
struct TidQuery {
    tid: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct HeartbeatBody {
    id: String,
    uuid: String,
    /// Embutido diretamente pelo agente; para o cliente RustDesk nativo vem via ?tid= na URL
    tenant_id: Option<Uuid>,
}

async fn heartbeat(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<TidQuery>,
    Json(body): Json<HeartbeatBody>,
) -> Result<Json<Value>, AppError> {
    heartbeat_inner(&state, addr, &headers, q.tid, body).await
}

async fn heartbeat_inner(
    state: &AppState,
    addr: SocketAddr,
    headers: &HeaderMap,
    query_tid: Option<Uuid>,
    body: HeartbeatBody,
) -> Result<Json<Value>, AppError> {
    let Some(tenant_id) = body.tenant_id.or(query_tid) else {
        tracing::warn!("heartbeat sem tenant_id descartado: rustdesk_id={}", body.id);
        return Ok(Json(json!({})));
    };
    let ip = extract_ip(addr, headers);

    // Remove placeholder criado pelo agente com o mesmo rustdesk_id mas UUID diferente
    sqlx::query(
        "DELETE FROM devices WHERE rustdesk_id = $1 AND uuid != $2 AND uuid LIKE 'host-%' AND tenant_id = $3",
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(tenant_id)
    .execute(&state.db)
    .await
    .ok();

    sqlx::query(
        r#"
        INSERT INTO devices (rustdesk_id, uuid, ip_address, last_seen_at, online, online_since, tenant_id)
        VALUES ($1, $2, $3, now(), true, now(), $4)
        ON CONFLICT (tenant_id, uuid) DO UPDATE SET
            rustdesk_id  = EXCLUDED.rustdesk_id,
            ip_address   = EXCLUDED.ip_address,
            last_seen_at = now(),
            online       = true,
            online_since = CASE WHEN devices.online = false THEN now() ELSE devices.online_since END
        "#,
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(&ip)
    .bind(tenant_id)
    .execute(&state.db)
    .await?;

    // Auto-filial por IP dentro do mesmo tenant
    sqlx::query(
        r#"
        UPDATE devices AS d
        SET branch_id = (
            SELECT branch_id FROM devices other
            WHERE other.ip_address = $2
              AND other.branch_id IS NOT NULL
              AND other.uuid != $1
              AND other.tenant_id = $3
            ORDER BY other.last_seen_at DESC
            LIMIT 1
        )
        WHERE d.uuid = $1 AND d.tenant_id = $3
          AND d.branch_id IS NULL
          AND EXISTS (
              SELECT 1 FROM devices other
              WHERE other.ip_address = $2
                AND other.branch_id IS NOT NULL
                AND other.uuid != $1
                AND other.tenant_id = $3
          )
        "#,
    )
    .bind(&body.uuid)
    .bind(&ip)
    .bind(tenant_id)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({})))
}

#[derive(Debug, Deserialize)]
struct SysinfoBody {
    id: String,
    uuid: String,
    hostname: Option<String>,
    os: Option<String>,
    tenant_id: Option<Uuid>,
}

async fn sysinfo(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<TidQuery>,
    Json(body): Json<SysinfoBody>,
) -> Result<impl IntoResponse, AppError> {
    sysinfo_inner(&state, addr, &headers, q.tid, body).await
}

async fn sysinfo_inner(
    state: &AppState,
    addr: SocketAddr,
    headers: &HeaderMap,
    query_tid: Option<Uuid>,
    body: SysinfoBody,
) -> Result<impl IntoResponse, AppError> {
    let Some(tenant_id) = body.tenant_id.or(query_tid) else {
        tracing::warn!("sysinfo sem tenant_id descartado: rustdesk_id={}", body.id);
        return Ok("SYSINFO_IGNORED");
    };
    let ip = extract_ip(addr, headers);

    sqlx::query(
        "DELETE FROM devices WHERE rustdesk_id = $1 AND uuid != $2 AND uuid LIKE 'host-%' AND tenant_id = $3",
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(tenant_id)
    .execute(&state.db)
    .await
    .ok();

    sqlx::query(
        r#"
        INSERT INTO devices (rustdesk_id, uuid, hostname, os, ip_address, last_seen_at, online, online_since, tenant_id)
        VALUES ($1, $2, $3, $4, $5, now(), true, now(), $6)
        ON CONFLICT (tenant_id, uuid) DO UPDATE SET
            rustdesk_id  = EXCLUDED.rustdesk_id,
            hostname     = EXCLUDED.hostname,
            os           = EXCLUDED.os,
            ip_address   = EXCLUDED.ip_address,
            last_seen_at = now(),
            online       = true,
            online_since = CASE WHEN devices.online = false THEN now() ELSE devices.online_since END
        "#,
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(&body.hostname)
    .bind(&body.os)
    .bind(&ip)
    .bind(tenant_id)
    .execute(&state.db)
    .await?;

    Ok("SYSINFO_UPDATED")
}

/// Tenant_id extraído do path: POST /t/:tenant_id/api/heartbeat
async fn heartbeat_tenant_path(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(tenant_id): Path<Uuid>,
    Json(body): Json<HeartbeatBody>,
) -> Result<Json<Value>, AppError> {
    let body = HeartbeatBody { tenant_id: Some(body.tenant_id.unwrap_or(tenant_id)), ..body };
    heartbeat_inner(&state, addr, &headers, None, body).await
}

/// Tenant_id extraído do path: POST /t/:tenant_id/api/sysinfo
async fn sysinfo_tenant_path(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(tenant_id): Path<Uuid>,
    Json(body): Json<SysinfoBody>,
) -> Result<impl IntoResponse, AppError> {
    let body = SysinfoBody { tenant_id: Some(body.tenant_id.unwrap_or(tenant_id)), ..body };
    sysinfo_inner(&state, addr, &headers, None, body).await
}

async fn sysinfo_ver() -> impl IntoResponse {
    "1"
}

async fn ab_get() -> impl IntoResponse {
    Json(json!({ "data": "[]" }))
}

async fn ab_set() -> impl IntoResponse {
    Json(json!({}))
}
