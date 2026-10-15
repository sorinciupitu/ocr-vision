"""Admin-only endpoints: application settings and user management."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import RegistrationStatus, UserAdminResponse, UserAdminUpdate, LLMSettings, LLMSettingsUpdate
from app.settings_service import (
    REGISTRATION_OPEN, LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL,
    get_setting, registration_open, set_setting,
)
from app.log_buffer import log_buffer

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


@router.get("/llm", response_model=LLMSettings)
def read_llm_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return {
        "provider": get_setting(db, LLM_PROVIDER, "ollama"),
        "base_url": get_setting(db, LLM_BASE_URL, ""),
        "model": get_setting(db, LLM_MODEL, ""),
        "api_key_set": bool(get_setting(db, LLM_API_KEY, "")),
    }


@router.put("/llm", response_model=LLMSettings)
def update_llm_settings(
    update: LLMSettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base_url = update.base_url.strip()
    if base_url and not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="LLM endpoint must start with http:// or https://")
    set_setting(db, LLM_PROVIDER, update.provider.strip())
    set_setting(db, LLM_BASE_URL, base_url)
    set_setting(db, LLM_MODEL, update.model.strip())
    if update.api_key is not None:
        set_setting(db, LLM_API_KEY, update.api_key.strip())
    return read_llm_settings(db, admin)


@router.get("/logs")
def read_logs(
    limit: int = Query(default=200, ge=1, le=500),
    admin: User = Depends(require_admin),
):
    return {"logs": log_buffer.snapshot(limit)}


@router.delete("/logs")
def clear_logs(admin: User = Depends(require_admin)):
    log_buffer.clear()
    return {"ok": True}


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
