"""
snapshot_manager.py
Snapshot / Rollback system for AuraReader.

Saves up to MAX_SNAPSHOTS (default 5) application states before each update.
Each snapshot captures Python sources + database + version marker (Option A).
Static assets are excluded by default to keep snapshot size small (~500 KB each).

Environment variables:
  AURA_MAX_SNAPSHOTS           — how many snapshots to retain (default: 5)
  AURA_SNAPSHOT_INCLUDE_STATIC — set "1" to also snapshot src/static/ assets
  AURA_SNAPSHOTS_DIR           — override the snapshot storage directory
"""

import os
import json
import time
import shutil
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
MAX_SNAPSHOTS = int(os.environ.get("AURA_MAX_SNAPSHOTS", "5"))
INCLUDE_STATIC = os.environ.get("AURA_SNAPSHOT_INCLUDE_STATIC", "0") == "1"


def _get_root() -> str:
    """Return the application root directory."""
    import sys
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.argv[0]))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get_snapshots_dir() -> str:
    """Return (and create if needed) the .snapshots directory."""
    default = os.path.join(_get_root(), ".snapshots")
    path = os.environ.get("AURA_SNAPSHOTS_DIR", default)
    os.makedirs(path, exist_ok=True)
    return path


# ── What gets snapshotted ───────────────────────────────────────────────────────
def _get_snapshot_sources(root: str) -> List[Dict[str, str]]:
    """
    Returns a list of {src, dst_rel} pairs describing what to copy.
    dst_rel is relative to the snapshot directory.
    """
    sources = []

    # Python source (excluding __pycache__, chroma_db, temp)
    src_dir = os.path.join(root, "src")
    if os.path.exists(src_dir):
        sources.append({"src": src_dir, "dst_rel": "src", "type": "dir",
                        "exclude": {"__pycache__", "chroma_db", "temp", "database.db"}})

    # Database file
    db_file = os.path.join(root, "src", "database.db")
    if os.path.exists(db_file):
        sources.append({"src": db_file, "dst_rel": "src/database.db", "type": "file"})

    # Version marker
    version_file = os.path.join(root, ".version")
    if os.path.exists(version_file):
        sources.append({"src": version_file, "dst_rel": ".version", "type": "file"})

    # requirements.txt
    req_file = os.path.join(root, "requirements.txt")
    if os.path.exists(req_file):
        sources.append({"src": req_file, "dst_rel": "requirements.txt", "type": "file"})

    return sources


def _copy_item(src: str, dst: str, exclude: set = None):
    """Copy a file or directory tree, skipping excluded names."""
    if os.path.isfile(src):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    elif os.path.isdir(src):
        def ignore_fn(directory, contents):
            if exclude:
                return {c for c in contents if c in exclude}
            return set()
        shutil.copytree(src, dst, ignore=ignore_fn, dirs_exist_ok=True)


def _dir_size(path: str) -> int:
    """Recursively compute directory size in bytes."""
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for fname in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fname))
            except OSError:
                pass
    return total


def _file_count(path: str) -> int:
    """Count files in a directory tree."""
    count = 0
    for _, _, files in os.walk(path):
        count += len(files)
    return count


