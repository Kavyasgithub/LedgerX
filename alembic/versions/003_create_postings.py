"""create postings table and triggers

Revision ID: 003
Revises: 002
Create Date: 2026-09-13
"""
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE postings (
            id              BIGSERIAL PRIMARY KEY,
            transaction_id  UUID NOT NULL REFERENCES transactions(id),
            account_id      UUID NOT NULL REFERENCES accounts(id),
            amount          BIGINT NOT NULL,
            currency        CHAR(3) NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT chk_amount_nonzero CHECK (amount <> 0)
        )
    """)

    op.execute("""
        CREATE INDEX idx_postings_account_time
            ON postings (account_id, created_at DESC, id DESC)
    """)

    op.execute("""
        CREATE INDEX idx_postings_transaction
            ON postings (transaction_id)
    """)

    # Trigger 1 — zero-sum enforcement (deferred to commit time)
    op.execute("""
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
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE CONSTRAINT TRIGGER trg_balanced
            AFTER INSERT ON postings
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION assert_transaction_balanced()
    """)

    # Trigger 2 — immutability (no UPDATE or DELETE ever)
    op.execute("""
        CREATE FUNCTION forbid_mutation() RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'Ledger records are immutable (table %)', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER trg_postings_immutable
            BEFORE UPDATE OR DELETE ON postings
            FOR EACH ROW EXECUTE FUNCTION forbid_mutation()
    """)

    op.execute("""
        CREATE TRIGGER trg_transactions_immutable
            BEFORE UPDATE OR DELETE ON transactions
            FOR EACH ROW EXECUTE FUNCTION forbid_mutation()
    """)

    # Trigger 3 — currency agreement
    op.execute("""
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
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER trg_currency_match
            BEFORE INSERT ON postings
            FOR EACH ROW EXECUTE FUNCTION assert_currency_match()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_currency_match ON postings")
    op.execute("DROP FUNCTION IF EXISTS assert_currency_match")
    op.execute("DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions")
    op.execute("DROP TRIGGER IF EXISTS trg_postings_immutable ON postings")
    op.execute("DROP FUNCTION IF EXISTS forbid_mutation")
    op.execute("DROP TRIGGER IF EXISTS trg_balanced ON postings")
    op.execute("DROP FUNCTION IF EXISTS assert_transaction_balanced")
    op.execute("DROP TABLE postings")
