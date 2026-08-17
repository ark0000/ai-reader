import time
import os
import logging
import httpx
import asyncio
import signal
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from src.database import init_db
from src.task_queue import task_queue
from src.config import settings
from src.routers import auth, chat, connections, files, themes, tts
from src.rag.manager import RAGManager
from src.rag.providers.local_chroma import LocalChromaRAGProvider

log_level = logging.INFO if settings.debug_console == "1" else logging.WARNING
logging.basicConfig(level=log_level)
logger = logging.getLogger(__name__)

last_heartbeat = time.time()

async def desktop_watchdog():
    global last_heartbeat
    # Give a generous 60-second grace period on startup before checking
    last_heartbeat = time.time() + 45
    while True:
        await asyncio.sleep(5)
        if os.environ.get("AURA_DESKTOP_MODE") == "1":
            if time.time() - last_heartbeat > 15:
                logger.warning("No heartbeat received from browser. Shutting down desktop server.")
                os.kill(os.getpid(), signal.SIGTERM)

async def periodic_temp_cleanup():
    from src.storage import LOCAL_TEMP_DIR
    import time
    while True:
        try:
            now = time.time()
            for filename in os.listdir(LOCAL_TEMP_DIR):
                filepath = os.path.join(LOCAL_TEMP_DIR, filename)
                if os.path.isfile(filepath):
                    # Delete files older than 1 hour (3600 seconds)
                    if os.stat(filepath).st_mtime < now - 3600:
                        os.remove(filepath)
        except Exception as e:
            logger.error(f"Error during temp cleanup: {e}")
        await asyncio.sleep(1800)  # Run every 30 minutes

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    
    # Initialize RAG Provider
    try:
        provider = LocalChromaRAGProvider()
        RAGManager.register_provider("default", provider)
    except Exception as e:
        logger.error(f"Failed to initialize RAG Provider: {e}")
        
    await task_queue.start()
    cleanup_task = asyncio.create_task(periodic_temp_cleanup())
    watchdog_task = asyncio.create_task(desktop_watchdog())
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            app.state.http_client = client
            yield
    except asyncio.CancelledError:
        pass
    finally:
        cleanup_task.cancel()
        watchdog_task.cancel()
        await task_queue.stop()

app = FastAPI(
    title="AuraReader Pro API",
    description="Backend for the universal reading app (PDF/EPUB/MD with AI).",
    version="2.0",
    lifespan=lifespan
)

@app.post("/api/heartbeat")
async def receive_heartbeat():
    global last_heartbeat
    last_heartbeat = time.time()
    return {"status": "ok"}

# UI Routes
@app.get("/", response_class=HTMLResponse)
async def get_root():
    static_index = os.path.join(os.path.dirname(__file__), "static", "index_v2.html")
    if os.path.exists(static_index):
        with open(static_index, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="Frontend file index_v2.html not found")
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi import Response
    return Response(status_code=204)



@app.get("/legacy", response_class=HTMLResponse)
async def get_legacy():
    static_index = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_index):
        with open(static_index, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="Frontend file index.html not found")

@app.get("/reader", response_class=HTMLResponse)
async def get_reader():
    static_reader = os.path.join(os.path.dirname(__file__), "static", "reader.html")
    if os.path.exists(static_reader):
        with open(static_reader, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="Frontend file reader.html not found")

@app.get("/reader-enhanced", response_class=HTMLResponse)
async def get_reader_enhanced():
    path = os.path.join(os.path.dirname(__file__), "static", "reader_enhanced.html")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return HTMLResponse(
                content=f.read(),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
    raise HTTPException(status_code=404, detail="reader_enhanced.html not found")

# Include Routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(connections.router)
app.include_router(files.router)
app.include_router(themes.router)
app.include_router(tts.router)

# Static Files (mount last to avoid overriding routes)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
