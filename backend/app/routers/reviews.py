from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.finding import FindingOut
from app.schemas.review import (AiDisclosure, AssignmentRequest, AuditOut, CommentCreate, CommentOut, EscalationRequest, ReviewCreate, ReviewCreated, ReviewDetail,
                                ReviewListItem, WorkflowOut)
from app.services import ai_disclosure, workflow_service as wf

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("", response_model=list[ReviewListItem])
def list_reviews(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.list_reviews(db, user)


@router.post("", response_model=ReviewCreated, status_code=201)
def create_review(body: ReviewCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.create_review(db, user, body)


@router.get("/{review_id}", response_model=ReviewDetail)
def get_review(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_review(db, user, review_id)


@router.get("/{review_id}/findings", response_model=list[FindingOut])
def get_findings(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_findings(db, user, review_id)


@router.get("/{review_id}/collaboration")
def get_collaboration(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_collaboration(db, user, review_id)


@router.get("/{review_id}/comments", response_model=list[CommentOut])
def get_comments(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_comments(db, user, review_id)


@router.get("/{review_id}/audit", response_model=list[AuditOut])
def get_audit(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.get_audit(db, user, review_id)


@router.post("/{review_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(review_id: str, body: CommentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.add_comment(db, user, review_id, body)


@router.get("/{review_id}/ai-disclosure", response_model=AiDisclosure, response_model_exclude_none=True)
def get_disclosure(review_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    wf.load_review(db, user, review_id)  # same visibility as the review itself
    return ai_disclosure.build(db, review_id)


@router.post("/{review_id}/assign", response_model=WorkflowOut)
def assign_reviewer(review_id: str, body: AssignmentRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.assign_reviewer(db, user, review_id, body.reviewer_id)


@router.post("/{review_id}/escalate", response_model=WorkflowOut)
def escalate_review(review_id: str, body: EscalationRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return wf.escalate_review(db, user, review_id, body.reason)
