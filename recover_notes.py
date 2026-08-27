import sys
import os

# Add root to pythonpath
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from src.main import app

if __name__ == "__main__":
    print("Starting recovery server on port 55016...")
    uvicorn.run(app, host="127.0.0.1", port=55016)
