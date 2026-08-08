import requests

BASE_URL = 'http://localhost:8080/api'
resp = requests.post(f'{BASE_URL}/chat', json={
    'connection_id': 1,
    'messages': [{'role': 'user', 'content': 'what is this document?'}],
    'rag_enabled': True,
    'file_id': 'missing_file_123'
})
print('Response code:', resp.status_code)
print('Response body:', resp.text)
