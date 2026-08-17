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

window.showActionPopup = function(e, labelOrActions, actionFn) {
  var p = document.getElementById('action-popup');
  if(!p) {
    p = document.createElement('div');
    p.id = 'action-popup';
    p.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow);z-index:9999;display:none;padding:4px;';
    document.body.appendChild(p);
  }
  
  var actions = Array.isArray(labelOrActions) ? labelOrActions : [{label: labelOrActions, actionFn: actionFn}];
  
  p.innerHTML = '';
  actions.forEach(function(act) {
    var btn = document.createElement('button');
    btn.className = 'pb';
    btn.style.width = '100%';
    btn.style.marginBottom = '2px';
    btn.innerHTML = act.label;
    btn.onclick = function(ev) {
      ev.stopPropagation();
      p.style.display = 'none';
      if (act.actionFn) act.actionFn();
    };
    p.appendChild(btn);
  });
  
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

window.showEnlargedMedia = function(node) {
  var modal = document.getElementById('enlarge-modal');
  var content = document.getElementById('enlarge-content');
  if (!modal || !content) return;
  
  content.innerHTML = '';
  // Ensure the node fits but maintains aspect ratio
  if (node.tagName.toLowerCase() === 'img' || node.tagName.toLowerCase() === 'svg') {
      node.style.maxWidth = '100%';
      node.style.maxHeight = '100%';
      node.style.objectFit = 'contain';
      node.style.height = 'auto';
  } else {
      node.style.width = '100%';
  }
  
  // Ensure transparent diagrams are legible on dark mode themes
  node.style.backgroundColor = '#ffffff';
  node.style.padding = '20px';
  node.style.borderRadius = '8px';
  // Use a subtle shadow instead of hard borders
  node.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  
  content.appendChild(node);
  modal.style.display = 'flex';
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
    
    // Sync username and logout button
    var unameInput = document.getElementById('username-input');
    var logoutBtn = document.getElementById('logout-btn');
    if (unameInput) {
        var currentUname = window.safeStorage.getItem('username') || '';
        unameInput.value = currentUname;
        if (logoutBtn) logoutBtn.style.display = currentUname.trim() ? 'inline-block' : 'none';
    }
    
    // Filter settings by file extension
    document.querySelectorAll('.settings-row').forEach(row => {
        var ext = row.getAttribute('data-ext');
        if (ext && window.currentExt) {
            row.style.display = ext.includes(window.currentExt) ? 'flex' : 'none';
        } else {
            row.style.display = 'flex';
        }
    });

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
    const fsPromise = doc.requestFullscreen ? doc.requestFullscreen() :
                      doc.webkitRequestFullscreen ? doc.webkitRequestFullscreen() :
                      doc.mozRequestFullScreen ? doc.mozRequestFullScreen() :
                      doc.msRequestFullscreen ? doc.msRequestFullscreen() :
                      Promise.reject(new Error('Fullscreen API not supported'));

    if (fsPromise && fsPromise.catch) {
      fsPromise.catch(function(err) {
        console.warn('[Fullscreen] Native fullscreen failed:', err.message);
        alert("Failed to enter fullscreen: " + err.message + "\nYour browser might be blocking it.");
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
};

// Fullscreen WITH toolbar visible (⤡ button)
// Uses browser fullscreen API but does NOT hide the top toolbar.
window.toggleOSFullScreen = function() {
  const doc = document.documentElement;
  const fullscreenElement = document.fullscreenElement || document.mozFullScreenElement ||
    document.webkitFullscreenElement || document.msFullscreenElement;

  if (!fullscreenElement) {
    // Mark that THIS fullscreen was triggered by the toolbar-mode button
    window._fullscreenWithToolbar = true;
    const fsPromise = doc.requestFullscreen ? doc.requestFullscreen() :
                      doc.webkitRequestFullscreen ? doc.webkitRequestFullscreen() :
                      doc.mozRequestFullScreen ? doc.mozRequestFullScreen() :
                      doc.msRequestFullscreen ? doc.msRequestFullscreen() :
                      Promise.reject(new Error('Fullscreen API not supported'));
    if (fsPromise && fsPromise.catch) {
      fsPromise.catch(function(err) {
        window._fullscreenWithToolbar = false;
        console.warn('[Fullscreen] Toolbar-fullscreen failed:', err.message);
      });
    }
  } else {
    window._fullscreenWithToolbar = false;
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
  }
};

function _handleFullscreenChange() {
  var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  var toolbarMode = window._fullscreenWithToolbar && isFs;

  // Regular fullscreen button state
  var btn = document.getElementById('fullscreen-btn');
  if (btn) btn.classList.toggle('active', isFs && !toolbarMode);

  // Toolbar-mode fullscreen button state
  var osBtn = document.getElementById('os-fullscreen-btn');
  if (osBtn) osBtn.classList.toggle('active', toolbarMode);

  // is-fullscreen class hides toolbar — only apply for regular fullscreen
  document.body.classList.toggle('is-fullscreen', isFs && !toolbarMode);
  // fullscreen-toolbar-mode keeps toolbar visible in fullscreen
  document.body.classList.toggle('fullscreen-toolbar-mode', toolbarMode);

  // Reset the flag when exiting
  if (!isFs) window._fullscreenWithToolbar = false;
}

document.addEventListener('fullscreenchange', _handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', _handleFullscreenChange);
document.addEventListener('mozfullscreenchange', _handleFullscreenChange);
document.addEventListener('MSFullscreenChange', function() {
  var isFs = !!document.msFullscreenElement;
  var btn = document.getElementById('fullscreen-btn');
  if (btn) btn.classList.toggle('active', isFs);
  document.body.classList.toggle('is-fullscreen', isFs);
});

window.toggleZenMode = function() {
  document.body.classList.toggle('pseudo-fullscreen');
  var btn = document.getElementById('zen-mode-btn');
  if (btn) btn.classList.toggle('active', document.body.classList.contains('pseudo-fullscreen'));
};

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.body.classList.contains('pseudo-fullscreen')) {
    window.toggleZenMode();
  }
});


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


// =========================================================================
// GENERIC SEARCH DISPATCHER
// =========================================================================
// Routes search operations to the active document handler's search methods.
// PDF retains its existing AuraSearch system; Markdown and EPUB get new
// handler-level search implementations.

window.dispatchSearch = function() {
  var q = document.getElementById('doc-query-box').value.trim();
  if (!q) return;
  var handler = window.getActiveHandler ? window.getActiveHandler() : null;
  if (handler && handler.performSearch) {
    var opts = {
      caseSensitive: document.getElementById('search-filter-case').classList.contains('active'),
      wholeWord: document.getElementById('search-filter-word').classList.contains('active')
    };
    handler.performSearch(q, opts);
  } else if (window.currentExt === 'pdf' && window.AuraSearch) {
    // Fallback to existing PDF search
    window.AuraSearch.isCaseSensitive = document.getElementById('search-filter-case').classList.contains('active');
    window.AuraSearch.isWholeWord = document.getElementById('search-filter-word').classList.contains('active');
    window.AuraSearch.triggerSearch();
  }
};

window.dispatchClearSearch = function() {
  var handler = window.getActiveHandler ? window.getActiveHandler() : null;
  if (handler && handler.clearSearch) {
    handler.clearSearch();
  }
  // Also clear the PDF textLayer highlights if applicable
  if (window.currentExt === 'pdf') {
    window._activeSearchHighlight = null;
    document.querySelectorAll('.textLayer').forEach(function(tl) {
      if (window.doCustomHighlight) window.doCustomHighlight(tl, null);
    });
  }
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-count').textContent = '0 matches';
};

// Override openCustomSearch to be generic
(function() {
  var _origOpen = window.openCustomSearch;
  window.openCustomSearch = function() {
    var dropdown = document.getElementById('yt-search-dropdown');
    if (dropdown) dropdown.classList.remove('hidden');
    document.getElementById('doc-query-box').focus();
    // PDF-specific init
    if (window.currentExt === 'pdf' && window.AuraSearch && window.AuraSearch.tocMap.length === 0) {
      window.AuraSearch.init();
    }
  };
})();

// Override closeCustomSearch to be generic
(function() {
  window.closeCustomSearch = function() {
    var dropdown = document.getElementById('yt-search-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    window.dispatchClearSearch();
  };
  
  // Close search when clicking outside
  document.addEventListener('click', function(e) {
    var searchContainer = document.getElementById('yt-search-container');
    if (searchContainer && !searchContainer.contains(e.target)) {
      var dropdown = document.getElementById('yt-search-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        if (window.closeCustomSearch) window.closeCustomSearch();
      }
    }
  });
})();

// Generic debounced input handler
(function() {
  var _debounce = null;
  var box = document.getElementById('doc-query-box');
  if (box) {
    // Remove old PDF-specific listener by cloning the element
    var newBox = box.cloneNode(true);
    box.parentNode.replaceChild(newBox, box);
    
    newBox.addEventListener('input', function(e) {
      var val = e.target.value.trim();
      var clearBtn = document.getElementById('search-clear');
      if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
      if (_debounce) clearTimeout(_debounce);
      _debounce = setTimeout(function() {
        if (val) {
          window.dispatchSearch();
        } else {
          window.dispatchClearSearch();
        }
      }, 300);
    });
    
    newBox.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        window.dispatchSearch();
      } else if (e.key === 'Escape') {
        if (window.closeCustomSearch) window.closeCustomSearch();
      }
    });
  }
  
  window.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      if (window.openCustomSearch) window.openCustomSearch();
    }
    if (e.key === 'Escape') {
      if (window.closeCustomSearch) window.closeCustomSearch();
    }
  });
  
  // Generic search clear button
  var clearBtn = document.getElementById('search-clear');
  if (clearBtn) {
    var newClear = clearBtn.cloneNode(true);
    clearBtn.parentNode.replaceChild(newClear, clearBtn);
    newClear.addEventListener('click', function() {
      var box = document.getElementById('doc-query-box');
      if (box) {
        box.value = '';
        box.focus();
        this.style.display = 'none';
        window.dispatchClearSearch();
      }
    });
  }
  
  // Generic prev/next navigation
  var prevBtn = document.getElementById('search-prev');
  var nextBtn = document.getElementById('search-next');
  if (prevBtn) {
    var newPrev = prevBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrev, prevBtn);
    newPrev.addEventListener('click', function() {
      var handler = window.getActiveHandler ? window.getActiveHandler() : null;
      if (handler && handler.navigateSearch) {
        handler.navigateSearch(-1);
      } else if (window.navigateSearchResult) {
        window.navigateSearchResult(-1);
      }
    });
  }
  if (nextBtn) {
    var newNext = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newNext, nextBtn);
    newNext.addEventListener('click', function() {
      var handler = window.getActiveHandler ? window.getActiveHandler() : null;
      if (handler && handler.navigateSearch) {
        handler.navigateSearch(1);
      } else if (window.navigateSearchResult) {
        window.navigateSearchResult(1);
      }
    });
  }
})();

