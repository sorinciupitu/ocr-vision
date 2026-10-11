import os
import shutil
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from app.database import get_db
from app.models import User, Document, DocumentPage
from app.dependencies import get_current_user, get_current_user_media
from app.schemas import DocumentResponse, DocumentDetailResponse, SearchResult
from app.config import get_settings
from app.ocr_service import process_file, create_thumbnail

router = APIRouter(prefix="/documents", tags=["documents"])
settings = get_settings()


def _get_owned_document(document_id: UUID, db: Session, user: User) -> Document:
    doc = db.query(Document).filter(
        Document.id == document_id, Document.owner_id == user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _thumbnail_output_path(document_id: UUID) -> str:
    thumbs_dir = os.path.join(settings.upload_folder, "thumbnails")
    os.makedirs(thumbs_dir, exist_ok=True)
    return os.path.join(thumbs_dir, f"{document_id}.png")


def _generate_thumbnail(document_id: UUID, file_path: str) -> Optional[str]:
    if not file_path or not os.path.exists(file_path):
        return None
    try:
        return create_thumbnail(file_path, _thumbnail_output_path(document_id))
    except Exception as e:
        print(f"Error creating thumbnail for {document_id}: {e}")
        return None


async def process_document_background(document_id: UUID, file_path: str, db: Session):
    """Background task to run OCR on a document."""
    try:
        db_doc = db.query(Document).filter(Document.id == document_id).first()
        if not db_doc:
            return

        db_doc.ocr_status = "processing"
        db.commit()

        thumb = _generate_thumbnail(document_id, file_path)
        if thumb:
            db_doc.thumbnail_path = thumb
            db.commit()

        # Run OCR
        full_text, page_count, page_texts = await process_file(file_path)

        db_doc.ocr_text = full_text
        db_doc.page_count = page_count
        db_doc.ocr_status = "completed"
        
        # PostgreSQL Full-Text Search update
        db_doc.search_vector = func.to_tsvector('english', full_text)

        for i, text_content in enumerate(page_texts):
            page = DocumentPage(
                document_id=document_id,
                page_number=i + 1,
                ocr_text=text_content
            )
            db.add(page)

        db.commit()
    except Exception as e:
        db_doc = db.query(Document).filter(Document.id == document_id).first()
        if db_doc:
            db_doc.ocr_status = "failed"
            db.commit()
        print(f"Error processing document {document_id}: {e}")


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
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
        ocr_status="pending"
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    background_tasks.add_task(process_document_background, new_doc.id, file_path, db)

    return new_doc


@router.get("", response_model=List[DocumentResponse])
@router.get("/", response_model=List[DocumentResponse])
def get_documents(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Document).filter(Document.owner_id == current_user.id).offset(skip).limit(limit).all()


@router.get("/search", response_model=List[SearchResult])
def search_documents(
    query: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    sql = text("""
        SELECT d.id, ts_headline('english', d.ocr_text, plainto_tsquery('english', :query)) as snippet,
               ts_rank(d.search_vector, plainto_tsquery('english', :query)) as rank
        FROM documents d
        WHERE d.owner_id = :owner_id AND d.search_vector @@ plainto_tsquery('english', :query)
        ORDER BY rank DESC
        LIMIT 20
    """)
    result = db.execute(sql, {"query": query, "owner_id": current_user.id}).fetchall()
    
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
    doc.search_vector = None
    db.commit()

    background_tasks.add_task(process_document_background, doc.id, doc.file_path, db)
    return doc


@router.delete("/{document_id}")
def delete_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = _get_owned_document(document_id, db, current_user)

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
