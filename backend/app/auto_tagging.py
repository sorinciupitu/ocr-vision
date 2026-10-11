"""Auto-tagging: match documents against the owner's TagRule rows.

Matching is case-insensitive substring over the OCR text and the original
filename. '%' and '_' in patterns are matched literally.
"""
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from app.models import Document, TagRule, document_tags


def _pattern_filter(pattern: str):
    pat = pattern.lower()
    return or_(
        func.lower(Document.ocr_text).contains(pat, autoescape=True),
        func.lower(Document.original_filename).contains(pat, autoescape=True),
    )


def backfill_rule(db: Session, rule: TagRule) -> int:
    """Attach rule.tag to every matching owner document not already tagged.

    Returns the number of documents newly tagged.
    """
    already = {
        row[0]
        for row in db.query(document_tags.c.document_id)
        .filter(document_tags.c.tag_id == rule.tag_id)
        .all()
    }
    docs = (
        db.query(Document)
        .filter(Document.owner_id == rule.owner_id, _pattern_filter(rule.pattern))
        .all()
    )
    added = 0
    for doc in docs:
        if doc.id in already:
            continue
        doc.tags.append(rule.tag)
        added += 1
    if added:
        db.commit()
    return added


def apply_rules_to_document(db: Session, doc: Document) -> int:
    """Apply every active rule of the owner to one freshly OCR'ed document.

    Returns the number of tags added. Idempotent: skips tags already present.
    """
    rules = (
        db.query(TagRule)
        .filter(TagRule.owner_id == doc.owner_id, TagRule.is_active.is_(True))
        .all()
    )
    if not rules:
        return 0

    have = {t.id for t in doc.tags}
    text = (doc.ocr_text or "").lower()
    fname = (doc.original_filename or "").lower()
    added = 0
    for rule in rules:
        if rule.tag_id in have:
            continue
        pat = rule.pattern.lower()
        if pat in text or pat in fname:
            doc.tags.append(rule.tag)
            have.add(rule.tag_id)
            added += 1
    if added:
        db.commit()
    return added
