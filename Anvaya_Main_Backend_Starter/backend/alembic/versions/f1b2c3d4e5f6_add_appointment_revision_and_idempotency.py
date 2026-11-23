"""add appointment revision and idempotency key

Revision ID: f1b2c3d4e5f6
Revises: e9c3d4a5b678
Create Date: 2026-11-21 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'e9c3d4a5b678'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'appointments',
        sa.Column('revision', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'appointments',
        sa.Column('last_idempotency_key', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('appointments', 'last_idempotency_key')
    op.drop_column('appointments', 'revision')
