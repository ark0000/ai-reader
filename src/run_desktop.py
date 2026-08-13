import uvicorn
import webbrowser
import threading
import time
import os
import sys
import subprocess

def auto_update():
    """Attempt to pull the latest frontend changes from GitHub without needing git installed."""
    print("Checking for frontend updates from GitHub...")
    try:
        import urllib.request
        import zipfile
        import io
        import shutil
        
        url = "https://github.com/ark0000/ai-reader/archive/refs/heads/main.zip"
        
        # Download the zip file in memory
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=5)
        
        with zipfile.ZipFile(io.BytesIO(response.read())) as z:
            # The root folder inside the zip is usually something like "ai-reader-main"
            root_dir = z.namelist()[0].split('/')[0]
            
            # Figure out where our local 'src/static' folder is
            base_dir = os.path.dirname(os.path.abspath(__file__))
            static_target = os.path.join(base_dir, "static")
            
            # Extract just the static files
            for file_info in z.infolist():
                if file_info.filename.startswith(f"{root_dir}/src/static/"):
                    relative_path = file_info.filename[len(f"{root_dir}/src/static/"):]
                    if not relative_path:
                        continue
                    
                    target_path = os.path.join(static_target, relative_path)
                    
                    if file_info.is_dir():
                        os.makedirs(target_path, exist_ok=True)
                    else:
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        with open(target_path, "wb") as f:
                            f.write(z.read(file_info.filename))
                            
        print("Frontend update complete! You have the latest UI features.")
    except Exception as e:
        print(f"Update skipped (could not fetch from GitHub): {e}")

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
