"""
updater.py
FastAPI router for Desktop Auto-Updater endpoints.
Includes snapshot / rollback management endpoints.
"""

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from typing import Optional, List
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
    """Apply the latest update using the detected strategy.
    
    Automatically creates a snapshot before applying so the update can be rolled back.
    """
    return DesktopUpdaterFacade.apply_update()

@router.post("/restart")
async def restart_app():
    """Safely restart the application."""
    return DesktopUpdaterFacade.restart_application()


# ── Snapshot / Rollback Endpoints ─────────────────────────────────────────────

@router.get("/snapshots")
async def list_snapshots():
    """
    List the last 5 application snapshots available for rollback.
    Each snapshot contains the app state captured before an update was applied.
    """
    from src.snapshot_manager import SnapshotManager
    return {"snapshots": SnapshotManager.list_snapshots()}

@router.post("/snapshots/create")
async def create_snapshot(reason: str = Query("manual", description="Reason for creating this snapshot")):
    """
    Manually create a snapshot of the current application state.
    Useful before making manual configuration changes.
    """
    from src.snapshot_manager import SnapshotManager
    result = SnapshotManager.create_snapshot(reason=reason)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Snapshot failed"))
    return result

@router.post("/snapshots/{snap_id}/restore")
async def restore_snapshot(snap_id: str):
    """
    Restore the application to a previous snapshot.
    After restore, a server restart is required to apply the changes.
    
    The snap_id must match the format: snap_YYYYMMDD_HHMMSS
    """
    from src.snapshot_manager import SnapshotManager
    result = SnapshotManager.restore_snapshot(snap_id)
    if result.get("status") == "error":
        msg = result.get("message", "Restore failed")
        # "not found" or "invalid ID" → 404; everything else → 500
        if "not found" in msg.lower() or "invalid" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=500, detail=msg)
    return result

@router.delete("/snapshots/{snap_id}")
async def delete_snapshot(snap_id: str):
    """
    Permanently delete a specific snapshot to free disk space.
    """
    from src.snapshot_manager import SnapshotManager
    result = SnapshotManager.delete_snapshot(snap_id)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message", "Delete failed"))
    return result
