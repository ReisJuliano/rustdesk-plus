use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc::UnboundedSender, Mutex};

pub type AgentTx = UnboundedSender<String>;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    /// "{tenant_id}:{device_uuid}" → WebSocket sender (comandos para o agente)
    pub agents: Arc<Mutex<HashMap<String, AgentTx>>>,
    pub installer_build: Arc<Mutex<()>>,
}

impl AppState {
    pub fn new(db: PgPool) -> Self {
        Self {
            db,
            agents: Arc::new(Mutex::new(HashMap::new())),
            installer_build: Arc::new(Mutex::new(())),
        }
    }
}

/// Chave composta usada no mapa de agentes para evitar colisão entre tenants.
pub fn agent_key(tenant_id: uuid::Uuid, device_uuid: &str) -> String {
    format!("{tenant_id}:{device_uuid}")
}
