from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, Document, Folder, Tag, document_tags
from app.dependencies import get_current_user
from app.schemas import (
    FolderCreate, FolderResponse, TagCreate, TagResponse,
    DocumentMove, DocumentTagsUpdate, DocumentResponse,
)

router = APIRouter(tags=["organize"])


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
            id=t.id, name=t.name, created_at=t.created_at,
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
    return TagResponse(id=tag.id, name=tag.name, document_count=0, created_at=tag.created_at)


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
