
"""add doctor appointment overlap protection

Revision ID: 2a67f520e83c
Revises: b7f4c2a91d63
Create Date: 2026-11-14 16:45:50.034062

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a67f520e83c'
down_revision: Union[str, Sequence[str], None] = 'b7f4c2a91d63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Prevent overlapping booked appointments for the same doctor."""

    # Required for GiST equality support on doctor_profile_id.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # Prevent overlapping booked appointments for the same doctor.
    # [) means the end time is excluded, so adjacent slots are allowed.
    op.execute("""
        ALTER TABLE appointments
        ADD CONSTRAINT ex_appointments_doctor_no_booked_overlap
        EXCLUDE USING gist (
            doctor_profile_id WITH =,
            tsrange(
                appointment_date + start_time,
                appointment_date + end_time,
                '[)'
            ) WITH &&
        )
        WHERE (status = 'booked')
    """)


def downgrade() -> None:
    """Remove the doctor appointment overlap protection."""

    op.execute("""
        ALTER TABLE appointments
        DROP CONSTRAINT IF EXISTS
        ex_appointments_doctor_no_booked_overlap
    """)
