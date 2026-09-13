"""create transactions table

Revision ID: 002
Revises: 001
Create Date: 2026-09-13
"""
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE transactions (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_type        TEXT NOT NULL,
            reference_id            TEXT,
            idempotency_key         TEXT UNIQUE,
            reverses_transaction_id UUID UNIQUE REFERENCES transactions(id),
            metadata                JSONB NOT NULL DEFAULT '{}',
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE transactions")
