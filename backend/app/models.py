import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, Integer, Boolean, ForeignKey, Index, Table, UniqueConstraint, func
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
    folders = relationship("Folder", back_populates="owner")
    tags = relationship("Tag", back_populates="owner")
    tag_rules = relationship("TagRule", back_populates="owner")


document_tags = Table(
    "document_tags",
    Base.metadata,
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


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
    ocr_attempts = Column(Integer, default=0)
    ocr_error = Column(String(1000), nullable=True)  # last failure, shown in the UI
    thumbnail_path = Column(String(1000), nullable=True)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    search_vector = Column(TSVECTOR)

    owner = relationship("User", back_populates="documents")
    pages = relationship("DocumentPage", back_populates="document", cascade="all, delete-orphan")
    # Eager: responses serialize folder/tags after the DB session may close.
    folder = relationship("Folder", back_populates="documents", lazy="selectin")
    tags = relationship("Tag", secondary=document_tags, back_populates="documents", lazy="selectin")

    @property
    def has_thumbnail(self) -> bool:
        return bool(self.thumbnail_path)

    __table_args__ = (
        Index("idx_documents_search", "search_vector", postgresql_using="gin"),
        Index("idx_documents_owner", "owner_id"),
        Index("idx_documents_status", "ocr_status"),
        Index("idx_documents_folder", "folder_id"),
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


class Folder(Base):
    """User-created archive folder; a document lives in at most one folder."""
    __tablename__ = "folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="folders")
    documents = relationship("Document", back_populates="folder")

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_folders_owner_name"),
    )


class Tag(Base):
    """User-created tag; a document can carry many tags."""
    __tablename__ = "tags"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="tags")
    documents = relationship("Document", secondary=document_tags, back_populates="tags")

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_tags_owner_name"),
    )


class TagRule(Base):
    """Auto-tag rule: documents whose OCR text or filename contain pattern get tag."""
    __tablename__ = "tag_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pattern = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    tag_id = Column(UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="tag_rules")
    tag = relationship("Tag", lazy="selectin")


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
