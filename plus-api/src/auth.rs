use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::FromRequestParts, http::request::Parts, RequestPartsExt};
use axum_extra::headers::{authorization::Bearer, Authorization};
use axum_extra::TypedHeader;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-insecure-secret-change-me".to_string())
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hash error: {e}"))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub role: String,
    /// None para super_admin (sem tenant fixo)
    pub tid: Option<Uuid>,
    pub exp: usize,
}

pub fn issue_token(user_id: Uuid, role: &str, tenant_id: Option<Uuid>) -> anyhow::Result<String> {
    let exp = (chrono::Utc::now() + chrono::Duration::days(7)).timestamp() as usize;
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        tid: tenant_id,
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret().as_bytes()),
    )?;
    Ok(token)
}

pub struct AuthUser {
    pub id: Uuid,
    pub role: String,
    pub tenant_id: Option<Uuid>,
}

impl AuthUser {
    pub fn is_super_admin(&self) -> bool {
        self.role == "super_admin"
    }

    pub fn require_admin(&self) -> Result<(), AppError> {
        if self.role == "admin" || self.role == "super_admin" {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    /// Retorna o tenant efetivo: usa override (header X-Tenant-Id) se super_admin,
    /// senão usa o tenant do próprio token.
    pub fn effective_tenant(&self, override_tid: Option<Uuid>) -> Result<Uuid, AppError> {
        if self.is_super_admin() {
            override_tid.ok_or_else(|| {
                AppError::BadRequest("super admin precisa do header X-Tenant-Id".to_string())
            })
        } else {
            self.tenant_id.ok_or(AppError::Forbidden)
        }
    }
}

#[async_trait::async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let TypedHeader(Authorization(bearer)) = parts
            .extract::<TypedHeader<Authorization<Bearer>>>()
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let data = decode::<Claims>(
            bearer.token(),
            &DecodingKey::from_secret(jwt_secret().as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized)?;

        Ok(AuthUser {
            id: data.claims.sub,
            role: data.claims.role,
            tenant_id: data.claims.tid,
        })
    }
}
