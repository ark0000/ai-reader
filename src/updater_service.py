"""
updater_service.py
Core Desktop Auto-Updater Service for AuraReader.
Implements Strategy, Factory, and Facade design patterns for seamless GitHub release updates.
"""

import os
import sys
import time
import json
import re
import urllib.request
import subprocess
import shutil
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)

CURRENT_VERSION = "v1.0.0"
GITHUB_REPO = "ark0000/ai-reader"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

def get_project_root() -> str:
    """Get the root directory of the application."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.argv[0]))
    else:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class SemVerComparator:
    """Algorithm for parsing and comparing Semantic Versioning strings."""
    
    @staticmethod
    def parse(version_str: str) -> Tuple[int, int, int]:
        """Convert 'v1.2.3' or '1.0' into (1, 2, 3)."""
        if not version_str:
            return (0, 0, 0)
        # Strip leading 'v' or 'V'
        cleaned = re.sub(r'^[vV]', '', version_str.strip())
        # Extract numerical components
        match = re.match(r'^(\d+)(?:\.(\d+))?(?:\.(\d+))?', cleaned)
        if match:
            major = int(match.group(1) or 0)
            minor = int(match.group(2) or 0)
            patch = int(match.group(3) or 0)
            return (major, minor, patch)
        return (0, 0, 0)

    @classmethod
    def is_newer(cls, latest_version: str, current_version: str) -> bool:
        """Return True if latest_version > current_version."""
        latest = cls.parse(latest_version)
        current = cls.parse(current_version)
        return latest > current


class UpdateStrategy:
    """Base strategy for applying updates."""
    def apply(self, release_data: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class GitUpdateStrategy(UpdateStrategy):
    """Update strategy for Git-cloned installations."""
    
    def apply(self, release_data: Dict[str, Any]) -> Dict[str, Any]:
        root = get_project_root()
        try:
            logger.info("Executing git pull to update to latest...")
            # Check git status first
            status_res = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True, timeout=10)
            has_local_changes = bool(status_res.stdout.strip())
            
            if has_local_changes:
                # Stash changes to prevent conflict
                subprocess.run(["git", "stash"], cwd=root, capture_output=True, text=True, timeout=10)
            
            # Fetch & pull
            pull_res = subprocess.run(["git", "pull", "origin", "main"], cwd=root, capture_output=True, text=True, timeout=30)
            if pull_res.returncode != 0:
                # Fallback to general git pull
                pull_res = subprocess.run(["git", "pull"], cwd=root, capture_output=True, text=True, timeout=30)
            
            if pull_res.returncode == 0:
                return {
                    "status": "success",
                    "message": "Application files updated successfully via Git.",
                    "details": pull_res.stdout,
                    "requires_restart": True
                }
            else:
                return {
                    "status": "error",
                    "message": f"Git pull failed: {pull_res.stderr or pull_res.stdout}",
                    "requires_restart": False
                }
        except Exception as e:
            logger.error(f"Git update failed: {e}")
            return {
                "status": "error",
                "message": f"Git update error: {str(e)}",
                "requires_restart": False
            }


class ReleaseAssetUpdateStrategy(UpdateStrategy):
    """Update strategy for downloading static asset updates or release zip bundles."""
    
    def apply(self, release_data: Dict[str, Any]) -> Dict[str, Any]:
        root = get_project_root()
        download_url = release_data.get("asset_url") or release_data.get("zipball_url")
        html_url = release_data.get("html_url", f"https://github.com/{GITHUB_REPO}/releases/latest")
        is_compiled_asset = bool(release_data.get("asset_url"))
        
        if not download_url:
            return {
                "status": "manual",
                "message": "Please download the latest release from GitHub.",
                "download_url": html_url,
                "requires_restart": False
            }
        
        try:
            temp_zip = os.path.join(root, "temp_update.zip")
            req = urllib.request.Request(download_url, headers={'User-Agent': 'AuraReader-Updater'})
            with urllib.request.urlopen(req, timeout=60) as response, open(temp_zip, 'wb') as out_file:
                shutil.copyfileobj(response, out_file)
            
            # Extract
            import zipfile
            extract_dir = os.path.join(root, "temp_update_extracted")
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
            
            # Find the root folder inside the extracted zip
            subfolders = [os.path.join(extract_dir, f) for f in os.listdir(extract_dir) if os.path.isdir(os.path.join(extract_dir, f))]
            source_folder = subfolders[0] if len(subfolders) == 1 else extract_dir
            
            if not getattr(sys, 'frozen', False) or not is_compiled_asset:
                # Not frozen or downloaded source zipball: safely update static files only
                src_static = os.path.join(source_folder, "src", "static")
                dst_static = os.path.join(root, "src", "static")
                
                if getattr(sys, 'frozen', False):
                    internal_static = os.path.join(root, "_internal", "src", "static")
                    if os.path.exists(internal_static):
                        dst_static = internal_static
                        
                if os.path.exists(src_static) and os.path.exists(dst_static):
                    shutil.copytree(src_static, dst_static, dirs_exist_ok=True)
                
                # Cleanup temp files
                if os.path.exists(temp_zip):
                    os.remove(temp_zip)
                if os.path.exists(extract_dir):
                    shutil.rmtree(extract_dir, ignore_errors=True)
                    
                # Save the new SHA
                latest_sha = release_data.get("latest_version", "unknown")
                # Since latest_version in release_data might be truncated ([:7]), we should use zipball_url or just save what we have
                # Actually, release_name might have it. Or we can just save latest_version
                version_file = os.path.join(root, ".version")
                try:
                    with open(version_file, "w") as f:
                        f.write(latest_sha)
                except Exception as e:
                    logger.error(f"Failed to write .version file: {e}")
                    
                return {
                    "status": "success",
                    "message": "Update downloaded and applied successfully!",
                    "requires_restart": True
                }
            else:
                # Frozen PyInstaller App: Spawn a batch script to overwrite the running executable
                bat_path = os.path.join(root, "apply_update.bat")
                exe_name = os.path.basename(sys.argv[0])
                
                bat_script = f"""@echo off
