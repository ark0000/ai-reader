import os

with open('src/static/reader_enhanced.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Rename auto-explain-cb
content = content.replace('id="auto-explain-cb"', 'id="md-auto-explain-cb"')

# 2. Add robust-selection-cb after PDF Image Recognizer
robust_cb = '''              </div>
              <div class="settings-row">
                <div class="settings-label-container">
                  <span class="settings-label">Robust Selection</span>
                  <span class="settings-help">Enhances text selection in PDFs across columns and pages.</span>
                </div>
                <label class="toggle-switch" aria-label="Robust Selection">
                  <input type="checkbox" id="robust-selection-cb" checked role="switch"
                    onchange="window.toggleStateKey('aura-robust-selection', this.checked); window.safeStorage.setItem('aura-robust-selection', this.checked ? 'true' : 'false');">
                  <span class="toggle-slider"></span>
                </label>'''
content = content.replace('onchange="window.toggleStateKey(\'aura-pdf-img\', this.checked); window.safeStorage.setItem(\'aura-pdf-img\', this.checked ? \'true\' : \'false\');">\n                <span class="toggle-slider"></span>\n              </label>', 'onchange="window.toggleStateKey(\'aura-pdf-img\', this.checked); window.safeStorage.setItem(\'aura-pdf-img\', this.checked ? \'true\' : \'false\');">\n                <span class="toggle-slider"></span>\n              </label>' + robust_cb)

# 3. Add User Profile Group before Saved State
profile_group = '''          <label class="settings-header">&#128100; User Profile & Storage</label>
            <div class="settings-group">
              <div class="settings-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div class="settings-label-container" style="margin-bottom: 4px;">
                  <span class="settings-label">Profile Name</span>
                  <span class="settings-help">Used to separate your library documents from other users.</span>
                </div>
                <div style="display:flex; width:100%; gap:8px;">
                  <input type="text" id="username-input" class="tb-sel" placeholder="Enter username..." style="flex:1; padding:6px 10px; background:var(--bg-body);" onchange="window.safeStorage.setItem('username', this.value); window.currentUsername = this.value;">
                  <button id="logout-btn" class="tb-btn" style="display:none; color:#ef4444;" onclick="window.safeStorage.setItem('username', ''); document.getElementById('username-input').value=''; this.style.display='none';">Log out</button>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-label-container">
                  <span class="settings-label">Save Documents Manually</span>
                  <span class="settings-help">Adds a save button instead of auto-saving everything.</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="manual-save-cb" role="switch" onchange="window.safeStorage.setItem('aura-manual-save', this.checked ? 'true' : 'false');">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="settings-row">
                <div class="settings-label-container">
                  <span class="settings-label">Metadata-Only Cache</span>
                  <span class="settings-help">Saves space by not caching full PDFs in the browser.</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="meta-only-cache-cb" role="switch" onchange="window.safeStorage.setItem('aura-meta-only-cache', this.checked ? 'true' : 'false');">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>\n\n'''
content = content.replace('<label class="settings-header">&#128190; Saved State</label>', profile_group + '          <label class="settings-header">&#128190; Saved State</label>')

# 4. Add save-pdf-state-cb and save-notes-state-cb inside Saved State
saved_state_cbs = '''                <div class="settings-row">
                  <div class="settings-label-container">
                    <span class="settings-label">Reading Position</span>
                    <span class="settings-help">Remember where you left off.</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" id="save-pdf-state-cb" role="switch"
                      onchange="window.toggleStateKey('aura-pdf-reading-state', this.checked);">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="settings-row">
                  <div class="settings-label-container">
                    <span class="settings-label">Notes & Annotations</span>
                    <span class="settings-help">Remember your notes.</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" id="save-notes-state-cb" role="switch"
                      onchange="window.toggleStateKey('aura-notes-state', this.checked);">
                    <span class="toggle-slider"></span>
                  </label>
                </div>\n'''
content = content.replace('Choose which preferences are remembered after you close the tab. Everything else is session-only.\n                </div>\n                <div class="settings-row">', 'Choose which preferences are remembered after you close the tab. Everything else is session-only.\n                </div>\n' + saved_state_cbs + '                <div class="settings-row">')

# 5. Move Library Button to Top bar
content = content.replace('<button class="tb-btn" onclick="document.getElementById(\'file-upload\').click()">&#128193; Open</button>', '<button class="tb-btn" onclick="document.getElementById(\'file-upload\').click()">&#128193; Open</button>\n        <button class="tb-btn" title="Library" onclick="if(window.openLibraryModal) window.openLibraryModal()">&#128218; Library</button>')

# 6. Add Library Modal HTML
modal_html = '''
<!-- LIBRARY MODAL -->
<div id="library-modal"
  style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center; animation:fadeIn 0.2s ease-out both;">
  <div style="background:var(--bg-panel); border:1px solid var(--border); border-radius:12px; width:90%; max-width:600px; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 10px 30px rgba(0,0,0,0.5); overflow:hidden;">
    <div style="padding:16px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03);">
      <h2 style="margin:0; font-size:18px; font-weight:600; display:flex; align-items:center; gap:8px;">
        &#128218; Document Library - <span id="library-username-display" style="color:var(--accent);"></span>
      </h2>
      <button class="tb-btn" style="border:none; background:transparent; font-size:24px; color:var(--text-2); padding: 0 8px;" onclick="document.getElementById('library-modal').style.display='none'">&times;</button>
    </div>
    <div id="library-list" style="flex:1; overflow-y:auto; padding:16px;">
      <!-- Populated dynamically -->
    </div>
  </div>
</div>
'''
content = content.replace('</body>\n\n</html>', modal_html + '\n</body>\n\n</html>')

with open('src/static/reader_enhanced.html', 'w', encoding='utf-8') as f:
    f.write(content)
