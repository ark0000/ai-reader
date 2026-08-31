"""
src/routers/admin.py
=====================
Developer-mode admin panel backend.

Only accessible when DEBUG_CONSOLE=1 is set in the environment.
Provides real-time tracking of:
  - Active users and their sessions
  - Which document each user currently has open
  - Per-user note counts
  - Server log streaming (last N lines)
  - Task queue state
  - System resource snapshot

Architecture decisions:
  - AdminTracker is a singleton (module-level) to survive across request lifetimes
  - Activity is pushed by the client via POST /api/admin/activity (lightweight ping)
  - Sessions expire after INACTIVITY_TIMEOUT seconds with no ping
  - All endpoints are guarded by require_dev_mode() which checks DEBUG_CONSOLE env var
  - Log streaming uses a bounded RingBuffer (deque) to avoid memory growth
"""

import os
import time
import logging
import collections
import threading
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel

from src.config import settings
from src.database import UserRepository, HistoryRepository, get_db_connection
from src.task_queue import task_queue

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# ── Constants ─────────────────────────────────────────────────────────────────
INACTIVITY_TIMEOUT = int(os.environ.get("AURA_ADMIN_SESSION_TTL", "300"))  # 5 min default
LOG_RING_SIZE = int(os.environ.get("AURA_ADMIN_LOG_LINES", "500"))          # last 500 log lines

# ── Dev-mode Guard ────────────────────────────────────────────────────────────
def require_dev_mode():
    if settings.debug_console != "1":
        raise HTTPException(
            status_code=403,
            detail="Admin panel is only available in developer mode (DEBUG_CONSOLE=1)."
        )

# ── In-memory Log Ring Buffer ─────────────────────────────────────────────────
class RingBufferHandler(logging.Handler):
    """Thread-safe logging handler that stores the last N log records in memory."""

    def __init__(self, capacity: int):
        super().__init__()
        self._buf: collections.deque = collections.deque(maxlen=capacity)
        self._lock = threading.Lock()
        self.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%H:%M:%S"
        ))

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            with self._lock:
                self._buf.append({
                    "ts": record.created,
                    "level": record.levelname,
                    "logger": record.name,
                    "msg": msg
                })
        except Exception:
            self.handleError(record)

    def get_lines(self, n: int = LOG_RING_SIZE, level: Optional[str] = None) -> List[Dict]:
        with self._lock:
            lines = list(self._buf)
        if level:
            lines = [l for l in lines if l["level"] == level.upper()]
        return lines[-n:]


# Install the ring buffer on the root logger once at import time
_ring_handler = RingBufferHandler(LOG_RING_SIZE)
logging.getLogger().addHandler(_ring_handler)


