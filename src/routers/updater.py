"""
updater.py
FastAPI router for Desktop Auto-Updater endpoints.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional
from src.updater_service import DesktopUpdaterFacade

router = APIRouter(prefix="/api/updater", tags=["updater"])

class UpdateCheckResponse(BaseModel):
    current_version: str
    latest_version: str
    has_update: bool
    release_name: Optional[str] = None
    release_notes: Optional[str] = None
    release_url: Optional[str] = None
    published_at: Optional[str] = None
    is_git: bool
    is_frozen: bool
    checked_at: str
    error: Optional[str] = None

@router.get("/local-version")
async def get_local_version():
    """Fast endpoint to get the currently running version without hitting GitHub."""
    from src.updater_service import get_project_root, CURRENT_VERSION
    import os
    root = get_project_root()
    version_file = os.path.join(root, ".version")
    if os.path.exists(version_file):
        with open(version_file, "r") as f:
            return {"version": f.read().strip()}
    return {"version": CURRENT_VERSION}

@router.get("/check", response_model=UpdateCheckResponse)
async def check_updates(force: bool = Query(False, description="Force fresh check bypassing cache")):
    """Check for new updates from GitHub Releases."""
    return DesktopUpdaterFacade.check_for_updates(force=force)

@router.post("/apply")
async def apply_update():
    """Apply the latest update using the detected strategy."""
    return DesktopUpdaterFacade.apply_update()

@router.post("/restart")
async def restart_app():
    """Safely restart the application."""
    return DesktopUpdaterFacade.restart_application()
