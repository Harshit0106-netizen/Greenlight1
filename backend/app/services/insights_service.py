"""Dashboard numbers and Brand Kit gap signals. Read-only aggregates, scoped to what the caller may see."""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import forbidden
from app.models.brand_kit import SourceItem
from app.models.finding import Finding, FindingDecision
from app.models.review import Review
from app.models.user import User
from app.schemas.review import InsightGap, InsightsSummary, RecurringIssue, TopIssue
from app.services.workflow_service import visible_reviews_query

NEEDS_ATTENTION = ("scanned", "resolving", "changes_requested")


def summary(db: Session, user: User) -> InsightsSummary:
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    reviews = db.scalars(visible_reviews_query(user)).all()
    ids = [r.id for r in reviews]
    top: list[TopIssue] = []
    recurring: list[RecurringIssue] = []
    if ids:
        rows = db.execute(select(Finding.type, func.count()).where(Finding.review_id.in_(ids))
                          .group_by(Finding.type).order_by(func.count().desc(), Finding.type).limit(5)).all()
        top = [TopIssue(type=t, count=n) for t, n in rows]
        total_reviews = max(1, len(ids))
        for t, n in rows:
            review_count = db.scalar(select(func.count(func.distinct(Finding.review_id))).where(Finding.review_id.in_(ids), Finding.type == t)) or 0
            rate = round(review_count / total_reviews, 3)
            recommendation = {
                "terminology": "Review terminology guidance and add preferred wording to the Brand Kit.",
                "unsupported_claim": "Add approved evidence for recurring claims or remove the claim pattern.",
                "contradicted_claim": "Refresh approved facts and make conflicting claims easier to verify.",
                "tone": "Clarify tone examples with before/after examples for creators.",
                "accessibility": "Add accessibility checks to the publishing checklist and templates.",
                "visual": "Add approved visual assets and clearer usage rules to the Brand Kit.",
            }.get(t, "Review the related Brand Kit guidance and publishing workflow.")
            if n >= 2 and review_count >= 2:
                recurring.append(RecurringIssue(type=t, count=n, review_count=review_count, rate=rate, recommendation=recommendation))

    def ts(d):  # SQLite returns naive datetimes
        return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)

    return InsightsSummary(
        reviewed_this_month=sum(1 for r in reviews if ts(r.created_at) >= month_start),
        needs_attention=sum(1 for r in reviews if r.status in NEEDS_ATTENTION),
        awaiting_approval=sum(1 for r in reviews if r.status == "in_review"),
        approved_this_month=sum(1 for r in reviews if r.status == "approved" and ts(r.decided_at) and ts(r.decided_at) >= month_start),
        top_issues=top,
    )


def gaps(db: Session, user: User) -> list[InsightGap]:
    if user.role != "brand_admin":
        raise forbidden("Only brand admins can view guideline-gap insights.")
    counts: dict[str, int] = {}
    q = (select(Finding).join(Review, Review.id == Finding.review_id)
         .where(Review.workspace_id == user.workspace_id, Finding.source_id.is_not(None)))
    for f in db.scalars(q):
        d = db.scalar(select(FindingDecision).where(FindingDecision.finding_id == f.id).order_by(FindingDecision.pk.desc()).limit(1))
        if d is not None and d.action == "disputed":
            counts[f.source_id] = counts.get(f.source_id, 0) + 1
    titles = {s.public_id: s.title for s in db.scalars(select(SourceItem).where(SourceItem.workspace_id == user.workspace_id))}
    out = [InsightGap(source_id=sid, title=titles.get(sid, sid), dispute_count=n,
                      note="Often disputed; may be unclear." if n >= 5 else f"Disputed {n} time(s); consider clarifying the wording.")
           for sid, n in counts.items()]
    return sorted(out, key=lambda g: -g.dispute_count)


def recurring(db: Session, user: User) -> list[RecurringIssue]:
    reviews = db.scalars(visible_reviews_query(user)).all()
    ids = [r.id for r in reviews]
    if not ids:
        return []
    total_reviews = max(1, len(ids))
    rows = db.execute(select(Finding.type, func.count()).where(Finding.review_id.in_(ids)).group_by(Finding.type).order_by(func.count().desc(), Finding.type)).all()
    out: list[RecurringIssue] = []
    recommendations = {
        "terminology": "Review terminology guidance and add preferred wording to the Brand Kit.",
        "unsupported_claim": "Add approved evidence for recurring claims or remove the claim pattern.",
        "contradicted_claim": "Refresh approved facts and make conflicting claims easier to verify.",
        "tone": "Clarify tone examples with before/after examples for creators.",
        "accessibility": "Add accessibility checks to the publishing checklist and templates.",
        "visual": "Add approved visual assets and clearer usage rules to the Brand Kit.",
    }
    for t, n in rows:
        review_count = db.scalar(select(func.count(func.distinct(Finding.review_id))).where(Finding.review_id.in_(ids), Finding.type == t)) or 0
        if n >= 2 and review_count >= 2:
            out.append(RecurringIssue(type=t, count=n, review_count=review_count, rate=round(review_count / total_reviews, 3), recommendation=recommendations.get(t, "Review the related Brand Kit guidance and publishing workflow.")))
    return out[:5]
