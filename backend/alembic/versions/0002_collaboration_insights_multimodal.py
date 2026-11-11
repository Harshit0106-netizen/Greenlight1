"""collaboration, recurring insights and multimodal review inputs

Revision ID: 0002_collaboration_insights_multimodal
Revises: 0001_initial_schema
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_collaboration_insights_multimodal"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("review", sa.Column("assigned_reviewer_id", sa.String(length=20), nullable=True))
    op.add_column("review", sa.Column("escalation_reason", sa.Text(), nullable=False, server_default=""))
    op.add_column("review", sa.Column("content_type", sa.String(length=30), nullable=False, server_default="text"))
    op.add_column("review", sa.Column("external_ref", sa.String(length=300), nullable=True))
    op.add_column("review", sa.Column("content_blocks", sa.JSON(), nullable=False, server_default="[]"))
    op.create_index("ix_review_assigned_reviewer_id", "review", ["assigned_reviewer_id"])
    op.create_foreign_key("fk_review_assigned_reviewer", "review", "app_user", ["assigned_reviewer_id"], ["id"])

    op.create_table(
        "review_assignment",
        sa.Column("pk", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_id", sa.String(length=20), nullable=False),
        sa.Column("reviewer_id", sa.String(length=20), nullable=False),
        sa.Column("assigned_by", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["review.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["app_user.id"]),
        sa.ForeignKeyConstraint(["assigned_by"], ["app_user.id"]),
        sa.PrimaryKeyConstraint("pk"),
    )
    op.create_index("ix_review_assignment_review_id", "review_assignment", ["review_id"])
    op.create_index("ix_review_assignment_reviewer_id", "review_assignment", ["reviewer_id"])

    op.create_table(
        "review_escalation",
        sa.Column("pk", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_id", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["review_id"], ["review.id"]),
        sa.ForeignKeyConstraint(["actor_id"], ["app_user.id"]),
        sa.PrimaryKeyConstraint("pk"),
    )
    op.create_index("ix_review_escalation_review_id", "review_escalation", ["review_id"])


def downgrade() -> None:
    op.drop_index("ix_review_escalation_review_id", table_name="review_escalation")
    op.drop_table("review_escalation")
    op.drop_index("ix_review_assignment_reviewer_id", table_name="review_assignment")
    op.drop_index("ix_review_assignment_review_id", table_name="review_assignment")
    op.drop_table("review_assignment")
    op.drop_constraint("fk_review_assigned_reviewer", "review", type_="foreignkey")
    op.drop_index("ix_review_assigned_reviewer_id", table_name="review")
    op.drop_column("review", "content_blocks")
    op.drop_column("review", "external_ref")
    op.drop_column("review", "content_type")
    op.drop_column("review", "escalation_reason")
    op.drop_column("review", "assigned_reviewer_id")