# ── Session Activity Tracker ──────────────────────────────────────────────────
class AdminTracker:
    """
    Singleton that tracks per-user activity pushed by the client.

    Data model per session:
        username     : str
        user_id      : int
        current_file : str | None      — filename currently open
        file_ext     : str | None      — file type (pdf/md/epub/txt)
        note_count   : int             — number of notes saved
        library_count: int             — number of documents in local library
        page         : int | None      — current page (pdf) or scrollTop (others)
        last_seen    : float           — unix timestamp of last ping
        started_at   : float           — unix timestamp of first ping this session
        ip           : str | None      — client IP
    """

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}   # key: username
        self._lock = threading.Lock()
        self._event_log: collections.deque = collections.deque(maxlen=1000)
        # ISOLATION FIX: Store outside of LOCAL_TEMP_DIR so periodic_temp_cleanup doesn't delete it
        self._state_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".admin_state.json"))

    # ── State Persistence ─────────────────────────────────────────────────────
    def save_state(self):
        """Serialize tracker state to JSON atomically."""
        try:
            import json
            with self._lock:
                data = {
                    "sessions": self._sessions,
                    "event_log": list(self._event_log)
                }
            
            tmp_path = self._state_file + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, self._state_file)
            logger.info("AdminTracker: State saved to disk.")
        except Exception as e:
            logger.error(f"AdminTracker: Failed to save state: {e}")
            
    def load_state(self):
        """Load tracker state from JSON."""
        try:
            import json
            if os.path.exists(self._state_file):
                with open(self._state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                with self._lock:
                    self._sessions = data.get("sessions", {})
                    # Restore event_log
                    self._event_log.clear()
                    self._event_log.extend(data.get("event_log", []))
                logger.info(f"AdminTracker: State loaded ({len(self._sessions)} sessions).")
        except Exception as e:
            logger.error(f"AdminTracker: Failed to load state: {e}")

    # ── Public write ──────────────────────────────────────────────────────────
    def record_activity(self, *, username: str, user_id: int,
                        current_file: Optional[str], file_ext: Optional[str],
                        note_count: int, library_count: int, page: Optional[int], ip: Optional[str],
                        previous_username: Optional[str] = None):
        now = time.time()
        with self._lock:
            if previous_username and previous_username in self._sessions and previous_username != username:
                existing = self._sessions.pop(previous_username)
            else:
                existing = self._sessions.get(username, {})
                
            prev_file = existing.get("current_file")

            session = {
                "username":     username,
                "user_id":      user_id,
                "current_file": current_file,
                "file_ext":     file_ext,
                "note_count":   note_count,
                "library_count": library_count,
                "page":         page,
                "last_seen":    now,
                "started_at":   existing.get("started_at", now),
                "ip":           ip or existing.get("ip"),
            }
            self._sessions[username] = session

            # Log document-open events
            if current_file and current_file != prev_file:
                self._event_log.append({
                    "ts":       now,
                    "username": username,
                    "event":    "opened_document",
                    "detail":   current_file
                })
                logger.info(f"[Admin] {username} opened: {current_file}")

    # ── Public read ───────────────────────────────────────────────────────────
    def get_active_sessions(self, include_expired: bool = False) -> List[Dict]:
        now = time.time()
        with self._lock:
            result = []
            for s in self._sessions.values():
                idle = now - s["last_seen"]
                if include_expired or idle < INACTIVITY_TIMEOUT:
                    result.append({**s, "idle_seconds": round(idle)})
            return sorted(result, key=lambda x: x["last_seen"], reverse=True)

    def get_summary(self) -> Dict:
        now = time.time()
        sessions = self.get_active_sessions()
        all_sessions = self.get_active_sessions(include_expired=True)
        return {
            "active_users":        len(sessions),
            "total_known_users":   len(all_sessions),
            "total_notes_tracked": sum(s["note_count"] for s in sessions),
            "active_documents":    [s["current_file"] for s in sessions if s["current_file"]],
            "server_time":         now,
            "session_ttl_seconds": INACTIVITY_TIMEOUT,
        }

    def get_events(self, n: int = 100) -> List[Dict]:
        with self._lock:
            return list(self._event_log)[-n:]

    def evict_expired(self):
        """Remove sessions older than INACTIVITY_TIMEOUT."""
        now = time.time()
        with self._lock:
            expired = [u for u, s in self._sessions.items()
                       if now - s["last_seen"] > INACTIVITY_TIMEOUT]
            for u in expired:
                del self._sessions[u]
        return len(expired)


_tracker = AdminTracker()


# ── Request Models ────────────────────────────────────────────────────────────
class ActivityPing(BaseModel):
    username:     str
    user_id:      int = 1
    current_file: Optional[str] = None
    file_ext:     Optional[str] = None
    note_count:   int = 0
    library_count: int = 0
    page:         Optional[int] = None
    previous_username: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/activity", dependencies=[])
async def post_activity(ping: ActivityPing, request: Request):
    """
    Client heartbeat — sent every 30 s by the reader when DEBUG_CONSOLE=1.
    No auth required (tracker is internal). Zero-cost in production (guard skips).
    """
    if settings.debug_console != "1":
        return {"status": "noop"}  # silent no-op in production

    client_ip = request.client.host if request.client else None
    _tracker.record_activity(
        username=ping.username,
        user_id=ping.user_id,
        current_file=ping.current_file,
        file_ext=ping.file_ext,
        note_count=ping.note_count,
        library_count=ping.library_count,
        page=ping.page,
        ip=client_ip,
        previous_username=ping.previous_username
    )
    return {"status": "ok", "tracked": True}


@router.get("/sessions")
async def get_sessions(_: None = Depends(require_dev_mode)):
    """All currently active user sessions with their reading state."""
    _tracker.evict_expired()
    return {
        "sessions":      _tracker.get_active_sessions(),
        "summary":       _tracker.get_summary(),
        "inactivity_ttl": INACTIVITY_TIMEOUT
    }


@router.get("/events")
async def get_events(n: int = 100, _: None = Depends(require_dev_mode)):
    """Recent document-open and activity events (up to 1000 stored)."""
    return {"events": _tracker.get_events(n=min(n, 1000))}


@router.get("/logs")
async def get_logs(
    n: int = 200,
    level: Optional[str] = None,
    _: None = Depends(require_dev_mode)
):
    """
    Return last N server log lines from the in-memory ring buffer.
    Filter by level: DEBUG | INFO | WARNING | ERROR | CRITICAL
    """
    lines = _ring_handler.get_lines(n=min(n, LOG_RING_SIZE), level=level)
    return {
        "count":     len(lines),
        "log_lines": lines,
        "ring_size": LOG_RING_SIZE
    }


@router.get("/queue")
async def get_queue_state(_: None = Depends(require_dev_mode)):
    """Current state of the conversion task queue."""
    tasks = []
    for tid, t in task_queue.tasks.items():
        tasks.append({
            "task_id":      tid,
            "status":       t.get("status"),
            "user_id":      t.get("user_id"),
            "progress":     t.get("progress"),
            "total":        t.get("total"),
            "error":        t.get("error"),
            "created_at":   t.get("created_at"),
            "started_at":   t.get("started_at"),
            "completed_at": t.get("completed_at"),
            "ext":          t.get("ext"),
        })
    tasks.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    status_counts = collections.Counter(t["status"] for t in tasks)
    return {
        "queue_depth":   task_queue.queue.qsize(),
        "max_depth":     task_queue.MAX_QUEUE_DEPTH,
        "total_tasks":   len(tasks),
        "status_counts": dict(status_counts),
        "tasks":         tasks[:100]  # cap response at 100 entries
    }


@router.get("/users")
async def get_all_users(_: None = Depends(require_dev_mode)):
    """
    All registered users with their history stats from the SQLite database.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Fetch true library note counts by parsing JSON
        cursor.execute("SELECT user_id, data_json FROM document_storage")
        import json
        import collections
        lib_notes_map = collections.defaultdict(int)
        for r in cursor.fetchall():
            try:
                data = json.loads(r["data_json"])
                notes_array = data.get("notes") or []
                lib_notes_map[r["user_id"]] += len(notes_array)
            except:
                pass
                
        cursor.execute("""
            SELECT
                u.id,
                u.username,
                (SELECT COUNT(id) FROM history WHERE user_id = u.id) AS total_documents,
                (SELECT SUM(pages_count) FROM history WHERE user_id = u.id) AS total_pages,
                (SELECT MAX(created_at) FROM history WHERE user_id = u.id) AS last_activity,
                (SELECT COUNT(id) FROM global_notes WHERE user_id = u.id) AS total_global_notes
            FROM users u
            ORDER BY last_activity DESC NULLS LAST
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        
        for row in rows:
            row["total_library_notes"] = lib_notes_map.get(row["id"], 0)

    # Merge with live tracker data
    live = {s["username"]: s for s in _tracker.get_active_sessions(include_expired=True)}
    for row in rows:
        live_data = live.get(row["username"], {})
        row["is_active"]    = live_data.get("idle_seconds", 9999) < INACTIVITY_TIMEOUT
        row["current_file"] = live_data.get("current_file")
        row["file_ext"]     = live_data.get("file_ext")
        row["note_count"]   = live_data.get("note_count", 0)
        row["library_count"]= live_data.get("library_count", 0)
        row["current_page"] = live_data.get("page")
        row["last_seen"]    = live_data.get("last_seen")
        row["ip"]           = live_data.get("ip")

    return {"users": rows, "total": len(rows)}


@router.get("/users/{target_user_id}/dump")
async def dump_user_notes(target_user_id: int, _: None = Depends(require_dev_mode)):
    """Dump raw JSON notes data for a specific user."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM global_notes WHERE user_id = ?", (target_user_id,))
        global_notes = [dict(r) for r in cursor.fetchall()]
        
        cursor.execute("SELECT * FROM document_storage WHERE user_id = ?", (target_user_id,))
        doc_storage = []
        import json
        for r in cursor.fetchall():
            d = dict(r)
            if d.get('data_json'):
                try: d['data_json'] = json.loads(d['data_json'])
                except: pass
            doc_storage.append(d)
            
        return {
            "target_user_id": target_user_id,
            "global_notes": global_notes,
            "document_storage": doc_storage
        }

@router.get("/users/{target_user_id}/deleted_notes")
async def get_deleted_user_notes(target_user_id: int, _: None = Depends(require_dev_mode)):
    """Fetch the trash bin (deleted global notes) for a specific user, after cleaning up 30+ day old items."""
    from src.database import GlobalNotesRepository
    GlobalNotesRepository.cleanup_old_deleted()
    deleted_notes = GlobalNotesRepository.get_deleted(target_user_id)
    return {"deleted_notes": deleted_notes}

@router.post("/users/{target_user_id}/notes/{note_id}/restore")
async def restore_user_note(target_user_id: int, note_id: int, _: None = Depends(require_dev_mode)):
    """Restore a deleted global note."""
    from src.database import GlobalNotesRepository
    success = GlobalNotesRepository.restore(target_user_id, note_id)
    if success:
        return {"status": "success", "message": "Note restored successfully."}
    else:
        raise HTTPException(status_code=404, detail="Note not found or could not be restored.")

class DeleteNoteRequest(BaseModel):
    type: str # 'global' or 'doc'
    docOrGlobalIdx: int
    noteIdx: int = -1

@router.delete("/users/{target_user_id}/notes")
async def delete_user_note(target_user_id: int, req: DeleteNoteRequest, _: None = Depends(require_dev_mode)):
    """Delete a specific note for a user."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if req.type == 'global':
            # Support soft delete
            cursor.execute("SELECT id FROM global_notes WHERE user_id = ? AND deleted_at IS NULL", (target_user_id,))
            global_notes = cursor.fetchall()
            if 0 <= req.docOrGlobalIdx < len(global_notes):
                note_id = global_notes[req.docOrGlobalIdx]['id']
                from src.database import GlobalNotesRepository
                GlobalNotesRepository.delete(target_user_id, note_id)
        elif req.type == 'doc':
            cursor.execute("SELECT id, data_json FROM document_storage WHERE user_id = ?", (target_user_id,))
            docs = cursor.fetchall()
            if 0 <= req.docOrGlobalIdx < len(docs):
                doc_id = docs[req.docOrGlobalIdx]['id']
                import json
                try:
                    data = json.loads(docs[req.docOrGlobalIdx]['data_json'] or '{}')
                    notes = []
                    if isinstance(data.get('notes'), list): notes = data['notes']
                    elif isinstance(data, list): notes = data
                    elif isinstance(data.get('highlights'), list): notes = data['highlights']
                    
                    if 0 <= req.noteIdx < len(notes):
                        notes.pop(req.noteIdx)
                        if isinstance(data.get('notes'), list): data['notes'] = notes
                        elif isinstance(data, list): data = notes
                        elif isinstance(data.get('highlights'), list): data['highlights'] = notes
                        
                        cursor.execute("UPDATE document_storage SET data_json = ? WHERE id = ?", (json.dumps(data), doc_id))
                except Exception:
                    pass
        conn.commit()
    return {"status": "success", "message": "Note deleted."}

@router.delete("/users/clear")
async def clear_all_users(_: None = Depends(require_dev_mode)):
    """DANGER: Wipe all user data and notes from the database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Rely on ON DELETE CASCADE for all related tables
        cursor.execute("DELETE FROM users WHERE id != 1")
        # For the guest user (id=1), explicitly delete their data
        for table in ["document_storage", "global_notes", "history", "connections", "themes"]:
            try: cursor.execute(f"DELETE FROM {table} WHERE user_id = 1")
            except: pass
        conn.commit()
    
    _tracker._sessions.clear()
    return {"status": "success", "message": "All user data has been cleared (Guest preserved)."}


@router.delete("/users/{target_user_id}")
async def delete_single_user(target_user_id: int, _: None = Depends(require_dev_mode)):
    """Delete a specific user and all their data."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Since foreign_keys = ON and tables have ON DELETE CASCADE, deleting the user
        # will automatically delete their connections, credentials, themes, history, etc.
        cursor.execute("DELETE FROM users WHERE id = ?", (target_user_id,))
        conn.commit()
    
    to_remove = [sid for sid, s in _tracker._sessions.items() if s.get("user_id") == target_user_id]
    for sid in to_remove:
        del _tracker._sessions[sid]
        
    return {"status": "success", "message": f"User {target_user_id} deleted."}


@router.get("/system")
async def get_system_info(_: None = Depends(require_dev_mode)):
    """Quick server resource snapshot (no heavy dependencies)."""
    import sys
    from src.storage import LOCAL_TEMP_DIR

    try:
        temp_files = [
            f for f in os.listdir(LOCAL_TEMP_DIR)
            if os.path.isfile(os.path.join(LOCAL_TEMP_DIR, f))
        ]
        temp_size = sum(
            os.path.getsize(os.path.join(LOCAL_TEMP_DIR, f))
            for f in temp_files
        )
    except Exception:
        temp_files, temp_size = [], 0

    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage(LOCAL_TEMP_DIR)
        resources = {
            "cpu_percent":  cpu,
            "mem_total_mb": round(mem.total / 1024**2),
            "mem_used_mb":  round(mem.used / 1024**2),
            "mem_percent":  mem.percent,
            "disk_free_gb": round(disk.free / 1024**3, 2),
        }
    except ImportError:
        resources = {"note": "Install psutil for resource metrics"}

    return {
        "python_version": sys.version,
        "debug_mode":     settings.debug_console == "1",
        "temp_dir":       LOCAL_TEMP_DIR,
        "temp_file_count": len(temp_files),
        "temp_size_mb":    round(temp_size / 1024**2, 2),
        "server_uptime_s": round(time.time() - _startup_time),
        "resources":       resources,
    }


@router.delete("/sessions/evict")
async def evict_expired_sessions(_: None = Depends(require_dev_mode)):
    """Manually evict expired sessions from the tracker."""
    count = _tracker.evict_expired()
    return {"evicted": count}



@router.get("/shared_files")
async def get_all_shared_files(_: None = Depends(require_dev_mode)):
    import os
    from src.storage import LOCAL_TEMP_DIR
    from src.database import get_db_connection
    
    files = []
    if os.path.exists(LOCAL_TEMP_DIR):
        for f in os.listdir(LOCAL_TEMP_DIR):
            if "_input." in f or "_output." in f:
                task_id = f.split("_input.")[0].split("_output.")[0]
                size = os.path.getsize(os.path.join(LOCAL_TEMP_DIR, f))
                
                # Check if there is an output file
                has_output = any(other.startswith(task_id + "_output.") for other in os.listdir(LOCAL_TEMP_DIR))
                
                if "_output." in f or (not has_output and "_input." in f):
                    import json
                    filename_to_show = f
                    meta_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_meta.json")
                    if os.path.exists(meta_path):
                        try:
                            with open(meta_path, "r", encoding="utf-8") as mf:
                                meta = json.load(mf)
                                filename_to_show = meta.get("original_filename", f)
                        except Exception:
                            pass
                            
                    files.append({
                        "task_id": task_id,
                        "filename": filename_to_show,
                        "raw_filename": f,
                        "size": size
                    })
    
    # Deduplicate by task_id
    seen = set()
    unique_files = []
    for f in files:
        if f["task_id"] not in seen:
            seen.add(f["task_id"])
            unique_files.append(f)
            
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT task_id, filename, shared_at FROM shared_files")
        shared = {r["task_id"]: dict(r) for r in cursor.fetchall()}
        
    for f in unique_files:
        f["is_shared"] = f["task_id"] in shared
        if f["is_shared"]:
            f["shared_filename"] = shared[f["task_id"]]["filename"]
            
    return {"files": unique_files}

class SharePayload(BaseModel):
    filename: str

@router.post("/shared_files/{task_id}")
async def share_file(task_id: str, payload: SharePayload, _: None = Depends(require_dev_mode)):
    from src.database import get_db_connection
    import time
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO shared_files (task_id, filename, shared_at) VALUES (?, ?, ?)", 
                       (task_id, payload.filename, time.time()))
        conn.commit()
    return {"status": "success"}

