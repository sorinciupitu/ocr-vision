from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, Document, Folder, Tag, document_tags
from app.dependencies import get_current_user
from app.schemas import (
    FolderCreate, FolderResponse, TagCreate, TagUpdate, TagResponse,
    DocumentMove, DocumentTagsUpdate, DocumentResponse,
    BulkFolderUpdate, BulkTagsAdd, BulkResult,
)

router = APIRouter(tags=["organize"])

# Palette keys the frontend knows how to render (OrganizeDialog.TAG_COLORS).
TAG_PALETTE = {"sky", "emerald", "amber", "rose", "violet", "pink"}


def _normalize(name: str) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    return name


def _get_owned_folder(folder_id: UUID, db: Session, user: User) -> Folder:
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.owner_id == user.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _get_owned_tag(tag_id: UUID, db: Session, user: User) -> Tag:
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.owner_id == user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


# ---------- Folders ----------

@router.get("/folders", response_model=List[FolderResponse])
def list_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    counts = dict(
        db.query(Document.folder_id, func.count(Document.id))
        .filter(Document.owner_id == current_user.id, Document.folder_id.isnot(None))
        .group_by(Document.folder_id)
        .all()
    )
    folders = db.query(Folder).filter(Folder.owner_id == current_user.id).order_by(Folder.name).all()
    return [
        FolderResponse(
            id=f.id, name=f.name, created_at=f.created_at,
            document_count=counts.get(f.id, 0),
        )
        for f in folders
    ]


@router.post("/folders", response_model=FolderResponse, status_code=201)
def create_folder(
    data: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = _normalize(data.name)
    existing = db.query(Folder).filter(
        Folder.owner_id == current_user.id, func.lower(Folder.name) == name.lower()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Folder already exists")
    folder = Folder(name=name, owner_id=current_user.id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderResponse(id=folder.id, name=folder.name, document_count=0, created_at=folder.created_at)


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_owned_folder(folder_id, db, current_user)
    # Unlink documents first: SQLAlchemy won't fire ON DELETE SET NULL on its own.
    db.query(Document).filter(Document.folder_id == folder_id).update({"folder_id": None})
    db.delete(folder)
    db.commit()
    return {"detail": "Folder deleted"}


# ---------- Tags ----------

@router.get("/tags", response_model=List[TagResponse])
def list_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    counts = dict(
        db.query(document_tags.c.tag_id, func.count(document_tags.c.document_id))
        .join(Document, Document.id == document_tags.c.document_id)
        .filter(Document.owner_id == current_user.id)
        .group_by(document_tags.c.tag_id)
        .all()
    )
    tags = db.query(Tag).filter(Tag.owner_id == current_user.id).order_by(Tag.name).all()
    return [
        TagResponse(
            id=t.id, name=t.name, color=t.color, created_at=t.created_at,
            document_count=counts.get(t.id, 0),
        )
        for t in tags
    ]


@router.post("/tags", response_model=TagResponse, status_code=201)
def create_tag(
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = _normalize(data.name)
    if len(name) > 100:
        raise HTTPException(status_code=422, detail="Tag name too long (max 100)")
    existing = db.query(Tag).filter(
        Tag.owner_id == current_user.id, func.lower(Tag.name) == name.lower()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists")
    tag = Tag(name=name, owner_id=current_user.id)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagResponse(
        id=tag.id, name=tag.name, color=tag.color,
        document_count=0, created_at=tag.created_at,
    )


@router.put("/tags/{tag_id}", response_model=TagResponse)
def update_tag(
    tag_id: UUID,
    data: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename a tag and/or set its palette color. Empty body is a no-op."""
    tag = _get_owned_tag(tag_id, db, current_user)

    if data.name is not None:
        name = _normalize(data.name)
        if len(name) > 100:
            raise HTTPException(status_code=422, detail="Tag name too long (max 100)")
        clash = db.query(Tag).filter(
            Tag.owner_id == current_user.id,
            Tag.id != tag.id,
            func.lower(Tag.name) == name.lower(),
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Tag already exists")
        tag.name = name

    if data.color is not None:
        if data.color not in TAG_PALETTE:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid color; pick one of: {', '.join(sorted(TAG_PALETTE))}",
            )
        tag.color = data.color

    db.commit()
    db.refresh(tag)
    count = (
        db.query(func.count(document_tags.c.document_id))
        .filter(document_tags.c.tag_id == tag.id)
        .scalar()
        or 0
    )
    return TagResponse(
        id=tag.id, name=tag.name, color=tag.color,
        document_count=count, created_at=tag.created_at,
    )


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = _get_owned_tag(tag_id, db, current_user)
    db.delete(tag)  # association rows go via ON DELETE CASCADE
    db.commit()
    return {"detail": "Tag deleted"}


# ---------- Document organization ----------

@router.put("/documents/{document_id}/folder", response_model=DocumentResponse)
def move_document(
    document_id: UUID,
    data: DocumentMove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(
        Document.id == document_id, Document.owner_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if data.folder_id is not None:
        _get_owned_folder(data.folder_id, db, current_user)
    doc.folder_id = data.folder_id
    db.commit()
    db.refresh(doc)
    return doc


@router.put("/documents/{document_id}/tags", response_model=DocumentResponse)
def set_document_tags(
    document_id: UUID,
    data: DocumentTagsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(
        Document.id == document_id, Document.owner_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    tags = (
        db.query(Tag)
        .filter(Tag.id.in_(data.tag_ids), Tag.owner_id == current_user.id)
        .all()
        if data.tag_ids
        else []
    )
    if len(tags) != len(set(data.tag_ids)):
        raise HTTPException(status_code=404, detail="One or more tags not found")
    doc.tags = tags
    db.commit()
    db.refresh(doc)
    return doc


def _owned_docs_or_404(document_ids, db: Session, user: User):
    """Fetch every requested document, failing (and changing nothing) if any
    document is missing or owned by someone else."""
    ids = list(dict.fromkeys(document_ids))
    docs = db.query(Document).filter(
        Document.id.in_(ids), Document.owner_id == user.id
    ).all()
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="One or more documents not found")
    return docs


@router.post("/documents/bulk-folder", response_model=BulkResult)
def bulk_move_documents(
    data: BulkFolderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    docs = _owned_docs_or_404(data.document_ids, db, current_user)
    if data.folder_id is not None:
        _get_owned_folder(data.folder_id, db, current_user)
    for doc in docs:
        doc.folder_id = data.folder_id
    db.commit()
    return BulkResult(updated=len(docs))


@router.post("/documents/bulk-tags", response_model=BulkResult)
def bulk_add_tags(
    data: BulkTagsAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    docs = _owned_docs_or_404(data.document_ids, db, current_user)
    tag_ids = list(dict.fromkeys(data.tag_ids))
    tags = db.query(Tag).filter(
        Tag.id.in_(tag_ids), Tag.owner_id == current_user.id
    ).all()
    if len(tags) != len(tag_ids):
        raise HTTPException(status_code=404, detail="One or more tags not found")
    for doc in docs:
        have = {t.id for t in doc.tags}
        for tag in tags:
            if tag.id not in have:
                doc.tags.append(tag)
    db.commit()
    return BulkResult(updated=len(docs))
