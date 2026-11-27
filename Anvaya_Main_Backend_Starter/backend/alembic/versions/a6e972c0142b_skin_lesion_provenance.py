"""Persist verified inference provenance without relabeling legacy analyses."""

from alembic import op
import sqlalchemy as sa

revision = "a6e972c0142b"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None

TABLE = "skin_lesion_analyses"
PROVENANCE = (("inference_mode", 40), ("model_version", 100), ("checkpoint_sha256", 64))


def upgrade() -> None:
    # Earlier revisions never created this table. Some installations already
    # have it from metadata.create_all. Preserve every existing row in that case.
    if not sa.inspect(op.get_bind()).has_table(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("patient_profile_id", sa.Uuid(), sa.ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False),
            sa.Column("image_path", sa.String(500)),
            sa.Column("image_filename", sa.String(255)),
            sa.Column("predicted_class", sa.String(50), nullable=False),
            sa.Column("predicted_label", sa.String(150), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("probabilities", sa.JSON(), nullable=False),
            sa.Column("risk_level", sa.String(30), nullable=False),
            sa.Column("disclaimer", sa.Text(), nullable=False),
            sa.Column("education_title", sa.String(255)),
            sa.Column("education_summary", sa.Text()),
            sa.Column("reviewed_by_doctor_id", sa.Uuid(), sa.ForeignKey("doctor_profiles.id", ondelete="SET NULL")),
            sa.Column("doctor_notes", sa.Text()),
            sa.Column("reviewed_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_skin_lesion_analyses_patient", TABLE, ["patient_profile_id"])
        op.create_index("ix_skin_lesion_analyses_created_at", TABLE, ["created_at"])

    for name, length in PROVENANCE:
        op.add_column(TABLE, sa.Column(name, sa.String(length), nullable=True))


def downgrade() -> None:
    # Retain analyses and review content even if the table was created here.
    for name, _ in reversed(PROVENANCE):
        op.drop_column(TABLE, name)
