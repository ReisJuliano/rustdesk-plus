-- ─── Tenants ────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Senha e outras configs isoladas por tenant
CREATE TABLE tenant_config (
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

-- ─── Adicionar tenant_id nas tabelas existentes ───────────────────────────────

ALTER TABLE branches  ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE users     ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE devices   ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tags       ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE exec_jobs ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- ─── Role super_admin ─────────────────────────────────────────────────────────

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('super_admin', 'admin', 'operator', 'viewer'));

-- ─── Dropar constraints únicas globais (conflito com multi-tenant) ────────────

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_rustdesk_id_key;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_uuid_key;
ALTER TABLE tags    DROP CONSTRAINT IF EXISTS tags_name_key;
ALTER TABLE users   DROP CONSTRAINT IF EXISTS users_email_key;

-- ─── Adicionar constraints únicas compostas por tenant ───────────────────────

ALTER TABLE devices ADD CONSTRAINT devices_tenant_rustdesk_id_key UNIQUE (tenant_id, rustdesk_id);
ALTER TABLE devices ADD CONSTRAINT devices_tenant_uuid_key         UNIQUE (tenant_id, uuid);
ALTER TABLE tags    ADD CONSTRAINT tags_tenant_name_key            UNIQUE (tenant_id, name);
ALTER TABLE users   ADD CONSTRAINT users_tenant_email_key          UNIQUE (tenant_id, email);

-- ─── Índices ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_tenants_slug       ON tenants(slug);
CREATE INDEX idx_branches_tenant    ON branches(tenant_id);
CREATE INDEX idx_users_tenant       ON users(tenant_id);
CREATE INDEX idx_devices_tenant     ON devices(tenant_id);
CREATE INDEX idx_tags_tenant        ON tags(tenant_id);
CREATE INDEX idx_exec_jobs_tenant   ON exec_jobs(tenant_id);