// =========================================================================
// CODE BLOCK TOOLBARS (Markdown/EPUB)
// =========================================================================
window.injectCodeToolbars = function(containerElement) {
  if (!containerElement) return;
  var pres = containerElement.querySelectorAll('pre');
  pres.forEach(function(pre) {
    // Avoid double injecting
    if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;
    
    var wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    
    var toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    
    var copyBtn = document.createElement('button');
    copyBtn.innerHTML = '&#128203; Copy Code';
    copyBtn.onclick = function() {
      navigator.clipboard.writeText(pre.innerText).then(() => {
        var original = copyBtn.innerHTML;
        copyBtn.innerHTML = '&#10004; Copied!';
        setTimeout(() => copyBtn.innerHTML = original, 2000);
      });
    };
    
    var aiBtn = document.createElement('button');
    aiBtn.innerHTML = '&#10024; Explain with AI';
    aiBtn.onclick = function() {
      var codeText = pre.innerText;
      if (window.switchTab && window.togglePanel) {
        if (window.panel.classList.contains('hidden')) window.togglePanel();
        window.switchTab('chat');
        var input = document.getElementById('chat-input');
        if (input) {
          input.value = "Explain the following code:\n```\n" + codeText + "\n```\n";
          input.focus();
        }
      }
    };
    
    var noteBtn = document.createElement('button');
    noteBtn.innerHTML = '&#128221; Add to Notes';
    noteBtn.onclick = function() {
      var codeText = pre.innerText;
      if (window.notes) {
        window.notes.push({ q: '<pre style="font-size:0.85em;padding:4px;">' + pre.innerHTML + '</pre>', txt: '', id: Date.now() });
        if (window.renderNotes) window.renderNotes();
        if (window.panel && window.panel.classList.contains('hidden')) window.togglePanel();
        if (window.switchTab) window.switchTab('notes');
        
        var original = noteBtn.innerHTML;
        noteBtn.innerHTML = '&#10004; Added!';
        setTimeout(() => noteBtn.innerHTML = original, 2000);
      }
    };
    
    toolbar.appendChild(copyBtn);
    toolbar.appendChild(aiBtn);
    toolbar.appendChild(noteBtn);
    wrapper.appendChild(toolbar);
  });
};
