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
  'aura-rag-topk':               { label: 'RAG Context Depth', category: 'ai', saveable: true }
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

      // 1. ALWAYS save metadata first! This ensures the file appears in the Library
      const metaStore = await this.dbManager.getTransaction('documents_meta', 'readwrite');
      await putPromisified(metaStore, { id, fileName, ext, timestamp: Date.now(), scrollState: scrollState || null });

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
      await putPromisified(store, { id, fileBlob: buffer, fileName, ext, timestamp: Date.now(), scrollState: scrollState || null });
      
      console.log(`[StorageRepository] Successfully saved document ${fileName}`);
    } catch (e) {
      console.warn("Failed to save document blob to IndexedDB (file might be too large or quota exceeded)", e);
    }
  }

  async saveScrollState(id, scrollState) {
    // FIX: Use a single atomic transaction covering both stores
    // Previously used two separate transactions that could diverge on page-unload.
    try {
      const db = await this.dbManager.getDB();
      const stores = ['documents_meta'];
      if (db.objectStoreNames.contains('documents')) stores.push('documents');

      const tx = db.transaction(stores, 'readwrite');

      const getAndUpdate = (storeName) => new Promise((resolve) => {
        const store = tx.objectStore(storeName);
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            req.result.scrollState = scrollState;
            store.put(req.result);
          }
          resolve();
        };
        req.onerror = () => resolve(); // non-fatal
      });

      await Promise.all(stores.map(s => getAndUpdate(s)));

      await new Promise((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('[StorageRepository] Failed to save scroll state:', e);
    }
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
    // FIX: Complete MIME type map — previously EPUB/MD got 'text/plain' which broke handlers.
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
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[StorageRepository] Failed to load document from IndexedDB:', e);
      return null;
    }
  }

  async saveNotes(id, notes, pdfHighlights) {
    try {
      const store = await this.dbManager.getTransaction('annotations', 'readwrite');
      store.put({ id, notes: JSON.parse(JSON.stringify(notes)), pdfHighlights: JSON.parse(JSON.stringify(pdfHighlights || [])), timestamp: Date.now() });
    } catch (e) {
      console.warn("Failed to save notes to IndexedDB", e);
    }
  }

  async loadNotes(id) {
    try {
      const store = await this.dbManager.getTransaction('annotations', 'readonly');
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("Failed to load notes", e);
      return null;
    }
  }

  async migrateNamespace(fromPrefix, toPrefix) {
    if (!fromPrefix || !toPrefix || fromPrefix === toPrefix) return;
    try {
      const db = await this.dbManager.getDB();
      const stores = ['documents', 'documents_meta', 'annotations'];
      const availableStores = stores.filter(s => db.objectStoreNames.contains(s));

      const tx = db.transaction(availableStores, 'readwrite');

      for (const storeName of availableStores) {
        const store = tx.objectStore(storeName);
        const req = store.openCursor();

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const key = String(cursor.key);
            if (key.startsWith(fromPrefix + '_')) {
              const suffix = key.substring((fromPrefix + '_').length);
              const newKey = toPrefix + '_' + suffix;
              // FIX: Deduplication guard — don't overwrite an existing target-namespace doc.
              const checkReq = store.getKey(newKey);
              checkReq.onsuccess = () => {
                if (!checkReq.result) {
                  // Target key doesn't exist — safe to migrate
                  const val = cursor.value;
                  val.id = newKey;
                  store.put(val);
                }
                // Always remove the source key
                store.delete(cursor.key);
              };
            }
            cursor.continue();
          }
        };
      }

      await new Promise((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      console.log(`[StorageRepository] Successfully migrated namespace from '${fromPrefix}' to '${toPrefix}'`);
    } catch(e) {
      console.warn('[StorageRepository] Migration error:', e);
    }
  }

  async getLibraryMeta(username) {
    try {
      const store = await this.dbManager.getTransaction('documents_meta', 'readonly');
      const metaItems = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const prefix = username + '_';
      let filtered = metaItems
        .filter(item => item.id.startsWith(prefix))
        .sort((a, b) => b.timestamp - a.timestamp);

      // Auto-adoption fallback: if no documents exist for active named user, auto-adopt guest files
      if (filtered.length === 0 && username !== 'guest') {
        const guestItems = metaItems.filter(item => item.id.startsWith('guest_'));
        if (guestItems.length > 0) {
          this.migrateNamespace('guest', username).catch(() => {});
          guestItems.forEach(item => {
            const migrated = Object.assign({}, item, { id: item.id.replace(/^guest_/, username + '_') });
            filtered.push(migrated);
          });
        }
      }

      // Enrich with note counts from annotations store
      const annStore = await this.dbManager.getTransaction('annotations', 'readonly');
      const allNotes = await new Promise((resolve, reject) => {
        const req = annStore.getAll();
        req.onsuccess = () => resolve(req.result);
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
}

window.dbManager = new DatabaseManager();
window.storageRepository = new StorageRepository(window.dbManager);

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
        // FIX: One-time migration guard per username — prevents re-migrating on every login.
        const migrationKey = `aura-profile-migrated-to-${newUsername}`;
        const alreadyMigrated = window.safeStorage && window.safeStorage.getItem(migrationKey) === 'true';

        if (!alreadyMigrated) {
          console.log(`[ProfileMigration] Migrating namespace from '${oldUsername}' to '${newUsername}'...`);
          if (this.storageRepo && this.storageRepo.migrateNamespace) {
            await this.storageRepo.migrateNamespace(oldUsername, newUsername);
          }
          if (window.safeStorage) window.safeStorage.setItem(migrationKey, 'true');
        } else {
          console.log(`[ProfileMigration] Skipping migration to '${newUsername}' — already performed.`);
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
  const uname = window.settingsRepo.getUsername();
  if (window.getActiveHandler && window.getActiveHandler() && window.getActiveHandler().getScrollState) {
    const state = window.getActiveHandler().getScrollState();
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
      window.storageRepository.saveNotes(key, window.notes, window.pdfHighlights);
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
// IMPORTANT: We use 'load' (not DOMContentLoaded) to ensure all <script> tags
// have finished executing and the file-upload event listener from pdf-handler.js is registered.
window.addEventListener('load', async () => {
  window.currentUsername = window.settingsRepo.getUsername();

  const library = await window.storageRepository.getLibraryMeta(window.currentUsername);
  console.log('[AutoRestore] library length for ' + window.currentUsername + ':', library.length);
  if (library.length === 0) return;

  const docData = await window.storageRepository.loadDocument(library[0].id);
  console.log('[AutoRestore] docData exists:', !!docData, 'fileBlob exists:', docData ? !!docData.fileBlob : false);
  if (!docData || !docData.fileBlob) {
      console.warn('[AutoRestore] Document missing or too large, cannot auto-restore blob.');
      if (library[0].scrollState) window.pendingScrollState = library[0].scrollState;
      return;
  }

  console.log('[StorageRepository] Restoring saved document:', docData.fileName);

  // Small delay to ensure all DOMContentLoaded handlers from other scripts have run
  setTimeout(() => {
    if (library[0].scrollState) window.pendingScrollState = library[0].scrollState;
    const mockFile = new File([docData.fileBlob], docData.fileName, { type: docData.fileBlob.type });
    const fileInput = document.getElementById('file-upload');
    if (fileInput) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(mockFile);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, 300);
});
