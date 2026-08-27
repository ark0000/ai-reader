import multiprocessing
import sys
import os

# === STEP 0: PyInstaller frozen-exe bootstrap ===
# This MUST run before any other imports to prevent crashes.
if __name__ == '__main__':
    multiprocessing.freeze_support()

    # When PyInstaller runs with --noconsole, sys.stdout and sys.stderr are None.
    # Any print() or logging call will crash with AttributeError.
    # Redirect them to a log file next to the executable.
    _log_path = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0] if sys.argv[0] else __file__)), "aura_server.log")
    try:
        _log_file = open(_log_path, "w", encoding="utf-8")
        if sys.stdout is None:
            sys.stdout = _log_file
        if sys.stderr is None:
            sys.stderr = _log_file
    except Exception:
        pass

# === Regular imports (safe now that stdout/stderr are valid) ===
import uvicorn
import threading
import socket
import time
import urllib.request
import json

CURRENT_VERSION = "v1.0.0"

def _get_app_dir():
    """Get the directory where the .exe (or script) lives. All user-facing files go here."""
    if getattr(sys, 'frozen', False):
        # Frozen exe: sys.argv[0] is the .exe path
        return os.path.dirname(os.path.abspath(sys.argv[0]))
    else:
        # Normal Python: use the project root (parent of src/)
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _log(msg):
    """Write a timestamped message to debug_log.txt next to the exe."""
    try:
        log_path = os.path.join(_get_app_dir(), "debug_log.txt")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
            f.flush()
    except Exception:
        pass

def get_free_port():
    """Find a dynamically available port, preferring 8500 to keep browser origins consistent."""
    # First try a fixed port so browser localStorage/IndexedDB persists across restarts
    preferred_port = 8500
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('127.0.0.1', preferred_port))
        s.close()
        return preferred_port
    except OSError:
        pass
        
    # Fallback to random ephemeral port if preferred is taken
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def check_for_updates():
    """Safely check GitHub API for a new release (read-only, no downloads)."""
    try:
        url = "https://api.github.com/repos/ark0000/ai-reader/releases/latest"
        req = urllib.request.Request(url, headers={'User-Agent': 'AuraReader'})
        response = urllib.request.urlopen(req, timeout=3)
        data = json.loads(response.read().decode('utf-8'))
        latest_version = data.get('tag_name')
        if latest_version and latest_version != CURRENT_VERSION:
            _log(f"Update available: {CURRENT_VERSION} -> {latest_version}")
            return latest_version, data.get('html_url')
    except Exception:
        pass
    return None, None

def wait_for_server(port, timeout=15):
    """Poll the server port until it accepts connections, or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.5)
            s.connect(('127.0.0.1', port))
            s.close()
            return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.3)
    return False

def run_server(port):
    """Run the Uvicorn server (blocks the calling thread)."""
    from src.main import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def open_browser(url):
    """Open URL in the default browser using the native Windows Shell API."""
    try:
        os.startfile(url)
        _log(f"Browser opened: {url}")
    except Exception as e:
        _log(f"Browser open failed: {e}")

# === Main entry point ===
if __name__ == "__main__":
    # Clear old log
    try:
        log_path = os.path.join(_get_app_dir(), "debug_log.txt")
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] AuraReader starting...\n")
    except Exception:
        pass

    try:
        # 1. Fix Python path so `from src.main import app` works
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        # 2. Check for updates (non-blocking, 3s timeout)
        _log("Checking for updates...")
        check_for_updates()

        # 3. Find a free port
        port = get_free_port()
        _log(f"Port allocated: {port}")

        # 4. Start server in a background daemon thread
        _log("Starting Uvicorn server thread...")
        os.environ["AURA_DESKTOP_MODE"] = "1"
        server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
        server_thread.start()

        # 5. Wait until the server is ACTUALLY ready (up to 45 seconds for cold PyInstaller start)
        _log("Waiting for server to become ready...")
        url = f"http://127.0.0.1:{port}/"
        if wait_for_server(port, timeout=45):
            _log("Server is ready!")
        else:
            _log("Server readiness timeout (45s). Opening browser anyway — server may still be loading.")

        # 6. Open browser regardless — the page will auto-refresh or show loading
        open_browser(url)

        # 6. Keep the main thread alive so the daemon server thread keeps running.
        #    When the user closes the console window (or kills the process), everything exits cleanly.
        server_thread.join()

    except Exception as e:
        _log(f"FATAL ERROR: {e}")
