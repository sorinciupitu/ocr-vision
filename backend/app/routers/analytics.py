from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_

from app.database import get_db
from app.models import User, Document, Folder, Tag
from app.dependencies import get_current_user
from app.schemas import AnalyticsSummary, MonthlyCount

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _word_count_sql():
    """Space-separated token count; NULL/blank text counts as 0."""
    normalized = func.btrim(func.regexp_replace(Document.ocr_text, r"\s+", " ", "g"))
    return case(
        (or_(Document.ocr_text.is_(None), func.btrim(Document.ocr_text) == ""), 0),
        else_=func.array_length(func.regexp_split_to_array(normalized, " "), 1),
    )


def _month_windows(now: datetime) -> List[str]:
    """Ascending 'YYYY-MM' labels for the 12 months ending with now's month."""
    y, m = now.year, now.month
    months = []
    for _ in range(12):
        months.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    months.reverse()
    return months


@router.get("/summary", response_model=AnalyticsSummary)
def analytics_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    documents, pages, words = (
        db.query(
            func.count(Document.id),
            func.coalesce(func.sum(Document.page_count), 0),
            func.coalesce(func.sum(_word_count_sql()), 0),
        )
        .filter(Document.owner_id == current_user.id)
        .one()
    )

    tags = (
        db.query(func.count(Tag.id))
        .filter(Tag.owner_id == current_user.id)
        .scalar()
    )
    folders = (
        db.query(func.count(Folder.id))
        .filter(Folder.owner_id == current_user.id)
        .scalar()
    )

    now = datetime.utcnow()
    months = _month_windows(now)
    start = datetime(int(months[0][:4]), int(months[0][5:]), 1)
    rows = (
        db.query(
            func.date_trunc("month", Document.created_at),
            func.count(Document.id),
        )
        .filter(Document.owner_id == current_user.id, Document.created_at >= start)
        .group_by(func.date_trunc("month", Document.created_at))
        .all()
    )
    counts = {d.strftime("%Y-%m"): c for d, c in rows}

    return AnalyticsSummary(
        documents=documents,
        pages=int(pages),
        words=int(words),
        tags=tags,
        folders=folders,
        by_month=[MonthlyCount(month=m, count=counts.get(m, 0)) for m in months],
    )
