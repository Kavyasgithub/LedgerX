CREATE TABLE postings (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  UUID NOT NULL REFERENCES transactions(id),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    amount          BIGINT NOT NULL,
    currency        CHAR(3) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX idx_postings_account_time
    ON postings (account_id, created_at DESC, id DESC);

CREATE INDEX idx_postings_transaction
    ON postings (transaction_id);

-- Zero-sum enforcement (deferred to commit time)
CREATE FUNCTION assert_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE total BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO total
    FROM postings WHERE transaction_id = NEW.transaction_id;
    IF total <> 0 THEN
        RAISE EXCEPTION 'Unbalanced transaction %: postings sum to %',
            NEW.transaction_id, total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_balanced
    AFTER INSERT ON postings
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION assert_transaction_balanced();

-- Immutability: no UPDATE or DELETE ever
CREATE FUNCTION forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger records are immutable (table %)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_postings_immutable
    BEFORE UPDATE OR DELETE ON postings
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_transactions_immutable
    BEFORE UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Currency agreement
CREATE FUNCTION assert_currency_match() RETURNS TRIGGER AS $$
DECLARE acct_currency CHAR(3);
BEGIN
    SELECT currency INTO acct_currency FROM accounts WHERE id = NEW.account_id;
    IF acct_currency <> NEW.currency THEN
        RAISE EXCEPTION 'Currency mismatch: posting % vs account %',
            NEW.currency, acct_currency;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_currency_match
    BEFORE INSERT ON postings
    FOR EACH ROW EXECUTE FUNCTION assert_currency_match();
