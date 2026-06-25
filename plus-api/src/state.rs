use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc::UnboundedSender, Mutex};

pub type AgentTx = UnboundedSender<String>;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    /// uuid → WebSocket sender (commands going TO the agent)
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
