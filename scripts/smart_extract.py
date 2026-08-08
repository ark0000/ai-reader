import os

with open("src/static/js/reader-core.js", "r", encoding="utf-8") as f:
    core_content = f.read()

def extract_block(text, start_pattern):
    idx = text.find(start_pattern)
    if idx == -1: return ""
    
    # find the first '{' after start_pattern
    start_brace = text.find('{', idx)
    if start_brace == -1: return ""
    
    brace_count = 1
    for i in range(start_brace + 1, len(text)):
        if text[i] == '{': brace_count += 1
        elif text[i] == '}': brace_count -= 1
        
        if brace_count == 0:
            return text[idx:i+1]
            
    return ""

# ai-chat.js
ai_funcs = [
    "window.loadConnections = async function()",
    "window.loadProviders = async function()",
    "window.openConnectionManager = function()",
    "window.connMgrProviderChanged = function()",
    "window.connMgrShowAdd = function()",
    "window.connMgrEdit = function(c)",
    "window.connMgrSave = async function()",
    "window.connMgrTest = async function()",
    "window.connMgrDelete = async function()",
    "window.askAI = async function(prompt)",
    "window.addMsg = function(txt,type)",
    "window.fmt = function(t)",
    "window.authHeaders = function()"
]
ai_out = ""
for f in ai_funcs:
    res = extract_block(core_content, f)
    if res: ai_out += res + ";\n\n"

with open("src/static/js/ai-chat.js", "w", encoding="utf-8") as f:
    f.write(ai_out)

# dictionary-tools.js
dict_funcs = [
    "var OFFLINE={'zenml'",
    "window.extractSurroundingContext = function",
    "window.fetchDict = async function"
]
dict_out = ""
for f in dict_funcs:
    if f.startswith("var OFFLINE"):
        idx = core_content.find("var OFFLINE={'zenml'")
        end = core_content.find("};", idx)
        if idx != -1 and end != -1:
            dict_out += core_content[idx:end+2] + "\n\n"
        
        func_res = extract_block(core_content, "function formatFullDefinition(data)")
        if func_res: dict_out += func_res + "\n\n"
    else:
        res = extract_block(core_content, f)
        if res: dict_out += res + ";\n\n"

with open("src/static/js/dictionary-tools.js", "w", encoding="utf-8") as f:
    f.write(dict_out)
    
# ui-components.js
ui_funcs = [
    "window.togglePanel = function()",
    "window.switchTab = function(name)",
    "window.hidePopup = function()",
    "window.popExplain = function()",
    "window.popDict = function()",
    "window.popSearch = function()",
    "window.showActionPopup = function",
    "window.toggleSettings = function",
    "window.handleSettingsTitleClick = function()",
    "window.closeToc = function()",
    "window.toggleFullScreen = function()"
]
ui_out = ""
for f in ui_funcs:
    res = extract_block(core_content, f)
    if res: ui_out += res + ";\n\n"
    
with open("src/static/js/ui-components.js", "w", encoding="utf-8") as f:
    f.write(ui_out)

print("Extraction successful.")
