"""create accounts table

Revision ID: 001
Revises:
Create Date: 2026-09-13
"""
from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE accounts")
