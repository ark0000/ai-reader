"""
Integration tests for Bug H (Round 3): GlobalNotesRepository ownership-safe upsert.

Verifies that:
1. A user can create and update their own notes.
2. A user CANNOT overwrite another user's note by sending that note's ID.
3. Soft-delete and restore work correctly with ownership.
"""

import os
import time
import pytest

os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project-id"

from src.database import init_db, GlobalNotesRepository, get_db_connection, hash_password, create_jwt


# ── Test Fixtures ──

@pytest.fixture(autouse=True)
def setup_db():
    """Initialize DB and create two test users."""
    init_db()
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users (id, username, hashed_password) VALUES (?, ?, ?)",
                  (901, "attacker", hash_password("pw")))
    except Exception:
        pass
    try:
        c.execute("INSERT INTO users (id, username, hashed_password) VALUES (?, ?, ?)",
                  (902, "victim", hash_password("pw")))
    except Exception:
        pass
    conn.commit()
    conn.close()
    yield
    # Cleanup test notes
    conn = get_db_connection()
    conn.execute("DELETE FROM global_notes WHERE user_id IN (901, 902)")
    conn.commit()
    conn.close()


# ── Unit Tests: GlobalNotesRepository.save() ──

class TestBugH_OwnershipGuard:
    """Bug H: ON CONFLICT(id) had no user_id guard, allowing cross-user overwrites."""

    def test_user_can_create_own_note(self):
        """Normal path: user 902 creates a note with a unique ID."""
        note_id = int(time.time() * 1000)
        result = GlobalNotesRepository.save(
            user_id=902, note_id=note_id,
            title="Victim's Private Note",
            content="<p>Secret content</p>",
            raw_text="Secret content",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )
        assert result is True

        note = GlobalNotesRepository.get(902, note_id)
        assert note is not None
        assert note["title"] == "Victim's Private Note"

    def test_user_can_update_own_note(self):
        """Normal path: user 902 updates their own note."""
        note_id = int(time.time() * 1000) + 1
        GlobalNotesRepository.save(
            user_id=902, note_id=note_id,
            title="Original Title",
            content="<p>Original</p>",
            raw_text="Original",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )

        # Update
        GlobalNotesRepository.save(
            user_id=902, note_id=note_id,
            title="Updated Title",
            content="<p>Updated</p>",
            raw_text="Updated",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )

        note = GlobalNotesRepository.get(902, note_id)
        assert note["title"] == "Updated Title"

    def test_attacker_cannot_overwrite_victim_note(self):
        """SECURITY: user 901 (attacker) must NOT be able to overwrite user 902's note."""
        note_id = int(time.time() * 1000) + 2

        # Victim creates a note
        GlobalNotesRepository.save(
            user_id=902, note_id=note_id,
            title="Victim's Secret",
            content="<p>Private data</p>",
            raw_text="Private data",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )

        # Attacker tries to overwrite the same note ID
        GlobalNotesRepository.save(
            user_id=901, note_id=note_id,
            title="HACKED",
            content="<p>Malicious content</p>",
            raw_text="Malicious content",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )

        # Victim's note must be unchanged
        victim_note = GlobalNotesRepository.get(902, note_id)
        assert victim_note is not None
        assert victim_note["title"] == "Victim's Secret"
        assert "Private data" in victim_note["content"]

        # Attacker should have their own separate copy (the INSERT path created a new row)
        # This may fail since the ID is the PK — let's check both
        attacker_note = GlobalNotesRepository.get(901, note_id)
        # Either the attacker got their own copy, or the save was silently ignored.
        # The key assertion is that the victim's note is intact.
        if attacker_note:
            # The new ownership-safe upsert creates a separate row for the attacker.
            # This verifies the INSERT path worked without touching victim's row.
            assert attacker_note["title"] == "HACKED"
        # But the CRITICAL test is: victim is untouched.

    def test_soft_delete_respects_ownership(self):
        """Verify soft-delete only deletes notes owned by the requesting user."""
        note_id = int(time.time() * 1000) + 3
        GlobalNotesRepository.save(
            user_id=902, note_id=note_id,
            title="Should Survive",
            content="<p>Data</p>",
            raw_text="Data",
            created_at=time.time() * 1000,
            updated_at=time.time() * 1000
        )

        # Attacker tries to delete it
        result = GlobalNotesRepository.delete(901, note_id)
        assert result is False  # No rows affected (wrong user_id)

        # Victim's note must still exist
        note = GlobalNotesRepository.get(902, note_id)
        assert note is not None
        assert note["title"] == "Should Survive"


class TestBugH_Integration_API:
    """Integration test: end-to-end API test for ownership guard via FastAPI TestClient."""

    def test_api_cross_user_note_protection(self):
        """Full HTTP path: POST /api/notes/global with another user's note ID."""
        from fastapi.testclient import TestClient
        from src.main import app

        client = TestClient(app)

        victim_token = create_jwt({"user_id": 902})
        attacker_token = create_jwt({"user_id": 901})

        note_id = int(time.time() * 1000) + 4

        # Victim creates a note
        resp = client.post("/api/notes/global", json={
            "id": note_id,
            "title": "Victim Note via API",
            "content": "<p>Secret API content</p>",
            "rawText": "Secret API content",
            "createdAt": time.time() * 1000,
            "updatedAt": time.time() * 1000,
        }, headers={"Authorization": f"Bearer {victim_token}"})
        assert resp.status_code == 200

        # Attacker tries to overwrite it
        resp = client.post("/api/notes/global", json={
            "id": note_id,
            "title": "HACKED via API",
            "content": "<p>Evil</p>",
            "rawText": "Evil",
            "createdAt": time.time() * 1000,
            "updatedAt": time.time() * 1000,
        }, headers={"Authorization": f"Bearer {attacker_token}"})

        # Verify victim's note is untouched
        resp = client.get(f"/api/notes/global/{note_id}",
                          headers={"Authorization": f"Bearer {victim_token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Victim Note via API"
        assert "Secret API content" in data["content"]
