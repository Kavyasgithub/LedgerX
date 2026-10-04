CREATE TABLE holds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL,
    status          TEXT NOT NULL,
    transaction_id  UUID REFERENCES transactions(id),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_hold_status CHECK (status IN ('active', 'consumed', 'released', 'expired'))
);

CREATE INDEX idx_holds_active
    ON holds (account_id) WHERE status = 'active';
