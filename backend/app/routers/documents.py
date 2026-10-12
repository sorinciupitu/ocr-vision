import os
import re
import shutil
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from app.database import get_db
from app.models import User, Document, DocumentPage, Tag, Folder
from app.dependencies import get_current_user, get_current_user_media
from app.schemas import DocumentResponse, DocumentDetailResponse, SearchResult, BulkDeleteRequest, BulkDeleteResult
from app.config import get_settings
from app.ocr_runner import run_ocr_with_retries

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()


def _get_owned_document(document_id: UUID, db: Session, user: User) -> Document:
    doc = db.query(Document).filter(
        Document.id == document_id, Document.owner_id == user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc# OCR (with retries/backoff and visible status) runs via app.ocr_runner.



@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    folder_id: Optional[UUID] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if folder_id is not None:
        owned = db.query(Folder).filter(
            Folder.id == folder_id, Folder.owner_id == current_user.id
        ).first()
        if not owned:
            raise HTTPException(status_code=404, detail="Folder not found")

    os.makedirs(settings.upload_folder, exist_ok=True)
    file_path = os.path.join(settings.upload_folder, file.filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    file_size = os.path.getsize(file_path)
    file_ext = os.path.splitext(file.filename)[1].lower().replace('.', '')

    new_doc = Document(
        title=file.filename,
        original_filename=file.filename,
        file_path=file_path,
        file_type=file_ext,
        file_size=file_size,
        owner_id=current_user.id,
        folder_id=folder_id,
        ocr_status="pending"
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    background_tasks.add_task(run_ocr_with_retries, new_doc.id, db)

    return new_doc


@router.get("", response_model=List[DocumentResponse])
@router.get("/", response_model=List[DocumentResponse])
def get_documents(
    skip: int = 0,
    limit: int = 100,
    folder_id: Optional[UUID] = None,
    unfiled: bool = False,
    tag_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Document).filter(Document.owner_id == current_user.id)
    if unfiled:
        query = query.filter(Document.folder_id.is_(None))
    elif folder_id is not None:
        query = query.filter(Document.folder_id == folder_id)
    if tag_id is not None:
        query = query.join(Document.tags).filter(Tag.id == tag_id)
    return query.offset(skip).limit(limit).all()


@router.get("/search", response_model=List[SearchResult])
def search_documents(
    query: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Prefix-match every word so partial input ("aut") already matches ("auto").
    words = re.findall(r"\w+", query.lower())
    if not words:
        return []
    tsquery = " & ".join(f"{w}:*" for w in words)
    # Filename substring match, with LIKE wildcards escaped and matched literally.
    like_term = "%" + re.sub(r"([%_\\])", r"\\\1", query.strip()) + "%"

    sql = text("""
        SELECT d.id,
               ts_headline('english', d.ocr_text, to_tsquery('english', :tsquery)) as snippet,
               COALESCE(ts_rank(d.search_vector, to_tsquery('english', :tsquery)), -1) as rank
        FROM documents d
        WHERE d.owner_id = :owner_id
          AND (d.search_vector @@ to_tsquery('english', :tsquery)
               OR d.original_filename ILIKE :like ESCAPE '\\')
        ORDER BY rank DESC, d.created_at DESC
        LIMIT 20
    """)
    result = db.execute(sql, {"tsquery": tsquery, "like": like_term, "owner_id": current_user.id}).fetchall()
    
    search_results = []
    for r in result:
        doc = db.query(Document).filter(Document.id == r.id).first()
        if doc:
            search_results.append({
                "document": doc,
                "snippet": r.snippet
            })
            
    return search_results


@router.get("/{document_id}/thumbnail")
def get_document_thumbnail(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_media)
):
    doc = _get_owned_document(document_id, db, current_user)
    if not doc.thumbnail_path or not os.path.exists(doc.thumbnail_path):
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(doc.thumbnail_path, media_type="image/png")


@router.get("/{document_id}/file")
def get_document_file(
    document_id: UUID,
    disposition: str = "inline",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_media)
):
    doc = _get_owned_document(document_id, db, current_user)
    if not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found")
    content_disposition = "attachment" if disposition == "attachment" else "inline"
    return FileResponse(
        doc.file_path,
        filename=doc.original_filename,
        content_disposition_type=content_disposition,
    )


@router.post("/{document_id}/reprocess", response_model=DocumentResponse)
def reprocess_document(
    document_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = _get_owned_document(document_id, db, current_user)

    db.query(DocumentPage).filter(DocumentPage.document_id == document_id).delete()
    doc.ocr_text = ""
    doc.page_count = 0
    doc.ocr_status = "pending"
    doc.ocr_attempts = 0
    doc.ocr_error = None
    doc.search_vector = None
    db.commit()

    background_tasks.add_task(run_ocr_with_retries, doc.id, db)
    return doc


@router.post("/{document_id}/retry", response_model=DocumentResponse)
def retry_document_ocr(
    document_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Manually retry a failed (or stuck queued) document with a fresh set of attempts."""
    doc = _get_owned_document(document_id, db, current_user)
    if doc.ocr_status == "processing":
        raise HTTPException(status_code=409, detail="Document is already being processed")
    if doc.ocr_status == "completed":
        raise HTTPException(status_code=409, detail="Document already processed; use reprocess to run OCR again")

    doc.ocr_status = "pending"
    doc.ocr_attempts = 0
    doc.ocr_error = None
    db.commit()

    background_tasks.add_task(run_ocr_with_retries, doc.id, db)
    return doc


def _remove_owned_files(doc: Document) -> None:
    # Only remove files we own inside the upload folder; never delete the
    # user's original files that live in external sync folders.
    upload_root = os.path.abspath(settings.upload_folder)
    for path in (doc.file_path, doc.thumbnail_path):
        if not path:
            continue
        abs_path = os.path.abspath(path)
        if abs_path.startswith(upload_root) and os.path.exists(abs_path):
            try:
                os.remove(abs_path)
            except OSError as e:
                print(f"Error removing {abs_path}: {e}")


@router.post("/bulk-delete", response_model=BulkDeleteResult)
def bulk_delete_documents(
    data: BulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids = list(dict.fromkeys(data.document_ids))
    docs = db.query(Document).filter(
        Document.id.in_(ids), Document.owner_id == current_user.id
    ).all()
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="One or more documents not found")
    for doc in docs:
        _remove_owned_files(doc)
        db.delete(doc)
    db.commit()
    return BulkDeleteResult(deleted=len(docs))


@router.delete("/{document_id}")
def delete_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = _get_owned_document(document_id, db, current_user)
    _remove_owned_files(doc)
    db.delete(doc)
    db.commit()
    return {"detail": "Document deleted"}


@router.get("/{document_id}", response_model=DocumentDetailResponse)
def get_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return _get_owned_document(document_id, db, current_user)
