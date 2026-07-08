-- Branding + estado de build do "Cliente Customizado" por tenant.
CREATE TABLE IF NOT EXISTS tenant_branding (
    tenant_id     UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    app_name      TEXT NOT NULL DEFAULT '',
    file_name     TEXT NOT NULL DEFAULT '',
    comp_name     TEXT NOT NULL DEFAULT '',
    url_link      TEXT NOT NULL DEFAULT '',
    custom_config TEXT NOT NULL DEFAULT '',
    icon_png      BYTEA,
    rustdesk_ref  TEXT NOT NULL DEFAULT '1.4.8',
    -- idle | queued | building | ready | failed
    build_status  TEXT NOT NULL DEFAULT 'idle',
    build_run_id  BIGINT,
    -- caminho local do .exe (backend local) ou URL pública/presigned (backend s3)
    artifact_url  TEXT,
    build_error   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    built_at      TIMESTAMPTZ
);
