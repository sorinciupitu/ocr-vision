from pydantic import BaseModel, EmailStr, UUID4, Field
from typing import Optional, List
from datetime import datetime


class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: UUID4
    username: str
    email: EmailStr
    is_active: bool

    class Config:
        from_attributes = True


class TagBrief(BaseModel):
    id: UUID4
    name: str

    class Config:
        from_attributes = True


class FolderBrief(BaseModel):
    id: UUID4
    name: str

    class Config:
        from_attributes = True


class FolderCreate(BaseModel):
    name: str


class FolderResponse(BaseModel):
    id: UUID4
    name: str
    document_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class TagCreate(BaseModel):
    name: str


class TagResponse(BaseModel):
    id: UUID4
    name: str
    document_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentMove(BaseModel):
    folder_id: Optional[UUID4] = None


class DocumentTagsUpdate(BaseModel):
    tag_ids: List[UUID4]


class DocumentResponse(BaseModel):
    id: UUID4
    title: str
    original_filename: str
    file_type: str
    file_size: int
    page_count: int
    ocr_status: str
    has_thumbnail: bool = False
    folder: Optional[FolderBrief] = None
    tags: List[TagBrief] = []
    created_at: datetime
    
    class Config:
        from_attributes = True


class DocumentDetailResponse(DocumentResponse):
    ocr_text: str

    class Config:
        from_attributes = True

class SearchResult(BaseModel):
    document: DocumentResponse
    snippet: str


class BulkFolderUpdate(BaseModel):
    document_ids: List[UUID4] = Field(min_length=1)
    folder_id: Optional[UUID4] = None


class BulkTagsAdd(BaseModel):
    document_ids: List[UUID4] = Field(min_length=1)
    tag_ids: List[UUID4] = Field(min_length=1)


class BulkDeleteRequest(BaseModel):
    document_ids: List[UUID4] = Field(min_length=1)


class BulkResult(BaseModel):
    updated: int


class BulkDeleteResult(BaseModel):
    deleted: int


class TagRuleCreate(BaseModel):
    pattern: str
    tag_id: UUID4


class TagRuleResponse(BaseModel):
    id: UUID4
    pattern: str
    is_active: bool
    created_at: datetime
    tag: TagBrief

    class Config:
        from_attributes = True


class TagRuleCreateResponse(TagRuleResponse):
    matched_count: int = 0


class MonthlyCount(BaseModel):
    month: str
    count: int


class AnalyticsSummary(BaseModel):
    documents: int
    pages: int
    words: int
    tags: int
    folders: int
    by_month: List[MonthlyCount]
