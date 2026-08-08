import os
with open(os.path.join(os.path.dirname(__file__), "../src/static/js/ai-chat.js"), "r", encoding="utf-8") as f:
    text = f.read()

count = 0
for i, char in enumerate(text):
    if char == '{':
        count += 1
    elif char == '}':
        count -= 1
print(f"Brace balance: {count}")
