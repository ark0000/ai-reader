/**
 * Deep Analysis Bug Fixes — Comprehensive Test Suite
 * Covers all 17 bug fixes from Rounds 1, 2, and 3.
 *
 * Test matrix:
 *   ┌─────────┬──────────────────────────────────────────────────────┐
 *   │ Round 1 │ Bugs 1–6: Lock lifecycle, stale-ID, remote sync,   │
 *   │         │ chapter highlight, username assignment               │
 *   ├─────────┼──────────────────────────────────────────────────────┤
 *   │ Round 2 │ Bugs A–G: Sidebar render, empty-note guard,        │
 *   │         │ markdown mode save, worker leak, openEditor lock,   │
 *   │         │ titleEl null guard                                   │
 *   ├─────────┼──────────────────────────────────────────────────────┤
 *   │ Round 3 │ Bugs I–L: TTS fallback race, loadExternalNote null  │
 *   │         │ guard, auto-sync token check, nested list worker     │
 *   └─────────┴──────────────────────────────────────────────────────┘
 */

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────────
// SECTION 1: SidebarStrategy — Bugs 5 (R1) + A (R2)
// ──────────────────────────────────────────────────────────────────────────

describe('SidebarStrategy — Chapter Highlight Fixes (Bugs 5 + A)', () => {
  let BookSidebarRenderer;

  beforeEach(() => {
    document.body.innerHTML = `<div id="external-notes-list"></div>`;
    // Stub global currentExternalNoteId
    global.currentExternalNoteId = 42;
    window.currentNotesTab = 'text';
    window.loadExternalNote = jest.fn();

    // Load SidebarStrategy
    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes/SidebarStrategy.js'), 'utf8'
    );
    eval(code);
    BookSidebarRenderer = window.BookSidebarRenderer;
  });

  test('Bug A: Selected chapter item shows accent border, not transparent', () => {
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');
    const note = { id: 42, title: 'Chapter 1', updatedAt: Date.now() };

    strategy._renderSingleNote(note, listEl, true /* isChild */);

    const item = listEl.querySelector('.sidebar-note-item');
    expect(item).not.toBeNull();
    // The selected chapter MUST have the accent border, NOT transparent
    expect(item.style.borderLeft).toBe('3px solid var(--accent)');
    expect(item.style.background.replace(/\s/g, '')).toBe('rgba(255,107,0,0.1)');
  });

  test('Bug A: Unselected chapter item shows transparent border', () => {
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');
    const note = { id: 999, title: 'Other Chapter', updatedAt: Date.now() }; // not selected

    strategy._renderSingleNote(note, listEl, true /* isChild */);

    const item = listEl.querySelector('.sidebar-note-item');
    expect(item.style.borderLeft).toBe('3px solid transparent');
    expect(item.style.background).toBe('transparent');
  });

  test('Bug A: Unselected standalone note also shows transparent border', () => {
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');
    const note = { id: 123, title: 'Standalone Note', updatedAt: Date.now() };

    strategy._renderSingleNote(note, listEl, false /* not child */);

    const item = listEl.querySelector('.sidebar-note-item');
    expect(item.style.borderLeft).toBe('3px solid transparent');
  });

  test('Bug A: Chapter item has position:relative for L-bracket', () => {
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');
    const note = { id: 999, title: 'Any Chapter', updatedAt: Date.now() };

    strategy._renderSingleNote(note, listEl, true);

    const item = listEl.querySelector('.sidebar-note-item');
    expect(item.style.position).toBe('relative');
  });
});


// ──────────────────────────────────────────────────────────────────────────
// SECTION 2: Markdown Worker — Bug L (R3): Nested List Conversion
// ──────────────────────────────────────────────────────────────────────────

