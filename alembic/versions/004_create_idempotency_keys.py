"""create idempotency_keys table

Revision ID: 004
Revises: 003
Create Date: 2026-09-13
"""
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE idempotency_keys")
