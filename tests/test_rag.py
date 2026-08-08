import requests
import time
import os

BASE_URL = 'http://localhost:8080/api'

with open('dummy.txt', 'w') as f:
    f.write('This is a test document. ' * 1000)

print('Uploading document...')
with open('dummy.txt', 'rb') as f:
    resp = requests.post(f'{BASE_URL}/upload', files={'file': ('dummy.md', f, 'text/markdown')})
    
data = resp.json()
print('Upload response:', data)
task_id = data.get('task_id')

if not task_id:
    print('Failed to get task ID.')
    exit(1)

for i in range(10):
    try:
        resp = requests.post(f'{BASE_URL}/chat', json={
            'connection_id': 1,
            'messages': [{'role': 'user', 'content': 'what is this document?'}],
            'rag_enabled': True,
            'file_id': task_id
        })
        if resp.status_code == 409:
            print(f'Attempt {i}: GOT 409:', resp.json().get('detail'))
        elif resp.status_code == 404:
            print(f'Attempt {i}: GOT 404:', resp.json().get('detail'))
        elif resp.status_code == 200:
            print(f'Attempt {i}: GOT 200: Success!')
            break
        else:
            print(f'Attempt {i}: Other code:', resp.status_code, resp.text)
    except Exception as e:
        print(f'Attempt {i}: Error:', e)
    time.sleep(0.5)

