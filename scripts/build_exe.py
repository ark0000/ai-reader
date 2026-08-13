import os
import subprocess
import sys

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
        "pyinstaller",
        "--name", "AuraReader",
        "--onedir",          # Creates a directory instead of a single file for easy updates
        "--clean",
        "--noconfirm",
        "--add-data", f"src/static{os.pathsep}src/static", # Include static files
        "src/run_desktop.py"
    ]
    
    print(f"Running command: {' '.join(command)}")
    subprocess.check_call(command)
    
    print("\n--- Build Complete ---")
    print("Your executable is located in: dist/AuraReader/")
    print("To run the app, double-click: dist/AuraReader/AuraReader.exe")
    print("\n[EASY UPDATE/ROLLBACK TRICK]:")
    print("Because we used --onedir, if you want to update the frontend (HTML/JS/CSS),")
    print("you DO NOT need to re-run this build script. You can simply copy your updated")
    print("'src/static' folder and paste it into 'dist/AuraReader/_internal/src/static'")
    print("(or wherever PyInstaller placed it), replacing the old files instantly!")

if __name__ == "__main__":
    build_executable()
