"""Reviews, findings, decisions, comments and the review state machine.

Rules that live here (and nowhere else):
  - only the creator resolves findings; only a reviewer approves or requests changes; the AI has no role
  - a review reaches `in_review` only when every finding is edited or disputed (accepted-but-unfixed blocks)
  - every change is stored with actor, time and reason (audit_event)
"""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import next_number
from app.errors import forbidden, invalid, not_found
from app.models.audit import Approval, AuditEvent, Comment
from app.models.workflow import ReviewAssignment, ReviewEscalation
from app.models.finding import Finding, FindingDecision
from app.models.review import Review, ReviewVersion
from app.models.user import User, utcnow
from app.pipeline.engine import run_pipeline
from app.schemas.finding import Decision, FindingOut, FindingPatch, FindingPatchOut
from app.schemas.review import (AssignmentRequest, AuditOut, CommentCreate, CommentOut, EscalationRequest, ReviewCreate, ReviewCreated, ReviewDetail,
                                ReviewListItem, WorkflowOut)
from app.services import ai_disclosure, brand_kit_service

REVIEWER_VISIBLE = ("in_review", "approved", "changes_requested")
EDITABLE = ("scanned", "resolving", "changes_requested")
TRANSITIONS: dict[str, set[str]] = {
    "draft": {"scanned"},
    "scanned": {"resolving", "in_review"},
    "resolving": {"resolving", "in_review"},
    "in_review": {"approved", "changes_requested"},
    "changes_requested": {"resolving", "in_review"},
    "approved": set(),
}


# ---- audit + state machine ------------------------------------------------------------------------
def audit(db: Session, user: User | None, workspace_id: str, review_id: str | None, event: str, detail: dict | None = None, reason: str = "") -> None:
    db.add(AuditEvent(workspace_id=workspace_id, review_id=review_id, actor_id=user.id if user else None,
                      event_type=event, detail=detail or {}, reason=reason))


def transition(db: Session, review: Review, new: str, actor: User | None, reason: str = "") -> None:
    if new not in TRANSITIONS.get(review.status, set()):
        raise invalid(f"A review cannot move from {review.status} to {new}.")
    if review.status != new:
        audit(db, actor, review.workspace_id, review.id, "status_changed", {"from": review.status, "to": new}, reason)
    review.status = new
    review.updated_at = utcnow()


# ---- visibility -----------------------------------------------------------------------------------
def can_view(user: User, review: Review) -> bool:
    if review.workspace_id != user.workspace_id:
        return False
    if user.role == "creator":
        return review.creator_id == user.id
    if user.role == "reviewer":
        return review.status in REVIEWER_VISIBLE or review.assigned_reviewer_id == user.id or bool(review.escalation_reason)
    return True  # manager, brand_admin: whole workspace (read-only for brand_admin)


def visible_reviews_query(user: User):
    q = select(Review).where(Review.workspace_id == user.workspace_id)
    if user.role == "creator":
        q = q.where(Review.creator_id == user.id)
    elif user.role == "reviewer":
        q = q.where((Review.status.in_(REVIEWER_VISIBLE)) | (Review.assigned_reviewer_id == user.id) | (Review.escalation_reason != ""))
    return q


def load_review(db: Session, user: User, review_id: str) -> Review:
    review = db.get(Review, review_id)
    if review is None or not can_view(user, review):
        raise not_found("Review not found.")
    return review


def _content(db: Session, review: Review) -> str:
    return db.scalar(select(ReviewVersion.content).where(
        ReviewVersion.review_id == review.id, ReviewVersion.number == review.current_version))


def _latest_decision(db: Session, finding_id: str) -> FindingDecision | None:
    return db.scalar(select(FindingDecision).where(FindingDecision.finding_id == finding_id)
                     .order_by(FindingDecision.pk.desc()).limit(1))


def _finding_out(db: Session, f: Finding) -> FindingOut:
    d = _latest_decision(db, f.id)
    return FindingOut(
        finding_id=f.id, type=f.type, severity=f.severity,
        span={"start": f.span_start, "end": f.span_end, "text": f.span_text},
        source={"kind": f.source_kind, "id": f.source_id, "version": f.source_version} if f.source_id else None,
        fact_match=f.fact_match, reason=f.reason, confidence=f.confidence, method=f.method, suggestion=f.suggestion,
        decision=Decision(action=d.action, reason=d.reason, actor=d.actor_id) if d else None,
    )


