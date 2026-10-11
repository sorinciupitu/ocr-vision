from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, Tag, TagRule
from app.dependencies import get_current_user
from app.schemas import TagRuleCreate, TagRuleCreateResponse, TagRuleResponse
from app.auto_tagging import backfill_rule

router = APIRouter(prefix="/tag-rules", tags=["tag-rules"])


def _normalize_pattern(pattern: str) -> str:
    pattern = " ".join((pattern or "").split())
    if not pattern:
        raise HTTPException(status_code=422, detail="Pattern cannot be empty")
    if len(pattern) > 100:
        raise HTTPException(status_code=422, detail="Pattern too long (max 100)")
    return pattern


@router.get("", response_model=List[TagRuleResponse])
def list_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(TagRule)
        .filter(TagRule.owner_id == current_user.id)
        .order_by(TagRule.created_at)
        .all()
    )


@router.post("", response_model=TagRuleCreateResponse, status_code=201)
def create_rule(
    data: TagRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pattern = _normalize_pattern(data.pattern)
    tag = db.query(Tag).filter(
        Tag.id == data.tag_id, Tag.owner_id == current_user.id
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    existing = db.query(TagRule).filter(
        TagRule.owner_id == current_user.id,
        TagRule.tag_id == tag.id,
        func.lower(TagRule.pattern) == pattern.lower(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Rule already exists")

    rule = TagRule(pattern=pattern, owner_id=current_user.id, tag_id=tag.id)
    db.add(rule)
    db.commit()
    db.refresh(rule)

    # Rules apply retroactively: tag every existing matching document now.
    matched = backfill_rule(db, rule)
    return TagRuleCreateResponse(
        id=rule.id,
        pattern=rule.pattern,
        is_active=rule.is_active,
        created_at=rule.created_at,
        tag=rule.tag,
        matched_count=matched,
    )


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rule = db.query(TagRule).filter(
        TagRule.id == rule_id, TagRule.owner_id == current_user.id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    # Tags already applied to documents are left untouched.
    db.delete(rule)
    db.commit()
    return {"detail": "Rule deleted"}
