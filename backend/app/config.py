from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql://user:password@db:5432/ocr_db"
    vllm_url: str = "http://vllm:8000/v1/chat/completions"
    vllm_model: str = "lightonai/LightOnOCR-3-4B"
    jwt_secret: str = "supersecretkey"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours
    sync_folder: str = "/app/local_sync"
    upload_folder: str = "/app/uploads"
    max_file_size_mb: int = 50
    supported_extensions: str = ".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.docx"
    redis_url: str = "redis://redis:6379/0"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
