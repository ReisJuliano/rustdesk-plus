CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE device_tags (
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    tag_id    UUID NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    PRIMARY KEY (device_id, tag_id)
);

CREATE TABLE exec_jobs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cmd        TEXT NOT NULL,
    powershell BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exec_results (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id     UUID NOT NULL REFERENCES exec_jobs(id) ON DELETE CASCADE,
    device_id  UUID NOT NULL REFERENCES devices(id)  ON DELETE CASCADE,
    output     TEXT NOT NULL DEFAULT '',
    exit_code  INTEGER,
    done       BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (job_id, device_id)
);

CREATE INDEX idx_exec_results_job ON exec_results(job_id);
