const fs = require('fs');
const path = require('path');

// 1. Setup DOM environment
document.body.innerHTML = `
  <div id="external-notes-list"></div>
  <input id="external-note-title" value="" />
`;

global.prompt = () => "Test Title"; // Mock prompt
global.confirm = () => true; // Mock confirm
global.alert = () => {};

// 2. Load the modules we need to test
// We'll read the files and evaluate them in the global scope
const adapterCode = fs.readFileSync(path.join(__dirname, '../src/static/js/notes/BookNodeAdapter.js'), 'utf-8').replace(/export\s*\{[^}]+\};?/g, '');
// Evaluate BookNodeAdapter
eval(adapterCode);

// Mock notesRepo before loading external-editor
const mockNotesDB = new Map();
let nextId = 1;

global.window.notesRepo = {
  getAllNotes: async () => Array.from(mockNotesDB.values()).map(n => ({...n})),
  getNote: async (id) => mockNotesDB.get(id) ? {...mockNotesDB.get(id)} : null,
  saveNote: async (note) => {
    if (!note.id) note.id = nextId++;
    mockNotesDB.set(note.id, {...note});
    return note.id;
  },
  deleteNote: async (id) => {
    mockNotesDB.delete(id);
  }
};

// We'll extract only the deletion and creation logic we want to test to avoid massive dependencies like Quill
const editorCode = fs.readFileSync(path.join(__dirname, '../src/static/js/external-editor.js'), 'utf-8');
// Very naive extraction of functions for testing
window.currentExternalNoteId = null;
window.createNewExternalNote = async function() {
  console.log("createNewExternalNote was called!");
  const newNote = { title: "Untitled Note", content: "", timestamp: Date.now() };
  const id = await window.notesRepo.saveNote(newNote);
  console.log("Saved note with id", id);
  window.currentExternalNoteId = id;
};
global.createNewExternalNote = window.createNewExternalNote;

window.loadExternalNotesList = () => { console.log("loadExternalNotesList called"); };

// Extract createNewBook
const createNewBookMatch = editorCode.match(/window\.createNewBook = async function\s*\(\)\s*\{[\s\S]+?^\};/m);
if (createNewBookMatch) eval(createNewBookMatch[0]);

// Extract createNewChapter
const createNewChapterMatch = editorCode.match(/window\.createNewChapter = async function\s*\(\)\s*\{[\s\S]+?^\};/m);
if (createNewChapterMatch) eval(createNewChapterMatch[0]);

// Extract deleteExternalNote
const deleteExternalNoteMatch = editorCode.match(/async function deleteExternalNote\(id, isBookRoot = false\)\s*\{[\s\S]*?^\}/m);
if (deleteExternalNoteMatch) eval(deleteExternalNoteMatch[0]);

// 3. Test Runner
let passed = 0;
let failed = 0;

async function runTest(name, testFn) {
  try {
    // Reset DB state before each test
    mockNotesDB.clear();
    nextId = 1;
    global.currentExternalNoteId = null;
    
    await testFn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ FAIL: ${name}`);
    console.error(e);
    failed++;
  }
}

// ==========================
// TEST CASES (Jest)
// ==========================

describe("Book Architecture", () => {
  beforeEach(() => {
    mockNotesDB.clear();
    nextId = 1;
    window.currentExternalNoteId = null;
    document.getElementById('external-note-title').value = "";
  });

  // --- UNIT TESTS: BookNodeAdapter ---
  test("BookNodeAdapter: Parses standalone note", () => {
    const adapter = new window.BookNodeAdapter();
    const data = [{ id: 1, title: "Just a Note" }];
    const res = adapter.build(data);
    expect(res.standaloneNotes.length).toBe(1);
    expect(res.books.size).toBe(0);
  });

  test("BookNodeAdapter: Parses book and chapters", () => {
    const adapter = new window.BookNodeAdapter();
    const data = [
      { id: 1, title: "[book:b-123] My Book" },
      { id: 2, title: "[book:b-123][ch:1] Intro" },
      { id: 3, title: "[book:b-123][ch:2] Body" }
    ];
    const res = adapter.build(data);
    const book = res.books.get("b-123");
    expect(book).toBeDefined();
    expect(book.title).toBe("My Book");
    expect(book.chapters.length).toBe(2);
    expect(book.chapters[0].title).toBe("Intro");
  });

  test("BookNodeAdapter: Handles malformed deep nesting edge cases", () => {
    const adapter = new window.BookNodeAdapter();
    const data = [
      { id: 1, title: "[book:b-123][ch:1][ch:2] Broken" },
      { id: 2, title: "[book:b-999]" } // No title after tags
    ];
    const res = adapter.build(data);
    
    // Deep nesting should still just parse out the first book/ch tags
    expect(res.books.size).toBe(2);
    expect(res.books.get("b-123").chapters[0].title).toBe("[ch:2] Broken");
    expect(res.books.get("b-999").title).toBe("");
  });

  // --- INTEGRATION TESTS: Instant Save Bypass ---
  test("Creation Bypass: createNewBook saves immediately without empty check", async () => {
    await window.createNewBook();
    const allNotes = await window.notesRepo.getAllNotes();
    expect(allNotes.length).toBe(1);
    expect(allNotes[0].title).toMatch(/\[book:b-[0-9a-z-]+\]/);
  });

  test("Creation Bypass: createNewChapter saves immediately", async () => {
    mockNotesDB.set(1, { id: 1, title: "[book:b-abc] Test Book" });
    nextId = 2;
    window.currentExternalNoteId = 1;
    document.getElementById('external-note-title').value = "[book:b-abc] Test Book";
    
    await window.createNewChapter();
    const allNotes = await window.notesRepo.getAllNotes();
    expect(allNotes.length).toBe(2);
    const chapter = allNotes.find(n => n.title.includes("[ch:"));
    expect(chapter).toBeDefined();
  });

  // --- INTEGRATION TESTS: Book Deletion Fix ---
  test('Deletion Fix: Deleting a book correctly deletes chapters and root note', async () => {
    await window.notesRepo.saveNote({ id: 1, title: '[book:b-test1] My Book' });
    await window.notesRepo.saveNote({ id: 2, title: '[book:b-test1][ch:1] Chapter 1' });

    await deleteExternalNote('b-test1', true);
    
    const allNotes = await window.notesRepo.getAllNotes();
    expect(allNotes.find(n => n.id === 1)).toBeUndefined(); // root deleted
    
    const ch = allNotes.find(n => n.id === 2);
    expect(ch).toBeUndefined(); // chapter completely deleted
  });
  
  test("Deletion Edge Case: Multiple books don't interfere during deletion", async () => {
    // Add another book to ensure it isn't touched
    await window.notesRepo.saveNote({ id: 1, title: '[book:b-test1] Book 1' });
    await window.notesRepo.saveNote({ id: 2, title: '[book:b-test1][ch:1] Ch1 Book1' });
    await window.notesRepo.saveNote({ id: 3, title: '[book:b-test2] Book 2' });
    await window.notesRepo.saveNote({ id: 4, title: '[book:b-test2][ch:1] Ch1 Book2' });
    
    await deleteExternalNote('b-test1', true);
    
    const allNotes = await window.notesRepo.getAllNotes();
    expect(allNotes.find(n => n.id === 1)).toBeUndefined();
    expect(allNotes.find(n => n.id === 2)).toBeUndefined(); // completely deleted
    expect(allNotes.find(n => n.id === 3)).toBeDefined(); // Book 2 untouched
    expect(allNotes.find(n => n.id === 4)).toBeDefined(); // Book 2 chapters untouched
  });
});