@router.delete("/shared_files/{task_id}")
async def unshare_file(task_id: str, _: None = Depends(require_dev_mode)):
    from src.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM shared_files WHERE task_id = ?", (task_id,))
        conn.commit()
    return {"status": "success"}


@router.post("/upload")
async def admin_upload_file(file: UploadFile, _: None = Depends(require_dev_mode)):
    import uuid
    import os
    from src.storage import LOCAL_TEMP_DIR
    
    ext = file.filename.lower().split('.')[-1]

    task_id = uuid.uuid4().hex
    try:
        content_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload: {str(e)}")
        
    input_filename = f"{task_id}_input.{ext}"
    output_filename = f"{task_id}_output.pdf"
    
    # Save input
    input_path = os.path.join(LOCAL_TEMP_DIR, input_filename)
    with open(input_path, "wb") as f:
        f.write(content_bytes)
        
    # Save metadata
    import json
    meta_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_meta.json")
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump({"original_filename": file.filename}, mf)
        
    # If it's a PDF, we can also just copy it to output so it's instantly readable without conversion
    if ext == "pdf":
        output_path = os.path.join(LOCAL_TEMP_DIR, output_filename)
        with open(output_path, "wb") as f:
            f.write(content_bytes)
            
    return {"status": "success", "task_id": task_id}

