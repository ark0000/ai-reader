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

# Initialize database tables for testing
init_db()

# Create test users
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

user_999_id = get_user_id("testuser_999")
user_888_id = get_user_id("testuser_888")
user_777_id = get_user_id("testuser_777")

client = TestClient(app)

# Helper function to mock authentication headers for testing
def get_auth_headers(user_id):
    from src.database import create_jwt
    token = create_jwt({"user_id": user_id})
    return {"Authorization": f"Bearer {token}"}

def test_global_notes_crud():
    headers = get_auth_headers(user_id=user_999_id) # test user
    
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
    headers = get_auth_headers(user_id=user_999_id)
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
    user1_headers = get_auth_headers(user_id=user_888_id)
    user2_headers = get_auth_headers(user_id=user_777_id)
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
