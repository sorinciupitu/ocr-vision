"""Admin-only endpoints: application settings and user management."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import RegistrationStatus, UserAdminResponse, UserAdminUpdate
from app.settings_service import REGISTRATION_OPEN, get_setting, registration_open, set_setting

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


@router.get("/settings", response_model=RegistrationStatus)
def read_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return {"open": registration_open(db)}


@router.put("/settings/registration", response_model=RegistrationStatus)
def update_registration(
    status: RegistrationStatus,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    set_setting(db, REGISTRATION_OPEN, "true" if status.open else "false")
    return {"open": status.open}


@router.get("/users", response_model=list[UserAdminResponse])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(User).order_by(User.created_at).all()


@router.patch("/users/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: UUID,
    update: UserAdminUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    is_self = target.id == admin.id

    if update.username is not None and update.username != target.username:
        taken = db.query(User).filter(User.username == update.username).first()
        if taken:
            raise HTTPException(status_code=409, detail="Username already registered")
        target.username = update.username

    if update.email is not None and update.email != target.email:
        taken = db.query(User).filter(User.email == update.email).first()
        if taken:
            raise HTTPException(status_code=409, detail="Email already registered")
        target.email = update.email

    if update.password:
        target.hashed_password = get_password_hash(update.password)

    if update.is_active is not None and update.is_active != target.is_active:
        if is_self:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        if not update.is_active and target.is_admin:
            other_admins = (
                db.query(User)
                .filter(User.id != target.id, User.is_admin.is_(True), User.is_active.is_(True))
                .count()
            )
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last active admin")
        target.is_active = update.is_active

    if update.is_admin is not None and update.is_admin != target.is_admin:
        if is_self:
            raise HTTPException(status_code=400, detail="You cannot change your own admin role")
        if not update.is_admin:
            other_admins = (
                db.query(User)
                .filter(User.id != target.id, User.is_admin.is_(True), User.is_active.is_(True))
                .count()
            )
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Cannot demote the last active admin")
        target.is_admin = update.is_admin

    db.commit()
    db.refresh(target)
    return target