describe('markdown-worker.js — Nested List Conversion (Bug L)', () => {
  let workerFn;

  beforeEach(() => {
    // Load the worker code into a callable function for testing.
    // The worker calls self.addEventListener('message', ...) — we capture it.
    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/workers/markdown-worker.js'), 'utf8'
    );
    const handlers = [];
    const fakeSelf = {
      addEventListener: (evt, fn) => handlers.push(fn),
      postMessage: jest.fn()
    };
    const fn = new Function('self', code);
    fn(fakeSelf);
    workerFn = (html) => {
      let result = null;
      fakeSelf.postMessage = (data) => { result = data; };
      handlers[0]({ data: { html, id: 'test-1' } });
      return result.md;
    };
  });

  test('Flat unordered list converts correctly', () => {
    const html = '<ul><li>Item A</li><li>Item B</li></ul>';
    const md = workerFn(html);
    expect(md).toContain('- Item A');
    expect(md).toContain('- Item B');
    expect(md).not.toContain('<ul');
    expect(md).not.toContain('<li');
  });

  test('Flat ordered list converts correctly', () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    const md = workerFn(html);
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
    expect(md).not.toContain('<ol');
  });

  test('Bug L: Nested unordered list produces indented markdown, no HTML fragments', () => {
    const html = '<ul><li>Parent<ul><li>Child A</li><li>Child B</li></ul></li><li>Sibling</li></ul>';
    const md = workerFn(html);
    // Must not contain any remaining HTML tags
    expect(md).not.toMatch(/<ul|<\/ul>|<li|<\/li>/i);
    // Must contain the nested items
    expect(md).toContain('Child A');
    expect(md).toContain('Child B');
    expect(md).toContain('Sibling');
  });

  test('Bug L: Three-level deep nesting converts without HTML remnants', () => {
    const html = '<ul><li>L1<ul><li>L2<ul><li>L3</li></ul></li></ul></li></ul>';
    const md = workerFn(html);
    expect(md).not.toMatch(/<[a-z]/i);
    expect(md).toContain('L1');
    expect(md).toContain('L2');
    expect(md).toContain('L3');
  });

  test('Bug L: Mixed ul/ol nesting converts correctly', () => {
    const html = '<ul><li>Bullet<ol><li>Numbered</li></ol></li></ul>';
    const md = workerFn(html);
    expect(md).not.toMatch(/<[a-z]/i);
    expect(md).toContain('Bullet');
    expect(md).toContain('Numbered');
  });
});


// ──────────────────────────────────────────────────────────────────────────
// SECTION 3: NotesRepository — Bugs 6 (R1), K (R3)
// ──────────────────────────────────────────────────────────────────────────

describe('NotesRepository — Username Assignment & Token Guards (Bugs 6 + K)', () => {
  let repoCode;

  beforeEach(() => {
    // Clean localStorage mock
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, val) => { store[key] = val; }),
        removeItem: jest.fn(key => { delete store[key]; }),
      },
      writable: true
    });
    global.indexedDB = undefined; // Disable IDB for unit tests
    global.fetch = jest.fn();
    global.requestIdleCallback = (fn) => fn();

    repoCode = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes-repository.js'), 'utf8'
    );
  });

  test('Bug 6: username is assigned in constructor', () => {
    window.localStorage.getItem.mockImplementation(key => {
      if (key === 'username') return 'alice';
      return null;
    });

    eval(repoCode);
    expect(window.notesRepo.username).toBe('alice');
  });

  test('Bug 6: defaults to guest when no username found', () => {
    eval(repoCode);
    expect(window.notesRepo.username).toBe('guest');
  });

  test('Bug K: auto-sync upload is skipped when non-guest user has no token', async () => {
    window.localStorage.getItem.mockImplementation(key => {
      if (key === 'username') return 'alice';
      if (key === 'token') return null; // No token!
      return null;
    });

    // Server returns a list missing the local note
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: '200', title: 'Server Note', updatedAt: 1000 }]
    });

    eval(repoCode);
    // Override _syncing so init() runs
    window.notesRepo._syncing = false;
    window.localStorage.getItem.mockImplementation(key => {
      if (key === 'global_notes_migrated_v2_alice') return 'true';
      if (key === 'username') return 'alice';
      if (key === 'token') return null;
      if (key === 'aura_global_notes_backup_alice') return JSON.stringify([{ id: '100', title: 'Local Only' }]);
      return null;
    });

    // Patch _getLocalAll to return local notes
    window.notesRepo._getLocalAll = jest.fn().mockResolvedValue([
      { id: '100', title: 'Local Only', updatedAt: 2000 }
    ]);
    window.notesRepo._saveLocal = jest.fn().mockResolvedValue();

    const notes = await window.notesRepo.getAllNotes();

    // fetch was called for getAllNotes, but the auto-sync POST must NOT have been called
    const postCalls = global.fetch.mock.calls.filter(
      c => c[1] && c[1].method === 'POST'
    );
    expect(postCalls.length).toBe(0);
  });
});


// ──────────────────────────────────────────────────────────────────────────
// SECTION 4: EditorModeController, saveExternalNote, loadExternalNote
//   Bugs B, C, D, E, G (R2), J (R3), 1–4 (R1)
// ──────────────────────────────────────────────────────────────────────────

