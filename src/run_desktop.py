import uvicorn
import webview
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
    print("Checking for updates safely...")
    try:
        url = "https://api.github.com/repos/ark0000/ai-reader/releases/latest"
        req = urllib.request.Request(url, headers={'User-Agent': 'AuraReader'})
        response = urllib.request.urlopen(req, timeout=3)
        data = json.loads(response.read().decode('utf-8'))
        
        latest_version = data.get('tag_name')
        if latest_version and latest_version != CURRENT_VERSION:
            print(f"Update available! You are on {CURRENT_VERSION}, but {latest_version} is out.")
            print(f"Download the latest release here: {data.get('html_url')}")
            return latest_version, data.get('html_url')
    except Exception as e:
        print(f"Update check skipped (offline or rate limited): {e}")
    return None, None

def run_server(port):
    """Run the Uvicorn server inside a daemon thread."""
    # We pass the app object directly so Uvicorn runs in this thread
    from src.main import app
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    # Ensure the parent directory is in the Python path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
        
    # Check for safe updates
    latest_version, update_url = check_for_updates()
    
    # Get a dynamic port that won't conflict with other apps
    port = get_free_port()
    print(f"Starting native app server on dynamically allocated port: {port}")
    
    # Start the server thread (daemon=True ensures it dies when the UI closes)
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()
    
    # Wait for the server to spin up
    time.sleep(1.0)
    
    # Create the native desktop window using pywebview
    url = f"http://127.0.0.1:{port}/"
    window = webview.create_window(
        title="AuraReader", 
        url=url, 
        width=1200, 
        height=800,
        min_size=(800, 600)
    )
    
    # Start the native GUI loop on the main thread
    webview.start()
