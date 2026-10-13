import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import admin, auth, documents, sync_folders, organize, tag_rules, analytics
from app.database import engine, Base, SessionLocal
from app.models import Document
from app.ocr_runner import run_ocr_with_retries

from app.init_db import init_db

init_db()


async def _requeue_one(document_id):
    db = SessionLocal()
    try:
        await run_ocr_with_retries(document_id, db)
    finally:
        db.close()


async def requeue_stuck_documents():
    """Documents left pending/processing by a crash or restart get a fresh
    set of OCR attempts when the app starts, so they never sit stuck."""
    db = SessionLocal()
    try:
        stuck_ids = [
            row[0]
            for row in db.query(Document.id)
            .filter(Document.ocr_status.in_(("pending", "processing")))
            .all()
        ]
        for doc_id in stuck_ids:
            doc = db.query(Document).filter(Document.id == doc_id).first()
            if not doc:
                continue
            doc.ocr_status = "pending"
            doc.ocr_attempts = 0
            doc.ocr_error = None
            db.commit()
            asyncio.create_task(_requeue_one(doc_id))
        if stuck_ids:
            print(f"Requeued {len(stuck_ids)} stuck document(s) for OCR.")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await requeue_stuck_documents()
    yield


app = FastAPI(title="OCR Document Archive API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(sync_folders.router, prefix="/api")
app.include_router(organize.router, prefix="/api")
app.include_router(tag_rules.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")

@app.get("/health")
def health_check():
    return {"status": "ok"}
