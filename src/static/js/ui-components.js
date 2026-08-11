window.togglePanel = function() {
  window.panel.classList.toggle('hidden');
  var fab = document.getElementById('fab');
  if (fab) {
    fab.style.display = window.panel.classList.contains('hidden') ? 'flex' : 'none';
  }
  if (window.logUI) window.logUI('ai-toggle');
};

window.switchTab = function(name){
  var ids=['chat','notes','tts'];
  document.querySelectorAll('.tab').forEach(function(b,i){
    b.classList.toggle('on',ids[i]===name);
    var pane = document.getElementById('tab-'+ids[i]);
    if(pane) pane.classList.toggle('on',ids[i]===name);
  });
};

window.hidePopup = function(){ window.popup.style.display='none'; };

window.popExplain = function(){hidePopup();askAI('Explain this concept:\n\n"'+selText+'"');};

window.popDict = function(){hidePopup();fetchDict(selText.trim().split(/\s+/)[0]);};

window.popSearch = function(){hidePopup();window.open('https://www.google.com/search?q='+encodeURIComponent(selText),'_blank');};

window.showActionPopup = function(e, label, actionFn) {
  var p = document.getElementById('action-popup');
  if(!p) {
    p = document.createElement('div');
    p.id = 'action-popup';
    p.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow);z-index:9999;display:none;padding:4px;';
    p.innerHTML = '<button class="pb" style="width:100%"></button>';
    document.body.appendChild(p);
  }
  var btn = p.firstChild;
  btn.innerHTML = label;
  btn.onclick = function(ev) {
    ev.stopPropagation();
    p.style.display = 'none';
    actionFn();
  };
  p.style.display = 'block';
  var pw = p.offsetWidth || 150;
  var ph = p.offsetHeight || 40;
  p.style.left = Math.min(e.clientX || 100, window.innerWidth - pw - 10) + 'px';
  p.style.top  = Math.min(e.clientY || 100, window.innerHeight - ph - 10) + 'px';
  setTimeout(function(){
    var hideFn = function(){ p.style.display='none'; document.removeEventListener('click', hideFn); };
    document.addEventListener('click', hideFn);
  }, 10);
};

window.toggleSettings = function(e) {
  if(e) e.stopPropagation();
  var s = document.getElementById('settings-popup');
  var b = document.getElementById('settings-backdrop');
  if(!s) return;
  
  var isHidden = s.style.display === 'none' || s.classList.contains('hidden');
  s.classList.remove('hidden');
  
  if (isHidden) {
    s.style.display = 'block';
    if(b) b.style.display = 'block';
    
    if (window.loadConnections) window.loadConnections();
    
    // Add escape key listener
    if (!window._settingsEscapeFn) {
      window._settingsEscapeFn = function(ev) {
        if (ev.key === 'Escape') {
          window.toggleSettings();
        }
      };
      document.addEventListener('keydown', window._settingsEscapeFn);
    }
    
    // Focus search input
    setTimeout(function() {
      var searchInput = document.getElementById('settings-search');
      if (searchInput) searchInput.focus();
    }, 50);
  } else {
    s.style.display = 'none';
    if(b) b.style.display = 'none';
    
    // Clean up escape listener
    if (window._settingsEscapeFn) {
      document.removeEventListener('keydown', window._settingsEscapeFn);
      window._settingsEscapeFn = null;
    }
  }
};

