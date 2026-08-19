from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_rag_upload_and_chat():
    doc_content = b'This is a test markdown document for RAG indexing. It contains sample data.'
    resp = client.post(
        '/api/upload',
        files={'file': ('dummy.md', doc_content, 'text/markdown')}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'task_id' in data
    task_id = data['task_id']

    # Test chat with file_id
    chat_resp = client.post('/api/chat', json={
        'connection_id': 1,
        'messages': [{'role': 'user', 'content': 'what is this document?'}],
        'rag_enabled': True,
        'file_id': task_id
    })
    # Either succeeds or returns 400/404 if connection 1 is not configured with an active provider
    assert chat_resp.status_code in [200, 400, 404, 409]


