// ==========================================
// CORE ORCHESTRATOR & DOCUMENT HANDLER REGISTRY
// ==========================================

window.sanitizeHTML = function(html) {
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(html, { 
      ALLOWED_TAGS: ['strong', 'em', 'code', 'pre', 'br', 'a', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
      ALLOWED_ATTR: ['href', 'style', 'class', 'target']
    });
  }
  var div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
};

window.escapeHTML = function(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// --- OCP: Document Handler Registry ---
window.DocumentHandlers = {};

window.registerDocumentHandler = function(ext, handler) {
  window.DocumentHandlers[ext] = handler;
  console.log(`[Registry] Registered handler for .${ext}`);
};

window.getActiveHandler = function() {
  return window.DocumentHandlers[window.currentExt] || null;
};

// --- GLOBALS ---
window.currentFileId = new URLSearchParams(window.location.search).get('task_id');
window.currentExt = 'txt'; // Updated by specific handlers
window.docText = '';
window.selText = '';
window.selRange = null;
window.notes = [];
window.uiTrace = [];

window.StateRegistry = {
  'aura-reading-theme':          { label: 'Reading Theme',         category: 'reading', saveable: true },
  'aura-reading-theme-custom':   { label: 'Custom Theme Colors',   category: 'reading', saveable: true },
  'AuraFontQuality':             { label: 'Font & Rendering',      category: 'font',    saveable: true },
  'aura-pdf-virt':               { label: 'Memory Saver',          category: 'perf',    saveable: true },
  'aura-pdf-lazy':               { label: 'Lazy Loading',          category: 'perf',    saveable: true },
  'aura-pdf-deep-search':        { label: 'Deep Search',           category: 'perf',    saveable: true },
  'aura-perf-dashboard':         { label: 'Performance Dashboard', category: 'perf',    saveable: true },
  'aura-capture-screenshots':    { label: 'UI Screenshot Capture', category: 'dev',     saveable: true },
  'aura-pdf-virt-pre-deep-search': { label: 'Virtualization Pre-Search', category: 'perf', saveable: true },
  'aura-pdf-lazy-pre-deep-search': { label: 'Lazy Pre-Search', category: 'perf', saveable: true }
};

window.safeStorage = {
  _mem: {},
  _criticalKeys: new Set(['token', 'username', 'auraVersion', 'aura-state-save-prefs']),
  
  _isAllowed(key) {
    if (this._criticalKeys.has(key)) return true;
    if (!window.StateRegistry[key]) return true; // unknown keys are considered critical
    const prefsRaw = localStorage.getItem('aura-state-save-prefs');
    const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};
    return prefs[key] === true;
  },
  
  getItem(key) {
    if (this._isAllowed(key)) {
      try { return localStorage.getItem(key); } catch(e) {}
    }
    return this._mem[key] !== undefined ? this._mem[key] : null;
  },
  
  setItem(key, val) {
    this._mem[key] = String(val);
    if (this._isAllowed(key)) {
      try { localStorage.setItem(key, val); } catch(e) {}
    }
  },
  
  removeItem(key) {
    delete this._mem[key];
    try { localStorage.removeItem(key); } catch(e) {}
  }
};

window.toggleStateKey = function(key, save) {
  const prefsRaw = localStorage.getItem('aura-state-save-prefs');
  const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};
  if (save) {
    prefs[key] = true;
    const val = window.safeStorage._mem[key];
    if (val !== undefined) {
      try { localStorage.setItem(key, val); } catch(e) {}
    }
  } else {
    delete prefs[key];
    try { localStorage.removeItem(key); } catch(e) {}
  }
  localStorage.setItem('aura-state-save-prefs', JSON.stringify(prefs));
};

