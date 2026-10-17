import asyncio
import logging
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
from app.database import SessionLocal
from app.models import User, Document, DocumentPage, SyncFolder
from app.dependencies import get_current_user
from app.config import get_settings
from app.ocr_runner import run_ocr_with_retries
from app.schemas import DocumentResponse

router = APIRouter(prefix="/sync", tags=["sync"])
settings = get_settings()
logger = logging.getLogger(__name__)

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


_inflight_files: set[str] = set()


async def ingest_file(file_path: str, owner_id: UUID):
    """Ingest one sync-folder file using a task-owned database session."""
    if file_path in _inflight_files:
        return
    _inflight_files.add(file_path)
    db = SessionLocal()
    try:
        if not os.path.isfile(file_path):
            return
        # A scan can see the same file more than once while OCR is running.
        # The path is the stable identity of a file in a configured folder.
        existing = db.query(Document.id).filter(
            Document.owner_id == owner_id,
            Document.file_path == file_path,
        ).first()
        if existing:
            return

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
            ocr_status="pending"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        await run_ocr_with_retries(doc.id, db)
    except Exception:
        logger.exception("Error ingesting sync file %s", file_path)
    finally:
        db.close()
        _inflight_files.discard(file_path)


def _sync_file_paths(folder: SyncFolder, db: Session) -> tuple[list[str], int, int]:
    """Return new supported files plus scan counters for one persisted folder."""
    existing_paths = {
        path for (path,) in db.query(Document.file_path)
        .filter(Document.owner_id == folder.owner_id)
        .all()
    }
    files_found = 0
    already_indexed = 0
    new_paths = []
    for root, _dirs, files in os.walk(folder.path):
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED:
                continue
            full_path = os.path.join(root, fname)
            files_found += 1
            if full_path in existing_paths or full_path in _inflight_files:
                already_indexed += 1
                continue
            new_paths.append(full_path)
    return new_paths, files_found, already_indexed


async def scan_active_sync_folders() -> None:
    """Poll all persisted folders and queue only files not already indexed."""
    db = SessionLocal()
    try:
        folders = db.query(SyncFolder).filter(SyncFolder.is_active.is_(True)).all()
        for folder in folders:
            if not os.path.isdir(folder.path):
                logger.warning("Sync folder is not accessible: %s", folder.path)
                continue
            new_paths, _files_found, _already_indexed = _sync_file_paths(folder, db)
            folder.last_synced_at = datetime.utcnow()
            db.commit()
            for file_path in new_paths:
                asyncio.create_task(ingest_file(file_path, folder.owner_id))
    except Exception:
        logger.exception("Automatic sync-folder scan failed")
    finally:
        db.close()


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

    new_paths, files_found, already_indexed = _sync_file_paths(folder, db)
    files_queued = len(new_paths)
    for file_path in new_paths:
        background_tasks.add_task(ingest_file, file_path, current_user.id)

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
