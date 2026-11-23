"""create appointment_reschedule_proposals table

Revision ID: b2c3d4e5f6a7
Revises: f1b2c3d4e5f6
Create Date: 2026-11-22 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'f1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Creates the appointment_reschedule_proposals table.

    Additive schema change: Preserves existing appointments table intact.
    Does not modify appointment status vocabulary or existing GiST exclusion constraints.
    """
    op.create_table(
        'appointment_reschedule_proposals',
        sa.Column('id', sa.Uuid(), nullable=False, primary_key=True),
        sa.Column('appointment_id', sa.Uuid(), nullable=False),
        sa.Column('doctor_profile_id', sa.Uuid(), nullable=False),
        sa.Column('patient_profile_id', sa.Uuid(), nullable=False),
        sa.Column('proposed_date', sa.Date(), nullable=False),
        sa.Column('proposed_start_time', sa.Time(), nullable=False),
        sa.Column('proposed_end_time', sa.Time(), nullable=False),
        sa.Column('doctor_message', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_idempotency_key', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['doctor_profile_id'], ['doctor_profiles.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['patient_profile_id'], ['patient_profiles.id'], ondelete='RESTRICT'),
        sa.CheckConstraint('proposed_start_time < proposed_end_time', name='ck_reschedule_proposal_time_range'),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')", name='ck_reschedule_proposal_status'),
    )

    # Partial unique index: at most ONE pending proposal per appointment
    op.create_index(
        'uq_appointment_active_reschedule_proposal',
        'appointment_reschedule_proposals',
        ['appointment_id'],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_index(
        'ix_reschedule_proposals_patient_status',
        'appointment_reschedule_proposals',
        ['patient_profile_id', 'status'],
    )

    op.create_index(
        'ix_reschedule_proposals_doctor_status',
        'appointment_reschedule_proposals',
        ['doctor_profile_id', 'status'],
    )

    op.create_index(
        'ix_reschedule_proposals_expires_at',
        'appointment_reschedule_proposals',
        ['expires_at'],
    )


def downgrade() -> None:
    """Reverts the appointment_reschedule_proposals table."""
    op.drop_index('ix_reschedule_proposals_expires_at', table_name='appointment_reschedule_proposals')
    op.drop_index('ix_reschedule_proposals_doctor_status', table_name='appointment_reschedule_proposals')
    op.drop_index('ix_reschedule_proposals_patient_status', table_name='appointment_reschedule_proposals')
    op.drop_index('uq_appointment_active_reschedule_proposal', table_name='appointment_reschedule_proposals')
    op.drop_table('appointment_reschedule_proposals')
