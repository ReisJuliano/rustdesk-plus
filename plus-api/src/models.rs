use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Tenant {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub name: String,
    pub role: String,
    pub tenant_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Branch {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub tenant_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Device {
    pub id: Uuid,
    pub rustdesk_id: String,
    pub uuid: String,
    pub hostname: Option<String>,
    pub os: Option<String>,
    pub alias: Option<String>,
    pub description: Option<String>,
    pub favorite: bool,
    pub branch_id: Option<Uuid>,
    pub owner_user_id: Option<Uuid>,
    pub tenant_id: Option<Uuid>,
    #[serde(skip_serializing)]
    pub unattended_password_hash: Option<String>,
    pub ip_address: Option<String>,
    pub online_since: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub online: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Stats {
    pub total_devices: i64,
    pub online_devices: i64,
    pub offline_devices: i64,
    pub total_branches: i64,
    pub total_users: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ServerConfigRow {
    pub key: String,
    pub value: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Tag {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub tenant_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ExecResult {
    pub id: Uuid,
    pub job_id: Uuid,
    pub device_id: Uuid,
    pub output: String,
    pub exit_code: Option<i32>,
    pub done: bool,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTenant {
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUser {
    pub email: String,
    pub password: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBranch {
    pub name: String,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct PatchDevice {
    pub alias: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveServerConfig {
    pub server_ip: String,
    pub server_key: String,
    pub api_url: String,
    /// Senha de acesso remoto — escrita em tenant_config, não em server_config global
    pub rustdesk_password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetDeviceBranch {
    pub branch_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTag {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExecRequest {
    pub cmd: String,
    pub powershell: Option<bool>,
    pub targets: Option<Vec<String>>,
    pub tag_id: Option<Uuid>,
}
