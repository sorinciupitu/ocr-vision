import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, Integer, Boolean, ForeignKey, Index, func
)
from sqlalchemy.dialects.postgresql import UUID, TSVECTOR
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    documents = relationship("Document", back_populates="owner")
    sync_folders = relationship("SyncFolder", back_populates="owner")


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(500), nullable=False)
    original_filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_type = Column(String(20), nullable=False)  # pdf, image, docx
    file_size = Column(Integer, default=0)
    page_count = Column(Integer, default=1)
    ocr_text = Column(Text, default="")
    ocr_status = Column(String(20), default="pending")  # pending, processing, completed, failed
    thumbnail_path = Column(String(1000), nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    search_vector = Column(TSVECTOR)

    owner = relationship("User", back_populates="documents")
    pages = relationship("DocumentPage", back_populates="document", cascade="all, delete-orphan")

    @property
    def has_thumbnail(self) -> bool:
        return bool(self.thumbnail_path)

    __table_args__ = (
        Index("idx_documents_search", "search_vector", postgresql_using="gin"),
        Index("idx_documents_owner", "owner_id"),
        Index("idx_documents_status", "ocr_status"),
    )


class DocumentPage(Base):
    __tablename__ = "document_pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    page_number = Column(Integer, nullable=False)
    ocr_text = Column(Text, default="")
    image_path = Column(String(1000), nullable=True)
    search_vector = Column(TSVECTOR)

    document = relationship("Document", back_populates="pages")

    __table_args__ = (
        Index("idx_pages_search", "search_vector", postgresql_using="gin"),
        Index("idx_pages_document", "document_id"),
    )


class SyncFolder(Base):
    __tablename__ = "sync_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    path = Column(String(1000), nullable=False)
    label = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    last_synced_at = Column(DateTime, nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="sync_folders")
