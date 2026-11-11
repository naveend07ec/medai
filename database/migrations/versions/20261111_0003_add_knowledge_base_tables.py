"""Create knowledge_documents and knowledge_chunks tables (non-destructive).

Revision ID: 20261111_0003
Revises: 20261110_0002
Create Date: 2026-11-11 11:50:00
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa

revision: str = "20261111_0003"
down_revision: Union[str, Sequence[str], None] = "20261110_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create knowledge_documents and knowledge_chunks tables if they do not exist."""
    existing_tables = (
        set()
        if context.is_offline_mode()
        else set(sa.inspect(op.get_bind()).get_table_names())
    )

    if "knowledge_documents" not in existing_tables:
        op.create_table(
            "knowledge_documents",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("source_publisher", sa.String(length=200), nullable=False),
            sa.Column("publication_date", sa.Date(), nullable=True),
            sa.Column("source_url", sa.String(length=1000), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=True),
            sa.Column("content_type", sa.String(length=100), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
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
            op.f("ix_knowledge_documents_content_hash"),
            "knowledge_documents",
            ["content_hash"],
            unique=True,
        )
        op.create_index(
            op.f("ix_knowledge_documents_created_at"),
            "knowledge_documents",
            ["created_at"],
            unique=False,
        )

    if "knowledge_chunks" not in existing_tables:
        op.create_table(
            "knowledge_chunks",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("document_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("chunk_text", sa.Text(), nullable=False),
            sa.Column("section_heading", sa.String(length=255), nullable=True),
            sa.Column("page_number", sa.Integer(), nullable=True),
            sa.Column("token_estimate", sa.Integer(), nullable=True),
            sa.Column("embedding_model", sa.String(length=120), nullable=False),
            sa.Column("embedding_dimension", sa.Integer(), nullable=False),
            sa.Column("embedding_vector", sa.JSON(), nullable=False),
            sa.Column("chunk_metadata", sa.JSON(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "embedding_dimension > 0",
                name="ck_knowledge_chunks_embedding_dimension_positive",
            ),
            sa.CheckConstraint(
                "chunk_index >= 0",
                name="ck_knowledge_chunks_chunk_index_non_negative",
            ),
            sa.ForeignKeyConstraint(
                ["document_id"],
                ["knowledge_documents.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "document_id",
                "chunk_index",
                name="uq_knowledge_chunks_document_chunk_index",
            ),
        )
        op.create_index(
            op.f("ix_knowledge_chunks_document_id"),
            "knowledge_chunks",
            ["document_id"],
            unique=False,
        )


def downgrade() -> None:
    """Destructive table drops are disabled to protect ingested medical knowledge."""
    raise NotImplementedError(
        "Destructive downgrade is disabled to preserve knowledge_documents and "
        "knowledge_chunks records."
    )
