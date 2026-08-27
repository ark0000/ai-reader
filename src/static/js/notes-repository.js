/**
 * Repository for managing Global Notes via backend SQLite storage.
 * Includes a one-time migration from the legacy IndexedDB.
 */
class NotesRepository {
  constructor() {
    this.apiBase = '/api/notes/global';
    this.migratedKey = 'global_notes_migrated_v2';
  }

  _getHeaders() {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async init() {
    if (this._initializing) return;
    if (localStorage.getItem(this.migratedKey)) return;
    
    this._initializing = true;
    // Perform one-time migration from IndexedDB
    try {
      const legacyDB = await this._openLegacyDB();
      if (!legacyDB) return;
      
      const tx = legacyDB.transaction(['global_notes'], 'readonly');
      const store = tx.objectStore('global_notes');
      
      const allNotes = await new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      
      for (const note of allNotes) {
        await this.saveNote(note);
      }
      
      localStorage.setItem(this.migratedKey, 'true');
      console.log(`Migrated ${allNotes.length} global notes to backend storage.`);
    } catch (e) {
      console.warn("Failed to migrate legacy global notes:", e);
    } finally {
      this._initializing = false;
    }
  }

  async _openLegacyDB() {
    return new Promise((resolve) => {
      const req = indexedDB.open('NotesDB', 1);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('global_notes')) {
          resolve(db);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => resolve(null);
    });
  }

  async getAllNotes() {
    await this.init();
    try {
      const res = await fetch(this.apiBase, { headers: this._getHeaders() });
      if (!res.ok) throw new Error("Failed to fetch notes");
      const notes = await res.json();
      return notes;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async getNote(id) {
    await this.init();
    try {
      const res = await fetch(`${this.apiBase}/${id}`, { headers: this._getHeaders() });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async saveNote(note) {
    await this.init();
    const parsedId = isNaN(Number(note.id)) ? note.id : Number(note.id);
    note.id = parsedId;
    note.updatedAt = Date.now();
    if (!note.createdAt) note.createdAt = note.updatedAt;
    
    try {
      const headers = this._getHeaders();
      headers['Content-Type'] = 'application/json';
      const res = await fetch(this.apiBase, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(note)
      });
      if (!res.ok) throw new Error("Failed to save note");
      return await res.json();
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async deleteNote(id) {
    await this.init();
    const parsedId = isNaN(Number(id)) ? id : Number(id);
    try {
      const res = await fetch(`${this.apiBase}/${parsedId}`, {
        method: 'DELETE',
        headers: this._getHeaders()
      });
      if (!res.ok) throw new Error("Failed to delete note");
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}

window.notesRepo = new NotesRepository();
