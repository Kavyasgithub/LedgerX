-- Migration 007 (retention_policy) narrowed these triggers from
-- (UPDATE OR DELETE) to UPDATE only, but was not applied to this database.
-- Re-apply the fix here so DELETE is allowed for workspace resets and retention jobs.

DROP TRIGGER IF EXISTS trg_postings_immutable     ON postings;
DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions;

CREATE TRIGGER trg_postings_immutable
    BEFORE UPDATE ON postings
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_transactions_immutable
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Also ensure cascade delete is in place (postings deleted when transaction is deleted)
ALTER TABLE postings
    DROP CONSTRAINT IF EXISTS postings_transaction_id_fkey;

ALTER TABLE postings
    ADD CONSTRAINT postings_transaction_id_fkey
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
