import os
import json
import pytest
from src.routers.admin import AdminTracker
from src.storage import LOCAL_TEMP_DIR

def test_admin_tracker_persistence():
    tracker = AdminTracker()
    
    # Inject some fake data
    tracker.record_activity(
        username="test_user",
        user_id=99,
        current_file="persisted_test.pdf",
        file_ext="pdf",
        note_count=42,
        library_count=5,
        page=10,
        ip="127.0.0.1"
    )
    
    # Save state
    tracker.save_state()
    
    # Verify the JSON file exists
    assert os.path.exists(tracker._state_file)
    with open(tracker._state_file, "r") as f:
        data = json.load(f)
    assert "sessions" in data
    assert "test_user" in data["sessions"]
    assert data["sessions"]["test_user"]["library_count"] == 5
    assert data["sessions"]["test_user"]["note_count"] == 42
    
    # Create a new tracker and load state
    new_tracker = AdminTracker()
    assert len(new_tracker._sessions) == 0
    
    new_tracker.load_state()
    
    assert len(new_tracker._sessions) == 1
    session = new_tracker._sessions.get("test_user")
    assert session is not None
    assert session["current_file"] == "persisted_test.pdf"
    assert session["library_count"] == 5
    assert session["note_count"] == 42
    
    # Clean up
    try:
        os.remove(tracker._state_file)
    except OSError:
        pass
