CREATE TABLE transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type        TEXT NOT NULL,
    reference_id            TEXT,
    idempotency_key         TEXT UNIQUE,
    reverses_transaction_id UUID UNIQUE REFERENCES transactions(id),
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
