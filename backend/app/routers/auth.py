from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import unauthorized, forbidden
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY = hash_password("not-a-real-password")


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY)  # same work either way
    if not user or not ok:
        raise unauthorized("Incorrect email or password.")
    return LoginResponse(access_token=create_access_token(user.id, user.role, user.workspace_id),
                         user=UserOut(id=user.id, name=user.name, role=user.role, workspace_id=user.workspace_id))


@router.get("/users", response_model=list[UserOut])
def list_users(role: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ("manager", "reviewer"):
        raise forbidden("Only managers and reviewers can view workspace reviewers.")
    q = select(User).where(User.workspace_id == user.workspace_id)
    if role:
        q = q.where(User.role == role)
    return [UserOut(id=u.id, name=u.name, role=u.role, workspace_id=u.workspace_id) for u in db.scalars(q.order_by(User.name))]
