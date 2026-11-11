from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.review import InsightGap, InsightsSummary, RecurringIssue
from app.services import insights_service

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/summary", response_model=InsightsSummary)
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return insights_service.summary(db, user)


@router.get("/gaps", response_model=list[InsightGap])
def gaps(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return insights_service.gaps(db, user)


@router.get("/recurring", response_model=list[RecurringIssue])
def recurring(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return insights_service.recurring(db, user)
