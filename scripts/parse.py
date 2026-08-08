import re

with open('src/static/reader_enhanced.html', 'r', encoding='utf-8') as f:
    html = f.read()

start_marker = '<div class="cfg" style="border:none;padding:0">'
end_marker = '<button class="developer-option" onclick="if(window.exportUITrace)'

start_idx = html.find(start_marker)
end_idx = html.find(end_marker)

content = html[start_idx + len(start_marker):end_idx]
matches = list(re.finditer(r'<label class="settings-header[^>]*>', content))

blocks = []
for i in range(len(matches)):
    start = matches[i].start()
    end = matches[i+1].start() if i < len(matches)-1 else len(content)
    blocks.append(content[start:end])

# Reorder
# Required: Reading(3), Font(4), AI(1), Dict(2), Saved(0), Perf(5)
new_content = "\n"
for idx in [3, 4, 1, 2, 0, 5]:
    new_content += blocks[idx].strip() + "\n\n          "

new_html = html[:start_idx + len(start_marker)] + new_content + html[end_idx:]

with open('src/static/reader_enhanced.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Settings successfully reordered.")
