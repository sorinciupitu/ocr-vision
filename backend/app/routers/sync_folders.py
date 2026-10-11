import os
from pathlib import Path
from typing import List
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from app.database import get_db
from app.models import User, Document, DocumentPage, SyncFolder
from app.dependencies import get_current_user
from app.config import get_settings
from app.ocr_service import process_file, create_thumbnail
from app.schemas import DocumentResponse

router = APIRouter(prefix="/sync", tags=["sync"])
settings = get_settings()

SUPPORTED = set(settings.supported_extensions.split(","))


class SyncFolderCreate(BaseModel):
    path: str
    label: str | None = None


class SyncFolderResponse(BaseModel):
    id: UUID
    path: str
    label: str | None
    is_active: bool
    last_synced_at: datetime | None

    class Config:
        from_attributes = True


class SyncResult(BaseModel):
    folder: str
    files_found: int
    files_queued: int
    already_indexed: int


async def ingest_file(file_path: str, owner_id: UUID, db: Session):
    """Background: ingest a single file into the archive."""
    try:
        filename = os.path.basename(file_path)
        ext = os.path.splitext(filename)[1].lower().replace('.', '')
        file_size = os.path.getsize(file_path)

        doc = Document(
            title=filename,
            original_filename=filename,
            file_path=file_path,
            file_type=ext,
            file_size=file_size,
            owner_id=owner_id,
            ocr_status="processing"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        thumb_path = os.path.join(settings.upload_folder, "thumbnails", f"{doc.id}.png")
        try:
            os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
            if create_thumbnail(file_path, thumb_path):
                doc.thumbnail_path = thumb_path
                db.commit()
        except Exception as e:
            print(f"Error creating thumbnail for {file_path}: {e}")

        full_text, page_count, page_texts = await process_file(file_path)

        doc.ocr_text = full_text
        doc.page_count = page_count
        doc.ocr_status = "completed"
        doc.search_vector = func.to_tsvector('english', full_text)

        for i, text_content in enumerate(page_texts):
            page = DocumentPage(
                document_id=doc.id,
                page_number=i + 1,
                ocr_text=text_content
            )
            db.add(page)

        db.commit()
    except Exception as e:
        print(f"Error ingesting {file_path}: {e}")


@router.post("/folders", response_model=SyncFolderResponse)
def add_sync_folder(
    data: SyncFolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    folder = SyncFolder(
        path=data.path,
        label=data.label,
        owner_id=current_user.id
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.get("/folders", response_model=List[SyncFolderResponse])
def list_sync_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(SyncFolder).filter(SyncFolder.owner_id == current_user.id).all()


@router.post("/folders/{folder_id}/scan", response_model=SyncResult)
async def scan_folder(
    folder_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    folder = db.query(SyncFolder).filter(
        SyncFolder.id == folder_id, SyncFolder.owner_id == current_user.id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Sync folder not found")
    
    if not os.path.isdir(folder.path):
        raise HTTPException(status_code=400, detail=f"Folder not accessible: {folder.path}")

    existing_paths = set(
        r[0] for r in db.query(Document.file_path).filter(Document.owner_id == current_user.id).all()
    )

    files_found = 0
    files_queued = 0
    already_indexed = 0

    for root, dirs, files in os.walk(folder.path):
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED:
                continue
            full_path = os.path.join(root, fname)
            files_found += 1
            if full_path in existing_paths:
                already_indexed += 1
                continue
            files_queued += 1
            background_tasks.add_task(ingest_file, full_path, current_user.id, db)

    folder.last_synced_at = datetime.utcnow()
    db.commit()

    return SyncResult(
        folder=folder.path,
        files_found=files_found,
        files_queued=files_queued,
        already_indexed=already_indexed
    )


@router.delete("/folders/{folder_id}")
def delete_sync_folder(
    folder_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    folder = db.query(SyncFolder).filter(
        SyncFolder.id == folder_id, SyncFolder.owner_id == current_user.id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Sync folder not found")
    db.delete(folder)
    db.commit()
    return {"detail": "Folder removed"}
