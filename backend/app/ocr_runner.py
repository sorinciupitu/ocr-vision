"""OCR execution with automatic retries and visible per-document status.

The document walks pending -> processing -> completed/failed. Failed attempts
are retried up to OCR_MAX_RETRIES times with exponential backoff
(base * 2**(attempt-1)); the last error is kept on the document so the UI can
show why OCR failed and offer a manual retry.
"""
import asyncio
import logging
import os

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auto_tagging import apply_rules_to_document
from app.config import get_settings
from app.models import Document, DocumentPage
from app.ocr_service import process_file, create_thumbnail

settings = get_settings()
logger = logging.getLogger(__name__)
OCR_CONCURRENCY = max(1, settings.ocr_concurrency)
_ocr_semaphore = asyncio.Semaphore(OCR_CONCURRENCY)


def _try_thumbnail(document_id, file_path):
    if not file_path or not os.path.exists(file_path):
        return None
    thumbs_dir = os.path.join(settings.upload_folder, "thumbnails")
    os.makedirs(thumbs_dir, exist_ok=True)
    try:
        return create_thumbnail(file_path, os.path.join(thumbs_dir, f"{document_id}.png"))
    except Exception as e:
        print(f"Error creating thumbnail for {document_id}: {e}")
        return None


async def run_ocr_with_retries(document_id, db: Session, max_attempts=None, base_delay=None):
    """OCR documents serially (by default), draining pending work afterwards.

    Uploads and sync-folder scans can each enqueue their own background task.
    The semaphore prevents those tasks from overwhelming the OCR backend, and
    the drain loop makes sure documents that were already queued are picked up
    automatically when the current document finishes.
    """
    async with _ocr_semaphore:
        doc = db.query(Document).filter(Document.id == document_id).first()
        # Another queued task may have drained this document while waiting on
        # the semaphore. Do not OCR a document that is already completed.
        if not doc or doc.ocr_status not in ("pending", "processing"):
            return
        await _run_ocr_with_retries(document_id, db, max_attempts, base_delay)
        while True:
            next_id = (
                db.query(Document.id)
                .filter(Document.ocr_status == "pending")
                .order_by(Document.created_at.asc())
                .first()
            )
            if not next_id:
                return
            await _run_ocr_with_retries(next_id[0], db)


async def _run_ocr_with_retries(document_id, db: Session, max_attempts=None, base_delay=None):
    """OCR one document, retrying transient failures. Owns the status fields."""
    max_attempts = max_attempts or settings.ocr_max_retries
    base_delay = settings.ocr_retry_base_delay if base_delay is None else base_delay
    last_error = None

    for attempt in range(1, max_attempts + 1):
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc:  # deleted while queued
            return
        doc.ocr_status = "processing"
        doc.ocr_attempts = attempt
        db.commit()

        try:
            if not doc.thumbnail_path:
                thumb = _try_thumbnail(document_id, doc.file_path)
                if thumb:
                    doc.thumbnail_path = thumb
                    db.commit()

            full_text, page_count, page_texts = await process_file(doc.file_path)

            doc.ocr_text = full_text
            doc.page_count = page_count
            doc.ocr_status = "completed"
            doc.ocr_error = None
            doc.search_vector = func.to_tsvector("english", full_text)

            db.query(DocumentPage).filter(DocumentPage.document_id == document_id).delete()
            for i, text_content in enumerate(page_texts):
                db.add(DocumentPage(document_id=document_id, page_number=i + 1, ocr_text=text_content))
            db.commit()

            # Auto-tagging: rules run on every freshly completed document.
            apply_rules_to_document(db, doc)
            return
        except Exception as e:
            last_error = f"Attempt {attempt}/{max_attempts}: {e}"
            logger.error(
                "OCR attempt %s/%s failed for %s: %s",
                attempt,
                max_attempts,
                document_id,
                last_error,
                exc_info=True,
            )
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.ocr_error = last_error[:1000]
                db.commit()
            if attempt < max_attempts:
                await asyncio.sleep(base_delay * (2 ** (attempt - 1)))

    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc:
        doc.ocr_status = "failed"
        doc.ocr_error = (last_error or "OCR failed")[:1000]
        db.commit()
