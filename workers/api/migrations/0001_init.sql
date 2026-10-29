-- Feedback: one row per submission, diagnostics in the same row. The fields
-- match what the old feedback service stored as JSON files
-- (the legacy Node service, removed in 279 C1; src/feedback.js owns it now).
-- The connecting IP is deliberately not
-- stored anywhere in this database.
CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL,
    app_json TEXT NOT NULL,
    diagnostics TEXT,
    bytes INTEGER NOT NULL DEFAULT 0
);

-- One-time Pinterest session credentials: only the SHA-256 of the credential
-- is stored, never the credential itself. Expired rows are swept on mint.
CREATE TABLE pinterest_sessions (
    hash TEXT PRIMARY KEY,
    created_at_ms INTEGER NOT NULL
);

CREATE INDEX pinterest_sessions_created_at_ms_idx ON pinterest_sessions (created_at_ms);
