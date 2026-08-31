// 1. Create a mock DOM
document.body.innerHTML = `
  <div id="external-notes-list">
    <!-- Book 1 (Should match 'pop') -->
    <div class="sidebar-book-item" data-title="pop book" data-type="book" style="display: block;">
      <div class="book-toggle-icon"></div>
      <div class="sidebar-chapters-container" style="display: none;">
        <div class="sidebar-note-item" data-title="chapter 1" data-type="chapter" style="display: block;"></div>
      </div>
    </div>
    
    <!-- Book 2 (Should match 'project') -->
    <div class="sidebar-book-item" data-title="project book" data-type="book" style="display: block;">
      <div class="book-toggle-icon"></div>
      <div class="sidebar-chapters-container" style="display: none;">
        <div class="sidebar-note-item" data-title="converspine" data-type="chapter" style="display: block;"></div>
      </div>
    </div>
    
    <!-- Standalone Notes Header -->
    <div class="sidebar-standalone-header" style="display: block;"></div>
    
    <!-- Standalone Notes -->
    <div class="sidebar-note-item" data-title="untitled note" data-type="standalone" style="display: block;"></div>
    <div class="sidebar-note-item" data-title="pop" data-type="standalone" style="display: block;"></div>
  </div>
`;

// 2. Inject the function to test (from external-editor.js)
global.window.filterExternalNotes = function(query) {
  const listEl = document.getElementById('external-notes-list');
  if (!listEl) return;
  query = (query || '').toLowerCase().trim();
  
  if (!query) {
    const allBooks = listEl.querySelectorAll('.sidebar-book-item');
    const allChapters = listEl.querySelectorAll('.sidebar-note-item[data-type="chapter"]');
    const allStandalone = listEl.querySelectorAll('.sidebar-note-item[data-type="standalone"]');
    const allHeaders = listEl.querySelectorAll('.sidebar-standalone-header');
    allBooks.forEach(el => el.style.display = 'block');
    allChapters.forEach(el => el.style.display = 'block');
    allStandalone.forEach(el => el.style.display = 'block');
    allHeaders.forEach(el => el.style.display = 'block');
    return;
  }
  
  const standalones = listEl.querySelectorAll('.sidebar-note-item[data-type="standalone"]');
  let standaloneMatchCount = 0;
  standalones.forEach(el => {
    if ((el.dataset.title || '').includes(query)) {
      el.style.display = 'block';
      standaloneMatchCount++;
    } else {
      el.style.display = 'none';
    }
  });
  
  const standaloneHeader = listEl.querySelector('.sidebar-standalone-header');
  if (standaloneHeader) standaloneHeader.style.display = standaloneMatchCount > 0 ? 'block' : 'none';
  
  const books = listEl.querySelectorAll('.sidebar-book-item');
  books.forEach(bookEl => {
    const bookMatches = (bookEl.dataset.title || '').includes(query);
    const chapters = bookEl.querySelectorAll('.sidebar-note-item[data-type="chapter"]');
    let chapterMatchCount = 0;
    
    chapters.forEach(chapterEl => {
      if (bookMatches || (chapterEl.dataset.title || '').includes(query)) {
        chapterEl.style.display = 'block';
        chapterMatchCount++;
      } else {
        chapterEl.style.display = 'none';
      }
    });
    
    if (bookMatches || chapterMatchCount > 0) {
      bookEl.style.display = 'block';
      if (query && !bookMatches && chapterMatchCount > 0) {
        const chaptersContainer = bookEl.querySelector('.sidebar-chapters-container');
        const toggleIcon = bookEl.querySelector('.book-toggle-icon');
        if (chaptersContainer) chaptersContainer.style.display = 'block';
        if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
      }
    } else {
      bookEl.style.display = 'none';
    }
  });
};

global.window.performGlobalSearch = async function(query) {
  const dropdown = document.getElementById('notes-search-dropdown');
  const resultsContainer = document.getElementById('notes-search-results');
  const countEl = document.getElementById('notes-search-count');
  
  if (!query.trim()) {
    dropdown.style.display = 'none';
    return;
  }
  
  const allNotes = await global.window.notesRepo.getAllNotes();
  let matchCount = 0;
  resultsContainer.innerHTML = '';
  
  let flags = global.window.searchMatchCase ? 'g' : 'gi';
  let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regexPattern = global.window.searchWholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
  
  let regex = new RegExp(regexPattern, flags);
  
  for (const note of allNotes) {
    const textToSearch = (note.title || '') + '\n' + (note.content || '');
    const matches = [...textToSearch.matchAll(regex)];
    
    if (matches.length > 0) {
      matchCount += matches.length;
      
      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.dataset.noteId = note.id;
      resultsContainer.appendChild(el);
    }
  }
  
  countEl.textContent = `${matchCount} results`;
  dropdown.style.display = 'flex';
};

// ==========================
// TEST CASES (Jest)
// ==========================

