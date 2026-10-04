CREATE TABLE idempotency_keys (
    key                  TEXT PRIMARY KEY,
    request_fingerprint  TEXT NOT NULL,
    endpoint             TEXT NOT NULL,
    status               TEXT NOT NULL,
    transaction_id       UUID REFERENCES transactions(id),
    response_status      INTEGER,
    response_body        JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    CONSTRAINT chk_status CHECK (status IN ('in_progress', 'completed', 'failed'))
);
