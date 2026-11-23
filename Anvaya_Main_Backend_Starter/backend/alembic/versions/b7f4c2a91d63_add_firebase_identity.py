"""add Firebase identity to users

Revision ID: b7f4c2a91d63
Revises: d2a8b3ab2c4d
Create Date: 2026-11-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7f4c2a91d63"
down_revision: Union[str, Sequence[str], None] = "d2a8b3ab2c4d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=True,
    )

    op.add_column(
        "users",
        sa.Column("firebase_uid", sa.String(length=128), nullable=True),
    )

    op.create_index(
        "ix_users_firebase_uid",
        "users",
        ["firebase_uid"],
        unique=True,
    )


def downgrade() -> None:
    connection = op.get_bind()

    has_passwordless_users = connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM users WHERE password_hash IS NULL)")
    ).scalar_one()

    if has_passwordless_users:
        raise RuntimeError(
            "Cannot downgrade: passwordless Firebase users exist. "
            "Preserve their authentication before reverting this migration."
        )

    op.drop_index("ix_users_firebase_uid", table_name="users")
    op.drop_column("users", "firebase_uid")

    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=False,
    )
