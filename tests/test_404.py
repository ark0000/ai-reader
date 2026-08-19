from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_missing_file_chat_returns_404_or_error():
    resp = client.post("/api/chat", json={
        "connection_id": 1,
        "messages": [{"role": "user", "content": "what is this document?"}],
        "rag_enabled": True,
        "file_id": "missing_file_123"
    })
    assert resp.status_code in [400, 404]

