use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::AppError,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        // Endpoint nativo usado pelo cliente RustDesk controlado.
        .route("/t/:tenant_id/api/audit/conn", post(receive_connection_audit))
        // Consulta autenticada do painel.
        .route("/admin/audit/connections", get(list_connection_audit))
        // Registra quem iniciou a conexÃ£o pelo painel antes de abrir rustdesk://.
        .route("/admin/devices/:device_id/connect", post(register_launch))
}

#[derive(Debug, Deserialize)]
struct AuditPayload {
    id: String,
    uuid: String,
    conn_id: i32,
    #[serde(default)]
    session_id: i64,
    nonce: Uuid,
    action: Option<String>,
    ip: Option<String>,
    peer: Option<(String, String)>,
    #[serde(rename = "type")]
    connection_type: Option<i16>,
}

async fn receive_connection_audit(
    State(state): State<AppState>,
    Path(tenant_id): Path<Uuid>,
    Json(body): Json<AuditPayload>,
) -> Result<Json<Value>, AppError> {
    let mut tx = state.db.begin().await?;

    // O cliente pode repetir o POST apÃ³s falhas transitÃ³rias.
    let fresh = sqlx::query(
        "INSERT INTO connection_audit_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(body.nonce)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if !fresh {
        tx.commit().await?;
        return Ok(Json(json!({ "ok": true, "duplicate": true })));
    }

    let device_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM devices WHERE tenant_id = $1 AND (uuid = $2 OR rustdesk_id = $3) AND deleted_at IS NULL LIMIT 1",
    )
    .bind(tenant_id)
    .bind(&body.uuid)
    .bind(&body.id)
    .fetch_optional(&mut *tx)
    .await?;

    match body.action.as_deref() {
        Some("new") => {
            // Associa ao clique mais recente do painel, se existir.
            let launch_id: Option<Uuid> = sqlx::query_scalar(
                r#"SELECT id FROM connection_audit
                   WHERE tenant_id = $1 AND target_rustdesk_id = $2
                     AND status = 'launched' AND launched_at > now() - interval '2 minutes'
                   ORDER BY launched_at DESC LIMIT 1 FOR UPDATE"#,
            )
            .bind(tenant_id)
            .bind(&body.id)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(id) = launch_id {
                sqlx::query(
                    r#"UPDATE connection_audit SET device_id = COALESCE($2, device_id), target_uuid = $3,
                       conn_id = $4, session_id = $5, source_ip = $6::inet, status = 'connecting',
                       started_at = now(), updated_at = now() WHERE id = $1"#,
                )
                .bind(id)
                .bind(device_id)
                .bind(&body.uuid)
                .bind(body.conn_id)
                .bind(body.session_id)
                .bind(&body.ip)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    r#"INSERT INTO connection_audit
                       (tenant_id, device_id, target_rustdesk_id, target_uuid, conn_id, session_id,
                        source_ip, status, started_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7::inet,'connecting',now())"#,
                )
                .bind(tenant_id)
                .bind(device_id)
                .bind(&body.id)
                .bind(&body.uuid)
                .bind(body.conn_id)
                .bind(body.session_id)
                .bind(&body.ip)
                .execute(&mut *tx)
                .await?;
            }
        }
        Some("close") => {
            sqlx::query(
                r#"UPDATE connection_audit SET status = 'closed', ended_at = now(), updated_at = now()
                   WHERE id = (SELECT id FROM connection_audit
                     WHERE tenant_id = $1 AND target_uuid = $2 AND conn_id = $3
                       AND session_id = $4 AND ended_at IS NULL
                     ORDER BY created_at DESC LIMIT 1)"#,
            )
            .bind(tenant_id)
            .bind(&body.uuid)
            .bind(body.conn_id)
            .bind(body.session_id)
            .execute(&mut *tx)
            .await?;
        }
        _ if body.peer.is_some() => {
            let (peer_id, peer_name) = body.peer.as_ref().unwrap();
            sqlx::query(
                r#"UPDATE connection_audit SET peer_rustdesk_id = $5, peer_name = $6,
                   connection_type = $7, status = 'active', updated_at = now()
                   WHERE id = (SELECT id FROM connection_audit
                     WHERE tenant_id = $1 AND target_uuid = $2 AND conn_id = $3
                       AND session_id = $4 AND ended_at IS NULL
                     ORDER BY created_at DESC LIMIT 1)"#,
            )
            .bind(tenant_id)
            .bind(&body.uuid)
            .bind(body.conn_id)
            .bind(body.session_id)
            .bind(peer_id)
            .bind(peer_name)
            .bind(body.connection_type)
            .execute(&mut *tx)
            .await?;
        }
        _ => {}
    }

    // MantÃ©m a tabela de deduplicaÃ§Ã£o pequena.
    sqlx::query("DELETE FROM connection_audit_nonces WHERE received_at < now() - interval '1 day'")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

