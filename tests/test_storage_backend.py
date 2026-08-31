import os
import json
import pytest
import time
from fastapi.testclient import TestClient

# Must set BYPASS_BIGQUERY_ERRORS for app import
os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project-id"

# Use an in-memory SQLite database for testing, if possible.
# Actually, src.database uses get_db_connection() which points to data.db. 
# We'll just test against data.db since we're in a test environment, but use unique keys.
from src.main import app
from src.database import init_db, register_user, get_db_connection

@pytest.fixture(autouse=True)
def setup_test_users():
    init_db()
    try:
        register_user("testuser_999", "password")
        register_user("testuser_888", "password")
        register_user("testuser_777", "password")
    except Exception:
        pass

def get_user_id(username):
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT id FROM users WHERE username = ?", (username,))
        return c.fetchone()['id']

def get_auth_headers(username):
    user_id = get_user_id(username)
    from src.database import create_jwt
    token = create_jwt({"user_id": user_id})
    return {"Authorization": f"Bearer {token}"}

client = TestClient(app)

def test_global_notes_crud():
    headers = get_auth_headers("testuser_999") # test user
    
    # 1. Create a note
    note_payload = {
        "id": int(time.time() * 1000),
        "title": "Test Note",
        "content": "<p>Test Content</p>",
        "rawText": "Test Content",
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000
    }
    
    response = client.post("/api/notes/global", json=note_payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Note"
    
    # 2. Get the note
    response = client.get(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Test Note"
    
    # 3. Get all notes
    response = client.get("/api/notes/global", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    
    # 4. Delete the note
    response = client.delete(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 200
    
    # 5. Verify deletion
    response = client.get(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 404

def test_document_storage_merging():
    headers = get_auth_headers("testuser_999")
    doc_key = f"test_doc_{int(time.time())}.pdf"
    
    # 1. Save scroll state
    scroll_payload = {
        "data": {
            "scrollState": {"page": 2, "offset": 150}
        }
    }
    response = client.post(f"/api/storage/document/{doc_key}", json=scroll_payload, headers=headers)
    assert response.status_code == 200
    
    # 2. Save notes (concurrent simulation)
    notes_payload = {
        "data": {
            "notes": [{"id": "n1", "text": "A note"}]
        }
    }
    response = client.post(f"/api/storage/document/{doc_key}", json=notes_payload, headers=headers)
    assert response.status_code == 200
    
    # 3. Verify both are merged successfully
    response = client.get(f"/api/storage/document/{doc_key}", headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    
    assert "scrollState" in data
    assert data["scrollState"]["page"] == 2
    
    assert "notes" in data
    assert len(data["notes"]) == 1
    assert data["notes"][0]["text"] == "A note"

def test_document_storage_isolation():
    user1_headers = get_auth_headers("testuser_888")
    user2_headers = get_auth_headers("testuser_777")
    doc_key = "shared_doc.pdf"
    
    # User 1 saves data
    client.post(f"/api/storage/document/{doc_key}", json={"data": {"scrollState": {"page": 5}}}, headers=user1_headers)
    
    # User 2 saves data
    client.post(f"/api/storage/document/{doc_key}", json={"data": {"scrollState": {"page": 10}}}, headers=user2_headers)
    
    # Verify isolation
    res1 = client.get(f"/api/storage/document/{doc_key}", headers=user1_headers).json()["data"]
    res2 = client.get(f"/api/storage/document/{doc_key}", headers=user2_headers).json()["data"]
    
    assert res1["scrollState"]["page"] == 5
    assert res2["scrollState"]["page"] == 10

def test_soft_delete_and_restore():
    headers = get_auth_headers("testuser_999")
    user_id = get_user_id("testuser_999")
    
    note_payload = {
        "id": int(time.time() * 1000) + 1,
        "title": "Trash Test Note",
        "content": "<p>Content to be trashed</p>",
        "rawText": "Content to be trashed",
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000
    }
    
    # 1. Create a note
    response = client.post("/api/notes/global", json=note_payload, headers=headers)
    assert response.status_code == 200
    
    # 2. Soft delete it
    response = client.delete(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 200
    
    # 3. Verify it is gone from active notes
    response = client.get(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 404
    
    # 4. Verify it exists in trash bin via Admin endpoint
    response = client.get(f"/api/admin/users/{user_id}/deleted_notes")
    assert response.status_code == 200
    trash_data = response.json()
    assert "deleted_notes" in trash_data
    assert any(n["id"] == note_payload["id"] for n in trash_data["deleted_notes"])
    
    # 5. Restore it via Admin endpoint
    response = client.post(f"/api/admin/users/{user_id}/notes/{note_payload['id']}/restore")
    assert response.status_code == 200
    
    # 6. Verify it is back in active notes
    response = client.get(f"/api/notes/global/{note_payload['id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Trash Test Note"
    
    # 7. Verify it is gone from trash bin
    response = client.get(f"/api/admin/users/{user_id}/deleted_notes")
    assert response.status_code == 200
    trash_data = response.json()
    assert not any(n["id"] == note_payload["id"] for n in trash_data["deleted_notes"])
def test_raw_notes_dump():
    headers = get_auth_headers("testuser_999")
    
    # 1. Create a book note
    note_payload = {
        "id": int(time.time() * 1000) + 99,
        "title": "[book:999][ch:1] The First Chapter",
        "content": "<p>Content</p>",
        "rawText": "Content",
        "createdAt": time.time() * 1000,
        "updatedAt": time.time() * 1000
    }
    client.post("/api/notes/global", json=note_payload, headers=headers)
    
    # 2. Call admin dump
    response = client.get("/api/admin/raw_notes_dump", headers=headers)
    assert response.status_code == 200
    data = response.json()
    
    # 3. Verify prefix is stripped
    found = False
    for n in data.get("global_notes", []):
        if n["id"] == note_payload["id"]:
            assert n["title"] == "The First Chapter"
            found = True
            break
            
    assert found