window.handleSettingsTitleClick = function() {
  window._devClickCount = (window._devClickCount || 0) + 1;
  clearTimeout(window._devClickTimer);
  
  if (window._devClickCount >= 7) {
    document.body.classList.toggle('dev-mode-active');
    window._devClickCount = 0;
    
    // Quick toast feedback
    var isActive = document.body.classList.contains('dev-mode-active');
    var toast = document.createElement('div');
    toast.textContent = isActive ? "Developer Options Unlocked!" : "Developer Options Hidden";
    toast.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:var(--accent); color:#fff; padding:8px 16px; border-radius:20px; z-index:9999; font-size:14px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.3); animation:popInDropdown 0.3s ease;";
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s';
      setTimeout(() => toast.remove(), 500);
    }, 2000);
    
    // Force re-run of filter to update visible rows
    var searchInput = document.getElementById('settings-search');
    if (searchInput && window.filterSettings) window.filterSettings(searchInput.value);
  } else {
    window._devClickTimer = setTimeout(function() {
      window._devClickCount = 0;
    }, 2000);
  }
};
window.closeToc = function() {
  var s = document.getElementById('toc-popup');
  if (s) { s.classList.remove('open'); s.classList.remove('active'); }
};

window.toggleFullScreen = function() {
  const doc = document.documentElement;
  const fullscreenElement = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;

  if (!fullscreenElement) {
    // Try native fullscreen first
    const fsPromise = doc.requestFullscreen ? doc.requestFullscreen() :
                      doc.webkitRequestFullscreen ? doc.webkitRequestFullscreen() :
                      doc.mozRequestFullScreen ? doc.mozRequestFullScreen() :
                      doc.msRequestFullscreen ? doc.msRequestFullscreen() :
                      Promise.reject(new Error('Fullscreen API not supported'));

    if (fsPromise && fsPromise.catch) {
      fsPromise.catch(function(err) {
        console.warn('[Fullscreen] Native fullscreen failed:', err.message);
        // Pseudo-fullscreen fallback: hide toolbars
        document.body.classList.toggle('pseudo-fullscreen');
      });
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  // Also toggle pseudo-fullscreen class for toolbar hiding
  if (!doc.requestFullscreen && !doc.webkitRequestFullscreen) {
    document.body.classList.toggle('pseudo-fullscreen');
  }
};


// =========================================================================
// LIBRARY MODAL LOGIC
// =========================================================================

window.openLibraryModal = async function() {
  const modal = document.getElementById('library-modal');
  if (!modal) return;
  
  const username = window.currentUsername || 'guest';
  const display = document.getElementById('library-username-display');
  if (display) display.textContent = username;
  
  const listContainer = document.getElementById('library-list');
  listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-2);">Loading library...</div>';
  modal.style.display = 'flex';
  
  if (window.storageRepository) {
    const files = await window.storageRepository.getLibraryMeta(username);
    if (files.length === 0) {
      if (username === 'guest' || !username) {
        listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-2); line-height: 1.5;">' +
          'Your library is currently empty.<br><br>' +
          '<strong>Tip:</strong> Open Settings ⚙️ and enter a User Profile name to save and restore your documents!' +
          '</div>';
      } else {
        listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-2);">No documents saved under profile "<strong>' + username + '</strong>".</div>';
      }
    } else {
      listContainer.innerHTML = '';
      files.forEach(f => {
        const item = document.createElement('div');
        item.style = 'display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-color); cursor:pointer; border-radius:4px;';
        item.className = 'library-item';
        
        item.onmouseover = () => item.style.background = 'var(--bg-elevated)';
        item.onmouseout = () => item.style.background = 'transparent';
        
        const dateStr = new Date(f.timestamp).toLocaleString();
        
        const nameEl = document.createElement('strong');
        nameEl.style = 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;';
        nameEl.textContent = f.fileName;

        const dateEl = document.createElement('span');
        dateEl.style = 'font-size:11px; color:var(--text-2);';
        dateEl.innerHTML = 'Saved: ' + dateStr + (f.noteCount > 0 ? ' &nbsp;&bull;&nbsp; <span style="color:var(--accent);">📝 ' + f.noteCount + ' notes</span>' : '');

        const infoDiv = document.createElement('div');
        infoDiv.style = 'display:flex; flex-direction:column; overflow:hidden; padding-right:12px; flex:1;';
        infoDiv.appendChild(nameEl);
        infoDiv.appendChild(dateEl);

        const actionDiv = document.createElement('div');
        actionDiv.style = 'display:flex; gap:8px;';

        const openBtn = document.createElement('button');
        openBtn.className = 'tb-btn';
        openBtn.style = 'padding:4px 12px; font-size:12px; white-space:nowrap;';
        openBtn.textContent = 'Open';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'tb-btn';
        deleteBtn.style = 'padding:4px 12px; font-size:12px; white-space:nowrap; background: rgba(220,53,69,0.1); color: var(--text-1);';
        deleteBtn.textContent = 'Delete';

        // --- Open button handler (dedicated, not on parent row) ---
        openBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();
          listContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--accent);">Opening document...</div>';
          const docData = await window.storageRepository.loadDocument(f.id);
          if (docData && docData.fileBlob) {
            if (f.scrollState) window.pendingScrollState = f.scrollState;
            const mockFile = new File([docData.fileBlob], docData.fileName, { type: docData.fileBlob.type });
            const fileInput = document.getElementById('file-upload');
            if (fileInput) {
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(mockFile);
              fileInput.files = dataTransfer.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
             alert('This document was too large to be fully cached by your browser, or its data was cleared. Please manually upload the file again to resume from your saved position.');
             window.openLibraryModal();
             return;
          }
          modal.style.display = 'none';
        });

        // --- Delete button handler (isolated, no bubbling to parent) ---
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
          if (confirm('Are you sure you want to delete this document from your library? This cannot be undone.')) {
            try {
              console.log('[Library] Deleting document:', f.id);
              await window.storageRepository.deleteDocument(f.id);
              console.log('[Library] Delete successful, refreshing...');
              // Also delete associated annotations
              try {
                const annStore = await window.dbManager.getTransaction('annotations', 'readwrite');
                annStore.delete(f.id);
              } catch(annErr) { /* annotations may not exist, that's fine */ }
              window.openLibraryModal();
            } catch (err) {
              console.error('[Library] Delete failed:', err);
              alert('Failed to delete document. See console for details.');
            }
          }
        });

        actionDiv.appendChild(openBtn);
        actionDiv.appendChild(deleteBtn);

        item.appendChild(infoDiv);
        item.appendChild(actionDiv);
        listContainer.appendChild(item);
      });
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  const userInput = document.getElementById('username-input');
  if (userInput) {
    const savedUser = window.safeStorage.getItem('username') || '';
    userInput.value = savedUser;

    // Advanced Library Settings
    if (document.getElementById('manual-save-cb')) {
      const isManualSave = window.safeStorage.getItem('aura-manual-save') !== 'false';
      document.getElementById('manual-save-cb').checked = isManualSave;
      if (isManualSave && document.getElementById('manual-save-btn')) {
        document.getElementById('manual-save-btn').style.display = 'inline-block';
      }
    }
    if (document.getElementById('meta-only-cache-cb')) {
      document.getElementById('meta-only-cache-cb').checked = window.safeStorage.getItem('aura-meta-only-cache') === 'true';
    }
    if (document.getElementById('md-auto-explain-cb')) {
      document.getElementById('md-auto-explain-cb').checked = window.safeStorage.getItem('aura-md-auto-explain') !== 'false';
    }
    if (document.getElementById('robust-selection-cb')) {
      document.getElementById('robust-selection-cb').checked = window.safeStorage.getItem('aura-robust-selection') !== 'false';
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && savedUser && savedUser !== 'guest') {
      logoutBtn.style.display = 'inline';
    }
  }
});

window.triggerManualSave = function(btnElement) {
  if (!window.currentFileName || !window.storageRepository) return;
  var uname = window.currentUsername || window.safeStorage.getItem('username') || 'guest';
  var state = window.getPdfScrollState ? window.getPdfScrollState() : null;
  if (state) {
    window.storageRepository.saveScrollState(uname + '_' + window.currentFileName, state);
    
    // Visual feedback
    if (btnElement) {
      const originalText = btnElement.innerHTML;
      btnElement.innerHTML = '&#9989; Saved!';
      setTimeout(() => {
        btnElement.innerHTML = originalText;
      }, 1500);
    }
  }
};
