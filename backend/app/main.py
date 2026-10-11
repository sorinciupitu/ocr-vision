from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, documents, sync_folders, organize
from app.database import engine, Base

from app.init_db import init_db

init_db()

app = FastAPI(title="OCR Document Archive API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(documents.router, prefix="/api")
app.include_router(sync_folders.router, prefix="/api")
app.include_router(organize.router, prefix="/api")

@app.get("/health")
def health_check():
    return {"status": "ok"}
