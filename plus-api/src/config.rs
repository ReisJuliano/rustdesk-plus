use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerConfig {
    pub server_ip: String,
    pub server_key: String,
    pub api_url: String,
}

async fn upsert(db: &PgPool, key: &str, value: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO server_config (key, value, updated_at) VALUES ($1, $2, now()) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn synchronize(db: &PgPool) -> anyhow::Result<()> {
    let key_path = std::env::var("RUSTDESK_KEY_PATH")
        .unwrap_or_else(|_| "/rustdesk-data/id_ed25519.pub".to_string());
    if let Ok(key) = tokio::fs::read_to_string(key_path).await {
        let key = key.trim();
        if !key.is_empty() {
            upsert(db, "server_key", key).await?;
        }
    }

    for (env_key, config_key) in [
        ("PUBLIC_HOST", "server_ip"),
        ("PUBLIC_API_URL", "api_url"),
    ] {
        if let Ok(value) = std::env::var(env_key) {
            if !value.trim().is_empty() {
                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM server_config WHERE key = $1 AND value <> '')",
                )
                .bind(config_key)
                .fetch_one(db)
                .await?;
                if !exists {
                    upsert(db, config_key, value.trim()).await?;
                }
            }
        }
    }

    if let Some(host) =
        sqlx::query_scalar::<_, String>("SELECT value FROM server_config WHERE key = 'server_ip'")
            .fetch_optional(db)
            .await?
    {
        write_public_host(host.trim()).await?;
    }
    Ok(())
}

pub async fn load(db: &PgPool) -> anyhow::Result<ServerConfig> {
    synchronize(db).await?;
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM server_config").fetch_all(db).await?;
    let mut config = ServerConfig {
        server_ip: String::new(),
        server_key: String::new(),
        api_url: String::new(),
    };
    for (key, value) in rows {
        match key.as_str() {
            "server_ip" => config.server_ip = value,
            "server_key" => config.server_key = value,
            "api_url" => config.api_url = value,
            _ => {}
        }
    }
    Ok(config)
}

pub async fn save(db: &PgPool, config: &ServerConfig) -> anyhow::Result<()> {
    upsert(db, "server_ip", config.server_ip.trim()).await?;
    upsert(db, "server_key", config.server_key.trim()).await?;
    upsert(db, "api_url", config.api_url.trim_end_matches('/')).await?;
    write_public_host(config.server_ip.trim()).await?;
    invalidate_installer().await;
    Ok(())
}

pub async fn write_public_host(host: &str) -> anyhow::Result<()> {
    if host.is_empty() {
        return Ok(());
    }
    let path = std::env::var("DEPLOYMENT_HOST_PATH")
        .unwrap_or_else(|_| "/deployment/public_host".to_string());
    if let Some(parent) = Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(path, host.as_bytes()).await?;
    Ok(())
}

pub async fn invalidate_installer() {
    let path = std::env::var("INSTALLER_PATH")
        .unwrap_or_else(|_| "/app/generated/rustdesk-installer.exe".to_string());
    let _ = tokio::fs::remove_file(path).await;
    let _ = tokio::fs::remove_file("/app/generated/installer-config.json").await;
}
