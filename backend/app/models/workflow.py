from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.user import utcnow


class ReviewAssignment(Base):
    __tablename__ = "review_assignment"
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"), index=True)
    assigned_by: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReviewEscalation(Base):
    __tablename__ = "review_escalation"
    pk: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[str] = mapped_column(ForeignKey("review.id"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("app_user.id"))
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
