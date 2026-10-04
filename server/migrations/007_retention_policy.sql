-- Retention policy: allow DELETE for automated cleanup, keep UPDATE blocked.
-- The immutability guarantee is "no one edits a record in place" — not "records
-- live forever". Financial systems typically have a data-retention window.

-- Narrow the immutability triggers from (UPDATE OR DELETE) → UPDATE only
DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions;
DROP TRIGGER IF EXISTS trg_postings_immutable     ON postings;

CREATE TRIGGER trg_transactions_immutable
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_postings_immutable
    BEFORE UPDATE ON postings
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Cascade: deleting a transaction automatically removes its postings
ALTER TABLE postings
    DROP CONSTRAINT postings_transaction_id_fkey,
    ADD  CONSTRAINT postings_transaction_id_fkey
         FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

-- Index to make the nightly age-off query fast
CREATE INDEX IF NOT EXISTS idx_transactions_created_at
    ON transactions (created_at);
