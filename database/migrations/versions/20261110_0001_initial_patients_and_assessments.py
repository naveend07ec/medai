"""Create patients and clinical_assessments tables (non-destructive).

Revision ID: 20261110_0001
Revises:
Create Date: 2026-11-10 15:40:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261110_0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create patients and clinical_assessments tables if they do not exist."""
    bind = op.get_bind()
    existing_tables = set(sa.inspect(bind).get_table_names())

    if "patients" not in existing_tables:
        op.create_table(
            "patients",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("patient_code", sa.String(length=50), nullable=False),
            sa.Column("full_name", sa.String(length=150), nullable=False),
            sa.Column("date_of_birth", sa.Date(), nullable=False),
            sa.Column("sex", sa.String(length=20), nullable=True),
            sa.Column("contact_number", sa.String(length=20), nullable=True),
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
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_patients_patient_code"),
            "patients",
            ["patient_code"],
            unique=True,
        )

    if "clinical_assessments" not in existing_tables:
        op.create_table(
            "clinical_assessments",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("patient_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("demographics_notes", sa.Text(), nullable=True),
            sa.Column("current_symptoms", sa.Text(), nullable=True),
            sa.Column("symptom_duration", sa.String(length=120), nullable=True),
            sa.Column("previous_conditions", sa.Text(), nullable=True),
            sa.Column("existing_medications", sa.Text(), nullable=True),
            sa.Column("medical_history_notes", sa.Text(), nullable=True),
            sa.Column("systolic_bp", sa.Float(), nullable=True),
            sa.Column("diastolic_bp", sa.Float(), nullable=True),
            sa.Column("heart_rate", sa.Float(), nullable=True),
            sa.Column("body_temperature", sa.Float(), nullable=True),
            sa.Column("oxygen_saturation", sa.Float(), nullable=True),
            sa.Column("additional_measurements", sa.Text(), nullable=True),
            sa.Column("lab_results", sa.Text(), nullable=True),
            sa.Column("ehr_summary", sa.Text(), nullable=True),
            sa.Column("previous_reports", sa.Text(), nullable=True),
            sa.Column("attached_report_names", sa.JSON(), nullable=False),
            sa.Column("attached_images", sa.JSON(), nullable=False),
            sa.Column("imaging_notes", sa.Text(), nullable=True),
            sa.Column("genomic_notes", sa.Text(), nullable=True),
            sa.Column("family_history_markers", sa.Text(), nullable=True),
            sa.Column("preprocessing_summary", sa.JSON(), nullable=True),
            sa.Column("predictive_experiment_result", sa.JSON(), nullable=True),
            sa.Column(
                "clinician_reviewed",
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
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["patient_id"],
                ["patients.id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_clinical_assessments_patient_id"),
            "clinical_assessments",
            ["patient_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_clinical_assessments_created_at"),
            "clinical_assessments",
            ["created_at"],
            unique=False,
        )


def downgrade() -> None:
    """Destructive table drops are disabled to protect clinical records."""
    raise NotImplementedError(
        "Destructive downgrade is disabled to prevent dropping patient or "
        "clinical assessment tables."
    )

