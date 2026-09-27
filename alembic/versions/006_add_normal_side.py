"""add normal_side to accounts

Revision ID: 006
Revises: 005
Create Date: 2026-09-27
"""
from alembic import op

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE accounts
            ADD COLUMN normal_side TEXT NOT NULL DEFAULT 'credit'
            CONSTRAINT chk_normal_side CHECK (normal_side IN ('debit', 'credit'))
        """
    )
    # Drop the default so the application must set it explicitly going forward.
    op.execute("ALTER TABLE accounts ALTER COLUMN normal_side DROP DEFAULT")


def downgrade() -> None:
    op.execute("ALTER TABLE accounts DROP COLUMN normal_side")
