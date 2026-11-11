from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.user import utcnow

STATUSES = ("draft", "scanned", "resolving", "in_review", "approved", "changes_requested")


class Review(Base):
    __tablename__ = "review"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.id"), index=True)
    creator_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    intent_note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    brand_kit_version: Mapped[int] = mapped_column(Integer)  # pinned at submission
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    scan_mode: Mapped[str] = mapped_column(String(20), default="full")  # full | rules_only
    assigned_reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), nullable=True, index=True)
    escalation_reason: Mapped[str] = mapped_column(Text, default="")
    content_type: Mapped[str] = mapped_column(String(30), default="text")
    external_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content_blocks: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReviewVersion(Base):
    """Every version of the draft text. Version 1 is exactly what was submitted."""

    __tablename__ = "review_version"
    __table_args__ = (UniqueConstraint("review_id", "number"),)
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("app_user.id"), nullable=True)
    reason: Mapped[str] = mapped_column(String(300), default="submitted")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
