import multiprocessing

if __name__ == '__main__':
    multiprocessing.freeze_support()

import uvicorn
import threading
import time
import os
import sys
import socket
import urllib.request
import json

CURRENT_VERSION = "v1.0.0"

def get_free_port():
    """Find a dynamically available ephemeral port using the OS."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def check_for_updates():
    """Safely check the GitHub API for a new release without downloading or extracting payloads."""
    try:
        url = "https://api.github.com/repos/ark0000/ai-reader/releases/latest"
        req = urllib.request.Request(url, headers={'User-Agent': 'AuraReader'})
        response = urllib.request.urlopen(req, timeout=3)
        data = json.loads(response.read().decode('utf-8'))
        
        latest_version = data.get('tag_name')
        if latest_version and latest_version != CURRENT_VERSION:
            return latest_version, data.get('html_url')
    except Exception as e:
        pass
    return None, None

def run_server(port):
    """Run the Uvicorn server inside a daemon thread."""
    from src.main import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def open_browser(url):
    """Reliably open a URL in the default browser on Windows."""
    try:
        with open("debug_log.txt", "a") as f:
            f.write(f"Attempting to open browser to {url} using os.startfile...\n")
            f.flush()
        # os.startfile uses the Windows ShellExecute API, which is much more reliable in PyInstaller than webbrowser.open
        os.startfile(url)
        with open("debug_log.txt", "a") as f:
            f.write(f"os.startfile succeeded.\n")
            f.flush()
    except Exception as e:
        with open("debug_log.txt", "a") as f:
            f.write(f"Browser launch failed: {e}\n")
            f.flush()

if __name__ == "__main__":
    
    with open("debug_log.txt", "w") as f:
        f.write("App started\n")
        f.flush()
        
    try:
        # Ensure the parent directory is in the Python path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)
            
        with open("debug_log.txt", "a") as f:
            f.write("Checking for updates...\n")
            f.flush()
            
        latest_version, update_url = check_for_updates()
        
        port = get_free_port()
        
        with open("debug_log.txt", "a") as f:
            f.write(f"Port allocated: {port}. Starting server...\n")
            f.flush()
        
        url = f"http://127.0.0.1:{port}/"
        
        # Schedule the browser to open after 1.5 seconds so the server has time to start
        threading.Timer(1.5, open_browser, args=(url,)).start()
        
        # Start the server on the main thread so it stays alive
        run_server(port)
        
    except Exception as e:
        with open("debug_log.txt", "a") as f:
            f.write(f"FATAL ERROR: {e}\n")
            f.flush()
