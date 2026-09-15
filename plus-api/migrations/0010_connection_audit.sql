CREATE TABLE connection_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    target_rustdesk_id TEXT NOT NULL,
    target_uuid TEXT NOT NULL,
    conn_id INTEGER,
    session_id BIGINT,
    peer_rustdesk_id TEXT,
    peer_name TEXT,
    source_ip INET,
    relay_id UUID,
    source_port INTEGER,
    connection_type SMALLINT,
    initiated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'connecting'
        CHECK (status IN ('launched', 'connecting', 'active', 'closed')),
    launched_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connection_audit_nonces (
    nonce UUID PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connection_audit_tenant_started
    ON connection_audit(tenant_id, started_at DESC);
CREATE INDEX idx_connection_audit_open
    ON connection_audit(tenant_id, target_uuid, conn_id, session_id)
    WHERE ended_at IS NULL;
CREATE INDEX idx_connection_audit_open_relay
    ON connection_audit(relay_id, source_ip, source_port)
    WHERE ended_at IS NULL;
CREATE INDEX idx_connection_audit_device
    ON connection_audit(device_id, started_at DESC);


