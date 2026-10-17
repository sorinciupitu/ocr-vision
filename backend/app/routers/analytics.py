from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_

from app.database import get_db
from app.models import User, Document, Folder, Tag
from app.dependencies import get_current_user
from app.schemas import AnalyticsSummary, MonthlyCount, PeriodCount

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


def _period_counts(db: Session, user_id, start: datetime, grain: str):
    truncated = func.date_trunc(grain, Document.created_at)
    rows = (
        db.query(truncated, func.count(Document.id))
        .filter(Document.owner_id == user_id, Document.created_at >= start)
        .group_by(truncated)
        .all()
    )
    return {period.strftime("%Y-%m-%d"): count for period, count in rows}


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

    today = datetime(now.year, now.month, now.day)
    days = [today - timedelta(days=offset) for offset in range(29, -1, -1)]
    current_week = today - timedelta(days=today.weekday())
    weeks = [current_week - timedelta(weeks=offset) for offset in range(11, -1, -1)]
    day_counts = _period_counts(db, current_user.id, days[0], "day")
    week_counts = _period_counts(db, current_user.id, weeks[0], "week")

    return AnalyticsSummary(
        documents=documents,
        pages=int(pages),
        words=int(words),
        tags=tags,
        folders=folders,
        by_month=[MonthlyCount(month=m, count=counts.get(m, 0)) for m in months],
        by_week=[PeriodCount(period=w.strftime("%Y-%m-%d"), count=week_counts.get(w.strftime("%Y-%m-%d"), 0)) for w in weeks],
        by_day=[PeriodCount(period=d.strftime("%Y-%m-%d"), count=day_counts.get(d.strftime("%Y-%m-%d"), 0)) for d in days],
    )
