"""create consent_requests table

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-23 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Creates the consent_requests table.

    Additive schema change: Preserves existing consent_records and health_records intact.
    Retains full patient sovereignty: pending consent requests grant zero EHR access.
    """
    op.create_table(
        'consent_requests',
        sa.Column('id', sa.Uuid(), nullable=False, primary_key=True),
        sa.Column('doctor_profile_id', sa.Uuid(), nullable=False),
        sa.Column('patient_profile_id', sa.Uuid(), nullable=False),
        sa.Column('requested_scopes', sa.JSON(), nullable=False),
        sa.Column('approved_scopes', sa.JSON(), nullable=True),
        sa.Column('doctor_message', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('consent_record_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_idempotency_key', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['doctor_profile_id'], ['doctor_profiles.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['patient_profile_id'], ['patient_profiles.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['consent_record_id'], ['consent_records.id'], ondelete='SET NULL'),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'partially_approved', 'declined', 'expired', 'superseded')",
            name='ck_consent_request_status',
        ),
        sa.CheckConstraint('expires_at > created_at', name='ck_consent_request_expiry'),
    )

    # Partial unique index: at most ONE pending request per (doctor, patient) pair
    op.create_index(
        'uq_active_consent_request_doctor_patient',
        'consent_requests',
        ['doctor_profile_id', 'patient_profile_id'],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_index(
        'ix_consent_requests_patient_status',
        'consent_requests',
        ['patient_profile_id', 'status'],
    )
    op.create_index(
        'ix_consent_requests_doctor_status',
        'consent_requests',
        ['doctor_profile_id', 'status'],
    )
    op.create_index(
        'ix_consent_requests_doctor_patient_status',
        'consent_requests',
        ['doctor_profile_id', 'patient_profile_id', 'status'],
    )
    op.create_index(
        'ix_consent_requests_expires_at',
        'consent_requests',
        ['expires_at'],
    )


def downgrade() -> None:
    """Drops the consent_requests table and its indexes."""
    op.drop_index('ix_consent_requests_expires_at', table_name='consent_requests')
    op.drop_index('ix_consent_requests_doctor_patient_status', table_name='consent_requests')
    op.drop_index('ix_consent_requests_doctor_status', table_name='consent_requests')
    op.drop_index('ix_consent_requests_patient_status', table_name='consent_requests')
    op.drop_index(
        'uq_active_consent_request_doctor_patient',
        table_name='consent_requests',
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_table('consent_requests')
