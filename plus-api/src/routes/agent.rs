use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    routing::get,
    Router,
};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/agent", get(agent_ws))
}

#[derive(Debug, Deserialize)]
struct AgentParams {
    uuid: String,
    hostname: Option<String>,
    rustdesk_id: Option<String>,
    os: Option<String>,
}

async fn agent_ws(
    ws: WebSocketUpgrade,
    Query(params): Query<AgentParams>,
    State(state): State<AppState>,
) -> Response {
    let uuid = params.uuid.clone();
    ws.on_upgrade(move |socket| handle_agent(socket, uuid, params, state))
}

async fn handle_agent(
    mut socket: WebSocket,
    uuid: String,
    params: AgentParams,
    state: AppState,
) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let registered_uuid = match ensure_agent_device(&state, &params).await {
        Some(device_uuid) => device_uuid,
        None => resolve_device_uuid(&state, &uuid)
            .await
            .unwrap_or_else(|| uuid.clone()),
    };
    let mut presence_interval = tokio::time::interval(std::time::Duration::from_secs(20));

    // Register agent
    {
        let mut agents = state.agents.lock().await;
        agents.insert(registered_uuid.clone(), tx);
    }
    update_agent_presence(&state, &registered_uuid, true).await;

    tracing::info!("agent connected: {uuid} -> {registered_uuid}");

    loop {
        tokio::select! {
            _ = presence_interval.tick() => {
                update_agent_presence(&state, &registered_uuid, true).await;
            }
            // Forward commands from admin to agent
            cmd = rx.recv() => {
                match cmd {
                    Some(msg) => {
                        if socket.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            // Receive output from agent and persist to DB
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(result) = serde_json::from_str::<AgentResult>(&text) {
                            let _ = persist_result(&state, result).await;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    _ => break,
                }
            }
        }
    }

    // Unregister
    let mut agents = state.agents.lock().await;
    agents.remove(&registered_uuid);
    drop(agents);
    update_agent_presence(&state, &registered_uuid, false).await;
    tracing::info!("agent disconnected: {uuid} -> {registered_uuid}");
}

async fn ensure_agent_device(state: &AppState, params: &AgentParams) -> Option<String> {
    let hostname = params
        .hostname
        .clone()
        .or_else(|| params.uuid.strip_prefix("host-").map(str::to_string));
    let real_rustdesk_id = params
        .rustdesk_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    // RustDesk and the agent use different UUIDs. Prefer the device row already
    // registered by RustDesk, matching it through the stable numeric RustDesk ID.
    if let Some(rustdesk_id) = real_rustdesk_id.as_deref() {
        let existing = sqlx::query_scalar::<_, String>(
            r#"
            UPDATE devices
            SET hostname = COALESCE($2, hostname),
                os = COALESCE($3, os),
                last_seen_at = now(),
                online = true,
                online_since = CASE WHEN online = false THEN now() ELSE online_since END
            WHERE rustdesk_id = $1
            RETURNING uuid
            "#,
        )
        .bind(rustdesk_id)
        .bind(&hostname)
        .bind(&params.os)
        .fetch_optional(&state.db)
        .await;

        match existing {
            Ok(Some(uuid)) => return Some(uuid),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!("failed to match agent by RustDesk ID {rustdesk_id}: {error:?}");
            }
        }
    }

    let rustdesk_id = real_rustdesk_id
        .unwrap_or_else(|| format!("agent:{}", hostname.as_deref().unwrap_or(&params.uuid)));

    let result = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO devices
            (rustdesk_id, uuid, hostname, os, last_seen_at, online, online_since)
        VALUES ($1, $2, $3, $4, now(), true, now())
        ON CONFLICT (uuid) DO UPDATE SET
            rustdesk_id = EXCLUDED.rustdesk_id,
            hostname = COALESCE(EXCLUDED.hostname, devices.hostname),
            os = COALESCE(EXCLUDED.os, devices.os),
            last_seen_at = now(),
            online = true,
            online_since = CASE WHEN devices.online = false THEN now() ELSE devices.online_since END
        RETURNING uuid
        "#,
    )
    .bind(rustdesk_id)
    .bind(&params.uuid)
    .bind(hostname)
    .bind(&params.os)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(uuid) => Some(uuid),
        Err(error) => {
            tracing::warn!("failed to register agent device {}: {error:?}", params.uuid);
            None
        }
    }
}

async fn update_agent_presence(state: &AppState, uuid: &str, online: bool) {
    let result = if online {
        sqlx::query(
            r#"
            UPDATE devices
            SET online = true,
                last_seen_at = now(),
                online_since = CASE WHEN online = false THEN now() ELSE online_since END
            WHERE uuid = $1
            "#,
        )
        .bind(uuid)
        .execute(&state.db)
        .await
    } else {
        sqlx::query("UPDATE devices SET online = false WHERE uuid = $1")
            .bind(uuid)
            .execute(&state.db)
            .await
    };

    if let Err(error) = result {
        tracing::warn!("failed to update agent presence for {uuid}: {error:?}");
    }
}

async fn resolve_device_uuid(state: &AppState, agent_id: &str) -> Option<String> {
    if let Some(hostname) = agent_id.strip_prefix("host-") {
        return sqlx::query_scalar::<_, String>(
            "SELECT uuid FROM devices WHERE lower(hostname) = lower($1) ORDER BY last_seen_at DESC NULLS LAST LIMIT 1",
        )
        .bind(hostname)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    }

    sqlx::query_scalar::<_, String>("SELECT uuid FROM devices WHERE uuid = $1 LIMIT 1")
        .bind(agent_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

#[derive(Debug, serde::Deserialize)]
struct AgentResult {
    job_id: uuid::Uuid,
    device_uuid: String,
    output: String,
    exit_code: Option<i32>,
    done: bool,
}

async fn persist_result(state: &AppState, r: AgentResult) -> anyhow::Result<()> {
    let resolved_uuid = resolve_device_uuid(state, &r.device_uuid)
        .await
        .unwrap_or(r.device_uuid);

    // Get device id from uuid
    let device_id: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT id FROM devices WHERE uuid = $1",
    )
    .bind(&resolved_uuid)
    .fetch_optional(&state.db)
    .await?;

    let Some(device_id) = device_id else { return Ok(()) };

    // Upsert result (append output)
    sqlx::query(
        r#"
        INSERT INTO exec_results (job_id, device_id, output, exit_code, done, finished_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() ELSE NULL END)
        ON CONFLICT (job_id, device_id) DO UPDATE SET
            output     = exec_results.output || EXCLUDED.output,
            exit_code  = COALESCE(EXCLUDED.exit_code, exec_results.exit_code),
            done       = EXCLUDED.done,
            finished_at = CASE WHEN EXCLUDED.done THEN now() ELSE exec_results.finished_at END
        "#,
    )
    .bind(r.job_id)
    .bind(device_id)
    .bind(&r.output)
    .bind(r.exit_code)
    .bind(r.done)
    .execute(&state.db)
    .await?;

    Ok(())
}
