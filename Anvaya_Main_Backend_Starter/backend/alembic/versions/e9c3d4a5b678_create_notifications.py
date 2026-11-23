"""create notifications table

Revision ID: e9c3d4a5b678
Revises: c8e19b450f21
Create Date: 2026-11-21 22:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9c3d4a5b678'
down_revision: Union[str, Sequence[str], None] = 'c8e19b450f21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create notifications table
    op.create_table(
        'notifications',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('recipient_user_id', sa.Uuid(), nullable=False),
        sa.Column('notification_type', sa.String(length=60), nullable=False),
        sa.Column('title', sa.String(length=150), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('related_entity_type', sa.String(length=50), nullable=True),
        sa.Column('related_entity_id', sa.String(length=64), nullable=True),
        sa.Column('safe_action_path', sa.String(length=255), nullable=True),
        sa.Column('idempotency_key', sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(['recipient_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # 2. Create single-column indexes
    op.create_index(
        op.f('ix_notifications_recipient_user_id'),
        'notifications',
        ['recipient_user_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_notification_type'),
        'notifications',
        ['notification_type'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_is_read'),
        'notifications',
        ['is_read'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_created_at'),
        'notifications',
        ['created_at'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_idempotency_key'),
        'notifications',
        ['idempotency_key'],
        unique=True,
    )

    # 3. Create composite covered indexes
    op.create_index(
        'ix_notifications_recipient_unread',
        'notifications',
        ['recipient_user_id', 'is_read', 'created_at'],
        unique=False,
    )
    op.create_index(
        'ix_notifications_recipient_created',
        'notifications',
        ['recipient_user_id', 'created_at'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_notifications_recipient_created', table_name='notifications')
    op.drop_index('ix_notifications_recipient_unread', table_name='notifications')
    op.drop_index(op.f('ix_notifications_idempotency_key'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_is_read'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_notification_type'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_recipient_user_id'), table_name='notifications')
    op.drop_table('notifications')
