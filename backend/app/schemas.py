from pydantic import BaseModel, EmailStr, UUID4
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


class DocumentResponse(BaseModel):
    id: UUID4
    title: str
    original_filename: str
    file_type: str
    file_size: int
    page_count: int
    ocr_status: str
    has_thumbnail: bool = False
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