def _unresolved(db: Session, review_id: str) -> int:
    n = 0
    for f in db.scalars(select(Finding).where(Finding.review_id == review_id)):
        d = _latest_decision(db, f.id)
        if d is None or d.action == "accepted":  # accepted = confirmed but not yet fixed
            n += 1
    return n


# ---- reviews --------------------------------------------------------------------------------------
def create_review(db: Session, user: User, body: ReviewCreate) -> ReviewCreated:
    if user.role != "creator":
        raise forbidden("Only creators can submit drafts.")
    kit_version = brand_kit_service.current_version(db, user.workspace_id)
    kit = brand_kit_service.snapshot(db, user.workspace_id, kit_version)
    result = run_pipeline(body.content, kit)

    review = Review(id=f"CL-{next_number(db, 'review', 2001)}", workspace_id=user.workspace_id, creator_id=user.id,
                    title=body.title.strip(), intent_note=body.intent_note, status="draft",
                    brand_kit_version=kit_version, scan_mode=result.mode, content_type=body.content_type,
                    external_ref=body.external_ref, content_blocks=[b.model_dump() for b in body.content_blocks])
    db.add(review)
    db.flush()
    db.add(ReviewVersion(review_id=review.id, number=1, content=body.content, created_by=user.id))
    audit(db, user, user.workspace_id, review.id, "review_submitted", {"brand_kit_version": brand_kit_service.label(kit_version)})

    for f in result.findings:
        sug = f["suggestion"]
        db.add(Finding(
            id=f"FD-{next_number(db, 'finding', 1001)}", review_id=review.id, type=f["type"], severity=f["severity"],
            span_start=f["span"]["start"], span_end=f["span"]["end"], span_text=f["span"]["text"],
            source_kind=f["source"]["kind"] if f["source"] else None, source_id=f["source"]["id"] if f["source"] else None,
            source_version=f["source"]["version"] if f["source"] else None, fact_match=f["fact_match"],
            reason=f["reason"], confidence=f["confidence"], method=f["method"], suggestion=sug))
    ai_disclosure.record(db, review.id, result)
    audit(db, None, user.workspace_id, review.id, "scan_completed",
          {"mode": result.mode, "findings": len(result.findings), "dropped_unverified": result.dropped_unverified})
    if body.content_blocks:
        image_blocks = [b for b in body.content_blocks if b.type == "image"]
        missing_alt = sum(1 for b in image_blocks if not b.alt_text.strip())
        audit(db, user, user.workspace_id, review.id, "structured_content_validated",
              {"blocks": len(body.content_blocks), "image_assets": len(image_blocks), "missing_alt_text": missing_alt, "external_ref": body.external_ref},
              "Structured content metadata captured before publication")
    transition(db, review, "scanned", None, "scan finished")
    if not result.findings:
        transition(db, review, "in_review", None, "no findings to resolve")
    db.commit()
    return ReviewCreated(id=review.id, status=review.status, finding_count=len(result.findings))


def list_reviews(db: Session, user: User) -> list[ReviewListItem]:
    rows = db.execute(
        visible_reviews_query(user).add_columns(User.name, func.count(Finding.id))
        .join(User, User.id == Review.creator_id)
        .outerjoin(Finding, Finding.review_id == Review.id)
        .group_by(Review.id, User.name).order_by(Review.updated_at.desc())).all()
    return [ReviewListItem(id=r.id, title=r.title, creator=name, status=r.status, finding_count=n, updated_at=r.updated_at)
            for r, name, n in rows]


def get_review(db: Session, user: User, review_id: str) -> ReviewDetail:
    r = load_review(db, user, review_id)
    return ReviewDetail(id=r.id, title=r.title, content=_content(db, r), status=r.status, creator=db.get(User, r.creator_id).name,
                        brand_kit_version=brand_kit_service.label(r.brand_kit_version), updated_at=r.updated_at)