// --- LIFECYCLE ---
document.addEventListener("DOMContentLoaded", function() {
  // Initialize save state checkboxes
  const prefsRaw = localStorage.getItem('aura-state-save-prefs');
  const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};
  const saveReadingCb = document.getElementById('save-reading-theme-cb');
  if (saveReadingCb) saveReadingCb.checked = (prefs['aura-reading-theme'] === true);
  
  const saveFontCb = document.getElementById('save-font-quality-cb');
  if (saveFontCb) saveFontCb.checked = (prefs['AuraFontQuality'] === true);
  
  const savePerfCb = document.getElementById('save-perf-cb');
  if (savePerfCb) savePerfCb.checked = (prefs['aura-pdf-virt'] === true);

  window.root = document.documentElement;
  window.contentEl = document.getElementById('content');
  window.docTitleEl = document.getElementById('doc-title');
  window.popup = document.getElementById('popup');
  window.panel = document.getElementById('ai-panel');
  window.chatWin = document.getElementById('chat-win');
  window.chatInput = document.getElementById('chat-input');
  window.pendingQEl = document.getElementById('pending-q');
  window.notesList = document.getElementById('notes-list');

  var provSel = document.getElementById('prov-sel');
  if(provSel) {
    provSel.onchange=function(e){
      var v=e.target.value;
      document.getElementById('ep-row').style.display=v==='openai'?'flex':'none';
      document.getElementById('key-row').style.display=v!=='backend'?'flex':'none';
    };
  }

  if(window.chatInput) {
    window.chatInput.addEventListener('keydown',function(e){
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); if(window.askAI) window.askAI(window.chatInput.value);}
    });
  }

  // Popup logic
  document.addEventListener('mouseup',function(e){
    if(window.popup && window.popup.contains(e.target)) return;
    var sel = window.getSelection();
    var txt = sel ? sel.toString().trim() : '';
    if (txt && txt.length > 0 && e.target.id !== 'chat-input') {
      window.selText = txt;
      try { window.selRange = sel.getRangeAt(0).cloneRange(); } catch(ex){}
      
      if (window.popup) {
          window.popup.style.display = 'flex';
          var pw = window.popup.offsetWidth || 210;
          var ph = window.popup.offsetHeight || 40;
          window.popup.style.left = Math.min(e.clientX, window.innerWidth - pw - 10) + 'px';
          window.popup.style.top  = Math.min(e.clientY + 12, window.innerHeight - ph - 10) + 'px';
      }
    } else {
      setTimeout(function() { if (window.hidePopup) window.hidePopup(); }, 110);
      if (!e.target.closest('button') && !e.target.closest('.panel') && !e.target.closest('#top-bar') && !e.target.closest('#secondary-toolbar')) {
        window.selText = '';
      }
    }
  });
  
  document.addEventListener('keydown', function(e) {
      if(e.key === 'Escape' && window.hidePopup) window.hidePopup();
  });
  
  // Screenshots setup
  var captureCb = document.getElementById('capture-screenshots-cb');
  if (captureCb) {
    captureCb.checked = (window.safeStorage.getItem('aura-capture-screenshots') === 'true');
    captureCb.addEventListener('change', function() {
      window.safeStorage.setItem('aura-capture-screenshots', captureCb.checked);
    });
  }
    
  // Performance Settings initialization
  var perfVirtCb = document.getElementById('perf-virt-cb');
  if (perfVirtCb && window.safeStorage.getItem('aura-pdf-virt') !== null) {
      perfVirtCb.checked = (window.safeStorage.getItem('aura-pdf-virt') === 'true');
  }
  
  var perfLazyCb = document.getElementById('perf-lazy-cb');
  if (perfLazyCb && window.safeStorage.getItem('aura-pdf-lazy') !== null) {
      perfLazyCb.checked = (window.safeStorage.getItem('aura-pdf-lazy') === 'true');
  }
  
  var perfDeepCb = document.getElementById('perf-deep-search-cb');
  if (perfDeepCb && window.safeStorage.getItem('aura-pdf-deep-search') !== null) {
      var deepEnabled = (window.safeStorage.getItem('aura-pdf-deep-search') === 'true');
      perfDeepCb.checked = deepEnabled;
      window.fullDeepSearch = deepEnabled;
      // If deep search was saved ON, reflect the cascade in UI checkboxes
      if (deepEnabled) {
          if (perfVirtCb) perfVirtCb.checked = false;
          if (perfLazyCb) perfLazyCb.checked = false;
      }
  }
  
  var perfDashCb = document.getElementById('perf-dashboard-cb');
  if (perfDashCb && window.safeStorage.getItem('aura-perf-dashboard') !== null) {
      perfDashCb.checked = (window.safeStorage.getItem('aura-perf-dashboard') === 'true');
      if (window.togglePerfDashboard) window.togglePerfDashboard(perfDashCb.checked);
  }
});