@router.delete("/vault/{task_id}")
async def delete_vault_file(task_id: str, _: None = Depends(require_dev_mode)):
    import os
    from src.storage import LOCAL_TEMP_DIR
    from src.database import get_db_connection
    
    # Delete all associated files
    if os.path.exists(LOCAL_TEMP_DIR):
        for f in os.listdir(LOCAL_TEMP_DIR):
            if f.startswith(task_id):
                try:
                    os.remove(os.path.join(LOCAL_TEMP_DIR, f))
                except Exception:
                    pass
                    
    # Remove from shared_files
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM shared_files WHERE task_id = ?", (task_id,))
        conn.commit()
        
    return {"status": "success"}

@router.delete("/vault")
async def delete_all_vault_files(_: None = Depends(require_dev_mode)):
    import os
    from src.storage import LOCAL_TEMP_DIR
    from src.database import get_db_connection
    
    # Delete all vault files (_input, _output, _meta)
    if os.path.exists(LOCAL_TEMP_DIR):
        for f in os.listdir(LOCAL_TEMP_DIR):
            if "_input." in f or "_output." in f or "_meta." in f:
                try:
                    os.remove(os.path.join(LOCAL_TEMP_DIR, f))
                except Exception:
                    pass
                    
    # Truncate shared_files table
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM shared_files")
        conn.commit()
        
    return {"status": "success"}

_startup_time = time.time()


