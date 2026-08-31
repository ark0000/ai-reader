// ==========================================
// CORE ORCHESTRATOR & DOCUMENT HANDLER REGISTRY
// ==========================================

window.sanitizeHTML = function(html) {
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(html, { 
      ALLOWED_TAGS: ['strong', 'em', 'code', 'pre', 'br', 'a', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'mspace', 'mtext', 'annotation'],
      ALLOWED_ATTR: ['href', 'style', 'class', 'target', 'xmlns', 'display', 'encoding']
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
  return window._activeDocHandler || window.DocumentHandlers[window.currentExt] || null;
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
  'aura-pdf-lazy-pre-deep-search': { label: 'Lazy Pre-Search', category: 'perf', saveable: true },
  'aura-reading-state':          { label: 'Remember Reading State',category: 'reading', saveable: true },
  'aura-notes-state':            { label: 'Remember Notes',        category: 'reading', saveable: true },
  'aura-ai-streaming':           { label: 'Real-Time Streaming AI Chat', category: 'ai', saveable: true },
  'aura-rag-citations':          { label: 'Interactive Page Citations in RAG', category: 'ai', saveable: true },
  'aura-rag-topk':               { label: 'RAG Context Depth', category: 'ai', saveable: true },
  'aura-book-mode':              { label: 'Book Mode (Restart Required)', category: 'perf', saveable: true }
};

window.jumpToCitation = function(target) {
  const handler = window.getActiveHandler();
  if (handler && typeof handler.jumpTo === 'function') {
    handler.jumpTo(target);
  } else if (window.pdfGotoPage && !isNaN(parseInt(target, 10))) {
    window.pdfGotoPage(parseInt(target, 10));
  }
};

window.safeStorage = {
  _mem: {},
  _criticalKeys: new Set(['token', 'username', 'auraVersion', 'aura-state-save-prefs', 'aura-book-mode']),
  
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
  let prefsRaw = localStorage.getItem('aura-state-save-prefs');
  let prefs = {};
  if (prefsRaw) {
    prefs = JSON.parse(prefsRaw);
  } else {
    // Default ON for fresh installs
    prefs['aura-reading-state'] = true;
    prefs['aura-notes-state'] = true;
    localStorage.setItem('aura-state-save-prefs', JSON.stringify(prefs));
  }
  // Migrate old 'aura-pdf-reading-state' to 'aura-reading-state'
  if (prefs['aura-pdf-reading-state'] === true) {
    prefs['aura-reading-state'] = true;
    delete prefs['aura-pdf-reading-state'];
    localStorage.setItem('aura-state-save-prefs', JSON.stringify(prefs));
    if (localStorage.getItem('aura-pdf-reading-state')) {
       localStorage.setItem('aura-reading-state', localStorage.getItem('aura-pdf-reading-state'));
       localStorage.removeItem('aura-pdf-reading-state');
    }
  }

  const saveReadingCb = document.getElementById('save-reading-theme-cb');
  if (saveReadingCb) saveReadingCb.checked = (prefs['aura-reading-theme'] === true);
  
  const saveFontCb = document.getElementById('save-font-quality-cb');
  if (saveFontCb) saveFontCb.checked = (prefs['AuraFontQuality'] === true);
  
  const savePerfCb = document.getElementById('save-perf-cb');
  if (savePerfCb) savePerfCb.checked = (prefs['aura-pdf-virt'] === true);

  const saveStateCb = document.getElementById('save-reading-state-cb');
  if (saveStateCb) saveStateCb.checked = (prefs['aura-reading-state'] === true);

  const saveNotesCb = document.getElementById('save-notes-state-cb');
  if (saveNotesCb) saveNotesCb.checked = (prefs['aura-notes-state'] === true);

  // Set username field and currentUsername on init
  window.currentUsername = localStorage.getItem('username') || 'guest';
  const usernameInput = document.getElementById('username-input');
  if (usernameInput) usernameInput.value = window.currentUsername === 'guest' ? '' : window.currentUsername;
  
  // Auto-login stored profile to ensure backend token is valid
  if (window.currentUsername !== 'guest') {
      fetch('/api/mock-login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({username: window.currentUsername})
      }).then(res => res.json()).then(data => {
          if(data.token) localStorage.setItem('token', data.token);
      }).catch(e => console.warn('Auto-login failed', e));
  }


  const manualSaveCb = document.getElementById('manual-save-cb');
  if (manualSaveCb) manualSaveCb.checked = (window.safeStorage.getItem('aura-manual-save') === 'true');
  if (window.toggleManualSaveButton) window.toggleManualSaveButton();
  
  const pdfColorsCb = document.getElementById('pdf-colors-cb');
  if (pdfColorsCb) pdfColorsCb.checked = (window.safeStorage.getItem('aura-pdf-colors') === 'true');

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

// =========================================================================
// DATABASE & REPOSITORY PATTERN (IndexedDB Persistence)
// =========================================================================

class DatabaseManager {
  constructor(dbName = 'AuraDB', version = 2) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('annotations')) {
          db.createObjectStore('annotations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('documents_meta')) {
          db.createObjectStore('documents_meta', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB Error:", event.target.error);
        reject(event.target.error);
      };
    });
    return this.initPromise;
  }

  async getTransaction(storeName, mode = 'readonly') {
    const db = await this.init();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  // Alias so both getDB() and init() work
  async getDB() {
    return this.init();
  }
}

class StorageRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  async saveDocument(id, fileBlob, fileName, ext, scrollState) {
    try {
      const putPromisified = (store, data) => new Promise((resolve, reject) => {
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });

      // 1. Check if an existing record has scrollState that should be preserved
      const metaStore = await this.dbManager.getTransaction('documents_meta', 'readwrite');
      let effectiveScrollState = scrollState || null;
      
      // If incoming scroll state is null or default page 1, check if DB has existing reading progress
      const isInitialPage1 = scrollState && scrollState.page === 1 && (!scrollState.ratio || scrollState.ratio === 0);
      if (!effectiveScrollState || isInitialPage1) {
        const existingMeta = await new Promise((res) => {
          const req = metaStore.get(id);
          req.onsuccess = () => res(req.result || null);
          req.onerror = () => res(null);
        });
        if (existingMeta && existingMeta.scrollState) {
          const hasAdvancedProgress = existingMeta.scrollState.page > 1 || 
                                     (existingMeta.scrollState.ratio && existingMeta.scrollState.ratio > 0) ||
                                     (existingMeta.scrollState.scrollTop && existingMeta.scrollState.scrollTop > 0) ||
                                     existingMeta.scrollState.cfi;
          if (hasAdvancedProgress || !effectiveScrollState) {
            effectiveScrollState = existingMeta.scrollState;
          }
        } else if (!effectiveScrollState && typeof id === 'string' && id.includes('_')) {
          // Fallback check for guest_ and un-prefixed records
          const suffix = id.substring(id.indexOf('_') + 1);
          const fbKeys = ['guest_' + suffix, suffix];
          for (const fbKey of fbKeys) {
            const fbMeta = await new Promise((res) => {
              const req = metaStore.get(fbKey);
              req.onsuccess = () => res(req.result || null);
              req.onerror = () => res(null);
            });
            if (fbMeta && fbMeta.scrollState) {
              effectiveScrollState = fbMeta.scrollState;
              break;
            }
          }
        }
      }

      // ALWAYS save metadata first! This ensures the file appears in the Library
      await putPromisified(metaStore, { id, fileName, ext, timestamp: Date.now(), scrollState: effectiveScrollState });

      if (window.safeStorage && window.safeStorage.getItem('aura-meta-only-cache') === 'true') {
        console.log(`[StorageRepository] Metadata-only caching enabled. Skipping blob save for ${fileName}`);
        return; // Exit early to prevent saving heavy blob
      }

      // 2. Convert File to ArrayBuffer to bypass DataCloneError bugs in Safari/older Chrome
      let buffer = fileBlob;
      if (fileBlob instanceof Blob) {
        buffer = await fileBlob.arrayBuffer();
      }

      // 3. Save full blob/buffer
      const store = await this.dbManager.getTransaction('documents', 'readwrite');
      await putPromisified(store, { id, fileBlob: buffer, fileName, ext, timestamp: Date.now(), scrollState: effectiveScrollState });
      
      console.log(`[StorageRepository] Successfully saved document ${fileName}`);
    } catch (e) {
      console.warn("Failed to save document blob to IndexedDB (file might be too large or quota exceeded)", e);
    }
  }

  _getHeaders() {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async _getBackendDocumentStorage(key) {
    try {
      const res = await fetch(`/api/storage/document/${encodeURIComponent(key)}`, {
        headers: this._getHeaders()
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || {};
      }
    } catch (e) {
      // Network/offline fallback
    }
    return {};
  }

  async _saveBackendDocumentStorage(key, data) {
    try {
      const headers = this._getHeaders();
      headers['Content-Type'] = 'application/json';
      await fetch(`/api/storage/document/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ data })
      });
    } catch (e) {
      // Local persistence in IndexedDB already succeeded
    }
  }

  async loadScrollState(id) {
    // 1. Try Backend Storage first
    const data = await this._getBackendDocumentStorage(id);
    if (data && data.scrollState) return data.scrollState;

    // 2. Fallback check on backend with suffix
    if (typeof id === 'string' && id.includes('_')) {
      const suffix = id.substring(id.indexOf('_') + 1);
      const guestData = await this._getBackendDocumentStorage('guest_' + suffix);
      if (guestData && guestData.scrollState) return guestData.scrollState;
      const defaultData = await this._getBackendDocumentStorage(suffix);
      if (defaultData && defaultData.scrollState) return defaultData.scrollState;
    }

    // 3. Fallback to Local IndexedDB (documents_meta)
    try {
      const metaStore = await this.dbManager.getTransaction('documents_meta', 'readonly');
      const localMeta = await new Promise((res) => {
        const req = metaStore.get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
      if (localMeta && localMeta.scrollState) return localMeta.scrollState;

      // Local fallback with suffix
      if (typeof id === 'string' && id.includes('_')) {
        const suffix = id.substring(id.indexOf('_') + 1);
        for (const fbKey of ['guest_' + suffix, suffix]) {
          const fbMeta = await new Promise((res) => {
            const req = metaStore.get(fbKey);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => res(null);
          });
          if (fbMeta && fbMeta.scrollState) return fbMeta.scrollState;
        }
      }
    } catch (e) {
      console.warn('[StorageRepository] Local scrollState load error:', e);
    }

    return null;
  }

  async saveScrollState(id, scrollState) {
    // 1. Save to local IndexedDB (documents_meta)
    try {
      const metaStore = await this.dbManager.getTransaction('documents_meta', 'readwrite');
      const existing = await new Promise((res) => {
        const req = metaStore.get(id);
        req.onsuccess = () => res(req.result || {});
        req.onerror = () => res({});
      });
      metaStore.put({ ...existing, id, scrollState, timestamp: Date.now() });
    } catch (e) {
      console.warn('[StorageRepository] Local scrollState save error:', e);
    }

    // 2. Sync to Backend
    await this._saveBackendDocumentStorage(id, { scrollState });
  }

  async deleteDocument(id) {
    console.log(`[StorageRepository] Attempting to delete document ${id}`);
    const db = await this.dbManager.init();
    
    return new Promise((resolve, reject) => {
      // Use a single transaction for all relevant stores
      const stores = ['documents', 'documents_meta'];
      if (db.objectStoreNames.contains('annotations')) {
        stores.push('annotations');
      }
      
      const tx = db.transaction(stores, 'readwrite');
      
      tx.oncomplete = () => {
        console.log(`[StorageRepository] Successfully deleted document ${id}`);
        resolve();
      };
      
      tx.onerror = (e) => {
        console.error("[StorageRepository] Transaction error during delete:", e.target.error);
        reject(e.target.error);
      };

      try {
        tx.objectStore('documents').delete(id);
        tx.objectStore('documents_meta').delete(id);
        if (stores.includes('annotations')) {
          tx.objectStore('annotations').delete(id);
        }
      } catch (err) {
        console.error("[StorageRepository] Error executing delete on stores:", err);
        // Sometimes delete() can throw if id is invalid type
        reject(err);
      }
    });
  }

  async loadDocument(id) {
    const MIME_MAP = {
      pdf:  'application/pdf',
      epub: 'application/epub+zip',
      md:   'text/markdown',
      txt:  'text/plain',
      html: 'text/html',
    };
    try {
      const docStore = await this.dbManager.getTransaction('documents', 'readonly');
      return await new Promise((resolve, reject) => {
        const req = docStore.get(id);
        req.onsuccess = () => {
          if (req.result && req.result.fileBlob) {
            if (req.result.fileBlob instanceof ArrayBuffer) {
              const mime = MIME_MAP[req.result.ext] || 'application/octet-stream';
              req.result.fileBlob = new Blob([req.result.fileBlob], { type: mime });
            }
            resolve(req.result);
          } else {
            // Fallback: If exact ID not found, check if it exists under guest_ or un-prefixed ID
            const fallbackKeys = [];
            if (typeof id === 'string' && id.includes('_')) {
              const suffix = id.substring(id.indexOf('_') + 1);
              fallbackKeys.push('guest_' + suffix, suffix);
            }
            if (fallbackKeys.length > 0) {
              const tryFallback = (idx) => {
                if (idx >= fallbackKeys.length) return resolve(null);
                const fbReq = docStore.get(fallbackKeys[idx]);
                fbReq.onsuccess = () => {
                  if (fbReq.result && fbReq.result.fileBlob) {
                    if (fbReq.result.fileBlob instanceof ArrayBuffer) {
                      const mime = MIME_MAP[fbReq.result.ext] || 'application/octet-stream';
                      fbReq.result.fileBlob = new Blob([fbReq.result.fileBlob], { type: mime });
                    }
                    resolve(fbReq.result);
                  } else {
                    tryFallback(idx + 1);
                  }
                };
                fbReq.onerror = () => tryFallback(idx + 1);
              };
              tryFallback(0);
            } else {
              resolve(null);
            }
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[StorageRepository] Failed to load document from IndexedDB:', e);
      return null;
    }
  }

  async saveNotes(id, notes, pdfHighlights, force = false) {
    // Guard: skip auto-saves during document hydration, but always allow force-saves (e.g. manual save button)
    if (!force && window._isDocumentLoading) return;

    // 1. Save to local IndexedDB (annotations)
    try {
      const annStore = await this.dbManager.getTransaction('annotations', 'readwrite');
      annStore.put({ id, notes, pdfHighlights, timestamp: Date.now() });
    } catch (e) {
      console.warn('[StorageRepository] Local annotations save error:', e);
    }

    // 2. Sync to Backend
    await this._saveBackendDocumentStorage(id, { notes, pdfHighlights });
  }

  async loadNotes(id) {
    // 1. Try Backend Storage first
    const data = await this._getBackendDocumentStorage(id);
    if (data && data.notes) return data;
    
    // 2. Fallback check on backend with suffix
    if (typeof id === 'string' && id.includes('_')) {
      const suffix = id.substring(id.indexOf('_') + 1);
      const guestData = await this._getBackendDocumentStorage('guest_' + suffix);
      if (guestData && guestData.notes) return guestData;
      const defaultData = await this._getBackendDocumentStorage(suffix);
      if (defaultData && defaultData.notes) return defaultData;
    }

    // 3. Fallback to Local IndexedDB (annotations)
    try {
      const annStore = await this.dbManager.getTransaction('annotations', 'readonly');
      const localAnn = await new Promise((res) => {
        const req = annStore.get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
      if (localAnn && localAnn.notes) return localAnn;

      // Local fallback with suffix
      if (typeof id === 'string' && id.includes('_')) {
        const suffix = id.substring(id.indexOf('_') + 1);
        for (const fbKey of ['guest_' + suffix, suffix]) {
          const fbAnn = await new Promise((res) => {
            const req = annStore.get(fbKey);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => res(null);
          });
          if (fbAnn && fbAnn.notes) return fbAnn;
        }
      }
    } catch (e) {
      console.warn('[StorageRepository] Local annotations load error:', e);
    }

    return null;
  }

  async migrateNamespace(fromPrefix, toPrefix) {
    if (!fromPrefix || !toPrefix || fromPrefix === toPrefix) return;
    try {
      const db = await this.dbManager.getDB();
      const stores = ['documents', 'documents_meta', 'annotations'];
      const availableStores = stores.filter(s => db.objectStoreNames.contains(s));

      for (const storeName of availableStores) {
        // Step 1: Read all items safely in readonly mode first
        const readTx = db.transaction([storeName], 'readonly');
        const readStore = readTx.objectStore(storeName);
        const allItems = await new Promise((resolve, reject) => {
          const req = readStore.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });

        // Step 2: Calculate items needing namespace migration
        const itemsToMigrate = [];
        const existingKeys = new Set(allItems.map(item => String(item.id)));

        for (const item of allItems) {
          const key = String(item.id);
          let suffix = null;
          if (key.startsWith(fromPrefix + '_')) {
            suffix = key.substring((fromPrefix + '_').length);
          } else if (fromPrefix === 'guest' && !key.includes('_')) {
            // Also adopt legacy un-prefixed keys (e.g. "my_doc.pdf")
            suffix = key;
          }

          if (suffix) {
            const newKey = toPrefix + '_' + suffix;
            itemsToMigrate.push({ oldKey: key, newKey, item });
          }
        }

        if (itemsToMigrate.length === 0) continue;

        // Step 3: Atomic write & delete in readwrite mode
        const writeTx = db.transaction([storeName], 'readwrite');
        const writeStore = writeTx.objectStore(storeName);

        for (const { oldKey, newKey, item } of itemsToMigrate) {
          if (!existingKeys.has(newKey)) {
            const updated = Object.assign({}, item, { id: newKey });
            writeStore.put(updated);
            existingKeys.add(newKey);
          }
          writeStore.delete(oldKey);
        }

        await new Promise((resolve, reject) => {
          writeTx.oncomplete = () => resolve();
          writeTx.onerror = (e) => reject(e.target.error);
        });
      }
      console.log(`[StorageRepository] Successfully migrated namespace from '${fromPrefix}' to '${toPrefix}'`);
    } catch(e) {
      console.warn('[StorageRepository] Migration error:', e);
    }
  }

  async migrateBackend() {
    if (localStorage.getItem('document_storage_migrated_v2')) return;
    try {
      const db = await this.dbManager.getDB();
      const stores = ['documents_meta', 'annotations'];
      const availableStores = stores.filter(s => db.objectStoreNames.contains(s));
      
      const toMigrate = {};

      for (const storeName of availableStores) {
        const readTx = db.transaction([storeName], 'readonly');
        const readStore = readTx.objectStore(storeName);
        const allItems = await new Promise((resolve) => {
          const req = readStore.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        
        for (const item of allItems) {
          const key = String(item.id);
          if (!toMigrate[key]) toMigrate[key] = {};
          if (storeName === 'documents_meta' && item.scrollState) {
            toMigrate[key].scrollState = item.scrollState;
          }
          if (storeName === 'annotations') {
            if (item.notes) toMigrate[key].notes = item.notes;
            if (item.pdfHighlights) toMigrate[key].pdfHighlights = item.pdfHighlights;
          }
        }
      }

      let count = 0;
      for (const key of Object.keys(toMigrate)) {
        if (Object.keys(toMigrate[key]).length > 0) {
          await this._saveBackendDocumentStorage(key, toMigrate[key]);
          count++;
        }
      }
      
      localStorage.setItem('document_storage_migrated_v2', 'true');
      console.log(`Migrated ${count} document records to backend storage.`);
    } catch (e) {
      console.warn("Failed to migrate legacy document storage:", e);
    }
  }

  async getLibraryMeta(username) {
    try {
      const store = await this.dbManager.getTransaction('documents_meta', 'readonly');
      const metaItems = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const user = (username && username.trim()) ? username.trim() : 'guest';
      const prefix = user + '_';
      const userLower = user.toLowerCase();

      // Filter for items belonging to current user (with case-insensitive fallback)
      let filtered = metaItems
        .filter(item => {
          const id = String(item.id);
          return id.startsWith(prefix) || id.toLowerCase().startsWith(userLower + '_');
        })
        .sort((a, b) => b.timestamp - a.timestamp);

      // Auto-adoption fallback: always check for guest_ or legacy un-prefixed files for named users
      if (user !== 'guest') {
        const adoptableItems = metaItems.filter(item => {
          const id = String(item.id);
          return id.startsWith('guest_') || !id.includes('_');
        });

        // Only adopt items that haven't already been migrated to the user's namespace
        const unmigratedItems = adoptableItems.filter(item => {
          const rawId = String(item.id);
          const cleanSuffix = rawId.startsWith('guest_') ? rawId.substring(6) : rawId;
          const targetId = user + '_' + cleanSuffix;
          return !filtered.some(f => String(f.id) === targetId);
        });

        if (unmigratedItems.length > 0) {
          await this.migrateNamespace('guest', user);
          unmigratedItems.forEach(item => {
            const rawId = String(item.id);
            const cleanSuffix = rawId.startsWith('guest_') ? rawId.substring(6) : rawId;
            const migrated = Object.assign({}, item, { id: user + '_' + cleanSuffix });
            filtered.push(migrated);
          });
        }
      }

      // Enrich with note counts from annotations store
      const annStore = await this.dbManager.getTransaction('annotations', 'readonly');
      const allNotes = await new Promise((resolve, reject) => {
        const req = annStore.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const noteMap = {};
      allNotes.forEach(n => { noteMap[n.id] = (n.notes ? n.notes.length : 0); });

      return filtered.map(item => ({
        id: item.id,
        fileName: item.fileName,
        ext: item.ext,
        timestamp: item.timestamp,
        scrollState: item.scrollState || null,
        noteCount: noteMap[item.id] || 0
      }));
    } catch (e) {
      console.warn("Failed to get library meta", e);
      return [];
    }
  }

  async deleteDocument(id) {
    try {
      // 1. Delete Blob
      const docStore = await this.dbManager.getTransaction('documents', 'readwrite');
      await new Promise((resolve, reject) => {
        const req = docStore.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // 2. Delete Meta
      const metaStore = await this.dbManager.getTransaction('documents_meta', 'readwrite');
      await new Promise((resolve, reject) => {
        const req = metaStore.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      // 3. Delete Annotations
      const annStore = await this.dbManager.getTransaction('annotations', 'readwrite');
      await new Promise((resolve, reject) => {
        const req = annStore.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      
      console.log(`[StorageRepository] Deleted document and all metadata for id: ${id}`);
    } catch (e) {
      console.error("[StorageRepository] Error deleting document:", e);
      throw e;
    }
  }
}

window.dbManager = new DatabaseManager();
window.storageRepository = new StorageRepository(window.dbManager);
window.storageRepository.migrateBackend().catch(e => console.warn(e));

// --- Event Bus ---
class EventBus {
  constructor() {
    this.listeners = {};
  }
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}
window.appEventBus = new EventBus();

// --- Settings Repository ---
class SettingsRepository {
  constructor() {
    this.cache = {};
  }
  get(key) {
    if (this.cache[key] !== undefined) return this.cache[key];
    
    // Check if it's a boolean preference stored in aura-state-save-prefs
    if (key === 'aura-reading-state' || key === 'aura-notes-state') {
        const prefsRaw = localStorage.getItem('aura-state-save-prefs');
        if (prefsRaw) {
            try {
                const prefs = JSON.parse(prefsRaw);
                if (prefs[key] !== undefined) {
                    const val = prefs[key] ? 'true' : 'false';
                    this.cache[key] = val;
                    return val;
                }
            } catch(e) {}
        }
    }

    const val = window.safeStorage.getItem(key);
    this.cache[key] = val;
    return val;
  }
  set(key, value) {
    this.cache[key] = value;
    window.safeStorage.setItem(key, value);
    window.appEventBus.emit(`SettingsChanged:${key}`, value);
  }
  isTrue(key) {
    return this.get(key) === 'true';
  }
  getUsername() {
    return this.get('username') || 'guest';
  }
}
window.settingsRepo = new SettingsRepository();

// --- Profile Migration Manager ---
class ProfileMigrationManager {
  constructor(storageRepo, settingsRepo, eventBus) {
    this.storageRepo = storageRepo;
    this.settingsRepo = settingsRepo;
    this.eventBus = eventBus;
    this.lastUsername = this.settingsRepo ? this.settingsRepo.getUsername() : 'guest';
    this._bindEvents();
  }

  _bindEvents() {
    if (!this.eventBus) return;
    this.eventBus.on('SettingsChanged:username', async (newVal) => {
      const newUsername = newVal && newVal.trim() ? newVal.trim() : 'guest';
      const oldUsername = this.lastUsername || 'guest';

      if (oldUsername !== newUsername && newUsername !== 'guest') {
        console.log(`[ProfileMigration] Migrating namespace from '${oldUsername}' to '${newUsername}'...`);
        if (this.storageRepo && this.storageRepo.migrateNamespace) {
          await this.storageRepo.migrateNamespace(oldUsername, newUsername);
        }

        const libModal = document.getElementById('library-modal');
        if (libModal && libModal.style.display !== 'none' && window.openLibraryModal) {
          window.openLibraryModal();
        }
      }

      this.lastUsername = newUsername;
    });
  }
}
window.profileMigrationManager = new ProfileMigrationManager(window.storageRepository, window.settingsRepo, window.appEventBus);

// --- Document Context Manager ---
class DocumentContextManager {
  constructor() {
    this.fileObj = null;
    this.fileName = null;
    this.fileExt = null;
  }
  setDocument(file, name, ext) {
    this.fileObj = file;
    this.fileName = name;
    this.fileExt = ext;
    window.currentFileName = name; // legacy fallback
    window.currentExt = ext;       // legacy fallback
  }
  getDocument() {
    return { file: this.fileObj, name: this.fileName, ext: this.fileExt };
  }
}
window.documentContext = new DocumentContextManager();

// --- Core Saving Logic ---
window.triggerLibrarySave = function(file, fileName, ext, force = false) {
  // Always update the core context when a file is opened
  window.documentContext.setDocument(file, fileName, ext);

  // If manual save mode is explicitly enabled, don't auto-save unless force=true
  if (!force && window.settingsRepo.isTrue('aura-manual-save')) return;

  const uname = window.settingsRepo.getUsername();
  const scrollState = window.pendingScrollState || (window.getActiveHandler && window.getActiveHandler() && window.getActiveHandler().getScrollState ? window.getActiveHandler().getScrollState() : null);
  window.storageRepository.saveDocument(uname + '_' + fileName, file, fileName, ext, scrollState);
};

window.triggerStateSave = function() {
  if (window._isDocumentLoading) return;
  if (!window.settingsRepo || !window.settingsRepo.isTrue('aura-reading-state')) return;
  if (window.settingsRepo.isTrue('aura-manual-save')) return;

  const uname = window.settingsRepo.getUsername();
  const handler = window.getActiveHandler ? window.getActiveHandler() : null;
  if (handler && handler.getScrollState) {
    const state = handler.getScrollState();
    if (state && window.currentFileName) {
      window.storageRepository.saveScrollState(uname + '_' + window.currentFileName, state);
    }
  }
};

window.manualSaveDocument = function() {
  const doc = window.documentContext.getDocument();
  if (!doc.file) {
      alert("No document currently loaded to save.");
      return;
  }
  const btn = document.getElementById('manual-save-btn');
  if (btn) {
    const ogText = btn.innerHTML;
    btn.innerHTML = '&#10004; Saved';
    setTimeout(() => btn.innerHTML = ogText, 2000);
  }
  
  // 1. Save the Document Blob
  if (window.triggerLibrarySave) {
      window.triggerLibrarySave(doc.file, doc.name, doc.ext, true);
  }
  
  // 2. Explicitly force save the Notes and Highlights for this file right now
  const uname = window.settingsRepo.getUsername();
  const key = uname + '_' + doc.name;
  if (window.storageRepository && window.notes) {
      // force=true bypasses the _isDocumentLoading guard so manual save always works
      window.storageRepository.saveNotes(key, window.notes, window.pdfHighlights, true);
  }
  
  // 3. Explicitly force save the reading state/scroll position right now
  if (window.getActiveHandler && window.getActiveHandler() && window.getActiveHandler().getScrollState) {
      const state = window.getActiveHandler().getScrollState();
      if (state && window.storageRepository) {
          window.storageRepository.saveScrollState(key, state);
      }
  }
};

window.toggleManualSaveButton = function(isManualSaveEnabled) {
  const btn = document.getElementById('manual-save-btn');
  if (btn) {
    btn.style.display = isManualSaveEnabled ? 'inline-block' : 'none';
  }
};

// Listen to UI Side effects via EventBus
window.appEventBus.on('SettingsChanged:aura-manual-save', (val) => {
  window.toggleManualSaveButton(val === 'true');
});

// Auto-restore logic on load
// Strategy: listen for 'load' to guarantee all <script> tags (including pdf-handler.js)
// have registered their DOMContentLoaded listeners. Then wait an additional tick
// so the 'change' event listener on #file-upload is guaranteed to be attached.
window.addEventListener('load', async () => {
  window.currentUsername = window.settingsRepo.getUsername();

  const library = await window.storageRepository.getLibraryMeta(window.currentUsername);
  console.log('[AutoRestore] library length for ' + window.currentUsername + ':', library.length);
  if (library.length === 0) return;

  const latest = library[0];
  const docData = await window.storageRepository.loadDocument(latest.id);
  console.log('[AutoRestore] docData exists:', !!docData, 'fileBlob exists:', docData ? !!docData.fileBlob : false);

  if (!docData || !docData.fileBlob) {
    console.warn('[AutoRestore] Document blob missing (metadata-only cache). Restoring scroll state only.');
    // Still restore scroll state so opening the file manually lands at the right position
    if (latest.scrollState) window.pendingScrollState = latest.scrollState;
    return;
  }

  console.log('[AutoRestore] Restoring saved document:', docData.fileName);

  // FIX: Use requestAnimationFrame after load to guarantee the pdf-handler
  // DOMContentLoaded block has fully executed and #file-upload listener is wired.
  // Previously, a flat 300ms timeout could race if the browser was busy.
  const _dispatchRestore = () => {
    if (latest.scrollState) window.pendingScrollState = latest.scrollState;
    const mockFile = new File([docData.fileBlob], docData.fileName, { type: docData.fileBlob.type });
    const fileInput = document.getElementById('file-upload');
    if (!fileInput) {
      console.warn('[AutoRestore] #file-upload not found — cannot auto-restore.');
      return;
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[AutoRestore] Dispatched file change event for:', docData.fileName);
  };


  // Use double-rAF to guarantee paint cycle + all synchronous event-listener
  // registrations (DOMContentLoaded handlers) have completed before we dispatch.
  requestAnimationFrame(() => requestAnimationFrame(_dispatchRestore));
});

// ── Admin Dev-Mode Activity Ping ──────────────────────────────────────────────
// Only sends data when the server is running with DEBUG_CONSOLE=1.
// The server endpoint returns { status: "noop" } silently in production.
// Interval: every 30 seconds while the tab is visible.
(function _initAdminPing() {
  var _pingTimer = null;
  var _lastLibraryCount = 0;

  function _getPage() {
    // PDF: current page number
    if (window.pdfCurrentPage) return window.pdfCurrentPage;
    // MD/TXT: encode scrollTop as page-equivalent
    var ce = document.getElementById('content-area') || document.getElementById('reader-content');
    if (ce && ce.scrollTop) return Math.round(ce.scrollTop / 100);
    return null;
  }

  var _lastSentUsername = null;

  async function _sendAdminPing() {
    try {
      var username = (window.settingsRepo && window.settingsRepo.getUsername())
                     || window.currentUsername || 'guest';
      
      // Async fetch library size, fallback to cached count if it fails or during sync unload
      if (window.storageRepository && window.storageRepository.getLibraryMeta) {
          try {
              var lib = await window.storageRepository.getLibraryMeta(username);
              _lastLibraryCount = lib.length || 0;
          } catch(e) {}
      }

      var userId   = 1; // client-side user_id approximation
      var file     = window.currentFileName || null;
      var ext      = file ? (file.split('.').pop() || null) : null;
      var notes    = (window.notes && window.notes.length) || 0;
      var page     = _getPage();

      var prevUsername = (_lastSentUsername && _lastSentUsername !== username) ? _lastSentUsername : null;
      _lastSentUsername = username;

      var payload = JSON.stringify({
        username:     username,
        user_id:      userId,
        current_file: file,
        file_ext:     ext,
        note_count:   notes,
        library_count: _lastLibraryCount,
        page:         page,
        previous_username: prevUsername
      });

      // Use sendBeacon if available (non-blocking, survives tab close)
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/admin/activity', blob);
      } else {
        fetch('/api/admin/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function() {}); // silent fail — non-critical
      }
    } catch (e) {
      // Never let admin ping break the reader
    }
  }

  function _startPing() {
    if (_pingTimer) return;
    _sendAdminPing(); // immediate first ping
    _pingTimer = setInterval(_sendAdminPing, 30000); // every 30 s
  }

  function _stopPing() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
  }

  // Pause when tab is hidden to avoid unnecessary traffic
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { _stopPing(); } else { _startPing(); }
  });

  // Send a final ping on tab close (works even without sendBeacon)
  window.addEventListener('beforeunload', _sendAdminPing);

  // Start after load
  window.addEventListener('load', _startPing);

  // Re-ping immediately when file changes (so admin panel sees new doc instantly)
  window.addEventListener('aura-file-opened', _sendAdminPing);
  window.addEventListener('aura-notes-changed', _sendAdminPing);

  // Expose for test access
  window._adminPingSend = _sendAdminPing;
})();

// --- Raw Storage Debugger ---
window.openRawStorageDebugger = async function() {
    try {
        const resp = await fetch('/api/admin/raw_notes_dump', { headers: window.authHeaders() });
        let backendData = { error: "Failed to fetch from backend" };
        if (resp.ok) {
            backendData = await resp.json();
        } else {
            backendData = { error: await resp.text() };
        }
        
        let localChatHistory = null;
        try {
            const val = window.safeStorage ? window.safeStorage.getItem('aura_chat_tree') : localStorage.getItem('aura_chat_tree');
            localChatHistory = val ? JSON.parse(val) : null;
        } catch(e) {}
        
        const finalDump = {
            backend_storage: backendData,
            browser_local_storage: {
                ai_chat_history: localChatHistory
            }
        };
        
        const w = window.open('', '_blank');
        if (w) {
            w.document.write('<html><head><title>Raw Storage Debugger</title></head><body style="background:#111;color:#0f0;font-family:monospace;padding:20px;white-space:pre-wrap;word-wrap:break-word;">' + JSON.stringify(finalDump, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</body></html>');
            w.document.close();
        } else {
            alert('Popup blocked! Please allow popups to see the debugger.');
        }
    } catch(err) {
        alert("Failed to load raw storage dump: " + err.message);
    }
};