describe("Sidebar Filter Search", () => {
  beforeEach(() => {
    // Reset all displays to block before each test
    const all = document.querySelectorAll('.sidebar-book-item, .sidebar-note-item, .sidebar-standalone-header');
    all.forEach(el => el.style.display = 'block');
  });

  test("Empty query shows all notes and books", () => {
    global.window.filterExternalNotes('');
    const visibleBooks = document.querySelectorAll('.sidebar-book-item[style*="display: block"]');
    const visibleStandalone = document.querySelectorAll('.sidebar-note-item[data-type="standalone"][style*="display: block"]');
    expect(visibleBooks.length).toBe(2);
    expect(visibleStandalone.length).toBe(2);
  });

  test("Searching for 'pop' filters correctly", () => {
    global.window.filterExternalNotes('pop');
    
    expect(document.querySelector('.sidebar-book-item[data-title="pop book"]').style.display).not.toBe('none');
    expect(document.querySelector('.sidebar-book-item[data-title="project book"]').style.display).toBe('none');
    expect(document.querySelector('.sidebar-note-item[data-title="pop"]').style.display).not.toBe('none');
    expect(document.querySelector('.sidebar-note-item[data-title="untitled note"]').style.display).toBe('none');
  });

  test("Searching for chapter 'converspine' keeps parent book visible", () => {
    global.window.filterExternalNotes('converspine');
    
    const book2 = document.querySelector('.sidebar-book-item[data-title="project book"]');
    expect(book2.style.display).not.toBe('none');
    
    const chaptersContainer = book2.querySelector('.sidebar-chapters-container');
    expect(chaptersContainer.style.display).not.toBe('none');
  });

  test("Case insensitivity: 'PROJECT' matches 'project'", () => {
    global.window.filterExternalNotes('PROJECT');
    expect(document.querySelector('.sidebar-book-item[data-title="project book"]').style.display).not.toBe('none');
  });

  test("Zero results hides everything", () => {
    global.window.filterExternalNotes('asdfghjkl');
    const visibleItems = document.querySelectorAll('.sidebar-book-item[style*="display: block"], .sidebar-note-item[style*="display: block"], .sidebar-standalone-header[style*="display: block"]');
    expect(visibleItems.length).toBe(0);
  });
});

describe("Global Search Overlay", () => {
  let mockDropdown, mockResults, mockCount;
  
  beforeEach(() => {
    global.window.notesRepo = {
      getAllNotes: async () => [
        { id: 1, title: "[book:123] Secret Project", content: "We need to find the specific Keyword here." },
        { id: 2, title: "Standalone Regex", content: "Symbols like ( and [ and * and + should not crash it." },
        { id: 3, title: "Capitalization Test", content: "Match THIS word." }
      ]
    };
    
    document.body.innerHTML = `
      <div id="notes-search-dropdown" style="display:none;"></div>
      <div id="notes-search-results"></div>
      <div id="notes-search-count"></div>
    `;
    mockDropdown = document.getElementById('notes-search-dropdown');
    mockResults = document.getElementById('notes-search-results');
    mockCount = document.getElementById('notes-search-count');
    
    global.window.searchMatchCase = false;
    global.window.searchWholeWord = false;
  });

  test("Empty query hides dropdown", async () => {
    mockDropdown.style.display = 'flex';
    await global.window.performGlobalSearch('   ');
    expect(mockDropdown.style.display).toBe('none');
  });

  test("Basic query finds match and shows dropdown", async () => {
    await global.window.performGlobalSearch('Keyword');
    expect(mockDropdown.style.display).toBe('flex');
    expect(mockResults.children.length).toBe(1);
    expect(mockResults.children[0].dataset.noteId).toBe("1");
    expect(mockCount.textContent).toBe('1 results');
  });

  test("Regex metacharacters are safely escaped", async () => {
    // Note 2 has "( and [ and * and +"
    await global.window.performGlobalSearch('([*+');
    expect(mockDropdown.style.display).toBe('flex');
    // If it wasn't escaped, it would throw a syntax error in the RegExp and fail the test.
    // It should not find "([*+" as a literal string though, so 0 results.
    expect(mockResults.children.length).toBe(0);
    
    await global.window.performGlobalSearch('* and +');
    expect(mockResults.children.length).toBe(1);
    expect(mockResults.children[0].dataset.noteId).toBe("2");
  });

  test("Match Case toggle works correctly", async () => {
    // Default is case insensitive
    global.window.searchMatchCase = false;
    await global.window.performGlobalSearch('this word');
    expect(mockResults.children.length).toBe(1);
    expect(mockResults.children[0].dataset.noteId).toBe("3");
    
    // Turn ON Match Case
    global.window.searchMatchCase = true;
    await global.window.performGlobalSearch('this word'); // Text has "THIS word"
    expect(mockResults.children.length).toBe(0);
    
    await global.window.performGlobalSearch('THIS word');
    expect(mockResults.children.length).toBe(1);
  });

  test("Whole Word toggle works correctly", async () => {
    global.window.searchWholeWord = false;
    await global.window.performGlobalSearch('Key'); // Should match "Keyword"
    expect(mockResults.children.length).toBe(1);
    expect(mockResults.children[0].dataset.noteId).toBe("1");
    
    global.window.searchWholeWord = true;
    await global.window.performGlobalSearch('Key'); // Should NOT match "Keyword"
    expect(mockResults.children.length).toBe(0);
    
    await global.window.performGlobalSearch('Keyword'); // Should match exact word
    expect(mockResults.children.length).toBe(1);
  });
});
