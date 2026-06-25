use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;

use crate::{error::AppError, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/login-options", get(login_options))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/currentUser", post(current_user))
        .route("/api/heartbeat", post(heartbeat))
        .route("/api/sysinfo", post(sysinfo))
        .route("/api/sysinfo_ver", post(sysinfo_ver))
        .route("/api/ab/get", post(ab_get))
        .route("/api/ab", post(ab_set))
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
struct HeartbeatBody {
    id: String,
    uuid: String,
}

async fn heartbeat(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<HeartbeatBody>,
) -> Result<Json<Value>, AppError> {
    let ip = extract_ip(addr, &headers);

    // Remove placeholder criado pelo agente (uuid = 'host-*') com o mesmo rustdesk_id
    // mas UUID diferente — isso evita conflito de unique key quando o cliente real chega.
    sqlx::query(
        "DELETE FROM devices WHERE rustdesk_id = $1 AND uuid != $2 AND uuid LIKE 'host-%'",
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .execute(&state.db)
    .await
    .ok();

    // Upsert device — registra IP e atualiza online_since só se estava offline
    sqlx::query(
        r#"
        INSERT INTO devices (rustdesk_id, uuid, ip_address, last_seen_at, online, online_since)
        VALUES ($1, $2, $3, now(), true, now())
        ON CONFLICT (uuid) DO UPDATE SET
            rustdesk_id  = EXCLUDED.rustdesk_id,
            ip_address   = EXCLUDED.ip_address,
            last_seen_at = now(),
            online       = true,
            online_since = CASE
                WHEN devices.online = false THEN now()
                ELSE devices.online_since
            END
        "#,
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(&ip)
    .execute(&state.db)
    .await?;

    // Auto-filial: se este device não tem filial mas outro com o mesmo IP tem, herda
    sqlx::query(
        r#"
        UPDATE devices AS d
        SET branch_id = (
            SELECT branch_id FROM devices other
            WHERE other.ip_address = $2
              AND other.branch_id IS NOT NULL
              AND other.uuid != $1
            ORDER BY other.last_seen_at DESC
            LIMIT 1
        )
        WHERE d.uuid = $1
          AND d.branch_id IS NULL
          AND EXISTS (
              SELECT 1 FROM devices other
              WHERE other.ip_address = $2
                AND other.branch_id IS NOT NULL
                AND other.uuid != $1
          )
        "#,
    )
    .bind(&body.uuid)
    .bind(&ip)
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
}

async fn sysinfo(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SysinfoBody>,
) -> Result<impl IntoResponse, AppError> {
    let ip = extract_ip(addr, &headers);

    // Mesma limpeza: remove placeholder do agente se o cliente real chegou
    sqlx::query(
        "DELETE FROM devices WHERE rustdesk_id = $1 AND uuid != $2 AND uuid LIKE 'host-%'",
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .execute(&state.db)
    .await
    .ok();

    sqlx::query(
        r#"
        INSERT INTO devices (rustdesk_id, uuid, hostname, os, ip_address, last_seen_at, online, online_since)
        VALUES ($1, $2, $3, $4, $5, now(), true, now())
        ON CONFLICT (uuid) DO UPDATE SET
            rustdesk_id  = EXCLUDED.rustdesk_id,
            hostname     = EXCLUDED.hostname,
            os           = EXCLUDED.os,
            ip_address   = EXCLUDED.ip_address,
            last_seen_at = now(),
            online       = true,
            online_since = CASE
                WHEN devices.online = false THEN now()
                ELSE devices.online_since
            END
        "#,
    )
    .bind(&body.id)
    .bind(&body.uuid)
    .bind(&body.hostname)
    .bind(&body.os)
    .bind(&ip)
    .execute(&state.db)
    .await?;

    Ok("SYSINFO_UPDATED")
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
