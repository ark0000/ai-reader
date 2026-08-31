import pytest
from fastapi.testclient import TestClient
from src.main import app
from src.database import get_db_connection

client = TestClient(app)

@pytest.fixture
def test_user_and_notes():
    # Setup test user and notes
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Create test user
        cursor.execute("INSERT INTO users (username, hashed_password) VALUES (?, ?)", ('test_admin_notes_user', 'hash'))
        user_id = cursor.lastrowid
        
        # Create a book root note and 2 chapters
        cursor.execute("INSERT INTO global_notes (user_id, title, content) VALUES (?, ?, ?)", (user_id, '[book:b-test123]', 'Root Note'))
        root_note_id = cursor.lastrowid
        
        cursor.execute("INSERT INTO global_notes (user_id, title, content) VALUES (?, ?, ?)", (user_id, '[book:b-test123][ch:1] Chapter 1', 'Chapter 1 Content'))
        ch1_id = cursor.lastrowid
        
        cursor.execute("INSERT INTO global_notes (user_id, title, content) VALUES (?, ?, ?)", (user_id, '[book:b-test123][ch:2] Chapter 2', 'Chapter 2 Content'))
        ch2_id = cursor.lastrowid
        
        conn.commit()
        
        yield {
            "user_id": user_id,
            "root_id": root_note_id,
            "ch1_id": ch1_id,
            "ch2_id": ch2_id
        }
        
        # Teardown
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()


def test_admin_cascade_delete_book(test_user_and_notes):
    data = test_user_and_notes
    user_id = data["user_id"]
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM global_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY id", (user_id,))
        notes = cursor.fetchall()
        
        idx = -1
        for i, row in enumerate(notes):
            if row['id'] == data["root_id"]:
                idx = i
                break
                
    assert idx != -1
    
    from src.routers.admin import require_dev_mode
    app.dependency_overrides[require_dev_mode] = lambda: None
    
    response = client.request("DELETE", f"/api/admin/users/{user_id}/notes", json={
        "type": "global",
        "docOrGlobalIdx": idx
    })
    
    app.dependency_overrides.pop(require_dev_mode, None)
    
    assert response.status_code == 200
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT deleted_at FROM global_notes WHERE id = ?", (data["root_id"],))
        root_deleted = cursor.fetchone()['deleted_at']
        assert root_deleted is not None
        
        cursor.execute("SELECT title FROM global_notes WHERE id = ?", (data["ch1_id"],))
        ch1_title = cursor.fetchone()['title']
        assert ch1_title == "Chapter 1"
        
        cursor.execute("SELECT title FROM global_notes WHERE id = ?", (data["ch2_id"],))
        ch2_title = cursor.fetchone()['title']
        assert ch2_title == "Chapter 2"
