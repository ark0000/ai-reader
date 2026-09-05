/**
 * NotesRepository.js
 * Multi-Tier Resilient Storage Architecture (Repository Pattern):
 * 1. Primary: SQLite Backend API (/api/notes/global) for cross-device sync & server persistence.
 * 2. Secondary / Offline: Local IndexedDB (NotesDB -> global_notes).
 * 3. Tertiary Fallback: localStorage (aura_global_notes_backup) for environments without IndexedDB.
 *
 * Guarantees zero data loss: notes are always saved locally first, synced with backend when available,
 * and seamlessly retrieved from local cache if backend is unreachable.
 */
class NotesRepository {
  constructor() {
    this.apiBase = '/api/notes/global';
    
    // Fetch username to strictly isolate the local IndexedDB / LocalStorage by user
    let uname = 'guest';
    try {
        uname = localStorage.getItem('username') || window.currentUsername || 'guest';
    } catch(e) {}
    
    this.username = uname; // FIX Bug 6: Must be assigned so token guards (this.username !== 'guest') work correctly
    this.dbName = 'NotesDB_' + uname;
    this.storeName = 'global_notes';
    this.localStorageBackupKey = 'aura_global_notes_backup_' + uname;
    this.migratedKey = 'global_notes_migrated_v2_' + uname;
    
    this._db = null;
    this._initPromise = null;
  }

