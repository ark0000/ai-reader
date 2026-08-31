import os
import time
import pytest
import threading
import uvicorn
from playwright.sync_api import Page, expect

os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project-id"
os.environ["DEBUG_CONSOLE"] = "1"  # Important for Admin panel access

from src.main import app
from src.database import init_db

init_db()

class ServerThread(threading.Thread):
    def __init__(self, host="127.0.0.1", port=8002):
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


def authenticate_user(page: Page) -> tuple[str, str]:
    import time
    username = f"e2e_admin_test_{int(time.time())}"
    res = page.request.post("http://127.0.0.1:8002/api/auth/register", data={"username": username, "password": "password123"})
    token = res.json()["token"]
    return token, username

def test_admin_trash_flow(page: Page):
    token, username = authenticate_user(page)
    
    # 1. Create a note via API
    headers = {"Authorization": f"Bearer {token}"}
    note_payload = {
        "id": int(time.time() * 1000) + 123,
        "title": "E2E Trash UI Note",
        "content": "<p>Will be deleted</p>",
        "rawText": "Will be deleted",
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000
    }
    res = page.request.post("http://127.0.0.1:8002/api/notes/global", data=note_payload, headers=headers)
    assert res.ok
    
    # 2. Soft delete it via API
    res = page.request.delete(f"http://127.0.0.1:8002/api/notes/global/{note_payload['id']}", headers=headers)
    assert res.ok

    # 3. Go to Admin UI
    page.goto("http://127.0.0.1:8002/admin")
    page.wait_for_load_state("domcontentloaded")
    
    # Authenticate admin panel with localstorage
    page.evaluate(f"localStorage.setItem('token', '{token}'); localStorage.setItem('username', '{username}');")
    page.reload()
    page.wait_for_load_state("domcontentloaded")
    
    # Click 'Users & State' tab
    page.click("button[onclick=\"switchTab('users')\"]")
    
    # Wait for users table to populate
    page.wait_for_selector("#users-tbody tr")
    
    # Find the trash button for our test user
    row = page.locator(f"tr:has-text('{username}')")
    trash_btn = row.locator("button:has-text('Trash')")
    trash_btn.click()
    
    # Wait for modal
    modal = page.locator("#notes-modal")
    expect(modal).to_be_visible()
    
    # Verify title says Trash Bin
    expect(page.locator("#notes-modal-title")).to_contain_text("Trash Bin")
    
    # Find our deleted note in the sidebar
    sidebar_note = page.locator(f"#notes-list-sidebar div:has-text('E2E Trash UI Note')").first
    expect(sidebar_note).to_be_visible()
    
    # Click it to view details
    sidebar_note.click()
    
    # Check the Action button is "Restore Note"
    restore_btn = page.locator("#note-delete-btn")
    expect(restore_btn).to_be_visible()
    expect(restore_btn).to_contain_text("Restore Note")
    
    # Playwright auto-accept dialog handling
    page.once("dialog", lambda dialog: dialog.accept())
    
    # Click Restore
    restore_btn.click()
    
    # Handle the potential secondary alert ("Note restored successfully!")
    page.once("dialog", lambda dialog: dialog.accept())
    
    # Verify it was restored via API
    res = page.request.get(f"http://127.0.0.1:8002/api/notes/global/{note_payload['id']}", headers=headers)
    assert res.ok
    assert res.json()["title"] == "E2E Trash UI Note"
