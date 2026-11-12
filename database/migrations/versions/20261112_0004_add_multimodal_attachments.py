"""Create assessment_attachments table for multimodal documents and medical images.

Revision ID: 20261112_0004
Revises: 20261111_0003
Create Date: 2026-11-12 11:55:00
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa

revision: str = "20261112_0004"
down_revision: Union[str, Sequence[str], None] = "20261111_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create assessment_attachments table if it does not already exist."""
    existing_tables = (
        set()
        if context.is_offline_mode()
        else set(sa.inspect(op.get_bind()).get_table_names())
    )

    if "assessment_attachments" not in existing_tables:
        op.create_table(
            "assessment_attachments",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("assessment_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("kind", sa.String(length=20), nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("mime_type", sa.String(length=100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("storage_path", sa.String(length=500), nullable=False),
            sa.Column("modality", sa.String(length=50), nullable=False),
            sa.Column("extraction_status", sa.String(length=30), nullable=False),
            sa.Column("extracted_text", sa.Text(), nullable=True),
            sa.Column("extraction_note", sa.Text(), nullable=True),
            sa.Column(
                "exif_stripped",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["assessment_id"],
                ["clinical_assessments.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_assessment_attachments_assessment_id"),
            "assessment_attachments",
            ["assessment_id"],
            unique=False,
        )


def downgrade() -> None:
    """Drop assessment_attachments table."""
    op.drop_index(
        op.f("ix_assessment_attachments_assessment_id"),
        table_name="assessment_attachments",
    )
    op.drop_table("assessment_attachments")

