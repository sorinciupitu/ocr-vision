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
    is_admin: bool = False

    class Config:
        from_attributes = True


class UserAdminResponse(UserResponse):
    created_at: datetime

    class Config:
        from_attributes = True


class UserAdminUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class RegistrationStatus(BaseModel):
    open: bool


class LLMSettings(BaseModel):
    provider: str = "ollama"
    base_url: str = ""
    model: str = ""
    api_key_set: bool = False


class LLMSettingsUpdate(BaseModel):
    provider: str = Field(default="ollama", min_length=1, max_length=50)
    base_url: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)
    api_key: Optional[str] = Field(default=None, max_length=500)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: List[dict] = Field(default_factory=list, max_length=20)


class ChatResponse(BaseModel):
    answer: str
    sources: List[str] = []


class TagBrief(BaseModel):
    id: UUID4
    name: str
    color: Optional[str] = None

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


class TagUpdate(BaseModel):
    """Partial update: only the provided fields change."""
    name: Optional[str] = None
    color: Optional[str] = None


class TagResponse(BaseModel):
    id: UUID4
    name: str
    color: Optional[str] = None
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
    ocr_attempts: int = 0
    ocr_error: Optional[str] = None
    has_thumbnail: bool = False
    folder: Optional[FolderBrief] = None
    tags: List[TagBrief] = []
    created_at: datetime
    updated_at: datetime
    
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


class TagRuleUpdate(BaseModel):
    """Partial update: only the provided fields change."""
    pattern: Optional[str] = None
    is_active: Optional[bool] = None


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


class DuplicateCheckRequest(BaseModel):
    names: List[str]


class DuplicateCheckResponse(BaseModel):
    # Subset of the requested names (as spelled by the caller) that already
    # exist as documents of the current user.
    existing: List[str]
