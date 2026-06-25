use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    auth::{hash_password, issue_token},
    config::{self, ServerConfig},
    error::AppError,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/setup/status", get(status))
        .route("/setup", post(setup))
}

async fn status(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let configured: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
            .fetch_one(&state.db)
            .await?;
    let config = config::load(&state.db).await?;
    Ok(Json(json!({
        "configured": configured,
        "server_ip": config.server_ip,
        "server_key": config.server_key,
        "api_url": config.api_url,
    })))
}

#[derive(Debug, Deserialize)]
struct SetupRequest {
    email: String,
    password: String,
    name: String,
    server_ip: String,
    api_url: String,
}

async fn setup(
    State(state): State<AppState>,
    Json(body): Json<SetupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let configured: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
            .fetch_one(&state.db)
            .await?;
    if configured {
        return Err(AppError::Forbidden);
    }
    if body.email.trim().is_empty()
        || body.password.len() < 8
        || body.server_ip.trim().is_empty()
        || body.api_url.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "preencha os dados; a senha deve ter pelo menos 8 caracteres".to_string(),
        ));
    }

    let password_hash = hash_password(&body.password)?;
    let user = sqlx::query_as::<_, crate::models::User>(
        "INSERT INTO users (email, password_hash, name, role) \
         VALUES ($1, $2, $3, 'admin') RETURNING *",
    )
    .bind(body.email.trim())
    .bind(password_hash)
    .bind(body.name.trim())
    .fetch_one(&state.db)
    .await?;

    let current = config::load(&state.db).await?;
    config::save(
        &state.db,
        &ServerConfig {
            server_ip: body.server_ip.trim().to_string(),
            server_key: current.server_key,
            api_url: body.api_url.trim_end_matches('/').to_string(),
        },
    )
    .await?;

    let token = issue_token(user.id, &user.role)?;
    Ok(Json(json!({ "token": token, "user": user })))
}
