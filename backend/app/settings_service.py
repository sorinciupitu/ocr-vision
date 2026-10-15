"""Application settings stored in the app_settings key/value table."""
from sqlalchemy.orm import Session

from app.models import AppSetting, User

REGISTRATION_OPEN = "registration_open"
LLM_PROVIDER = "llm_provider"
LLM_BASE_URL = "llm_base_url"
LLM_API_KEY = "llm_api_key"
LLM_MODEL = "llm_model"


def get_setting(db: Session, key: str, default: str = None):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row.value if row else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def registration_open(db: Session) -> bool:
    """Whether self-service registration is allowed right now.

    Defaults to open; an instance with no users can never lock itself out,
    so registration stays open until at least one account exists.
    """
    if db.query(User).count() == 0:
        return True
    value = get_setting(db, REGISTRATION_OPEN)
    return value != "false"
