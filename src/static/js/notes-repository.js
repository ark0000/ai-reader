/**
 * Repository for managing Global Notes using IndexedDB.
 */
class NotesRepository {
  constructor() {
    this.dbName = 'NotesDB';
    this.storeName = 'global_notes';
    this.db = null;
  }

  async init() {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = (event) => reject(event.target.error);
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
  }

  async getAllNotes() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('updatedAt');
      const request = index.openCursor(null, 'prev'); // Sort descending by updatedAt
      
      const notes = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          notes.push(cursor.value);
          cursor.continue();
        } else {
          resolve(notes);
        }
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getNote(id) {
    await this.init();
    const numId = isNaN(Number(id)) ? id : Number(id);
    const strId = String(id);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(numId);
      request.onsuccess = (event) => {
        if (event.target.result) resolve(event.target.result);
        else {
          const req2 = store.get(strId);
          req2.onsuccess = (e) => resolve(e.target.result);
          req2.onerror = (e) => reject(e.target.error);
        }
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async saveNote(note) {
    await this.init();
    const parsedId = isNaN(Number(note.id)) ? note.id : Number(note.id);
    note.id = parsedId;
    note.updatedAt = Date.now();
    if (!note.createdAt) note.createdAt = note.updatedAt;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(note);
      request.onsuccess = () => resolve(note);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async deleteNote(id) {
    await this.init();
    const numId = isNaN(Number(id)) ? id : Number(id);
    const strId = String(id);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Attempt to delete both Number and String formats to handle legacy data
      try { store.delete(numId); } catch(e) { console.warn('numId delete failed', e); }
      try { store.delete(strId); } catch(e) { console.warn('strId delete failed', e); }
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) => reject(event.target.error);
    });
  }
}

window.notesRepo = new NotesRepository();