echo Waiting for AuraReader to close...
ping 127.0.0.1 -n 3 > nul
echo Updating files...
xcopy /s /e /y "{os.path.basename(extract_dir)}\\{os.path.basename(source_folder)}\\*" "."
echo Cleaning up...
rmdir /s /q "{os.path.basename(extract_dir)}"
del /f /q "{os.path.basename(temp_zip)}"
echo Starting new version...
start "" "{exe_name}"
del "%~f0"
"""
                with open(bat_path, "w", encoding="utf-8") as f:
                    f.write(bat_script)
                
                # Execute batch file detached
                creation_flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
                subprocess.Popen(["cmd.exe", "/c", bat_path], cwd=root, creationflags=creation_flags)
                
                # Schedule immediate exit so batch script can acquire file locks
                import threading
                def _exit_later():
                    time.sleep(1.5)
                    os._exit(0)
                threading.Thread(target=_exit_later, daemon=True).start()
                
                return {
                    "status": "success",
                    "message": "Update applied. Restarting immediately...",
                    "requires_restart": False
                }
                
        except Exception as e:
            logger.error(f"Asset update failed: {e}")
            return {
                "status": "error",
                "message": f"Asset update error: {str(e)}. You can download manually from GitHub.",
                "download_url": html_url,
                "requires_restart": False
            }


class UpdateStrategyFactory:
    """Factory to choose the optimal update strategy based on environment."""
    
    @staticmethod
    def get_strategy() -> Tuple[str, UpdateStrategy]:
        root = get_project_root()
        is_git = os.path.exists(os.path.join(root, ".git"))
        if is_git:
            return ("git", GitUpdateStrategy())
        else:
            return ("release_asset", ReleaseAssetUpdateStrategy())


class DesktopUpdaterFacade:
    """Facade orchestrating version checking, release fetching, and 1-click update execution."""
    
    _cache_time = 0
    _cached_result: Optional[Dict[str, Any]] = None
    _CACHE_TTL = 600  # 10 minutes cache
    
    @classmethod
    def check_for_updates(cls, force: bool = False) -> Dict[str, Any]:
        """Check GitHub for new releases with caching."""
        now = time.time()
        if not force and cls._cached_result and (now - cls._cache_time < cls._CACHE_TTL):
            return cls._cached_result
        
        root = get_project_root()
        is_git = os.path.exists(os.path.join(root, ".git"))
        is_frozen = getattr(sys, 'frozen', False)
        
        result: Dict[str, Any] = {
            "current_version": CURRENT_VERSION,
            "latest_version": CURRENT_VERSION,
            "has_update": False,
            "release_name": "",
            "release_notes": "",
            "release_url": f"https://github.com/{GITHUB_REPO}/releases",
            "published_at": "",
            "is_git": is_git,
            "is_frozen": is_frozen,
            "checked_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        
        try:
            if is_git:
                # Check for Git updates by seeing if origin/main is ahead
                subprocess.run(["git", "fetch", "origin", "main"], cwd=root, capture_output=True, timeout=10)
                count_res = subprocess.run(["git", "rev-list", "HEAD..origin/main", "--count"], cwd=root, capture_output=True, text=True, timeout=5)
                commits_behind = int(count_res.stdout.strip() or 0)
                
                result.update({
                    "has_update": commits_behind > 0,
                    "release_name": f"{commits_behind} New Commits Available",
                    "release_notes": "Updates have been pushed to the git repository. Click Apply to pull the latest changes.",
                    "latest_version": "git-latest" if commits_behind > 0 else CURRENT_VERSION
                })
                cls._cached_result = result
                cls._cache_time = now
            else:
                # For frozen apps, check the latest commit on main branch instead of releases
                commit_api_url = f"https://api.github.com/repos/{GITHUB_REPO}/commits/main"
                req = urllib.request.Request(
                    commit_api_url,
                    headers={
                        'User-Agent': 'AuraReader-Desktop',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode('utf-8'))
                        latest_sha = data.get("sha", "")
                        
                        # Read the local .version file to know our current SHA
                        current_sha = CURRENT_VERSION
                        version_file = os.path.join(root, ".version")
                        if os.path.exists(version_file):
                            with open(version_file, "r") as f:
                                current_sha = f.read().strip()
                        
                        has_update = latest_sha != "" and not latest_sha.startswith(current_sha)
                        
                        result.update({
                            "latest_version": latest_sha[:7] if latest_sha else CURRENT_VERSION,
                            "current_version": current_sha[:7] if len(current_sha) > 7 else current_sha,
                            "has_update": has_update,
                            "release_name": f"Commit {latest_sha[:7]}",
                            "release_notes": data.get("commit", {}).get("message", "Latest updates from main branch."),
                            "release_url": data.get("html_url") or result["release_url"],
                            "published_at": data.get("commit", {}).get("author", {}).get("date", ""),
                            "zipball_url": f"https://github.com/{GITHUB_REPO}/archive/refs/heads/main.zip",
                            "asset_url": None
                        })
                        
                        cls._cached_result = result
                        cls._cache_time = now
        except Exception as e:
            logger.warning(f"Could not check for updates: {e}")
            result["error"] = str(e)
            
        return result

    @classmethod
    def apply_update(cls) -> Dict[str, Any]:
        """Apply the update using the appropriate strategy.
        
        A snapshot of the current state is automatically created before applying,
        so the user can roll back if anything goes wrong.
        """
        update_info = cls.check_for_updates(force=True)
        strategy_name, strategy = UpdateStrategyFactory.get_strategy()

        # Auto-snapshot before applying (Rollback Fix)
        try:
            from src.snapshot_manager import SnapshotManager
            snap_result = SnapshotManager.create_snapshot(reason="pre-update")
            logger.info(f"Pre-update snapshot: {snap_result.get('id', 'unknown')}")
        except Exception as e:
            logger.warning(f"Could not create pre-update snapshot (non-fatal): {e}")

        res = strategy.apply(update_info)
        res["strategy"] = strategy_name
        res["current_version"] = CURRENT_VERSION
        res["latest_version"] = update_info.get("latest_version", CURRENT_VERSION)
        return res


    @classmethod
    def restart_application(cls) -> Dict[str, Any]:
        """Safely trigger application shutdown for manual restart."""
        try:
            # Schedule delayed process exit
            import threading
            def _exit_later():
                time.sleep(1.0)
                os._exit(0)
            threading.Thread(target=_exit_later, daemon=True).start()
            
            return {"status": "restarting", "message": "Application is shutting down..."}
        except Exception as e:
            logger.error(f"Shutdown failed: {e}")
            return {"status": "error", "message": f"Shutdown failed: {str(e)}"}
