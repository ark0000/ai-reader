import uvicorn
import webbrowser
import threading
import time
import os
import sys

def open_browser():
    # Wait a moment for the server to start
    time.sleep(1.5)
    print("Opening browser to http://127.0.0.1:8000/")
    webbrowser.open("http://127.0.0.1:8000/")

if __name__ == "__main__":
    # Start the browser thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Check if we are running in a PyInstaller bundle
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        print("Running from PyInstaller executable.")
    
    # Run the FastAPI server
    # We pass the module string so uvicorn can handle reloads if needed (though not needed for exe)
    # Using the app object directly also works well for PyInstaller
    from src.main import app
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
