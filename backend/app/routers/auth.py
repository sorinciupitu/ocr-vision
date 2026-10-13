from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.settings_service import registration_open
from app.auth import verify_password, get_password_hash, create_access_token
from app.schemas import RegistrationStatus, Token, UserCreate, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user

@router.get("/registration-status", response_model=RegistrationStatus)
def registration_status(db: Session = Depends(get_db)):
    """Public: whether self-service registration is currently allowed."""
    return {"open": registration_open(db)}

@router.post("/register", response_model=UserResponse)
def register(user: UserCreate, db: Session = Depends(get_db)):
    if not registration_open(db):
        raise HTTPException(status_code=403, detail="Registration is disabled")
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    existing_email = db.query(User).filter(User.email == user.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user.password)
    # Bootstrap: on an empty instance the first account becomes the admin.
    is_first_user = db.query(User).count() == 0
    new_user = User(
        username=user.username,
        email=user.email,
        hashed_password=hashed_password,
        is_admin=is_first_user,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user
