"""add health_record encryption_version

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-24 21:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Adds encryption_version column to health_records.

    Additive schema change (Gate 2B Phase 3C-2A / Hardened Phase 3C-2C):
    - Column: health_records.encryption_version
    - Type: INTEGER, nullable=False, server_default='0'
    - Semantics:
        0 = legacy plaintext storage (all existing historical records)
        1 = authenticated AES-256-GCM ciphertext envelope storage
    - Check Constraint: ck_health_records_encryption_version (0 or 1)

    PostgreSQL Locking & Safety Analysis:
    1. ADD COLUMN with a constant DEFAULT:
       On PostgreSQL 11+, 'ADD COLUMN ... DEFAULT 0' executes as an O(1)
       metadata-only operation without rewriting the table.
       However, it still requires an ACCESS EXCLUSIVE lock on 'health_records'.

    2. Two-Phase Constraint Addition (Reduced-Lock Pattern):
       - Step 1: 'ADD CONSTRAINT ... CHECK (...) NOT VALID;'
         Acquires a brief ACCESS EXCLUSIVE lock but skips the table validation scan.
       - Step 2: 'VALIDATE CONSTRAINT ...;'
         Scans existing rows under a weaker SHARE UPDATE EXCLUSIVE lock, which
         permits concurrent SELECT, INSERT, UPDATE, and DELETE operations.

    CRITICAL TRANSACTION LOCKING CAVEAT:
    Alembic migrations default to a single transactional block (transactional_ddl = True).
    Under PostgreSQL transaction semantics, locks acquired in a transaction (including
    ACCESS EXCLUSIVE from ADD COLUMN) are held until COMMIT. Therefore, executing
    ADD CONSTRAINT NOT VALID followed by VALIDATE CONSTRAINT in the same transaction
    does NOT release the ACCESS EXCLUSIVE lock before VALIDATE CONSTRAINT executes.
    In very large production tables with millions of rows, true lock minimization
    requires splitting VALIDATE CONSTRAINT into a separately committed post-deploy phase.
    On moderate tables, the two-phase syntax remains PostgreSQL best practice.
    """
    op.add_column(
        "health_records",
        sa.Column(
            "encryption_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Two-phase reduced-lock constraint addition for PostgreSQL
        op.execute(
            sa.text(
                "ALTER TABLE health_records "
                "ADD CONSTRAINT ck_health_records_encryption_version "
                "CHECK (encryption_version IN (0, 1)) NOT VALID"
            )
        )
        op.execute(
            sa.text(
                "ALTER TABLE health_records "
                "VALIDATE CONSTRAINT ck_health_records_encryption_version"
            )
        )
    else:
        # Standard generic dialect fallback (e.g. SQLite unit tests)
        op.create_check_constraint(
            "ck_health_records_encryption_version",
            "health_records",
            "encryption_version IN (0, 1)",
        )


def downgrade() -> None:
    """Removes encryption_version check constraint and column.

    CRITICAL SAFETY WARNING:
    Downgrading is unsafe if records with encryption_version = 1 exist in the database.
    Dropping this column would leave ciphertext envelopes in clinical text columns
    without version metadata to identify them as encrypted, permanently breaking
    read operations. Ensure all records are backfilled/decrypted to version 0 before
    executing downgrade in any environment.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "ALTER TABLE health_records "
                "DROP CONSTRAINT IF EXISTS ck_health_records_encryption_version"
            )
        )
        op.drop_column("health_records", "encryption_version")
    else:
        op.drop_constraint(
            "ck_health_records_encryption_version",
            "health_records",
            type_="check",
        )
        op.drop_column("health_records", "encryption_version")
