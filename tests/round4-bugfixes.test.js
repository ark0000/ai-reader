/**
 * Round 4 Bug Fixes — Test Suite
 * Covers the final 3 deep-analysis bug fixes from the last hour:
 * 1. SidebarStrategy string-injection / XSS vulnerabilities (escaping apostrophes).
 * 2. NotesRepository QuotaExceededError prevention (500kb limit).
 * 3. NotesRepository emergency garbage collection fallback.
 */

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────────────
// SECTION 1: SidebarStrategy — String Injection / XSS
// ──────────────────────────────────────────────────────────────────────────

describe('SidebarStrategy — String Injection Fix', () => {
  let BookSidebarRenderer;

  beforeEach(() => {
    document.body.innerHTML = `<div id="external-notes-list"></div>`;
    global.currentExternalNoteId = 42;
    window.currentNotesTab = 'text';

    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes/SidebarStrategy.js'), 'utf8'
    );
    eval(code);
    BookSidebarRenderer = window.BookSidebarRenderer;
  });

  test('Escapes single quotes in Book ID to prevent onclick syntax crash', () => {
    const strategy = new BookSidebarRenderer({ 
        build: () => {
            const books = new Map();
            books.set("Arun's Book", { 
                id: "Arun's Book", 
                title: "Arun's Book", 
                chapters: [], 
                isOrphan: false 
            });
            return { books, standaloneNotes: [] };
        } 
    });
    const listEl = document.getElementById('external-notes-list');

    strategy.render([], listEl);

    const header = listEl.querySelector('.sidebar-book-item');
    expect(header).not.toBeNull();
    
    // Check if the onClick handler contains the properly escaped string: 'Arun\'s Book'
    const buttons = header.querySelectorAll('button');
    let foundEscaped = false;
    buttons.forEach(btn => {
        if (btn.getAttribute('onclick').includes("downloadBook('Arun\\'s Book')")) {
            foundEscaped = true;
        }
    });
    
    expect(foundEscaped).toBe(true);
  });

  test('Escapes single quotes in Note ID', () => {
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');
    const note = { id: "Note's ID", title: 'Test Note', updatedAt: Date.now() };

    strategy._renderSingleNote(note, listEl, false);

    const item = listEl.querySelector('.sidebar-note-item');
    const buttons = item.querySelectorAll('button');
    let foundEscaped = false;
    buttons.forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("readNoteInReader('Note\\'s ID')")) {
            foundEscaped = true;
        }
    });
    
    expect(foundEscaped).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SECTION 2: NotesRepository — localStorage Quota Prevention
// ──────────────────────────────────────────────────────────────────────────