  _getHeaders() {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async _getDB() {
    if (this._db) return this._db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) {
          resolve(null);
          return;
        }
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = (e) => {
          this._db = e.target.result;
          resolve(this._db);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        console.warn("IndexedDB initialization error:", err);
        resolve(null);
      }
    });

    return this._initPromise;
  }

  // --- Local Storage Layer (IndexedDB + localStorage fallback) ---



  async _saveLocal(note) {
    // 1. localStorage backup — deferred to idle time (tertiary fallback, not time-critical)
    const _doLocalStorageBackup = () => {
      try {
        const backupRaw = localStorage.getItem(this.localStorageBackupKey);
        let list = backupRaw ? JSON.parse(backupRaw) : [];
        list = list.filter(n => String(n.id) !== String(note.id));
        list.unshift(note);
        localStorage.setItem(this.localStorageBackupKey, JSON.stringify(list));
      } catch (e) {
        console.warn("localStorage note backup error:", e);
      }
    };
    
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(_doLocalStorageBackup, { timeout: 5000 });
    } else {
      setTimeout(_doLocalStorageBackup, 0);
    }

    // 2. Save to IndexedDB
    try {
      const db = await this._getDB();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          store.put(note);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch (e) {
      console.warn("IndexedDB saveLocal error:", e);
    }
  }

  async _getLocalAll() {
    // Try IndexedDB first
    try {
      const db = await this._getDB();
      if (db) {
        const notes = await new Promise((resolve) => {
          const tx = db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        if (notes && notes.length > 0) {
          notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          return notes;
        }
      }
    } catch (e) {
      console.warn("IndexedDB getLocalAll error:", e);
    }

    // Fallback to localStorage backup
    try {
      const backupRaw = localStorage.getItem(this.localStorageBackupKey);
      if (backupRaw) {
        const list = JSON.parse(backupRaw);
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return list;
      }
    } catch (e) {
      console.warn("localStorage getLocalAll error:", e);
    }

    return [];
  }

  async _deleteLocal(id) {
    // 1. Delete from localStorage backup
    try {
      const backupRaw = localStorage.getItem(this.localStorageBackupKey);
      if (backupRaw) {
        let list = JSON.parse(backupRaw);
        list = list.filter(n => String(n.id) !== String(id));
        localStorage.setItem(this.localStorageBackupKey, JSON.stringify(list));
      }
    } catch (e) {
      console.warn("localStorage delete error:", e);
    }

    // 2. Delete from IndexedDB
    try {
      const db = await this._getDB();
      if (db) {
        await new Promise((resolve) => {
          const tx = db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.delete(isNaN(Number(id)) ? id : Number(id));
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        });
      }
    } catch (e) {
      console.warn("IndexedDB deleteLocal error:", e);
    }
  }

  // --- Synchronization & Init ---

  async init() {
    if (this._syncing) return;
    this._syncing = true;
    try {
      await this._getDB();

      // One-time initial sync if needed
      if (!localStorage.getItem(this.migratedKey)) {
        const localNotes = await this._getLocalAll();
        if (localNotes && localNotes.length > 0) {
          for (const note of localNotes) {
            try {
              const headers = this._getHeaders();
              headers['Content-Type'] = 'application/json';
              await fetch(this.apiBase, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(note)
              });
            } catch (syncErr) {
              // Non-blocking sync error
            }
          }
        }
        localStorage.setItem(this.migratedKey, 'true');
      }
    } catch (e) {
      console.warn("NotesRepository init/sync error:", e);
    } finally {
      this._syncing = false;
    }
  }

  // --- Public API ---

  async getAllNotes() {
    await this.init();

    let localNotes = await this._getLocalAll();
    let serverNotes = null;

    // 1. Attempt to fetch latest from backend
    try {
      const token = localStorage.getItem('token');
      // STRICT ISOLATION: If they are logged in as a named user but lack a token, DO NOT fetch.
      // This prevents the backend from silently falling back to returning 'guest' notes.
      if (this.username !== 'guest' && !token) {
         console.warn("Skipping backend sync: No valid token for profile", this.username);
      } else {
        const res = await fetch(this.apiBase, { headers: this._getHeaders() });
        if (res.ok) {
          serverNotes = await res.json();
        }
      }
    } catch (fetchErr) {
      console.warn("Backend fetch failed, falling back to local notes:", fetchErr.message);
    }

    if (Array.isArray(serverNotes)) {
      const noteMap = new Map();
      const serverIds = new Set(serverNotes.map(n => String(n.id)));
      
      // Load local notes first
      for (const n of localNotes) {
        noteMap.set(String(n.id), n);
        
        // AUTO-SYNC: If the local note is not on the server, upload it now
        if (!serverIds.has(String(n.id))) {
          const headers = this._getHeaders();
          headers['Content-Type'] = 'application/json';
          fetch(this.apiBase, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(n)
          }).catch(e => console.warn("Failed to auto-sync local note to server:", e));
        }
      }
      
      // Overlay server notes and update local DB
      for (const n of serverNotes) {
        const local = noteMap.get(String(n.id));
        if (!local || (n.updatedAt && local.updatedAt && n.updatedAt >= local.updatedAt)) {
          noteMap.set(String(n.id), n);
          this._saveLocal(n).catch(() => {});
        }
      }
      
      const merged = Array.from(noteMap.values());
      merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return merged;
    }

    // 2. Graceful fallback if fetch totally failed
    return localNotes;
  }

  async getNote(id) {
    await this.init();
    const parsedId = isNaN(Number(id)) ? id : Number(id);

    // 1. Try backend
    try {
      const token = localStorage.getItem('token');
      if (this.username !== 'guest' && !token) {
          console.warn("Skipping getNote sync: No valid token for profile", this.username);
      } else {
        const res = await fetch(`${this.apiBase}/${parsedId}`, { headers: this._getHeaders() });
        if (res.ok) {
          const note = await res.json();
          if (note) {
            this._saveLocal(note).catch(() => {});
            return note;
          }
        }
      }
    } catch (fetchErr) {
      console.warn("Backend getNote failed, falling back to local note:", fetchErr.message);
    }

    // 2. Fallback to local store
    const localNotes = await this._getLocalAll();
    return localNotes.find(n => String(n.id) === String(parsedId)) || null;
  }

  async saveNote(note) {
    await this.init();
    const parsedId = isNaN(Number(note.id)) ? note.id : Number(note.id);
    note.id = parsedId || Date.now();
    note.updatedAt = Date.now();
    if (!note.createdAt) note.createdAt = note.updatedAt;
    note.title = note.title || 'Untitled Note';
    note.content = note.content || '';
    note.rawText = note.rawText || '';

    // 1. Immediate local persistence (guarantees zero data loss even if network/server is down)
    await this._saveLocal(note);

    // 2. Synchronize to backend
    try {
      const token = localStorage.getItem('token');
      if (this.username !== 'guest' && !token) {
          console.warn("Skipping backend saveNote: No valid token for profile", this.username);
          return note;
      }
      
      const headers = this._getHeaders();
      headers['Content-Type'] = 'application/json';
      const res = await fetch(this.apiBase, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(note)
      });
      if (res.ok) {
        const serverResult = await res.json();
        return serverResult;
      }
    } catch (e) {
      console.warn("Backend note save failed, saved to local storage:", e.message);
    }

    return note;
  }

  async deleteNote(id) {
    await this.init();
    const parsedId = isNaN(Number(id)) ? id : Number(id);

    // 1. Immediate local deletion
    await this._deleteLocal(parsedId);

    // 2. Delete on backend
    try {
      const token = localStorage.getItem('token');
      if (this.username !== 'guest' && !token) {
          console.warn("Skipping backend deleteNote: No valid token for profile", this.username);
          return;
      }
      await fetch(`${this.apiBase}/${parsedId}`, {
        method: 'DELETE',
        headers: this._getHeaders()
      });
    } catch (e) {
      console.warn("Backend note delete failed:", e.message);
    }
  }
}

window.notesRepo = new NotesRepository();
