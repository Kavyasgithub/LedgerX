"""create holds table

Revision ID: 005
Revises: 004
Create Date: 2026-09-13
"""
from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_holds_active
            ON holds (account_id) WHERE status = 'active'
    """)


def downgrade() -> None:
    op.execute("DROP TABLE holds")