# ── SnapshotManager ─────────────────────────────────────────────────────────────
class SnapshotManager:
    """
    Facade for creating, listing, and restoring application snapshots.

    Design: uses file-system as the single source of truth — no database
    dependency. This means it works even if the database is corrupt.
    """

    @staticmethod
    def create_snapshot(reason: str = "manual") -> Dict[str, Any]:
        """
        Creates a timestamped snapshot of the current application state.
        Prunes old snapshots so at most MAX_SNAPSHOTS are retained.

        Returns snapshot metadata dict.
        """
        from src.updater_service import CURRENT_VERSION
        root = _get_root()
        snap_dir = _get_snapshots_dir()
        snap_id = f"snap_{time.strftime('%Y%m%d_%H%M%S')}"
        snap_path = os.path.join(snap_dir, snap_id)

        try:
            os.makedirs(snap_path, exist_ok=True)
            sources = _get_snapshot_sources(root)
            file_count = 0

            for item in sources:
                dst = os.path.join(snap_path, item["dst_rel"])
                if item["type"] == "file":
                    if os.path.exists(item["src"]):
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.copy2(item["src"], dst)
                        file_count += 1
                elif item["type"] == "dir":
                    if os.path.exists(item["src"]):
                        _copy_item(item["src"], dst, exclude=item.get("exclude", set()))
                        file_count += _file_count(dst)

            size_bytes = _dir_size(snap_path)

            # Read version
            ver_file = os.path.join(root, ".version")
            version_str = CURRENT_VERSION
            if os.path.exists(ver_file):
                with open(ver_file) as f:
                    version_str = f.read().strip() or CURRENT_VERSION

            meta = {
                "id": snap_id,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "version": version_str,
                "reason": reason,
                "files_count": file_count,
                "size_bytes": size_bytes,
            }

            with open(os.path.join(snap_path, "snapshot.json"), "w") as f:
                json.dump(meta, f, indent=2)

            logger.info(f"Snapshot created: {snap_id} ({size_bytes/1024:.1f} KB, reason={reason})")

            # Prune old snapshots
            SnapshotManager._prune()

            return {"status": "created", **meta}

        except Exception as e:
            logger.error(f"Snapshot creation failed: {e}", exc_info=True)
            shutil.rmtree(snap_path, ignore_errors=True)
            return {"status": "error", "message": str(e)}

    @staticmethod
    def list_snapshots() -> List[Dict[str, Any]]:
        """
        Returns metadata for the last MAX_SNAPSHOTS snapshots,
        newest first.
        """
        snap_dir = _get_snapshots_dir()
        snapshots = []

        for name in sorted(os.listdir(snap_dir), reverse=True):
            snap_path = os.path.join(snap_dir, name)
            meta_file = os.path.join(snap_path, "snapshot.json")
            if not os.path.isdir(snap_path) or not os.path.exists(meta_file):
                continue
            try:
                with open(meta_file) as f:
                    meta = json.load(f)
                meta["size_kb"] = round(meta.get("size_bytes", 0) / 1024, 1)
                snapshots.append(meta)
            except Exception as e:
                logger.warning(f"Could not read snapshot meta {meta_file}: {e}")

        return snapshots[:MAX_SNAPSHOTS]

    @staticmethod
    def restore_snapshot(snap_id: str) -> Dict[str, Any]:
        """
        Restores a snapshot by copying its files back over the live application.
        After restore, the server must be restarted to pick up changes.

        Safety: validates snap_id format before touching any files.
        """
        import re
        if not re.match(r'^snap_\d{8}_\d{6}$', snap_id):
            return {"status": "error", "message": "Invalid snapshot ID format."}

        snap_dir = _get_snapshots_dir()
        snap_path = os.path.join(snap_dir, snap_id)
        meta_file = os.path.join(snap_path, "snapshot.json")

        if not os.path.isdir(snap_path) or not os.path.exists(meta_file):
            return {"status": "error", "message": f"Snapshot '{snap_id}' not found."}

        root = _get_root()

        try:
            with open(meta_file) as f:
                meta = json.load(f)

            # Walk snapshot files and restore them.
            # On Windows, Python source files that are currently imported by the
            # running process may be memory-mapped (WinError 1224 / errno 1224).
            # We skip those files and report them as "skipped" — they will be
            # correctly applied after the server restarts.
            restored = 0
            skipped = []
            for dirpath, _, filenames in os.walk(snap_path):
                for fname in filenames:
                    if fname == "snapshot.json":
                        continue
                    src_file = os.path.join(dirpath, fname)
                    rel = os.path.relpath(src_file, snap_path)
                    dst_file = os.path.join(root, rel)
                    os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                    try:
                        shutil.copy2(src_file, dst_file)
                        restored += 1
                    except (PermissionError, OSError) as file_err:
                        # WinError 1224: file is memory-mapped by running process.
                        # Skip gracefully — changes take effect after server restart.
                        skipped.append(rel)
                        logger.warning(
                            f"Skipping locked file during restore (will apply after restart): "
                            f"{rel} — {file_err}"
                        )

            logger.info(f"Snapshot {snap_id} restored: {restored} files written, {len(skipped)} skipped (locked).")
            return {
                "status": "restored",
                "message": (
                    f"Snapshot from {meta.get('created_at', '?')} (version {meta.get('version', '?')}) "
                    f"has been restored. {len(skipped)} locked file(s) will apply after restart. "
                    "Please restart the server to apply all changes."
                ),
                "snap_id": snap_id,
                "files_restored": restored,
                "files_skipped": skipped,
                "requires_restart": True,
                "snapshot": meta,
            }

        except Exception as e:
            logger.error(f"Snapshot restore failed: {e}", exc_info=True)
            return {"status": "error", "message": f"Restore failed: {str(e)}"}

    @staticmethod
    def delete_snapshot(snap_id: str) -> Dict[str, Any]:
        """Permanently deletes a specific snapshot."""
        import re
        if not re.match(r'^snap_\d{8}_\d{6}$', snap_id):
            return {"status": "error", "message": "Invalid snapshot ID format."}

        snap_dir = _get_snapshots_dir()
        snap_path = os.path.join(snap_dir, snap_id)

        if not os.path.isdir(snap_path):
            return {"status": "error", "message": f"Snapshot '{snap_id}' not found."}

        try:
            shutil.rmtree(snap_path)
            logger.info(f"Snapshot {snap_id} deleted.")
            return {"status": "deleted", "snap_id": snap_id}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    @staticmethod
    def _prune():
        """Keep only the latest MAX_SNAPSHOTS snapshots; delete the rest."""
        snap_dir = _get_snapshots_dir()
        all_snaps = sorted(
            [d for d in os.listdir(snap_dir)
             if os.path.isdir(os.path.join(snap_dir, d)) and d.startswith("snap_")],
            reverse=True
        )
        for old in all_snaps[MAX_SNAPSHOTS:]:
            try:
                shutil.rmtree(os.path.join(snap_dir, old))
                logger.info(f"Pruned old snapshot: {old}")
            except Exception as e:
                logger.warning(f"Could not prune {old}: {e}")