// --- DELEGATED FEATURE TOGGLES ---
window.toggleHighDPI = function(isEnabled) {
  if (isEnabled) {
    document.body.style.webkitFontSmoothing = 'antialiased';
    document.body.style.textRendering = 'optimizeLegibility';
  } else {
    document.body.style.webkitFontSmoothing = 'auto';
    document.body.style.textRendering = 'auto';
  }
  const handler = window.getActiveHandler();
  if (handler && handler.renderQuality && handler.renderQuality.toggleHighDPI) {
      handler.renderQuality.toggleHighDPI(isEnabled);
  }
};

window.setFontAlgo = function(val) {
  var content = document.getElementById('content');
  if (content) {
    if (val === 'smart') content.style.fontWeight = '300';
    else if (val === 'thicker') content.style.fontWeight = '500';
    else content.style.fontWeight = 'normal';
  }
  const handler = window.getActiveHandler();
  if (handler && handler.renderQuality && handler.renderQuality.setFontAlgo) {
      handler.renderQuality.setFontAlgo(val);
  }
};

window.toggleThemeAware = function(isEnabled) {
  if (isEnabled) document.body.classList.add('smart-dark-mode');
  else document.body.classList.remove('smart-dark-mode');
  
  const handler = window.getActiveHandler();
  if (handler && handler.renderQuality && handler.renderQuality.toggleThemeAware) {
      handler.renderQuality.toggleThemeAware(isEnabled);
  }
};

window.toggleDeepSearch = function(isEnabled) {
  window.fullDeepSearch = isEnabled;
  window.safeStorage.setItem('aura-pdf-deep-search', isEnabled);
  
  var virtCb = document.getElementById('perf-virt-cb');
  var lazyCb = document.getElementById('perf-lazy-cb');

  if (isEnabled) {
    window.safeStorage.setItem('aura-pdf-virt-pre-deep-search', virtCb ? virtCb.checked : true);
    window.safeStorage.setItem('aura-pdf-lazy-pre-deep-search', lazyCb ? lazyCb.checked : true);

    if (virtCb) virtCb.checked = false;
    if (lazyCb) lazyCb.checked = false;
    window.toggleVirtualization(false);
    window.toggleLazyLoading(false);
  } else {
    let prevVirt = window.safeStorage.getItem('aura-pdf-virt-pre-deep-search');
    let prevLazy = window.safeStorage.getItem('aura-pdf-lazy-pre-deep-search');
    
    let restoreVirt = prevVirt === null ? true : (prevVirt === 'true');
    let restoreLazy = prevLazy === null ? true : (prevLazy === 'true');

    if (virtCb) virtCb.checked = restoreVirt;
    if (lazyCb) lazyCb.checked = restoreLazy;
    window.toggleVirtualization(restoreVirt);
    window.toggleLazyLoading(restoreLazy);
  }
  
  const handler = window.getActiveHandler();
  if (handler && handler.search && handler.search.toggleDeepSearch) {
      handler.search.toggleDeepSearch(isEnabled);
  }
};

window.toggleVirtualization = function(isEnabled) {
  window.safeStorage.setItem('aura-pdf-virt', isEnabled);
  
  const handler = window.getActiveHandler();
  if (handler && handler.virtualization && handler.virtualization.toggle) {
      handler.virtualization.toggle(isEnabled);
  }
};

window.toggleLazyLoading = function(isEnabled) {
  window.safeStorage.setItem('aura-pdf-lazy', isEnabled);
  
  const handler = window.getActiveHandler();
  if (handler && handler.lazyLoading && handler.lazyLoading.toggle) {
      handler.lazyLoading.toggle(isEnabled);
  }
};

window.toggleAutoExplain = function(isEnabled) {
  window._autoExplainEnabled = isEnabled;
};

window.toggleUICapture = function(isEnabled) {
  window._uiCaptureEnabled = isEnabled;
};

// Delegated TOC Open
window.toggleToc = function(e) {
  if (e) e.stopPropagation();
  var s = document.getElementById('toc-popup');
  if (!s) return;
  var isOpen = s.classList.contains('open') || s.classList.contains('active');
  if (isOpen) { 
      if (window.closeToc) window.closeToc(); 
      return; 
  }
  s.classList.add('open');
  
  const handler = window.getActiveHandler();
  if (handler && handler.toc && handler.toc.render) {
      handler.toc.render();
  }
};