async fn register_launch(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(device_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let tenant_id = effective_tenant(&auth, &headers)?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT rustdesk_id, uuid FROM devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    )
    .bind(device_id)
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?;
    let (rustdesk_id, uuid) = row.ok_or(AppError::NotFound)?;
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO connection_audit
           (tenant_id, device_id, target_rustdesk_id, target_uuid, initiated_by_user_id,
            status, launched_at)
           VALUES ($1,$2,$3,$4,$5,'launched',now()) RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .bind(rustdesk_id)
    .bind(uuid)
    .bind(auth.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true, "audit_id": id })))
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    search: Option<String>,
}

async fn list_connection_audit(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let tenant_id = effective_tenant(&auth, &headers)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let search = q.search.unwrap_or_default();
    let rows = sqlx::query(
        r#"SELECT a.id, a.target_rustdesk_id, a.peer_rustdesk_id, a.peer_name,
                  host(a.source_ip) AS source_ip, a.connection_type, a.status,
                  a.launched_at, a.started_at, a.ended_at,
                  CASE WHEN a.started_at IS NULL THEN NULL
                       ELSE EXTRACT(EPOCH FROM (COALESCE(a.ended_at, now()) - a.started_at))::bigint END AS duration_seconds,
                  d.hostname, d.alias, u.name AS initiated_by_name, u.email AS initiated_by_email
           FROM connection_audit a
           LEFT JOIN devices d ON d.id = a.device_id
           LEFT JOIN users u ON u.id = a.initiated_by_user_id
           WHERE a.tenant_id = $1
             AND ($2 = '' OR a.target_rustdesk_id ILIKE '%' || $2 || '%'
                  OR COALESCE(a.peer_rustdesk_id,'') ILIKE '%' || $2 || '%'
                  OR COALESCE(a.peer_name,'') ILIKE '%' || $2 || '%'
                  OR COALESCE(d.hostname,'') ILIKE '%' || $2 || '%')
           ORDER BY COALESCE(a.started_at, a.launched_at, a.created_at) DESC
           LIMIT $3 OFFSET $4"#,
    )
    .bind(tenant_id)
    .bind(search.trim())
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.get::<Uuid,_>("id"),
        "target_rustdesk_id": r.get::<String,_>("target_rustdesk_id"),
        "peer_rustdesk_id": r.get::<Option<String>,_>("peer_rustdesk_id"),
        "peer_name": r.get::<Option<String>,_>("peer_name"),
        "source_ip": r.get::<Option<String>,_>("source_ip"),
        "connection_type": r.get::<Option<i16>,_>("connection_type"),
        "status": r.get::<String,_>("status"),
        "launched_at": r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("launched_at"),
        "started_at": r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("started_at"),
        "ended_at": r.get::<Option<chrono::DateTime<chrono::Utc>>,_>("ended_at"),
        "duration_seconds": r.get::<Option<i64>,_>("duration_seconds"),
        "hostname": r.get::<Option<String>,_>("hostname"),
        "alias": r.get::<Option<String>,_>("alias"),
        "initiated_by_name": r.get::<Option<String>,_>("initiated_by_name"),
        "initiated_by_email": r.get::<Option<String>,_>("initiated_by_email"),
    })).collect();
    Ok(Json(json!(result)))
}

fn effective_tenant(auth: &AuthUser, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let override_tid = headers.get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok());
    auth.effective_tenant(override_tid)
}



