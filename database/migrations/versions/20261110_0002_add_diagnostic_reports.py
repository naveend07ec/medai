"""Create diagnostic_reports table (non-destructive).

Revision ID: 20261110_0002
Revises: 20261110_0001
Create Date: 2026-11-10 16:10:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261110_0002"
down_revision: Union[str, Sequence[str], None] = "20261110_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create diagnostic_reports table if it does not exist."""
    bind = op.get_bind()
    existing_tables = set(sa.inspect(bind).get_table_names())

    if "diagnostic_reports" not in existing_tables:
        op.create_table(
            "diagnostic_reports",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("assessment_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("provider", sa.String(length=50), nullable=False),
            sa.Column("model_name", sa.String(length=120), nullable=False),
            sa.Column("report_payload", sa.JSON(), nullable=False),
            sa.Column(
                "clinician_reviewed",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
            sa.Column("clinician_notes", sa.Text(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["assessment_id"],
                ["clinical_assessments.id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_diagnostic_reports_assessment_id"),
            "diagnostic_reports",
            ["assessment_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_diagnostic_reports_created_at"),
            "diagnostic_reports",
            ["created_at"],
            unique=False,
        )


def downgrade() -> None:
    """Destructive table drops are disabled to protect generated diagnostic reports."""
    raise NotImplementedError(
        "Destructive downgrade is disabled to preserve diagnostic_reports records."
    )