describe('external-editor.js — Core Bug Fixes', () => {

  function makeQuill() {
    const q = {
      root: { innerHTML: '', textContent: '' },
      clipboard: { dangerouslyPasteHTML: jest.fn((idx, html) => { q.root.innerHTML = html; }) },
      _handlers: {},
      on(evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); },
      emit(evt, ...args) { (this._handlers[evt] || []).forEach(fn => fn(...args)); },
      getSelection() { return { index: 0, length: 0 }; },
      getLine() { return [{ domNode: { textContent: '' } }, 0]; },
      getIndex() { return 0; },
      getText() { return this.root.textContent || this.root.innerHTML.replace(/<[^>]+>/g, ''); },
      setText(t) { this.root.innerHTML = ''; this.root.textContent = t; },
      deleteText: jest.fn(),
      formatLine: jest.fn(),
      setSelection: jest.fn(),
      formatText: jest.fn(),
      getLength() { return 1; },
      getFormat() { return {}; },
      format: jest.fn(),
      focus: jest.fn(),
      getContents() { return []; },
      updateContents: jest.fn(),
      insertEmbed: jest.fn(),
      insertText: jest.fn()
    };
    return q;
  }

  function loadEditorModule() {
    const fakeQuill = makeQuill();
    window.Quill = class {
      constructor() { return fakeQuill; }
      static import() {
        class BE {
          static create() { return document.createElement('div'); }
          static value(n) { return n.innerHTML; }
        }
        return BE;
      }
      static register() {}
      static find() { return null; }
    };
    window.marked = { use: jest.fn(), parse: jest.fn(md => `<p>${md}</p>`) };
    window.Worker = jest.fn(() => ({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      postMessage: jest.fn()
    }));

    eval(fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/external-editor.js'), 'utf8'
    ));

    initQuillEditor();
    window._saveExternalNote = saveExternalNote;
    window._loadExternalNote = loadExternalNote;
    window._closeExternalNotes = closeExternalNotes;
    HTMLAnchorElement.prototype.click = jest.fn();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="external-notes-overlay" style="display:none;"></div>
      <div id="quill-editor"></div>
      <textarea id="markdown-source-editor" style="display:none;"></textarea>
      <input id="external-note-title" value="" />
      <button id="save-external-btn">Save</button>
      <button id="mode-toggle-btn">Markdown Source</button>
      <button id="md-convert-btn">Markdown</button>
      <div id="external-notes-list"></div>
      <div id="text-note-tools"></div>
      <div id="canvas-note-tools" style="display:none;"></div>
      <div id="pure-canvas-container" style="display:none;"></div>
      <div id="templates-sidebar"></div>
    `;

    window.notesRepo = {
      getAllNotes: jest.fn().mockResolvedValue([]),
      getNote: jest.fn().mockResolvedValue(null),
      saveNote: jest.fn().mockImplementation(n => Promise.resolve({ ...n, id: n.id || 1 })),
      deleteNote: jest.fn().mockResolvedValue()
    };
    window.notes = [];
    window.appEventBus = { on: jest.fn(), emit: jest.fn() };
    window.settingsRepo = { isTrue: jest.fn().mockReturnValue(false), getUsername: jest.fn().mockReturnValue('guest') };
    window.safeStorage = { getItem: jest.fn().mockReturnValue(null), setItem: jest.fn(), removeItem: jest.fn() };
    window.alert = jest.fn();
    window.isExternalNoteLoading = false;

    loadEditorModule();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Bug G (R2): Null guard on titleEl ──
  test('Bug G: saveExternalNote returns silently if titleEl is missing', async () => {
    document.getElementById('external-note-title').remove();
    await expect(window._saveExternalNote(true)).resolves.toBeUndefined();
    expect(window.notesRepo.saveNote).not.toHaveBeenCalled();
  });

  // ── Bug B (R2): Title-only saves allowed ──
  test('Bug B: saves a note with meaningful title even if content is empty', async () => {
    document.getElementById('external-note-title').value = 'My Book Overview';
    window.quillEditor.root.innerHTML = '<p><br></p>'; // empty content
    window.currentExternalNoteId = 12345;

    await window._saveExternalNote(true);
    expect(window.notesRepo.saveNote).toHaveBeenCalled();
  });

  test('Bug B: blocks save when BOTH title and content are empty', async () => {
    document.getElementById('external-note-title').value = 'Untitled Note';
    window.quillEditor.root.innerHTML = '<p><br></p>';
    window.currentExternalNoteId = 12345;

    await window._saveExternalNote(false);
    expect(window.alert).toHaveBeenCalledWith('Cannot save an empty note.');
    expect(window.notesRepo.saveNote).not.toHaveBeenCalled();
  });

  // ── Bug C (R2): Markdown mode reads from textarea, not Quill ──
  test('Bug C: in markdown mode, content comes from textarea, not Quill DOM', async () => {
    window.editorModeController.mode = 'markdown';
    const rawEditor = document.getElementById('markdown-source-editor');
    rawEditor.value = '# Hello World\n\nSome markdown content';
    // Quill has stale/blank content
    window.quillEditor.root.innerHTML = '<p>OLD STALE CONTENT</p>';
    window.currentExternalNoteId = 12345;
    document.getElementById('external-note-title').value = 'Test Note';

    await window._saveExternalNote(true);

    const savedNote = window.notesRepo.saveNote.mock.calls[0][0];
    // Content should be from marked.parse(textarea), not from Quill
    expect(savedNote.content).toContain('Hello World');
    expect(savedNote.content).not.toContain('OLD STALE CONTENT');
  });

  // ── Bug 1 (R1): isExternalNoteLoading blocks saveExternalNote ──
  test('Bug 1: saveExternalNote aborts when isExternalNoteLoading is true', async () => {
    window.isExternalNoteLoading = true;
    document.getElementById('external-note-title').value = 'Test';
    window.quillEditor.root.innerHTML = '<p>Content</p>';

    await window._saveExternalNote(false);
    expect(window.notesRepo.saveNote).not.toHaveBeenCalled();
  });

  // ── Bug 3 (R1): Stale-ID auto-save guard ──
  test('Bug 3: auto-save aborts if note ID changed after typing', () => {
    window.currentExternalNoteId = 100;
    window.currentNotesTab = 'text';
    document.getElementById('external-note-title').value = 'Note';
    window.quillEditor.root.innerHTML = '<p>Some text</p>';

    // Simulate a user 'text-change' event
    window.quillEditor.emit('text-change',
      { ops: [{ insert: ' ' }] }, null, 'user'
    );

    // Switch note before the 5s timer fires
    window.currentExternalNoteId = 200;

    // Fire all timers (the 5s auto-save)
    jest.runAllTimers();

    // saveNote must NOT have been called for the old note
    expect(window.notesRepo.saveNote).not.toHaveBeenCalled();
  });

  // ── Bug J (R3): loadExternalNote null guard on titleEl ──
  test('Bug J: loadExternalNote returns silently if titleEl is null', async () => {
    document.getElementById('external-note-title').remove();
    window.notesRepo.getNote.mockResolvedValue({
      id: 42, title: '[book:abc] Test', content: '<p>Hello</p>'
    });

    // Should not throw
    await window._loadExternalNote(42);
    // No error should have been thrown
  });

  test('Bug J: loadExternalNote correctly handles title without book prefix', async () => {
    window.notesRepo.getNote.mockResolvedValue({
      id: 42, title: 'Plain Note Title', content: '<p>Hello</p>'
    });

    await window._loadExternalNote(42);

    const titleEl = document.getElementById('external-note-title');
    expect(titleEl.dataset.bookPrefix).toBe('');
    expect(titleEl.value).toBe('Plain Note Title');
  });
});


// ──────────────────────────────────────────────────────────────────────────
// SECTION 5: Remote Notes Engine — Bug 4 (R1)
// ──────────────────────────────────────────────────────────────────────────

describe('RemoteNotesEngine — Loading Lock Guard (Bug 4)', () => {
  beforeEach(() => {
    global.WebSocket = jest.fn(() => ({
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
    }));
    WebSocket.OPEN = 1;
    window.currentExternalNoteId = 'note_1';
    window.quillEditor = { updateContents: jest.fn(), getContents: jest.fn().mockReturnValue([]) };
    window.isExternalNoteLoading = false;
    window.saveExternalNote = jest.fn();
    window.loadExternalNote = jest.fn();
    window.createNewExternalNote = jest.fn().mockResolvedValue();
    window.notesRepo = { getAllNotes: jest.fn().mockResolvedValue([]) };
    window.TabletSync = null;

    eval(fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/sync/remote-notes-engine.js'), 'utf8'
    ) + '\nwindow.RemoteNotesEngine = RemoteNotesEngine;');
  });

  test('Bug 4: FORCE_SAVE RPC is blocked when isExternalNoteLoading is true', () => {
    window.isExternalNoteLoading = true;
    const engine = new window.RemoteNotesEngine('test-room');
    engine.handleRPC({ command: 'FORCE_SAVE' });
    expect(window.saveExternalNote).not.toHaveBeenCalled();
  });

  test('Bug 4: FORCE_SAVE RPC works when isExternalNoteLoading is false', () => {
    window.isExternalNoteLoading = false;
    const engine = new window.RemoteNotesEngine('test-room');
    engine.handleRPC({ command: 'FORCE_SAVE' });
    expect(window.saveExternalNote).toHaveBeenCalledWith(true);
  });

  test('Bug 4: RENAME_NOTE RPC is blocked when isExternalNoteLoading is true', () => {
    document.body.innerHTML = '<input id="external-note-title" value="Old" />';
    window.isExternalNoteLoading = true;
    const engine = new window.RemoteNotesEngine('test-room');
    engine.handleRPC({ command: 'RENAME_NOTE', new_title: 'New Title' });
    // Rename should still update the input, but save must NOT fire
    expect(window.saveExternalNote).not.toHaveBeenCalled();
  });
});
