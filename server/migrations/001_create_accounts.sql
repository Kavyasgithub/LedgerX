CREATE TABLE accounts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT NOT NULL UNIQUE,
    account_type     TEXT NOT NULL,
    currency         CHAR(3) NOT NULL,
    allows_negative  BOOLEAN NOT NULL DEFAULT FALSE,
    cached_balance   BIGINT NOT NULL DEFAULT 0,
    version          BIGINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_currency CHECK (currency ~ '^[A-Z]{3}$')
);