def get_findings(db: Session, user: User, review_id: str) -> list[FindingOut]:
    r = load_review(db, user, review_id)
    rank = {"high": 0, "medium": 1, "low": 2}
    rows = sorted(db.scalars(select(Finding).where(Finding.review_id == r.id)), key=lambda f: (rank[f.severity], f.span_start))
    return [_finding_out(db, f) for f in rows]


# ---- decisions ------------------------------------------------------------------------------------
def decide_finding(db: Session, user: User, finding_id: str, body: FindingPatch) -> FindingPatchOut:
    finding = db.get(Finding, finding_id)
    review = db.get(Review, finding.review_id) if finding else None
    if finding is None or review is None or review.workspace_id != user.workspace_id:
        raise not_found("Finding not found.")
    if user.role != "creator" or review.creator_id != user.id:
        raise forbidden("Only the creator of this review can accept, edit or dispute its findings.")
    if review.status not in EDITABLE:
        raise invalid(f"Findings cannot be changed while the review is {review.status}.")

    reason = body.reason.strip()
    if body.action == "disputed" and not reason:
        raise invalid("A reason is required to dispute a finding.")

    if body.action == "edited":
        new_text = body.edited_text
        if new_text is None or not new_text.strip():
            raise invalid("edited_text is required when action is 'edited'.")
        content = _content(db, review)
        if content[finding.span_start:finding.span_end] != finding.span_text:
            raise invalid("The flagged text has changed; reload the review.")
        delta = len(new_text) - (finding.span_end - finding.span_start)
        updated = content[:finding.span_start] + new_text + content[finding.span_end:]
        review.current_version += 1
        db.add(ReviewVersion(review_id=review.id, number=review.current_version, content=updated, created_by=user.id,
                             reason=f"edit for {finding.id}"))
        for other in db.scalars(select(Finding).where(Finding.review_id == review.id, Finding.id != finding.id)):
            if other.span_start >= finding.span_end:  # findings never overlap, so later ones simply shift
                other.span_start += delta
                other.span_end += delta
        finding.span_end = finding.span_start + len(new_text)
        finding.span_text = new_text
        if finding.suggestion:
            finding.suggestion = {**finding.suggestion, "applied": new_text == finding.suggestion.get("text")}
        reason = reason or "Edited the flagged wording."
        audit(db, user, review.workspace_id, review.id, "content_edited",
              {"finding_id": finding.id, "version": review.current_version}, reason)

    decision = FindingDecision(finding_id=finding.id, action=body.action, reason=reason,
                               edited_text=body.edited_text if body.action == "edited" else None, actor_id=user.id)
    db.add(decision)
    db.flush()
    audit(db, user, review.workspace_id, review.id, "finding_decision", {"finding_id": finding.id, "action": body.action}, reason)

    target = "in_review" if _unresolved(db, review.id) == 0 else "resolving"
    transition(db, review, target, user, "all findings resolved" if target == "in_review" else "")
    db.commit()
    return FindingPatchOut(finding_id=finding.id, decision=Decision(action=body.action, reason=reason, actor=user.id))


# ---- comments, approval ---------------------------------------------------------------------------
def add_comment(db: Session, user: User, review_id: str, body: CommentCreate) -> CommentOut:
    if user.role not in ("creator", "manager"):
        raise forbidden("Only creators and managers can comment.")
    review = load_review(db, user, review_id)
    return _comment(db, user, review, body.text)


def _comment(db: Session, user: User, review: Review, text: str) -> CommentOut:
    c = Comment(id=f"C-{next_number(db, 'comment', 1)}", review_id=review.id, author_id=user.id, text=text.strip())
    db.add(c)
    db.flush()
    audit(db, user, review.workspace_id, review.id, "comment_added", {"comment_id": c.id})
    db.commit()
    return CommentOut(id=c.id, author=user.name, text=c.text, created_at=c.created_at)


