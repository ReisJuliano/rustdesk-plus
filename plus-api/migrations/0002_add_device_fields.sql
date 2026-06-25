ALTER TABLE devices
  ADD COLUMN favorite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN alias TEXT,
  ADD COLUMN description TEXT;

CREATE TABLE server_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
