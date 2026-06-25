mod auth;
mod config;
mod db;
mod error;
mod installer;
mod models;
mod routes;
mod state;

use axum::{routing::get, Router};
use state::AppState;
use std::net::SocketAddr;

async fn health() -> &'static str {
    "ok"
}

async fn bootstrap_admin(db: &sqlx::PgPool) -> anyhow::Result<()> {
    let (email, password) = match (std::env::var("ADMIN_EMAIL"), std::env::var("ADMIN_PASSWORD")) {
        (Ok(e), Ok(p)) => (e, p),
        _ => return Ok(()),
    };

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(db)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let password_hash = auth::hash_password(&password)?;
    sqlx::query(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')",
    )
    .bind(&email)
    .bind(&password_hash)
    .bind("Admin")
    .execute(db)
    .await?;
    tracing::info!("bootstrapped initial admin user {email}");
    Ok(())
}

async fn offline_sweeper(db: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    loop {
        interval.tick().await;
        let result = sqlx::query(
            "UPDATE devices SET online = false WHERE online = true AND last_seen_at < now() - interval '60 seconds'",
        )
        .execute(&db)
        .await;
        if let Err(e) = result {
            tracing::warn!("offline sweeper failed: {e:?}");
        }
    }
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let db = db::connect().await.expect("failed to connect to database");
    bootstrap_admin(&db).await.expect("failed to bootstrap admin user");
    config::synchronize(&db)
        .await
        .expect("failed to synchronize server configuration");
    let state = AppState::new(db.clone());

    tokio::spawn(offline_sweeper(db));

    let app = Router::new()
        .route("/health", get(health))
        .merge(routes::admin::router())
        .merge(routes::client::router())
        .merge(routes::agent::router())
        .merge(routes::setup::router())
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:21114".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind plus-api listener on {bind_addr}: {e}"));

    tracing::info!("plus-api listening on {bind_addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("server error");
}