def _decide_review(db: Session, user: User, review_id: str, outcome: str, note: str) -> WorkflowOut:
    if user.role != "reviewer":
        raise forbidden("Only reviewers can approve or request changes.")
    review = load_review(db, user, review_id)
    if review.status != "in_review":
        raise invalid(f"Only reviews that are in_review can be decided (this one is {review.status}).")
    if outcome == "approved" and _unresolved(db, review.id):
        raise invalid("Every finding must be edited or disputed before approval.")
    note = note.strip()
    if outcome == "changes_requested" and not note:
        raise invalid("A note is required when requesting changes.")
    transition(db, review, outcome, user, note)
    review.decided_at = utcnow() if outcome == "approved" else None
    db.add(Approval(review_id=review.id, actor_id=user.id, decision=outcome, note=note))
    audit(db, user, review.workspace_id, review.id, outcome, {}, note)
    if note:  # the note is visible to the creator in the comment thread
        db.add(Comment(id=f"C-{next_number(db, 'comment', 1)}", review_id=review.id, author_id=user.id, text=note))
    db.commit()
    return WorkflowOut(id=review.id, status=review.status)


def approve(db: Session, user: User, review_id: str, note: str) -> WorkflowOut:
    return _decide_review(db, user, review_id, "approved", note)


def request_changes(db: Session, user: User, review_id: str, note: str) -> WorkflowOut:
    return _decide_review(db, user, review_id, "changes_requested", note)


# ---- collaboration -------------------------------------------------------------------------------
def get_collaboration(db: Session, user: User, review_id: str) -> dict:
    review = load_review(db, user, review_id)
    assigned = db.get(User, review.assigned_reviewer_id) if review.assigned_reviewer_id else None
    return {"assigned_reviewer": assigned.name if assigned else None, "escalation_reason": review.escalation_reason,
            "content_type": review.content_type, "external_ref": review.external_ref, "content_blocks": review.content_blocks or []}


def get_comments(db: Session, user: User, review_id: str) -> list[CommentOut]:
    review = load_review(db, user, review_id)
    rows = db.execute(select(Comment, User.name).join(User, User.id == Comment.author_id)
                      .where(Comment.review_id == review.id).order_by(Comment.created_at.asc())).all()
    return [CommentOut(id=c.id, author=name, text=c.text, created_at=c.created_at) for c, name in rows]


def get_audit(db: Session, user: User, review_id: str) -> list[AuditOut]:
    review = load_review(db, user, review_id)
    rows = db.execute(select(AuditEvent, User.name).outerjoin(User, User.id == AuditEvent.actor_id)
                      .where(AuditEvent.review_id == review.id).order_by(AuditEvent.created_at.asc(), AuditEvent.pk.asc())).all()
    return [AuditOut(id=e.pk, actor=name or "Greenlight", event_type=e.event_type, detail=e.detail or {}, reason=e.reason, created_at=e.created_at) for e, name in rows]


def assign_reviewer(db: Session, user: User, review_id: str, reviewer_id: str) -> WorkflowOut:
    if user.role != "manager":
        raise forbidden("Only managers can assign reviewers.")
    review = load_review(db, user, review_id)
    reviewer = db.get(User, reviewer_id)
    if reviewer is None or reviewer.workspace_id != user.workspace_id or reviewer.role != "reviewer":
        raise invalid("Reviewer must be a reviewer in the same workspace.")
    review.assigned_reviewer_id = reviewer.id
    review.updated_at = utcnow()
    db.add(ReviewAssignment(review_id=review.id, reviewer_id=reviewer.id, assigned_by=user.id))
    audit(db, user, review.workspace_id, review.id, "review_assigned", {"reviewer_id": reviewer.id, "reviewer": reviewer.name}, "Assigned for collaborative review")
    db.commit()
    return WorkflowOut(id=review.id, status=review.status)


def escalate_review(db: Session, user: User, review_id: str, reason: str) -> WorkflowOut:
    if user.role != "manager":
        raise forbidden("Only managers can escalate reviews.")
    review = load_review(db, user, review_id)
    reason = reason.strip()
    review.escalation_reason = reason
    review.updated_at = utcnow()
    db.add(ReviewEscalation(review_id=review.id, actor_id=user.id, reason=reason))
    audit(db, user, review.workspace_id, review.id, "review_escalated", {"reason": reason}, reason)
    db.commit()
    return WorkflowOut(id=review.id, status=review.status)
