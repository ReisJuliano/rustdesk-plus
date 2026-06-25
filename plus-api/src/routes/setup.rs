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
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenants)")
            .fetch_one(&state.db)
            .await?;
    let cfg = config::load(&state.db).await?;
    Ok(Json(json!({
        "configured": configured,
        "server_ip": cfg.server_ip,
        "server_key": cfg.server_key,
        "api_url": cfg.api_url,
    })))
}

#[derive(Debug, Deserialize)]
struct SetupRequest {
    email: String,
    password: String,
    name: String,
    server_ip: String,
    api_url: String,
    /// Nome do primeiro tenant (empresa do dono)
    tenant_name: String,
}

async fn setup(
    State(state): State<AppState>,
    Json(body): Json<SetupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let configured: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenants)")
            .fetch_one(&state.db)
            .await?;
    if configured {
        return Err(AppError::Forbidden);
    }
    if body.email.trim().is_empty()
        || body.password.len() < 8
        || body.server_ip.trim().is_empty()
        || body.api_url.trim().is_empty()
        || body.tenant_name.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "preencha todos os campos; a senha deve ter pelo menos 8 caracteres".to_string(),
        ));
    }

    // Slug derivado do nome do tenant
    let slug = body
        .tenant_name
        .trim()
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();

    // 1. Cria o primeiro tenant
    let tenant_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
    )
    .bind(body.tenant_name.trim())
    .bind(&slug)
    .fetch_one(&state.db)
    .await?;

    // 2. Cria o super admin (tenant_id = NULL)
    let password_hash = hash_password(&body.password)?;
    let user = sqlx::query_as::<_, crate::models::User>(
        "INSERT INTO users (email, password_hash, name, role, tenant_id) \
         VALUES ($1, $2, $3, 'super_admin', NULL) RETURNING *",
    )
    .bind(body.email.trim())
    .bind(password_hash)
    .bind(body.name.trim())
    .fetch_one(&state.db)
    .await?;

    // 3. Salva config global do servidor
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

    // 4. Gera senha e código de instalação do primeiro tenant
    config::ensure_tenant_password(&state.db, tenant_id).await?;
    config::ensure_tenant_install_code(&state.db, tenant_id).await?;

    let token = issue_token(user.id, &user.role, None)?;
    Ok(Json(json!({ "token": token, "user": user, "tenant_id": tenant_id })))
}