describe('NotesRepository — localStorage Quota Guards', () => {
  let NotesRepoClass;

  beforeEach(() => {
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, val) => { 
            // Mock QuotaExceededError if string is over a certain mock size
            if (val.length > 1000000) throw new Error("QuotaExceededError");
            store[key] = val; 
        }),
        removeItem: jest.fn(key => { delete store[key]; }),
      },
      writable: true
    });
    
    global.indexedDB = undefined;
    global.requestIdleCallback = (fn) => fn(); // synchronous execution for tests

    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes-repository.js'), 'utf8'
    );
    eval(code);
    NotesRepoClass = window.notesRepo.constructor;
  });

  test('Rejects massive notes (>500kb) from localStorage fallback', async () => {
    const repo = new NotesRepoClass();
    const largeContent = 'A'.repeat(600000); // 600kb
    
    const note = { id: 1, title: 'Large', content: largeContent };
    
    await repo._saveLocal(note);
    
    const stored = window.localStorage.getItem(repo.localStorageBackupKey);
    // Because it's > 500k, it should bypass localStorage and remain empty (null or '[]')
    expect(stored === null || stored === '[]').toBe(true); 
  });

  test('Accepts normal notes into localStorage', async () => {
    const repo = new NotesRepoClass();
    const note = { id: 2, title: 'Small', content: 'Hello World' };
    
    await repo._saveLocal(note);
    
    const stored = window.localStorage.getItem(repo.localStorageBackupKey);
    const parsed = JSON.parse(stored);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe(2);
  });

  test('Emergency garbage collection on QuotaExceededError', async () => {
    const repo = new NotesRepoClass();
    
    // Seed localStorage with 20 dummy notes
    let list = [];
    for(let i = 0; i < 20; i++) {
        list.push({ id: 100+i, content: 'B'.repeat(1000) });
    }
    window.localStorage.setItem(repo.localStorageBackupKey, JSON.stringify(list));
    
    // Re-mock localstorage with 15kb quota limit (enough for 10 sliced notes, but not 20)
    const mockStore = { [repo.localStorageBackupKey]: JSON.stringify(list) };
    window.localStorage.setItem = jest.fn((key, val) => {
        if (val.length > 15000) throw new Error("QuotaExceededError");
        mockStore[key] = val;
    });
    window.localStorage.getItem = jest.fn((key) => mockStore[key]);
    
    const note = { id: 999, content: 'A'.repeat(1000) };
    await repo._saveLocal(note);
    
    // The quota exception will trigger the emergency `list.slice(0, 10)`
    const finalStored = JSON.parse(mockStore[repo.localStorageBackupKey]);
    
    // Should contain the new note + 9 old notes = 10 notes max!
    expect(finalStored.length).toBe(10);
    expect(finalStored[0].id).toBe(999); // Ensure the newly saved note survived!
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SECTION 3: Embedded Canvas TDZ & Editor Mode Safety
// ──────────────────────────────────────────────────────────────────────────

describe('SidebarStrategy & EditorMode — Edge-case Bug Fixes', () => {
  test('Renders note with embedded stylus canvases without TDZ ReferenceError', () => {
    document.body.innerHTML = `<div id="external-notes-list"></div>`;
    window.currentNotesTab = 'text';

    const code = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes/SidebarStrategy.js'), 'utf8'
    );
    eval(code);
    const BookSidebarRenderer = window.BookSidebarRenderer;
    const strategy = new BookSidebarRenderer({ build: () => ({ books: new Map(), standaloneNotes: [] }) });
    const listEl = document.getElementById('external-notes-list');

    const noteWithCanvas = {
      id: "note_with_canvases",
      title: 'Canvas Note',
      updatedAt: Date.now(),
      html: '<p>Text</p><div class="ql-stylus-canvas" data-id="canvas_123"></div>'
    };

    expect(() => {
      strategy._renderSingleNote(noteWithCanvas, listEl, false);
    }).not.toThrow();

    const btn = listEl.querySelector('.sidebar-note-item button');
    expect(btn).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SECTION 4: notes-tts — String Note ID & PDF Print Idempotency
// ──────────────────────────────────────────────────────────────────────────

describe('notes-tts.js — Safety & Race Condition Fixes', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="notes-list"></div>
      <div id="rte-modal" style="display:none;"></div>
    `;
    window.notes = [];
    window.pdfHighlights = [];

    const ttsCode = fs.readFileSync(
      path.resolve(__dirname, '../src/static/js/notes-tts.js'), 'utf8'
    );
    eval(ttsCode);
  });

  test('renderNotes quotes string note IDs to prevent evaluation errors', () => {
    window.notes = [
      { id: 'hl-2', txt: 'Highlight content', isHl: true, color: '#fde68a' },
      { id: 12345, txt: 'Numeric content', isHl: false }
    ];

    window.renderNotes();

    const buttons = document.querySelectorAll('.note-card button');
    expect(buttons.length).toBe(4);

    // First card buttons must have string argument 'hl-2'
    const editBtn1 = buttons[0].getAttribute('onclick');
    expect(editBtn1).toBe("editNote('hl-2')");

    const deleteBtn1 = buttons[1].getAttribute('onclick');
    expect(deleteBtn1).toBe("deleteNote('hl-2')");

    // Second card buttons must have numeric argument 12345
    const editBtn2 = buttons[2].getAttribute('onclick');
    expect(editBtn2).toBe("editNote(12345)");
  });

  test('exportNotes pdf handles late-loading images idempotently without double-print or throw', () => {
    jest.useFakeTimers();

    window.notes = [
      { id: 1, txt: 'Note with image', isHl: false, q: '<img src="test.jpg">' }
    ];

    let printCallCount = 0;
    const fakeDoc = {
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn(),
      getElementsByTagName: jest.fn(() => [{
        complete: false,
        onload: null,
        onerror: null
      }])
    };

    const originalAppendChild = document.body.appendChild.bind(document.body);
    jest.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el && el.tagName === 'IFRAME') {
        Object.defineProperty(el, 'contentWindow', {
          value: {
            document: fakeDoc,
            focus: jest.fn(),
            print: jest.fn(() => { printCallCount++; })
          },
          configurable: true
        });
      }
      return originalAppendChild(el);
    });

    window.exportNotes('pdf');

    // Trigger fallback timer (3000ms) + 50ms buffer
    jest.advanceTimersByTime(3100);
    expect(printCallCount).toBe(1);

    // Simulate image finishing after fallback timer
    const img = fakeDoc.getElementsByTagName()[0];
    if (img.onload) {
      expect(() => {
        img.onload();
        jest.advanceTimersByTime(200);
      }).not.toThrow();
    }

    // print should still have been called exactly once (idempotent)
    expect(printCallCount).toBe(1);

    jest.useRealTimers();
    document.body.appendChild.mockRestore();
  });
});


