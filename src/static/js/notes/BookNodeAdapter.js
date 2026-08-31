class BookNodeAdapter {
  static BOOK_RE = /^\[book:([^\]]+)\](?:\[ch:(\d+)\]\s*)?(.*)$/;
  
  build(flatNotes) {
    const books = new Map();
    const standaloneNotes = [];
    
    for (const note of flatNotes) {
      const m = BookNodeAdapter.BOOK_RE.exec(note.title);
      if (!m) { 
        standaloneNotes.push(note); 
        continue; 
      }
      
      const [, bookId, chIdx, cleanTitle] = m;
      const title = cleanTitle.trim();
      
      // If it has no chapter index, it's the root book note
      if (!chIdx) { 
        if (books.has(bookId)) {
          // If we already saw chapters for this book, merge
          const existingChapters = books.get(bookId).chapters;
          books.set(bookId, { ...note, title: title, chapters: existingChapters });
        } else {
          books.set(bookId, { ...note, title: title, chapters: [] });
        }
      } else {
        if (!books.has(bookId)) {
          // Orphan chapter, create a dummy root
          books.set(bookId, { id: bookId, title: `Unknown Book (${bookId})`, chapters: [], isOrphan: true });
        }
        books.get(bookId).chapters.push({ ...note, title: title, order: parseInt(chIdx, 10) });
      }
    }
    
    // Sort chapters within books
    for (const b of books.values()) {
      b.chapters.sort((a,b) => a.order - b.order);
    }
    
    return { standaloneNotes, books };
  }
}

window.BookNodeAdapter = BookNodeAdapter;
