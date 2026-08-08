import os
import secrets
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Google Cloud & BigQuery
    project_id: str | None = os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")
    dataset_id: str = os.getenv("BIGQUERY_DATASET", "document_pipeline")
    table_id: str = os.getenv("BIGQUERY_TABLE", "processed_metadata")
    
    # LLM
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    
    # Auth
    jwt_secret_key: str | None = os.getenv("JWT_SECRET_KEY")
    
    # Debug
    debug_console: str = os.getenv("DEBUG_CONSOLE", "0")
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

if not settings.jwt_secret_key:
    if settings.debug_console != "1":
        raise ValueError("FATAL: JWT_SECRET_KEY environment variable MUST be set in production to prevent database corruption.")
    settings.jwt_secret_key = secrets.token_urlsafe(32)
