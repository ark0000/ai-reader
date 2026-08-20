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
from fastapi import APIRouter, Depends, HTTPException, Request
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
        cursor.execute("""
            SELECT
                u.id,
                u.username,
                COUNT(h.id)         AS total_documents,
                SUM(h.pages_count)  AS total_pages,
                MAX(h.created_at)   AS last_activity
            FROM users u
            LEFT JOIN history h ON h.user_id = u.id
            GROUP BY u.id
            ORDER BY last_activity DESC NULLS LAST
        """)
        rows = [dict(r) for r in cursor.fetchall()]

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


_startup_time = time.time()
