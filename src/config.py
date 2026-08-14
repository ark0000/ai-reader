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
    # In desktop or standalone environments, persist a local secret key so database encryption is stable
    key_file = os.path.join(os.path.dirname(__file__), ".secret_key")
    if os.path.exists(key_file):
        try:
            with open(key_file, "r", encoding="utf-8") as f:
                settings.jwt_secret_key = f.read().strip()
        except Exception:
            pass
    if not settings.jwt_secret_key:
        settings.jwt_secret_key = secrets.token_urlsafe(32)
        try:
            with open(key_file, "w", encoding="utf-8") as f:
                f.write(settings.jwt_secret_key)
        except Exception:
            pass
