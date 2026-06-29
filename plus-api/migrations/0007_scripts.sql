-- Scripts: definições de automação (criador visual)
CREATE TABLE scripts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    definition  JSONB       NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scripts_tenant ON scripts(tenant_id);

-- Execuções de scripts (uma por disparo)
CREATE TABLE script_runs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id    UUID        REFERENCES scripts(id) ON DELETE SET NULL,
    script_name  TEXT        NOT NULL,
    tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    triggered_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    target_type  TEXT        NOT NULL,  -- 'all' | 'devices' | 'tag'
    target_ids   TEXT[]      NOT NULL DEFAULT '{}',
    status       TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|partial
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
CREATE INDEX idx_script_runs_tenant  ON script_runs(tenant_id);
CREATE INDEX idx_script_runs_script  ON script_runs(script_id);
CREATE INDEX idx_script_runs_created ON script_runs(created_at DESC);

-- Resultado por device por execução
CREATE TABLE script_run_results (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID        NOT NULL REFERENCES script_runs(id) ON DELETE CASCADE,
    device_id   UUID        NOT NULL REFERENCES devices(id)    ON DELETE CASCADE,
    status      TEXT        NOT NULL DEFAULT 'pending',   -- pending|running|done|failed
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, device_id)
);
CREATE INDEX idx_script_run_results_run ON script_run_results(run_id);

-- Resultado por passo (nó) por device por execução
CREATE TABLE script_run_steps (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_result_id UUID        NOT NULL REFERENCES script_run_results(id) ON DELETE CASCADE,
    node_id       TEXT        NOT NULL,
    node_label    TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
    output        TEXT        NOT NULL DEFAULT '',
    exit_code     INTEGER,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    UNIQUE (run_result_id, node_id)
);
CREATE INDEX idx_script_run_steps_result ON script_run_steps(run_result_id);
