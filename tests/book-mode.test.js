const fs = require('fs');
const vm = require('vm');

// Mock window
const sandbox = { window: {} };
vm.createContext(sandbox);
const code = fs.readFileSync('src/static/js/notes/BookNodeAdapter.js', 'utf8');
vm.runInContext(code, sandbox);
const BookNodeAdapter = sandbox.window.BookNodeAdapter;

describe('BookNodeAdapter', () => {
    let adapter;
    
    beforeEach(() => {
        adapter = new BookNodeAdapter();
    });

    test('Flat list of notes without book titles returns standalone notes', () => {
        const flatNotes = [
            { id: 1, title: 'Note 1' },
            { id: 2, title: 'Note 2' }
        ];
        
        const res = adapter.build(flatNotes);
        expect(res.standaloneNotes.length).toBe(2);
        expect(res.books.size).toBe(0);
    });

    test('Book notes are grouped correctly', () => {
        const flatNotes = [
            { id: 1, title: 'Note 1' },
            { id: 2, title: '[book:123] My Book' },
            { id: 3, title: '[book:123][ch:1] Chapter 1' },
            { id: 4, title: '[book:123][ch:2] Chapter 2' }
        ];
        
        const res = adapter.build(flatNotes);
        expect(res.standaloneNotes.length).toBe(1);
        expect(res.standaloneNotes[0].title).toBe('Note 1');
        
        expect(res.books.size).toBe(1);
        const book = res.books.get('123');
        expect(book.title).toBe('My Book');
        expect(book.chapters.length).toBe(2);
        
        expect(book.chapters[0].order).toBe(1);
        expect(book.chapters[0].title).toBe('Chapter 1');
    });

    test('Orphaned chapters are shown independently', () => {
        const flatNotes = [
            { id: 1, title: '[book:999][ch:1] Orphaned Chapter' }
        ];
        
        const res = adapter.build(flatNotes);
        expect(res.standaloneNotes.length).toBe(0);
        expect(res.books.size).toBe(1);
        
        const book = res.books.get('999');
        expect(book.title).toBe('Unknown Book (999)');
        expect(book.chapters.length).toBe(1);
        expect(book.chapters[0].title).toBe('Orphaned Chapter');
    });

    test('O(N) grouping: 1000 chapters build efficiently', () => {
        const flatNotes = [{ id: 1, title: '[book:123] Huge Book' }];
        for (let i = 1; i <= 1000; i++) {
            flatNotes.push({ id: i + 1, title: `[book:123][ch:${i}] Chapter ${i}` });
        }
        
        const start = performance.now();
        const res = adapter.build(flatNotes);
        const end = performance.now();
        
        expect(res.books.size).toBe(1);
        expect(res.books.get('123').chapters.length).toBe(1000);
        expect(end - start).toBeLessThan(50); // Should be very fast
    });
});
