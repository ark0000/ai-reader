import os
import time
import pytest
import base64
import threading
import uvicorn
from playwright.sync_api import Page, expect

os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project-id"

from src.main import app
from src.database import init_db

# Initialize database
init_db()

class ServerThread(threading.Thread):
    def __init__(self, host="127.0.0.1", port=8001):
        threading.Thread.__init__(self)
        self.host = host
        self.port = port
        self.server = None

    def run(self):
        config = uvicorn.Config(app, host=self.host, port=self.port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.server.run()

    def stop(self):
        if self.server:
            self.server.should_exit = True

@pytest.fixture(scope="session", autouse=True)
def test_server():
    server = ServerThread()
    server.start()
    time.sleep(2) # Give it a moment to boot
    yield
    server.stop()
    server.join(timeout=2)


def authenticate_user(page: Page) -> str:
    # Use playwright request context to register a test user
    import time
    username = f"e2e_user_{int(time.time())}"
    res = page.request.post("http://127.0.0.1:8001/api/auth/register", data={"username": username, "password": "password123"})
    token = res.json()["token"]
    return token

def test_drag_and_drop_upload(page: Page):
    token = authenticate_user(page)
    # Inject token by going to a blank page on same origin first
    page.goto("http://127.0.0.1:8001/")
    page.evaluate(f"localStorage.setItem('token', '{token}')")

    # Navigate to the enhanced reader
    page.goto("http://127.0.0.1:8001/reader-enhanced")
    
    # Wait for the DOM to be fully loaded
    page.wait_for_load_state("domcontentloaded")
    
    # Ensure no dropzone is currently visible
    dropzone = page.locator("#dropzone")
    
    # Dummy PDF content
    dummy_pdf_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    b64_pdf = base64.b64encode(dummy_pdf_content).decode("utf-8")
    
    # 1. Simulate dragenter (should make dropzone visible)
    page.evaluate("""() => {
        const dt = new DataTransfer();
        const event = new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
    }""")
    
    # 2. Simulate drop with a file
    page.evaluate(f"""(b64Content) => {{
        const bytes = Uint8Array.from(atob(b64Content), c => c.charCodeAt(0));
        const file = new File([bytes], 'e2e_test_drop.pdf', {{ type: 'application/pdf' }});
        const dt = new DataTransfer();
        dt.items.add(file);
        
        const event = new DragEvent('drop', {{ dataTransfer: dt, bubbles: true, cancelable: true }});
        document.dispatchEvent(event);
    }}""", b64_pdf)
    
    time.sleep(2)

def test_global_notes_migration_on_startup(page: Page):
    token = authenticate_user(page)
    page.goto("http://127.0.0.1:8001/")
    page.evaluate(f"localStorage.setItem('token', '{token}')")
    
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

    # Go to root to set some IndexedDB legacy notes
    page.goto("http://127.0.0.1:8001/legacy")
    page.wait_for_load_state("domcontentloaded")
    
    # Inject legacy notes into IndexedDB
    page.evaluate("""async () => {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('NotesDB', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('global_notes')) {
                    const store = db.createObjectStore('global_notes', { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('global_notes', 'readwrite');
                const store = tx.objectStore('global_notes');
                store.put({
                    id: 123456789,
                    title: 'Legacy E2E Note',
                    content: 'This note should migrate',
                    rawText: 'This note should migrate',
                    updatedAt: Date.now()
                });
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => reject();
            };
        });
    }""")
    
    # Clear localStorage migration flag to trigger migration
    page.evaluate("""() => {
        localStorage.removeItem('global_notes_migrated_v2');
    }""")
    
    # Load reader-enhanced to trigger migration
    page.goto("http://127.0.0.1:8001/reader-enhanced")
    page.wait_for_load_state("domcontentloaded")
    
    # Trigger the migration by fetching notes
    page.evaluate("async () => await window.notesRepo.getAllNotes()")
    
    time.sleep(2) # Give fetch() time to complete
    
    # Verify migration flag is set
    migrated = page.evaluate("() => localStorage.getItem('global_notes_migrated_v2')")
    assert migrated == 'true'
    
    # Fetch from backend to ensure it's there
    notes = page.evaluate("""async () => {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/notes/global', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return await res.json();
    }""")
    
    found = False
    for n in notes:
        if n.get("title") == 'Legacy E2E Note':
            found = True
            break
    assert found
