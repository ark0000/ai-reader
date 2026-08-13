import uvicorn
import webbrowser
import threading
import time
import os
import sys
import subprocess

def auto_update():
    """Attempt to pull the latest changes from GitHub before starting."""
    print("Checking for updates...")
    try:
        # Check if we have git installed and are inside a repo
        result = subprocess.run(["git", "pull"], capture_output=True, text=True, check=True)
        print("Update status:\n", result.stdout)
    except Exception as e:
        print("Update skipped (not a git repo or git not found).")

def open_browser():
    # Wait a moment for the server to start
    time.sleep(2.5)
    print("Opening browser to http://127.0.0.1:8000/")
    webbrowser.open("http://127.0.0.1:8000/")

if __name__ == "__main__":
    # Ensure the parent directory is in the Python path
    # so that "from src.main import app" works correctly
    # when the script is run directly as "python src/run_desktop.py"
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
        
    # 1. Try to auto-update via git pull
    auto_update()
    
    # 2. Start the browser thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Check if we are running in a PyInstaller bundle
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        print("Running from PyInstaller executable.")
    
    # Run the FastAPI server
    # We pass the module string so uvicorn can handle reloads if needed (though not needed for exe)
    # Using the app object directly also works well for PyInstaller
    from src.main import app
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
