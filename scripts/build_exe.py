import os
import sys
import subprocess
import shutil

def build_executable():
    print("Building AuraReader Desktop Executable...")
    
    # Ensure pyinstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
    
    # We use --onedir so that the 'src/static' folder is exposed
    # This allows instantly updating HTML/JS/CSS without recompiling the executable!
    command = [
        sys.executable, "-m", "PyInstaller",
        "--name", "AuraReader",
        "--onedir",          # Creates a directory instead of a single file for easy updates
        "--noconsole",       # No console window on double-click (prevents user from closing it)
        "--clean",
        "--noconfirm",
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.protocols.websockets",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.lifespan",
        "--hidden-import=uvicorn.lifespan.on",
        "--add-data", f"src/static{os.pathsep}src/static",  # Bundle frontend files
        "--add-data", f".env{os.pathsep}.",                   # Bundle .env config
        "src/run_desktop.py"
    ]
    
    print(f"Running command: {' '.join(command)}")
    subprocess.check_call(command)
    
    # Post-build: also copy .env next to the exe as a fallback
    # (pydantic_settings looks in CWD for .env, which is dist/AuraReader/ when double-clicked)
    env_src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    env_dst = os.path.join("dist", "AuraReader", ".env")
    if os.path.exists(env_src):
        shutil.copy2(env_src, env_dst)
        print(f"Copied .env to {env_dst}")
    
    print("\n--- Build Complete ---")
    print("Your executable is located in: dist/AuraReader/")
    print("To run the app, double-click: dist/AuraReader/AuraReader.exe")
    print("\n[SHARING]:")
    print("ZIP the entire dist/AuraReader/ folder and send it to a friend.")
    print("They just extract and double-click AuraReader.exe - no Python needed!")

if __name__ == "__main__":
    build_executable()
