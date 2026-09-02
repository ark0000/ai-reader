window.quillEditor = null;
let currentExternalNoteId = null; // Used for global notes
window.currentExternalNoteId = null;
let currentSessionNoteId = null;  // Used for highlight notes
let saveTimeout = null;
window.currentNotesTab = window.currentNotesTab || 'text';

window.switchNotesTab = function(tab) {
    window.currentNotesTab = tab;
    const tabText = document.getElementById('tab-text-notes');
    const tabCanvas = document.getElementById('tab-canvas-notes');
    const title = document.getElementById('notes-list-title');
    
    if (tabText && tabCanvas) {
        tabText.classList.toggle('active', tab === 'text');
        tabText.style.borderBottom = tab === 'text' ? '3px solid var(--accent)' : '3px solid transparent';
        tabText.style.color = tab === 'text' ? 'var(--text-1)' : 'var(--text-3)';
        
        tabCanvas.classList.toggle('active', tab === 'canvas');
        tabCanvas.style.borderBottom = tab === 'canvas' ? '3px solid var(--accent)' : '3px solid transparent';
        tabCanvas.style.color = tab === 'canvas' ? 'var(--text-1)' : 'var(--text-3)';
    }
    
    if (title) {
        title.textContent = tab === 'text' ? 'TEXT NOTES' : 'CANVAS NOTES';
    }
    
    if (typeof loadExternalNotesList === 'function') {
        loadExternalNotesList();
    }
};

// Register Custom Table Blot for Quill so tables are preserved and not stripped
if (typeof Quill !== 'undefined') {
  try {
    const BlockEmbed = Quill.import('blots/block/embed');
    class CustomTableBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        node.innerHTML = typeof value === 'string' ? value : '';
        node.setAttribute('contenteditable', 'true');
        return node;
      }
      static value(node) {
        return node.innerHTML;
      }
    }
    CustomTableBlot.blotName = 'custom-table';
    CustomTableBlot.tagName = 'div';
    CustomTableBlot.className = 'ql-custom-table-container';
    Quill.register(CustomTableBlot, true);

    class CustomDiagramBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        if (typeof value === 'string') {
          node.innerHTML = value;
        } else if (typeof value === 'object' && value !== null) {
          node.innerHTML = value.svg || '';
          if (value.mermaid) {
            node.setAttribute('data-mermaid', encodeURIComponent(value.mermaid));
          }
        }
        node.setAttribute('contenteditable', 'false'); // SVG diagrams shouldn't be editable text
        node.setAttribute('style', 'margin: 16px 0; text-align: center; background: rgba(255,255,255,0.02); padding: 12px; border: 1px solid var(--border); border-radius: 8px;');
        return node;
      }
      static value(node) {
        const mermaid = node.getAttribute('data-mermaid');
        if (mermaid) {
          return { svg: node.innerHTML, mermaid: decodeURIComponent(mermaid) };
        }
        return node.innerHTML;
      }
    }
    CustomDiagramBlot.blotName = 'custom-diagram';
    CustomDiagramBlot.tagName = 'div';
    CustomDiagramBlot.className = 'ql-diagram-container';
    Quill.register(CustomDiagramBlot, true);
  } catch(e) {
    console.warn("CustomTableBlot registration:", e);
  }
}

// Wait for Quill to be ready
function initQuillEditor() {
  if (window.quillEditor) return; // already initialized
  
  if (typeof Quill === 'undefined') {
    console.error("Quill is not loaded.");
    alert("The Rich Text Editor failed to load because the Quill library is missing. Please check your internet connection.");
    return;
  }

  try {
    // Register inline style-based size attributor BEFORE creating the Quill instance
    const SizeStyle = Quill.import('attributors/style/size');
    const validSizes = ['10px', '12px', '14px', '18px', '24px', '32px', '48px', '64px', '80px', '96px', '120px'];
    SizeStyle.whitelist = validSizes;
    Quill.register(SizeStyle, true);

    // Ordered size steps — false means "default/16px"
    const SIZES = ['10px', '12px', '14px', false, '18px', '24px', '32px', '48px', '64px', '80px', '96px', '120px'];
    const SIZE_VALUES = ['10px', '12px', '14px', '16px', '18px', '24px', '32px', '48px', '64px', '80px', '96px', '120px']; // resolved px values

    let _savedRange = null;
    let _isFormatting = false;

    function applySizeToRange(quill, range, sizeValue) {
      if (!range || _isFormatting) return;
      quill.setSelection(range, 'silent');
      
      const val = sizeValue || false;
      const CHUNK_SIZE = 5000; // chars per chunk
      
      if (range.length <= CHUNK_SIZE) {
        if (range.length === 0) {
          quill.format('size', val, 'user');
        } else {
          quill.formatText(range.index, range.length, 'size', val, 'user');
        }
        return;
      }
      
      _isFormatting = true;
      // For huge selections (100+ pages), format in chunks via requestAnimationFrame
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;';
      overlay.innerHTML = 'Formatting... <span id="fmt-pct">0</span>%';
      document.getElementById('quill-editor').appendChild(overlay);
      
      let currentIdx = range.index;
      const endIdx = range.index + range.length;
      const pctEl = overlay.querySelector('#fmt-pct');
      
      function formatNextChunk() {
        const len = Math.min(CHUNK_SIZE, endIdx - currentIdx);
        if (len <= 0) {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          _isFormatting = false;
          // Force toolbar update by re-setting the selection
          quill.setSelection(range, 'user');
          return;
        }
        
        // Trigger 'user' event on the very last chunk so auto-save and toolbar resync fire
        const isLastChunk = (currentIdx + len >= endIdx);
        quill.formatText(currentIdx, len, 'size', val, isLastChunk ? 'user' : 'silent');
        currentIdx += len;
        
        pctEl.textContent = Math.round(((currentIdx - range.index) / range.length) * 100);
        requestAnimationFrame(formatNextChunk);
      }
      
      requestAnimationFrame(formatNextChunk);
    }

    // Helper: get current size of selection
    function getCurrentSize(quill, range) {
      const format = quill.getFormat(range || quill.getSelection() || {index:0,length:0});
      let size = format.size || '16px';
      
      // If selection spans multiple sizes, getFormat returns an array. Use the most prominent/first one.
      if (Array.isArray(size)) {
        size = size[0] || '16px';
      }
      return size;
    }

    const toolbarOptions = [
      [{ 'size': SIZES }, 'size-decrease', 'size-increase'],
      [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      ['blockquote', 'code-block'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'script': 'sub'}, { 'script': 'super' }],
      [{ 'align': [] }],
      ['link', 'image', 'video', 'formula'],
      ['clean'] 
    ];

    window.quillEditor = new Quill('#quill-editor', {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbarOptions,
          handlers: {
            // Dropdown handler: restore saved selection then apply exact size
            'size': function(value) {
              const quill = window.quillEditor;
              const range = _savedRange || quill.getSelection();
              applySizeToRange(quill, range, value);
              _savedRange = null;
            },
            // A- button: step size down one level, keep all other formats
            'size-decrease': function() {
              const quill = window.quillEditor;
              const range = _savedRange || quill.getSelection();
              if (!range) return;
              const current = getCurrentSize(quill, range);
              const idx = SIZE_VALUES.indexOf(current);
              if (idx > 0) {
                const next = SIZE_VALUES[idx - 1];
                applySizeToRange(quill, range, next === '16px' ? false : next);
              }
            },
            // A+ button: step size up one level, keep all other formats
            'size-increase': function() {
              const quill = window.quillEditor;
              const range = _savedRange || quill.getSelection();
              if (!range) return;
              const current = getCurrentSize(quill, range);
              const idx = SIZE_VALUES.indexOf(current);
              if (idx < SIZE_VALUES.length - 1) {
                const next = SIZE_VALUES[idx + 1];
                applySizeToRange(quill, range, next === '16px' ? false : next);
              }
            }
          }
        }
      },
      placeholder: 'Start writing your note here (Markdown shortcuts supported: #, -, >, ```, **bold**)...'
    });

    // After toolbar is mounted, replace A+/A- button labels with styled text
    setTimeout(() => {
      const toolbar = document.querySelector('.ql-toolbar');
      if (!toolbar) return;
      const decBtn = toolbar.querySelector('.ql-size-decrease');
      const incBtn = toolbar.querySelector('.ql-size-increase');
      if (decBtn) { decBtn.innerHTML = '<span style="font-size:15px;font-weight:700;font-family:sans-serif;color:var(--text-1);">A-</span>'; decBtn.title = 'Decrease font size'; }
      if (incBtn) { incBtn.innerHTML = '<span style="font-size:15px;font-weight:700;font-family:sans-serif;color:var(--text-1);">A+</span>'; incBtn.title = 'Increase font size'; }
    }, 0);

    // Save selection whenever user interacts with editor (before toolbar click steals it)
    window.quillEditor.on('selection-change', function(range) {
      if (range) _savedRange = range; // only update when we have a real selection
    });

    // Attach Markdown Intelligence Engine
    window.mdIntelligence = new MarkdownIntelligenceEngine(window.quillEditor);

    // Add clipboard matcher for tables so pasting preserves them
    if (window.quillEditor && window.quillEditor.clipboard) {
      window.quillEditor.clipboard.addMatcher('TABLE', function(node, delta) {
        const Delta = Quill.import('delta');
        return new Delta().insert({ 'custom-table': node.outerHTML });
      });
    }

    // Click listener for Diagram editing via Popup Menu
    document.getElementById('quill-editor').addEventListener('click', function(e) {
      const diagramBlot = e.target.closest('.ql-diagram-container');
      if (diagramBlot) {
        e.stopPropagation();
        const mermaidEnc = diagramBlot.getAttribute('data-mermaid');
        if (mermaidEnc) {
          try {
            const mermaidSrc = decodeURIComponent(mermaidEnc);
            const prompt = 'Please explain this diagram:\\n\\n```mermaid\\n' + mermaidSrc + '\\n```';
            
            const actions = [];
            actions.push({
              label: '&#10024; Explain with AI',
              actionFn: function() {
                if (window.askAI) window.askAI(prompt);
              }
            });
            
            actions.push({
              label: '&#9651; Enlarge',
              actionFn: function() {
                if (window.showEnlargedMedia) {
                  var clone = diagramBlot.cloneNode(true);
                  clone.style.cursor = 'default';
                  window.showEnlargedMedia(clone);
                }
              }
            });
            
            if (window.DiagramBuilder && typeof window.DiagramBuilder.open === 'function') {
              actions.push({
                label: '&#11041; Open in Diagram Builder',
                actionFn: function() {
                  window.DiagramBuilder.open(mermaidSrc);
                }
              });
            }
            
            if (window.showActionPopup) {
              window.showActionPopup(e, actions);
            }
          } catch(err) {
            console.error("Failed to decode mermaid source", err);
          }
        }
      }
    });

    // Auto-save logic
    window.quillEditor.on('text-change', function(delta, oldDelta, source) {
      // FIX R4: Ignore programmatic/API text changes to prevent phantom auto-save loops
      if (source !== 'user') return;
      
      // Push Deltas to the Tablet Sync Engine if connected
      if (window.RemoteNotesEngineInstance) {
          window.RemoteNotesEngineInstance.broadcastLocalDelta(delta);
      }
      
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveExternalNote, 5000); // Auto-save every 5 seconds
    });
  } catch (err) {
    console.error("Failed to initialize Quill editor:", err);
    alert("An error occurred while loading the editor: " + err.message);
  }
}

// ==========================================
// Sidebar Search Logic
// ==========================================
window.searchMatchCase = false;
window.searchWholeWord = false;

window.toggleSearchOption = function(option) {
  if (option === 'case') {
    window.searchMatchCase = !window.searchMatchCase;
    const el = document.getElementById('search-toggle-case');
    if (el) el.style.color = window.searchMatchCase ? 'var(--accent)' : 'var(--text-3)';
  } else if (option === 'word') {
    window.searchWholeWord = !window.searchWholeWord;
    const el = document.getElementById('search-toggle-word');
    if (el) el.style.color = window.searchWholeWord ? 'var(--accent)' : 'var(--text-3)';
  }
  const query = document.getElementById('notes-search-input').value;
  performGlobalSearch(query);
};

window.performGlobalSearch = async function(query) {
  const dropdown = document.getElementById('notes-search-dropdown');
  const resultsContainer = document.getElementById('notes-search-results');
  const countEl = document.getElementById('notes-search-count');
  
  if (!query.trim()) {
    dropdown.style.display = 'none';
    return;
  }
  
  if (!window.notesRepo) return;
  const allNotes = await window.notesRepo.getAllNotes();
  
  let matchCount = 0;
  resultsContainer.innerHTML = '';
  
  let flags = window.searchMatchCase ? 'g' : 'gi';
  let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regexPattern = window.searchWholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
  
  let regex;
  try {
    regex = new RegExp(regexPattern, flags);
  } catch(e) {
    dropdown.style.display = 'none';
    return;
  }
  
  for (const note of allNotes) {
    const textToSearch = (note.title || '') + '\n' + (note.content || '');
    const matches = [...textToSearch.matchAll(regex)];
    
    if (matches.length > 0) {
      matchCount += matches.length;
      
      const cleanTitle = (note.title || 'Untitled').replace(/^\[book:[^\]]+\](?:\[ch:\d+\]\s*)?/, '').trim();
      
      // Get a snippet around the first match
      const firstMatch = matches[0];
      const startIdx = Math.max(0, firstMatch.index - 40);
      const endIdx = Math.min(textToSearch.length, firstMatch.index + query.length + 40);
      let snippet = textToSearch.substring(startIdx, endIdx);
      
      // Highlight the snippet
      snippet = snippet.replace(regex, match => `<span style="background: rgba(255,165,0,0.4); color: #fff; border-radius: 2px;">${match}</span>`);
      
      const el = document.createElement('div');
      el.style.padding = '8px 12px';
      el.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      el.style.cursor = 'pointer';
      el.style.transition = 'background 0.2s';
      el.onmouseover = () => el.style.background = 'rgba(255,255,255,0.05)';
      el.onmouseout = () => el.style.background = 'transparent';
      el.onmousedown = () => {
         // Use mousedown instead of click to prevent onblur hiding it first
         if (window.loadExternalNote) window.loadExternalNote(note.id);
         dropdown.style.display = 'none';
      };
      
      el.innerHTML = `
        <div style="font-size: 12px; font-weight: bold; color: var(--text-1); margin-bottom: 4px;">${cleanTitle}</div>
        <div style="font-size: 11px; color: var(--text-3); word-wrap: break-word;">...${snippet}...</div>
      `;
      
      resultsContainer.appendChild(el);
    }
  }
  
  countEl.textContent = `${matchCount} result${matchCount !== 1 ? 's' : ''}`;
  dropdown.style.display = 'flex';
};

window.filterExternalNotes = function(query) {
  const listEl = document.getElementById('external-notes-list');
  if (!listEl) return;
  
  query = (query || '').toLowerCase().trim();
  
  // If empty, reset everything
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
  
  // Process Standalone Notes
  const standalones = listEl.querySelectorAll('.sidebar-note-item[data-type="standalone"]');
  let standaloneMatchCount = 0;
  standalones.forEach(el => {
    const title = el.dataset.title || '';
    if (title.includes(query)) {
      el.style.display = 'block';
      standaloneMatchCount++;
    } else {
      el.style.display = 'none';
    }
  });
  
  const standaloneHeader = listEl.querySelector('.sidebar-standalone-header');
  if (standaloneHeader) {
    standaloneHeader.style.display = standaloneMatchCount > 0 ? 'block' : 'none';
  }
  
  // Process Books and Chapters
  const books = listEl.querySelectorAll('.sidebar-book-item');
  books.forEach(bookEl => {
    const bookTitle = bookEl.dataset.title || '';
    const bookMatches = bookTitle.includes(query);
    
    const chapters = bookEl.querySelectorAll('.sidebar-note-item[data-type="chapter"]');
    let chapterMatchCount = 0;
    
    chapters.forEach(chapterEl => {
      const chapterTitle = chapterEl.dataset.title || '';
      // If book matches, show all chapters. If not, check if chapter matches.
      if (bookMatches || chapterTitle.includes(query)) {
        chapterEl.style.display = 'block';
        chapterMatchCount++;
      } else {
        chapterEl.style.display = 'none';
      }
    });
    
    // Show book if the book itself matches, or if any of its chapters match
    if (bookMatches || chapterMatchCount > 0) {
      bookEl.style.display = 'block';
      
      // If we are searching, it's helpful to auto-expand the book if it has matching chapters
      if (query && !bookMatches && chapterMatchCount > 0) {
        const chaptersContainer = bookEl.querySelector('.sidebar-chapters-container');
        const toggleIcon = bookEl.querySelector('.book-toggle-icon');
        if (chaptersContainer && toggleIcon) {
          chaptersContainer.style.display = 'block';
          toggleIcon.style.transform = 'rotate(0deg)';
        }
      }
    } else {
      bookEl.style.display = 'none';
    }
  });
};

/**
 * SmartMarkdownNormalizer
 * 
 * Adapter that pre-processes copied text from ChatGPT/Web/Notion into standard GFM Markdown:
 * 1. TSV / Tabbed tables -> Markdown Pipe Tables (| Header | Header |\n| --- | --- |)
 * 2. Unicode bullet glyphs (•, ●, ▪, ◦, ⁃, –) -> Standard Markdown list items (- )
 * 3. Unfenced Mermaid diagrams -> ```mermaid ... ```
 * 4. Section headings and emphasis normalization
 */
class SmartMarkdownNormalizer {
  static normalize(text) {
    if (!text || typeof text !== 'string') return '';

    let lines = text.split(/\r?\n/);
    let normalizedLines = [];
    let tsvRows = [];

    const flushTsvTable = () => {
      if (tsvRows.length === 0) return;
      if (tsvRows.length === 1 && tsvRows[0].length === 1) {
        normalizedLines.push(tsvRows[0][0]);
      } else {
        const maxCols = Math.max(...tsvRows.map(r => r.length));
        if (maxCols >= 2) {
          const header = tsvRows[0];
          while (header.length < maxCols) header.push(' ');
          normalizedLines.push('\n| ' + header.map(c => c.trim().replace(/\|/g, '\\|') || ' ').join(' | ') + ' |');
          normalizedLines.push('| ' + Array(maxCols).fill('---').join(' | ') + ' |');

          for (let i = 1; i < tsvRows.length; i++) {
            const row = tsvRows[i];
            while (row.length < maxCols) row.push(' ');
            normalizedLines.push('| ' + row.map(c => c.trim().replace(/\|/g, '\\|') || ' ').join(' | ') + ' |');
          }
          normalizedLines.push('');
        } else {
          tsvRows.forEach(r => normalizedLines.push(r.join(' ')));
        }
      }
      tsvRows = [];
    };

    let inFencedCode = false;
    let inBareMermaid = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // 1. Check for standard Markdown fenced code blocks (``` or ~~~)
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        flushTsvTable();
        if (inBareMermaid) {
          normalizedLines.push('```');
          inBareMermaid = false;
        }
        inFencedCode = !inFencedCode;
        normalizedLines.push(line);
        continue;
      }

      // If inside an existing code block, preserve lines exactly as-is without touching
      if (inFencedCode) {
        normalizedLines.push(line);
        continue;
      }

      // 2. Check for bare unfenced mermaid (e.g. "mermaid" without ```)
      if (!inBareMermaid && /^\s*mermaid\s*$/i.test(line)) {
        flushTsvTable();
        inBareMermaid = true;
        normalizedLines.push('```mermaid');
        continue;
      }

      if (inBareMermaid) {
        // Check if bare mermaid ended (heading, horizontal rule, blank line followed by non-diagram, or table)
        if (/^(#{1,6}\s+|---|\*\*\*|___|\|.+\||[📋⚡📚🗺️📌])/.test(line.trim())) {
          normalizedLines.push('```\n');
          inBareMermaid = false;
          // Process current line as normal
        } else {
          normalizedLines.push(line);
          continue;
        }
      }

      // 3. Check for TSV table rows
      if (line.includes('\t')) {
        const cells = line.split('\t').map(c => c.trim());
        if (cells.some(Boolean)) {
          tsvRows.push(cells);
          continue;
        }
      } else {
        if (tsvRows.length > 0) {
          flushTsvTable();
        }
      }

      // 4. Normalize Unicode bullet glyphs
      line = line.replace(/^([ \t]*)[•●▪◦⁃–][ \t]+/g, '$1- ');
      line = line.replace(/(\n|\r|^)[ \t]*•[ \t]+/g, '$1- ');

      normalizedLines.push(line);
    }

    if (inBareMermaid) {
      normalizedLines.push('```\n');
    }
    flushTsvTable();

    return normalizedLines.join('\n');
  }
}
window.SmartMarkdownNormalizer = SmartMarkdownNormalizer;

/**
 * MarkedConfigAdapter  (Adapter Pattern, SRP)
 *
 * Configures the global marked.js instance ONCE at startup.
 * marked.use() is additive/global in marked v4+ — calling it repeatedly
 * accumulates duplicate options and causes rendering drift.
 * All callers must use MarkedConfigAdapter.configure() instead of marked.use() directly.
 */
const MarkedConfigAdapter = {
  _configured: false,
  configure() {
    if (this._configured || typeof marked === 'undefined' || !marked.use) return;
    marked.use({ gfm: true, breaks: true });
    this._configured = true;
  }
};
window.MarkedConfigAdapter = MarkedConfigAdapter;

/**
 * MarkdownIntelligenceEngine
 * 
 * Provides intelligent Markdown capabilities to Quill Rich Text Editor:
 * 1. Live Typing Shortcuts (Real-time auto-formatting for headers, lists, quotes, code blocks, dividers)
 * 2. Smart Paste Recognition (Detects and parses pasted Markdown structures into styled rich text)
 * 3. On-demand Conversion (Converts raw Markdown content in editor to rich text via marked.js)
 * 4. HTML to Markdown Serialization (For clean .md export)
 */
class MarkdownIntelligenceEngine {
  constructor(quill) {
    this.quill = quill;
    this._initStrategies();
    this._bindEvents();
  }

  _initStrategies() {
    // Line-level trigger rules (Prefix -> Formatting Strategy)
    this.lineStrategies = [
      { pattern: /^#{6}\s/, format: { header: 6 }, prefixLen: 7 },
      { pattern: /^#{5}\s/, format: { header: 5 }, prefixLen: 6 },
      { pattern: /^#{4}\s/, format: { header: 4 }, prefixLen: 5 },
      { pattern: /^#{3}\s/, format: { header: 3 }, prefixLen: 4 },
      { pattern: /^#{2}\s/, format: { header: 2 }, prefixLen: 3 },
      { pattern: /^#\s/, format: { header: 1 }, prefixLen: 2 },
      { pattern: /^[-*+]\s/, format: { list: 'bullet' }, prefixLen: 2 },
      { pattern: /^\d+\.\s/, format: { list: 'ordered' }, prefixLen: (text) => text.indexOf('.') + 2 },
      { pattern: /^>\s/, format: { blockquote: true }, prefixLen: 2 },
      { pattern: /^```\s/, format: { 'code-block': true }, prefixLen: 4 },
      { pattern: /^---\s/, format: { divider: true }, prefixLen: 4 }
    ];
  }

  isEnabled() {
    if (window.settingsRepo) {
      return !window.settingsRepo.isTrue('aura-disable-editor-markdown');
    }
    if (window.safeStorage) {
      return window.safeStorage.getItem('aura-disable-editor-markdown') !== 'true';
    }
    return true;
  }

  _bindEvents() {
    if (!this.quill) return;

    // 1. Listen for text-change for live typing shortcuts
    // Debounced at 50ms (SRP): decouples keystroke detection from execution,
    // preventing getLine() calls on every single character.
    this.quill.on('text-change', (delta, oldDelta, source) => {
      if (source !== 'user') return;
      clearTimeout(this._textChangeTimer);
      this._textChangeTimer = setTimeout(() => this._handleTextChange(), 50);
    });

    // 2. Intercept paste on container in CAPTURE phase so it intercepts before Quill clipboard
    const container = document.getElementById('quill-editor') || this.quill.root;
    container.addEventListener('paste', (e) => {
      this._handlePaste(e);
    }, true);

    if (window.appEventBus) {
      window.appEventBus.on('SettingsChanged:aura-disable-editor-markdown', () => {
        if (typeof updateMarkdownUI === 'function') updateMarkdownUI();
      });
    }
  }

  _handleTextChange() {
    if (!this.isEnabled()) return;
    const range = this.quill.getSelection();
    if (!range) return;

    const [line, offset] = this.quill.getLine(range.index);
    if (!line) return;

    const lineIndex = this.quill.getIndex(line);
    const textUpToCursor = this.quill.getText(lineIndex, offset);

    // Check line-level shortcut (e.g. user just typed "# ", "- ", "> ")
    for (const strategy of this.lineStrategies) {
      if (strategy.pattern.test(textUpToCursor)) {
        const pLen = typeof strategy.prefixLen === 'function' ? strategy.prefixLen(textUpToCursor) : strategy.prefixLen;
        // lineIndex is already declared above

        // Delete trigger characters from the line
        this.quill.deleteText(lineIndex, pLen, 'user');

        // Apply formatting to the line
        Object.entries(strategy.format).forEach(([key, val]) => {
          this.quill.formatLine(lineIndex, 1, key, val, 'user');
        });
        return;
      }
    }
  }

  _handlePaste(e) {
    if (!this.isEnabled()) return; // Native Quill paste executes cleanly without interception
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    
    const htmlData = clipboardData.getData('text/html');
    if (htmlData && (htmlData.includes('<table') || htmlData.includes('<TABLE'))) {
      return; // Let Quill handle rich HTML tables directly
    }

    const textData = clipboardData.getData('text/plain');
    if (!textData || textData.trim().length < 3) return;

    // Detect if content is structured Markdown or table/list formatted text
    if (this.detectMarkdown(textData)) {
      e.preventDefault();
      e.stopPropagation();
      
      const normalized = SmartMarkdownNormalizer.normalize(textData);
      
      let html = '';
      if (typeof marked !== 'undefined' && marked.parse) {
        try {
          MarkedConfigAdapter.configure(); // one-time global config (Adapter Pattern)
          html = marked.parse(normalized);
          // Wrap all <table>...</table> in custom-table container so Quill preserves them
          html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
            return `<div class="ql-custom-table-container">${match}</div>`;
          });
          // Strip light-mode inline styles that clash with dark theme
          html = html
            .replace(/\s*style="[^"]*background(?:-color)?:\s*(?:white|#fff|#ffffff|rgb\(255,\s*255,\s*255\))[^"]*"/gi, '')
            .replace(/\s*style="[^"]*color:\s*(?:black|#000|#000000)[^"]*"/gi, '')
            .replace(/background(?:-color)?:\s*(?:white|#fff|#ffffff|rgb\(255,\s*255,\s*255\))\s*;?/gi, '')
            .replace(/color:\s*(?:black|#000|#000000)\s*;?/gi, '');
        } catch (err) {
          console.warn('Marked parse fallback:', err);
          html = normalized.replace(/\n/g, '<br>');
        }
      } else {
        html = normalized.replace(/\n/g, '<br>');
      }

      const range = this.quill.getSelection() || { index: this.quill.getLength(), length: 0 };
      
      if (this.quill.clipboard && this.quill.clipboard.dangerouslyPasteHTML) {
        this.quill.clipboard.dangerouslyPasteHTML(range.index, html, 'user');
        // Fix: advance cursor to end of pasted block so user can keep typing naturally
        setTimeout(() => {
          const newLen = this.quill.getLength();
          this.quill.setSelection(newLen - 1, 0, 'silent');
        }, 0);
      } else {
        this.quill.root.innerHTML += html;
      }

      this._showToast('✨ Markdown recognized & formatted');
    }
  }

  detectMarkdown(text) {
    if (!text || typeof text !== 'string') return false;

    let score = 0;
    // Header pattern
    if (/^#{1,6}\s+.+$/m.test(text)) score += 3;
    // Code block / Mermaid
    if (/^```[\s\S]*?```$/m.test(text) || /\b(mermaid|graph LR|graph TD|subgraph)\b/i.test(text)) score += 4;
    // List items & Unicode bullets
    if (/^(\s*[-*+]|\s*\d+\.|\s*[•●▪◦⁃–])\s+.+$/m.test(text)) score += 2;
    // Tab-separated tables
    if (/\t[^\n]+\t/m.test(text) || /^Table\t/m.test(text)) score += 3;
    // Blockquotes
    if (/^>\s+.+$/m.test(text)) score += 2;
    // Links / Images
    if (/!?\[[^\]]+\]\([^)]+\)/.test(text)) score += 2;
    // Bold / Italic / Inline Code / Strikethrough
    if (/(\*\*|__)[^\n]+(\*\*|__)|`[^`\n]+`|~~[^\n]+~~/.test(text)) score += 2;
    // Markdown Tables
    if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) score += 3;

    return score >= 2;
  }

  convertCurrentContent() {
    if (!this.quill) return;
    const rawText = this.quill.getText().trim();
    if (!rawText) {
      this._showToast('Editor is empty');
      return;
    }

    if (typeof marked === 'undefined' || !marked.parse) {
      alert('Marked.js parser is not available.');
      return;
    }

    try {
      const normalized = SmartMarkdownNormalizer.normalize(rawText);
      MarkedConfigAdapter.configure(); // one-time global config (Adapter Pattern)
      let html = marked.parse(normalized);
      // Wrap all <table>...</table> in custom-table container
      html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
        return `<div class="ql-custom-table-container">${match}</div>`;
      });
      
      if (this.quill.clipboard && this.quill.clipboard.dangerouslyPasteHTML) {
        this.quill.setText('\n', 'api'); // 'api' source: suppresses auto-save trigger on blank content
        this.quill.clipboard.dangerouslyPasteHTML(0, html, 'user');
      } else {
        this.quill.root.innerHTML = html;
      }
      this._showToast('✨ Converted Markdown to Rich Text');
    } catch(err) {
      console.error('Markdown conversion error:', err);
      alert('Error parsing Markdown: ' + err.message);
    }
  }

  _showToast(msg) {
    let toast = document.getElementById('md-intelligence-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'md-intelligence-toast';
      toast.style.cssText = 'position:fixed; bottom:30px; right:30px; background:rgba(20,20,30,0.95); color:#fff; padding:10px 20px; border-radius:20px; font-size:13px; font-weight:600; z-index:999999; box-shadow:0 10px 30px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.2); transition:opacity 0.3s ease, transform 0.3s ease; pointer-events:none; display:flex; align-items:center; gap:8px;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 2400);
  }
}

function ensureQuillEditor() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('external-notes-overlay');
    if (overlay && overlay.style.display !== 'flex') {
      overlay.style.display = 'flex';
    }
    if (window.quillEditor) {
      return resolve(window.quillEditor);
    }
    initQuillEditor();
    if (window.quillEditor) {
      return resolve(window.quillEditor);
    }
    setTimeout(() => {
      initQuillEditor();
      resolve(window.quillEditor);
    }, 100);
  });
}
window.ensureQuillEditor = ensureQuillEditor;

function openExternalNotes() {
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    if (typeof updateMarkdownUI === 'function') updateMarkdownUI();
    if (!window.quillEditor) {
      // Need a small timeout to ensure the container is fully rendered before Quill mounts
      setTimeout(initQuillEditor, 100);
    }
    loadExternalNotesList();
  }
}

window.openExternalEditorWithContent = async function(title, htmlContent) {
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) overlay.style.display = 'flex';
  if (typeof updateMarkdownUI === 'function') updateMarkdownUI();
  
  const editor = await ensureQuillEditor();
  if (!editor) {
    console.error("Quill editor is not available.");
    return;
  }
  
  currentExternalNoteId = null;
  window.currentExternalNoteId = null;
  currentSessionNoteId = null;
  
  const titleInput = document.getElementById('external-note-title');
  if (titleInput) {
    titleInput.dataset.bookPrefix = '';
    titleInput.value = title || 'Untitled Note';
  }
  
  if (editor.clipboard && editor.clipboard.dangerouslyPasteHTML) {
    editor.clipboard.dangerouslyPasteHTML(0, htmlContent);
  } else {
    editor.root.innerHTML = htmlContent;
  }
  
  await saveExternalNote(true);
  loadExternalNotesList();
};

function closeExternalNotes() {
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) overlay.style.display = 'none';
  // FIX Bug 2: Always save on close — not just when a pending auto-save timer exists.
  // Clearing the timer prevents a double-save; the explicit call below handles the final state.
  clearTimeout(saveTimeout);
  saveExternalNote(true); // silent save
}

// NOTE: The complete createNewExternalNote (with markdown editor + mode reset) is defined below at line ~660.
// The old incomplete duplicate here has been removed (Bug 1 fix).

async function loadExternalNotesList() {
  if (!window.notesRepo) return;
  try {
    const allNotes = await window.notesRepo.getAllNotes();
    let notes = [];
    if (window.currentNotesTab === 'text') {
        notes = allNotes.filter(n => !n.isCanvasNote && n.itemType !== 'canvas');
    } else {
        notes = allNotes.filter(n => n.isCanvasNote || n.itemType === 'canvas');
    }

    const listEl = document.getElementById('external-notes-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    if (notes.length === 0 && window.currentNotesTab === 'canvas') {
      const msg = 'No saved canvases.';
      listEl.innerHTML = `<div style="color:var(--text-3); font-size:12px; padding:10px;">${msg}</div>`;
      return;
    }

    const isBookMode = true; // Hardcoded to true as per new architecture
    let strategy = null;
    if (window.BookSidebarRenderer && window.BookNodeAdapter) {
      strategy = new window.BookSidebarRenderer(new window.BookNodeAdapter());
    }
    
    if (strategy) {
      strategy.render(notes, listEl);
    } else {
      // Fallback if strategy not loaded
      listEl.innerHTML = `<div style="color:var(--text-3); font-size:12px; padding:10px;">Error loading SidebarStrategy.</div>`;
    }
  } catch (e) {
    console.error("Failed to load notes list:", e);
  }
}

/**
 * EditorModeController
 * 
 * Manages Dual-Mode editing for the Full Notes Editor:
 * - 'visual': Quill Rich Text Editor with tables, colors, formatting
 * - 'markdown': Raw Markdown Source Editor for easy table typing and fast copy-pasting
 */
class EditorModeController {
  constructor() {
    this.mode = 'visual'; // 'visual' | 'markdown'
  }

  toggleMode() {
    // Guard: sync textarea content back to Quill before any mode switch (prevents content loss on rapid toggle)
    this.syncBeforeSave();
    // Guard: Quill must be initialized before switching modes
    if (!window.quillEditor) {
      console.warn('EditorModeController: Quill not initialized yet.');
      return;
    }
    if (window.mdIntelligence && !window.mdIntelligence.isEnabled()) {
      alert("Markdown features are currently disabled in Settings.");
      return;
    }
    if (this.mode === 'visual') {
      this.switchToMarkdown();
    } else {
      this.switchToVisual();
    }
  }

  async switchToMarkdown() {
    const rawEditor = document.getElementById('markdown-source-editor');
    const visualEditor = document.getElementById('quill-editor');
    const qlToolbar = document.querySelector('.ql-toolbar');
    const toggleBtn = document.getElementById('mode-toggle-btn');
    if (!rawEditor || !visualEditor || !window.quillEditor) return;

    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = '⏳ Converting...';
    }

    // Convert current Quill HTML to Markdown
    const html = window.quillEditor.root.innerHTML;
    let md = '';
    
    if (html.length > 50000 && window.MarkdownWorker) {
        md = await new Promise((resolve) => {
            const msgId = Date.now() + Math.random();
            const handler = (e) => {
                if (e.data.id === msgId) {
                    window.MarkdownWorker.removeEventListener('message', handler);
                    resolve(e.data.md);
                }
            };
            window.MarkdownWorker.addEventListener('message', handler);
            window.MarkdownWorker.postMessage({ id: msgId, html: html });
        });
    } else {
        md = htmlToMarkdown(html);
    }
    
    rawEditor.value = md;

    visualEditor.style.display = 'none';
    if (qlToolbar) qlToolbar.style.display = 'none';
    rawEditor.style.display = 'block';
    rawEditor.focus();

    if (toggleBtn) {
      toggleBtn.disabled = false;
      toggleBtn.innerHTML = '👁️ Visual View';
      toggleBtn.style.background = 'var(--accent)';
      toggleBtn.style.color = '#fff';
    }
    this.mode = 'markdown';
  }

  switchToVisual() {
    const rawEditor = document.getElementById('markdown-source-editor');
    const visualEditor = document.getElementById('quill-editor');
    const qlToolbar = document.querySelector('.ql-toolbar');
    const toggleBtn = document.getElementById('mode-toggle-btn');
    if (!rawEditor || !visualEditor || !window.quillEditor) return;

    // Convert raw Markdown to HTML
    const md = rawEditor.value;
    const normalized = SmartMarkdownNormalizer.normalize(md);
    let html = '';
    if (typeof marked !== 'undefined' && marked.parse) {
      MarkedConfigAdapter.configure(); // one-time global config (Adapter Pattern)
      html = marked.parse(normalized);
      html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
        return `<div class="ql-custom-table-container">${match}</div>`;
      });
    } else {
      html = normalized.replace(/\n/g, '<br>');
    }

    if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
      window.quillEditor.setText('\n', 'api'); // 'api' source: suppresses auto-save trigger on blank content
      window.quillEditor.clipboard.dangerouslyPasteHTML(0, html, 'user');
    } else {
      window.quillEditor.root.innerHTML = html;
    }

    rawEditor.style.display = 'none';
    if (qlToolbar) qlToolbar.style.display = 'block';
    visualEditor.style.display = 'block';
    window.quillEditor.focus();

    if (toggleBtn) {
      toggleBtn.innerHTML = '📝 Markdown Source';
      toggleBtn.style.background = 'rgba(255,255,255,0.05)';
      toggleBtn.style.color = 'var(--text-1)';
    }
    this.mode = 'visual';
  }

  syncBeforeSave() {
    if (this.mode === 'markdown') {
      const rawEditor = document.getElementById('markdown-source-editor');
      if (rawEditor && window.quillEditor) {
        const md = rawEditor.value;
        const normalized = SmartMarkdownNormalizer.normalize(md);
        let html = '';
        if (typeof marked !== 'undefined' && marked.parse) {
          MarkedConfigAdapter.configure(); // one-time global config (Adapter Pattern)
          html = marked.parse(normalized);
          html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
            return `<div class="ql-custom-table-container">${match}</div>`;
          });
          // Use 'api' source for setText so auto-save timer is NOT triggered on blank content mid-sync
          if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
            window.quillEditor.setText('\n', 'api');
            window.quillEditor.clipboard.dangerouslyPasteHTML(0, html, 'api');
          } else {
            window.quillEditor.root.innerHTML = html;
          }
        }
      }
    }
  }
}
window.editorModeController = new EditorModeController();
window.toggleEditorMode = function() {
  window.editorModeController.toggleMode();
};

function updateMarkdownUI() {
  const isEnabled = window.mdIntelligence ? window.mdIntelligence.isEnabled() : true;
  const toggleBtn = document.getElementById('mode-toggle-btn');
  const convertBtn = document.getElementById('md-convert-btn');
  if (toggleBtn) toggleBtn.style.display = isEnabled ? 'inline-block' : 'none';
  if (convertBtn) convertBtn.style.display = isEnabled ? 'inline-block' : 'none';

  // Fix: explicitly hide the raw textarea when Markdown is disabled,
  // in case switchToVisual() fails early (e.g. Quill not yet initialized)
  if (!isEnabled) {
    const rawEditor = document.getElementById('markdown-source-editor');
    if (rawEditor) rawEditor.style.display = 'none';
  }

  if (!isEnabled && window.editorModeController && window.editorModeController.mode === 'markdown') {
    window.editorModeController.switchToVisual();
  }
}
window.updateMarkdownUI = updateMarkdownUI;

async function createNewExternalNote() {
  currentExternalNoteId = null;
  window.currentExternalNoteId = null;
  currentSessionNoteId = null;
  const titleInput = document.getElementById('external-note-title');
  if (titleInput) {
    titleInput.dataset.bookPrefix = '';
    titleInput.value = window.currentNotesTab === 'canvas' ? 'Untitled Canvas' : 'Untitled Note';
    setTimeout(() => titleInput.focus(), 50);
  }
  
  const newId = Date.now();
  currentExternalNoteId = newId;
  window.currentExternalNoteId = newId;
  
  if (window.currentNotesTab === 'canvas') {
      document.getElementById('quill-editor').style.display = 'none';
      document.getElementById('markdown-source-editor').style.display = 'none';
      const qlToolbar = document.querySelector('.ql-toolbar');
      if (qlToolbar) qlToolbar.style.display = 'none';
      
      const txtTools = document.getElementById('text-note-tools');
      if (txtTools) txtTools.style.display = 'none';
      const canvasTools = document.getElementById('canvas-note-tools');
      if (canvasTools) canvasTools.style.display = 'flex';
      
      const canvasContainer = document.getElementById('pure-canvas-container');
      if (canvasContainer) {
          canvasContainer.style.display = 'block';
          canvasContainer.dataset.id = newId;
          if (window.StylusEngine) window.StylusEngine.activate(canvasContainer);
      }
  } else {
      document.getElementById('quill-editor').style.display = 'block';
      const qlToolbar = document.querySelector('.ql-toolbar');
      if (qlToolbar) qlToolbar.style.display = 'block';
      
      const txtTools = document.getElementById('text-note-tools');
      if (txtTools) txtTools.style.display = 'flex';
      const canvasTools = document.getElementById('canvas-note-tools');
      if (canvasTools) canvasTools.style.display = 'none';
      
      const canvasContainer = document.getElementById('pure-canvas-container');
      if (canvasContainer) {
          canvasContainer.style.display = 'none';
          if (window.StylusEngine) window.StylusEngine.deactivate();
      }
      
      if (window.quillEditor) {
          window.quillEditor.setText('\n');
      }
      const rawEditor = document.getElementById('markdown-source-editor');
      if (rawEditor) rawEditor.value = '';
      if (window.editorModeController && window.editorModeController.mode === 'markdown') {
        window.editorModeController.switchToVisual();
      }
  }
  
  // Save the new blank note explicitly to the DB so it appears in the list immediately
  const newNote = {
    id: newId,
    title: window.currentNotesTab === 'canvas' ? 'Untitled Canvas' : 'Untitled Note',
    content: window.currentNotesTab === 'canvas' ? '[]' : '',
    rawText: '',
    itemType: window.currentNotesTab === 'canvas' ? 'canvas' : 'text',
    isCanvasNote: window.currentNotesTab === 'canvas',
    updatedAt: Date.now(),
    createdAt: Date.now()
  };
  
  if (window.notesRepo) {
      await window.notesRepo.saveNote(newNote);
  }
  
  loadExternalNotesList();
}
window.createNewExternalNote = createNewExternalNote;

window.handleNewNoteClick = function() {
  const isBookMode = true; // Hardcoded to true as per new architecture
  if (isBookMode && window.currentNotesTab !== 'canvas') {
    const menu = document.getElementById('new-note-menu-options');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  } else {
    createNewExternalNote();
  }
};

window.createNewBook = async function() {
  const bookName = prompt("Enter new Book title:");
  if (!bookName) return;
  const uuid = 'b-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  await createNewExternalNote();
  const titleInput = document.getElementById('external-note-title');
  const prefix = `[book:${uuid}] `;
  if (titleInput) {
    titleInput.dataset.bookPrefix = prefix;
    titleInput.value = bookName;
  }
  
  if (window.notesRepo && window.currentExternalNoteId) {
    const note = await window.notesRepo.getNote(window.currentExternalNoteId);
    if (note) {
      note.title = prefix + bookName;
      await window.notesRepo.saveNote(note);
      loadExternalNotesList();
    }
  }
};

window.createNewChapter = async function() {
  if (!window.notesRepo) return;
  
  // Find which book is currently selected or prompt
  const notes = await window.notesRepo.getAllNotes();
  const books = new Map();
  const bookRegex = /^\[book:([^\]]+)\](?:\[ch:(\d+)\]\s*)?(.*)$/;
  
  for (const n of notes) {
    const m = bookRegex.exec(n.title);
    if (m && !m[2]) books.set(m[1], m[3]); // bookId -> title
  }
  
  if (books.size === 0) {
    alert("No Books found. Please create a Book first.");
    return;
  }
  
  // Determine target bookId (simple heuristic: first book, or currently selected book)
  let targetBookId = null;
  let maxCh = 0;
  
  if (window.currentExternalNoteId) {
    const currentNote = notes.find(n => n.id === window.currentExternalNoteId);
    if (currentNote) {
      const m = bookRegex.exec(currentNote.title);
      if (m) targetBookId = m[1];
    }
  }
  
  if (!targetBookId) {
    targetBookId = Array.from(books.keys())[0];
  }
  
  // Find highest chapter number
  for (const n of notes) {
    const m = bookRegex.exec(n.title);
    if (m && m[1] === targetBookId && m[2]) {
      maxCh = Math.max(maxCh, parseInt(m[2], 10));
    }
  }
  
  const chName = prompt(`Enter chapter name for "${books.get(targetBookId)}":`, `Chapter ${maxCh + 1}`);
  if (!chName) return;
  
  await createNewExternalNote();
  const titleInput = document.getElementById('external-note-title');
  const prefix = `[book:${targetBookId}][ch:${maxCh + 1}] `;
  if (titleInput) {
    titleInput.dataset.bookPrefix = prefix;
    titleInput.value = chName;
  }
  
  // Explicitly update the title in the DB since the note is empty and saveExternalNote would ignore it
  if (window.notesRepo && window.currentExternalNoteId) {
    const note = await window.notesRepo.getNote(window.currentExternalNoteId);
    if (note) {
      note.title = prefix + chName;
      await window.notesRepo.saveNote(note);
      loadExternalNotesList();
    }
  }
};


/**
 * ToolbarStateAdapter — reads current toolbar DOM state and re-applies it
 * to the active StylusEngine facade after every canvas activation.
 * Bug 9 fix: StylusEngine.activate() creates a new Facade each time, which
 * resets currentSize/currentColor/currentTool to defaults. This adapter
 * bridges DOM state → Engine API without coupling them (Adapter Pattern).
 * Backward compatible: gracefully no-ops if elements or engine are absent.
 */
function _restoreToolbarStateToEngine() {
    if (!window.StylusEngine || !window.StylusEngine.activeFacade) return;
    
    // Read from both tablet toolbar IDs and desktop toolbar IDs
    const sizeEl = document.getElementById('tb-size') || document.getElementById('stylus-size');
    const colorEl = document.getElementById('tb-color') || document.getElementById('stylus-color');
    const activeToolBtn = document.querySelector('.tool-btn.active[id^="tb-"]');
    
    if (sizeEl && sizeEl.value) {
        window.StylusEngine.setSize(parseFloat(sizeEl.value));
    }
    if (colorEl && colorEl.value) {
        window.StylusEngine.setColor(colorEl.value);
    }
    if (activeToolBtn) {
        const tool = activeToolBtn.id.replace('tb-', '');
        if (['pen', 'highlighter', 'eraser'].includes(tool)) {
            window.StylusEngine.setTool(tool);
        }
    }
}

async function loadExternalNote(id) {
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  if (!window.notesRepo) return;
  try {
    const note = await window.notesRepo.getNote(parsedId);
    if (note) {
      currentExternalNoteId = note.id;
      window.currentExternalNoteId = note.id;
      currentSessionNoteId = null; // Clear session note context
      const titleEl = document.getElementById('external-note-title');
      const match = (note.title || '').match(/^(\[book:[^\]]+\](?:\[ch:\d+\]\s*)?)(.*)$/);
      if (match) {
          titleEl.dataset.bookPrefix = match[1];
          titleEl.value = match[2];
      } else {
          titleEl.dataset.bookPrefix = '';
          titleEl.value = note.title || '';
      }
      
      const isCanvas = note.isCanvasNote || note.itemType === 'canvas';
      
      if (isCanvas) {
          document.getElementById('quill-editor').style.display = 'none';
          document.getElementById('markdown-source-editor').style.display = 'none';
          const qlToolbar = document.querySelector('.ql-toolbar');
          if (qlToolbar) qlToolbar.style.display = 'none';
          
          const txtTools = document.getElementById('text-note-tools');
          if (txtTools) txtTools.style.display = 'none';
          const canvasTools = document.getElementById('canvas-note-tools');
          if (canvasTools) canvasTools.style.display = 'flex';
          
          const canvasContainer = document.getElementById('pure-canvas-container');
          if (canvasContainer) {
              canvasContainer.style.display = 'block';
              canvasContainer.dataset.id = note.id;
              
              if (note.content && window.StylusStore) {
                  try {
                      const strokes = JSON.parse(note.content);
                      if (Array.isArray(strokes)) {
                          window.StylusStore.set(note.id, strokes);
                      }
                  } catch (e) {}
              }
              
              if (window.StylusEngine) {
                  window.StylusEngine.activate(canvasContainer);
                  // Bug 9 fix: restore toolbar state after activate() creates a new facade
                  _restoreToolbarStateToEngine();
              }
          }
      } else {
          document.getElementById('quill-editor').style.display = 'block';
          const qlToolbar = document.querySelector('.ql-toolbar');
          if (qlToolbar) qlToolbar.style.display = 'block';
          
          const txtTools = document.getElementById('text-note-tools');
          if (txtTools) txtTools.style.display = 'flex';
          const canvasTools = document.getElementById('canvas-note-tools');
          if (canvasTools) canvasTools.style.display = 'none';
          
          const canvasContainer = document.getElementById('pure-canvas-container');
          if (canvasContainer) {
              canvasContainer.style.display = 'none';
              if (window.StylusEngine) window.StylusEngine.deactivate();
          }
          
          if (window.quillEditor) {
            const html = note.content || '';
            if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
              window.quillEditor.setText('\n');
              window.quillEditor.clipboard.dangerouslyPasteHTML(0, html, 'api');
            } else {
              window.quillEditor.root.innerHTML = html;
            }
          }
          const rawEditor = document.getElementById('markdown-source-editor');
          if (rawEditor) {
            rawEditor.value = htmlToMarkdown(note.content || '');
          }
      }
      
      loadExternalNotesList(); // Refresh list to update selection highlight
      
      // Notify Tablet that the active note has changed
      if (window.RemoteNotesEngineInstance) {
          window.RemoteNotesEngineInstance.broadcastNoteSwitch();
      }
    }
  } catch(e) {
    console.error("Failed to load note:", e);
  }
}

async function saveExternalNote(silent = false) {
  if (!window.quillEditor) return;
  if (window.editorModeController) window.editorModeController.syncBeforeSave();
  
  const titleEl = document.getElementById('external-note-title');
  const prefix = titleEl.dataset.bookPrefix || '';
  const title = prefix + titleEl.value.trim();
  let content = window.quillEditor.root.innerHTML;
  
  if (window.currentNotesTab === 'canvas') {
      const canvasContainer = document.getElementById('pure-canvas-container');
      const canvasId = canvasContainer ? canvasContainer.dataset.id : null;
      if (canvasId && window.StylusStore) {
          const strokes = window.StylusStore.get(canvasId) || [];
          content = JSON.stringify(strokes);
      }
  }
  
  let rawText = '';
  if (window.currentNotesTab !== 'canvas' && typeof htmlToMarkdown === 'function') {
      if (content.length > 50000 && window.MarkdownWorker) {
          // Offload to worker for massive documents to avoid main-thread freeze
          rawText = await new Promise((resolve) => {
              const msgId = Date.now() + Math.random();
              const handler = (e) => {
                  if (e.data.id === msgId) {
                      window.MarkdownWorker.removeEventListener('message', handler);
                      resolve(e.data.md);
                  }
              };
              window.MarkdownWorker.addEventListener('message', handler);
              window.MarkdownWorker.postMessage({ id: msgId, html: content });
          });
      } else {
          rawText = htmlToMarkdown(content);
      }
  } else {
      rawText = window.quillEditor.getText().trim();
  }
  
  if ((!content || content === '<p><br></p>') && window.currentNotesTab !== 'canvas') {
    if (!silent) alert("Cannot save an empty note.");
    return;
  }
  
  // FACADE: Determine where to save based on context
  if (currentSessionNoteId) {
    // Save to the current PDF session highlight notes
    if (window.notes) {
      const idx = window.notes.findIndex(n => n.id === currentSessionNoteId);
      if (idx !== -1) {
        window.notes[idx].txt = content;
        if (typeof renderNotes === 'function') renderNotes();
        // Force flush to storage because this is an explicit user "Save" action
        if (window.storageRepository && window.currentFileName) {
          const uname = window.settingsRepo ? window.settingsRepo.getUsername() : (window.currentUsername || 'guest');
          window.storageRepository.saveNotes(uname + '_' + window.currentFileName, window.notes, window.pdfHighlights, true);
        }
      }
    }

    if (!silent) {
      // FIX Bug 3: Guard btn — overlay may be hidden when auto-save fires
      const btn = document.getElementById('save-external-btn');
      if (btn) {
        const oldText = btn.textContent;
        btn.textContent = 'Saved to Session';
        btn.style.background = '#48bb78';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.style.background = 'var(--accent)';
        }, 2000);
      }
    }
    return;
  }

  // Fallback to Global Notes repository
  if (!window.notesRepo) return;

  const noteToSave = {
    id: currentExternalNoteId || Date.now(), // Create new ID if it's a new global note
    title: title || (window.currentNotesTab === 'canvas' ? 'Untitled Canvas' : 'Untitled Note'),
    content: content,
    rawText: rawText,
    itemType: window.currentNotesTab === 'canvas' ? 'canvas' : 'text',
    isCanvasNote: window.currentNotesTab === 'canvas'
  };
  
  try {
    const saved = await window.notesRepo.saveNote(noteToSave);
    currentExternalNoteId = saved.id;
    window.currentExternalNoteId = saved.id;
    if (!silent) {
      // FIX Bug 3: Guard btn — overlay may be hidden when silent auto-save fires
      const btn = document.getElementById('save-external-btn');
      if (btn) {
        const oldText = btn.textContent;
        btn.textContent = 'Saved';
        btn.style.background = '#48bb78';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.style.background = 'var(--accent)';
        }, 2000);
      }
      loadExternalNotesList();
    }
  } catch(e) {
    console.error("Failed to save note:", e);
    if (!silent) alert("Failed to save note. Check console for details.");
  }
}
window.saveExternalNote = saveExternalNote;

window.downloadBook = async function(bookId) {
  try {
    const allNotes = await window.notesRepo.getAllNotes();
    const bookIdMatch = `[book:${bookId}]`;
    
    // Find all notes belonging to the book
    const bookNotes = allNotes.filter(n => n.title && n.title.includes(bookIdMatch));
    
    if (bookNotes.length === 0) {
      alert("Book not found or empty.");
      return;
    }
    
    // Separate root note and chapters
    const rootNote = bookNotes.find(n => !n.title.includes('[ch:'));
    const chapters = bookNotes.filter(n => n.title.includes('[ch:'));
    
    // Sort chapters by order
    chapters.sort((a, b) => {
      const matchA = a.title.match(/\[ch:(\d+)\]/);
      const matchB = b.title.match(/\[ch:(\d+)\]/);
      const orderA = matchA ? parseInt(matchA[1], 10) : 0;
      const orderB = matchB ? parseInt(matchB[1], 10) : 0;
      return orderA - orderB;
    });
    
    const bookTitle = rootNote ? rootNote.title.replace(/^\[book:[^\]]+\]/, '').trim() : "Untitled_Book";
    
    let combinedMarkdown = `# ${bookTitle}\n\n`;
    if (rootNote && rootNote.content) {
      combinedMarkdown += `${rootNote.content}\n\n`;
    }
    
    for (const ch of chapters) {
      const cleanChTitle = ch.title.replace(/^\[book:[^\]]+\](?:\[ch:\d+\]\s*)?/, '');
      combinedMarkdown += `---\n\n## ${cleanChTitle}\n\n`;
      if (ch.content) combinedMarkdown += `${ch.content}\n\n`;
    }
    
    // Trigger download
    const blob = new Blob([combinedMarkdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bookTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
    
  } catch (e) {
    console.error("Failed to download book:", e);
    alert("Error downloading book: " + e.message);
  }
};

async function deleteExternalNote(id, isBookRoot = false) {
    const parsedId = isNaN(Number(id)) ? id : Number(id);
    
    if (isBookRoot) {
      if (!confirm("Are you sure you want to delete this Book? All chapters will be permanently deleted.")) {
        return;
      }
      
      try {
        const allNotes = await window.notesRepo.getAllNotes();
        const bookIdMatch = `[book:${parsedId}]`;
        
        // Find the root note first before modifying any titles
        const rootNote = allNotes.find(n => String(n.title).startsWith(`[book:${parsedId}]`) && !String(n.title).includes('[ch:'));
        
        const chaptersToDelete = [];
        for (const n of allNotes) {
          if (n.title && n.title.includes(bookIdMatch) && n.id !== (rootNote ? rootNote.id : null)) {
            chaptersToDelete.push(n);
          }
        }
        
        // Delete all chapters
        for (const n of chaptersToDelete) {
          await window.notesRepo.deleteNote(n.id);
        }
        
        // Now delete the root book note
        if (rootNote) {
           await window.notesRepo.deleteNote(rootNote.id);
        }
        
        // Clear editor if we deleted the currently open note
        if ((rootNote && currentExternalNoteId === rootNote.id) || chaptersToDelete.some(n => n.id === window.currentExternalNoteId)) {
           createNewExternalNote();
        }
        
        loadExternalNotesList();
        return;
      } catch(e) {
        console.error("Failed to delete book:", e);
        alert("Error deleting book: " + e.message);
        return;
      }
    }
    
    // Standard delete
    try {
      await window.notesRepo.deleteNote(parsedId);
      if (currentExternalNoteId === parsedId) {
        createNewExternalNote(); // Clear editor if we deleted the currently open note
      } else {
        loadExternalNotesList();
      }
    } catch(e) {
      console.error("Failed to delete note:", e);
      alert("Error: " + e.message);
    }
  }

/**
 * Converts Quill HTML DOM structure to clean Markdown text
 */
function htmlToMarkdown(htmlOrNode) {
  const container = typeof htmlOrNode === 'string' ? document.createElement('div') : htmlOrNode;
  if (typeof htmlOrNode === 'string') container.innerHTML = htmlOrNode;

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    let childrenText = Array.from(node.childNodes).map(traverse).join('');

    switch (tag) {
      case 'h1': return `\n# ${childrenText.trim()}\n\n`;
      case 'h2': return `\n## ${childrenText.trim()}\n\n`;
      case 'h3': return `\n### ${childrenText.trim()}\n\n`;
      case 'h4': return `\n#### ${childrenText.trim()}\n\n`;
      case 'h5': return `\n##### ${childrenText.trim()}\n\n`;
      case 'h6': return `\n###### ${childrenText.trim()}\n\n`;
      case 'strong':
      case 'b': return `**${childrenText}**`;
      case 'em':
      case 'i': return `*${childrenText}*`;
      case 's':
      case 'strike':
      case 'del': return `~~${childrenText}~~`;
      case 'u': return `<u>${childrenText}</u>`;
      case 'img': return `![${node.getAttribute('alt') || 'image'}](${node.getAttribute('src') || ''})`;
      case 'code':
        return node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre'
          ? childrenText
          : `\`${childrenText}\``;
      case 'pre': return `\n\`\`\`\n${childrenText.trim()}\n\`\`\`\n\n`;
      case 'blockquote': return `\n> ${childrenText.trim().replace(/\n/g, '\n> ')}\n\n`;
      case 'ul': return `\n${childrenText}\n`;
      case 'ol': {
        // FIX Bug 5: Don't call traverse(li) which hits the 'li' case and prepends '- ',
        // producing '1. - item'. Instead traverse the li's children directly for clean text.
        let idx = 1;
        return `\n${Array.from(node.children).map(li => {
          const liText = Array.from(li.childNodes).map(traverse).join('').trim();
          return `${idx++}. ${liText}`;
        }).join('\n')}\n\n`;
      }
      case 'li': return `- ${childrenText.trim()}\n`;
      case 'p': return `${childrenText.trim()}\n\n`;
      case 'a': return `[${childrenText}](${node.getAttribute('href') || ''})`;
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        const mdRows = [];
        rows.forEach((tr, rowIndex) => {
          const cells = Array.from(tr.querySelectorAll('th, td'));
          const cellTexts = cells.map(c => Array.from(c.childNodes).map(traverse).join('').trim().replace(/\|/g, '\\|') || ' ');
          mdRows.push('| ' + cellTexts.join(' | ') + ' |');
          if (rowIndex === 0) {
            mdRows.push('| ' + Array(cellTexts.length).fill('---').join(' | ') + ' |');
          }
        });
        return '\n\n' + mdRows.join('\n') + '\n\n';
      }
      case 'th':
      case 'td':
        return childrenText.trim();
      case 'u': return childrenText; // No GFM equivalent for underline — strip tags, keep text
      case 'hr': return `\n---\n\n`;
      case 'br': return `\n`;
      case 'div': {
        // Handle Mermaid diagram blots: emit fenced mermaid block for clean MD/TXT export
        if (node.classList && node.classList.contains('ql-diagram-container')) {
          let mermaidSrc = node.getAttribute('data-mermaid') || '';
          if (mermaidSrc) {
            try { mermaidSrc = decodeURIComponent(mermaidSrc); } catch(e) {}
          }
          return mermaidSrc
            ? `\n\`\`\`mermaid\n${mermaidSrc.trim()}\n\`\`\`\n\n`
            : `\n<!-- diagram -->\n`;
        }
        // Handle Canvas drawings: emit the raw SVG so it isn't lost
        if (node.classList && node.classList.contains('ql-stylus-canvas')) {
          const svg = node.getAttribute('data-svg') || '';
          if (svg) {
            return `\n${svg}\n\n`;
          }
        }
        // Custom table containers: let the inner <table> case handle the content
        if (node.classList && node.classList.contains('ql-custom-table-container')) {
          return childrenText;
        }
        return childrenText;
      }
      default: return childrenText;
    }
  }

  return traverse(container).trim().replace(/\n{3,}/g, '\n\n');
}
window.htmlToMarkdown = htmlToMarkdown;

function exportExternalNoteMD() {
    if (!window.quillEditor) return;
    if (window.editorModeController) window.editorModeController.syncBeforeSave();
    const content = window.quillEditor.root.innerHTML;
  if (!content || content === '<p><br></p>') { alert("Note is empty."); return; }
  
  const title = document.getElementById('external-note-title').value.trim() || 'Untitled Note';
  const mdText = htmlToMarkdown(content);
  
  const blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title + '.md';
  a.click();
}
window.exportExternalNoteMD = exportExternalNoteMD;

function convertCurrentNoteFromMarkdown() {
  // Guard: warn user this is a destructive replace of all formatting
  const currentText = window.quillEditor && window.quillEditor.getText().trim();
  if (currentText && currentText.length > 10) {
    const ok = confirm(
      '⚠️ Convert to Rich Text\n\nThis will parse all text in the editor as Markdown and replace the current formatting.\n\nContinue?'
    );
    if (!ok) return;
  }
  if (window.mdIntelligence) {
    window.mdIntelligence.convertCurrentContent();
  } else if (window.quillEditor && typeof marked !== 'undefined' && marked.parse) {
    MarkedConfigAdapter.configure();
    const raw = window.quillEditor.getText().trim();
    if (raw) {
      window.quillEditor.setText('\n', 'api'); // 'api' source: suppresses auto-save on blank content
      window.quillEditor.clipboard.dangerouslyPasteHTML(0, marked.parse(raw), 'user');
    }
  }
}
window.convertCurrentNoteFromMarkdown = convertCurrentNoteFromMarkdown;

function exportExternalNoteTXT() {
  if (!window.quillEditor) return;
  if (window.editorModeController) window.editorModeController.syncBeforeSave();
  const content = window.quillEditor.root.innerHTML;
  if (!content || content === '<p><br></p>') { alert("Note is empty."); return; }
  
  const title = document.getElementById('external-note-title').value.trim() || 'Untitled Note';
  const plainText = htmlToMarkdown(content);
  
  const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title + '.txt';
  a.click();
}

function exportExternalNotePDF() {
    if (!window.quillEditor) return;
    if (window.editorModeController) window.editorModeController.syncBeforeSave();
    const content = window.quillEditor.root.innerHTML;
  if (!content || content === '<p><br></p>') { alert("Note is empty."); return; }
  
  const title = document.getElementById('external-note-title').value.trim() || 'Untitled Note';
  
  var iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);
  
  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<html><head><title>'+title+'</title><style>body{font-family:sans-serif;padding:20px;line-height:1.6;} img{max-width:100%;height:auto;}</style></head><body>');
  doc.write('<h2>' + title + '</h2><hr>');
  doc.write(content);
  doc.write('</body></html>');
  doc.close();
  
  iframe.contentWindow.focus();
  setTimeout(function() {
    iframe.contentWindow.print();
    setTimeout(function() { document.body.removeChild(iframe); }, 1000);
  }, 250);
}

// Function to open the Full Editor specifically for a session note (PDF highlight note)
window.editSessionNoteInFullEditor = async function(id) {
  if (!window.notes) return;
  const note = window.notes.find(n => String(n.id) === String(id));
  if (!note) return;

  currentSessionNoteId = note.id;
  currentExternalNoteId = null; // Clear global context
  window.currentExternalNoteId = null;

  // FIX R2: Direct overlay display without redundant openExternalNotes() call
  const overlay = document.getElementById('external-notes-overlay');
  if (overlay) overlay.style.display = 'flex';
  if (typeof updateMarkdownUI === 'function') updateMarkdownUI();

  // Set the title visually (session notes don't formally use titles, but this looks better)
  const titleEl = document.getElementById('external-note-title');
  if (titleEl) titleEl.value = 'Highlight Note ' + (note.isHl ? '(Annotated)' : '');

  // FIX Bug 4 & R2: Use ensureQuillEditor() without multiple competing inits
  const editor = await ensureQuillEditor();
  if (editor) {
    const html = note.txt || '';
    if (editor.clipboard && editor.clipboard.dangerouslyPasteHTML) {
      editor.setText('\n');
      editor.clipboard.dangerouslyPasteHTML(0, html, 'api');
    } else {
      editor.root.innerHTML = html;
    }
  }
  loadExternalNotesList();
};

// Open the note in the main Enhanced Reader viewer
async function readNoteInReader(id) {
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  if (!window.notesRepo) return;
  
  try {
    const note = await window.notesRepo.getNote(parsedId);
    if (note && window.openFile) {
      // Always prefer re-generating markdown from the HTML source of truth to handle legacy corrupted rawText
      const mdContent = (typeof htmlToMarkdown === 'function' ? htmlToMarkdown(note.content || '') : note.rawText || note.content);
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const file = new File([blob], (note.title || 'Untitled Note') + '.md', { type: 'text/markdown' });
      
      closeExternalNotes(); // Close the modal
      window.openFile(file); // Open in Enhanced Reader
      
      // Auto-slide away the AI sidebar so the user can see the note
      const panel = document.getElementById('ai-panel');
      if (panel && !panel.classList.contains('hidden') && window.togglePanel) {
        window.togglePanel();
      }
    }
  } catch(e) {
    console.error("Failed to read note:", e);
  }
}

// ── Diagram Builder Integration for External Notes Editor ────────────────
function openDiagramBuilderForExternalEditor() {
  if (window.DiagramBuilder && typeof window.DiagramBuilder.open === 'function') {
    window.DiagramBuilder.open();
  } else {
    alert("Diagram Builder is initializing. Please try again in a moment.");
  }
}
window.openDiagramBuilderForExternalEditor = openDiagramBuilderForExternalEditor;

function insertDiagramIntoExternalEditor(svgHtml, mermaidCode) {
  const overlay = document.getElementById('external-notes-overlay');
  const codeBlock = `\n\n\`\`\`mermaid\n${(mermaidCode || '').trim()}\n\`\`\`\n\n`;
  
  if (!overlay || overlay.style.display === 'none') {
    // If Full Editor is closed, save it as a new Global Note
    if (window.notesRepo) {
      const noteToSave = {
        title: 'Diagram Note ' + new Date().toLocaleString(),
        content: `<p>Diagram generated from builder</p>${svgHtml}`,
        rawText: codeBlock
      };
      window.notesRepo.saveNote(noteToSave).then(() => {
        if (window.refreshExternalNotesList) window.refreshExternalNotesList();
      });
      return true; // Successfully saved to Full Editor backend
    }
    return false;
  }

  const mode = window.editorModeController ? window.editorModeController.mode : 'visual';

  if (mode === 'markdown') {
    const rawEditor = document.getElementById('markdown-source-editor');
    if (rawEditor) {
      const start = rawEditor.selectionStart || rawEditor.value.length;
      const end = rawEditor.selectionEnd || rawEditor.value.length;
      const val = rawEditor.value;
      rawEditor.value = val.substring(0, start) + codeBlock + val.substring(end);
      rawEditor.selectionStart = rawEditor.selectionEnd = start + codeBlock.length;
      rawEditor.focus();
      return true;
    }
  } else {
    // Visual mode (Quill)
    if (window.quillEditor) {
      const selection = window.quillEditor.getSelection(true);
      const index = selection ? selection.index : window.quillEditor.getLength();
      window.quillEditor.insertEmbed(index, 'custom-diagram', { svg: svgHtml, mermaid: mermaidCode }, 'user');
      window.quillEditor.insertText(index + 1, '\n', 'user');
      window.quillEditor.setSelection(index + 2, 'silent');
      return true;
    }
  }
  return false;
}
window.insertDiagramIntoExternalEditor = insertDiagramIntoExternalEditor;

window.openStylusDrawing = function() {
    if (!window.StylusEngine || !window.StylusEngine.isSupported) {
        if (window.showToast) window.showToast('Drawing requires a modern browser with Pointer Events support.');
        else alert('Drawing requires a modern browser with Pointer Events support.');
        return;
    }
    
    // Switch to visual mode if not already
    if (window.currentEditorMode === 'markdown') {
        if (typeof toggleEditorMode === 'function') {
            toggleEditorMode();
        }
    }
    
    if (window.quillEditor) {
        const selection = window.quillEditor.getSelection(true);
        const index = selection ? selection.index : window.quillEditor.getLength();
        
        // Insert a new stylus canvas block
        window.quillEditor.insertEmbed(index, 'stylus-canvas', {
            strokes: '[]',
            svg: '',
            meta: { version: 1 }
        }, 'user');
        
        // Add a newline after
        window.quillEditor.insertText(index + 1, '\n', 'user');
        window.quillEditor.setSelection(index + 2, 'silent');
        
        // Focus the newly inserted node to activate Stylus Mode immediately
        setTimeout(() => {
            const nodes = window.quillEditor.root.querySelectorAll('.ql-stylus-canvas');
            if (nodes.length > 0) {
                const newNode = nodes[nodes.length - 1];
                newNode.focus();
                // Manually trigger activation just in case focus doesn't propagate
                if (window.StylusEngine && window.StylusEngine.activate) {
                    window.StylusEngine.activate(newNode);
                }
            }
        }, 50);
    } else {
        console.warn("Cannot insert drawing, quillEditor is not initialized.");
    }
};

window.duplicateExternalNote = async function(id) {
    if (!window.notesRepo) return;
    const note = await window.notesRepo.getNote(id);
    if (!note) return;
    
    // Deep clone to safely alter properties
    const newNote = JSON.parse(JSON.stringify(note));
    delete newNote.id; // ensure we get a new ID in saveNote logic
    newNote.title = (newNote.title || 'Untitled') + '_copy';
    newNote.updatedAt = Date.now();
    newNote.createdAt = Date.now();

    await window.notesRepo.saveNote(newNote);
    if (typeof loadExternalNotesList === 'function') {
        loadExternalNotesList();
    }
    if (window.showToast) window.showToast('Note duplicated');
};

window.exportExternalNoteRAW = async function() {
    if (!window.notesRepo) return;
    const id = window.currentExternalNoteId || (typeof currentExternalNoteId !== 'undefined' ? currentExternalNoteId : null);
    if (!id) {
        alert("No note is currently open.");
        return;
    }
    
    // Auto-save any pending typing in the editor before grabbing it from the DB
    if (typeof saveExternalNote === 'function') {
        await saveExternalNote(true);
    }
    
    const note = await window.notesRepo.getNote(id);
    if (!note) return;
    
    const dataStr = JSON.stringify(note, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (note.title || 'Untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `${safeTitle}.auranote.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.importExternalNoteRAW = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const parsedNote = JSON.parse(e.target.result);
            if (typeof parsedNote !== 'object' || !parsedNote) throw new Error("Invalid note format");
            
            parsedNote.id = Date.now().toString(); // Always assign new ID to avoid overwriting existing
            parsedNote.updatedAt = Date.now();
            parsedNote.createdAt = Date.now();
            
            if (!window.notesRepo) {
                alert("Notes repository not initialized.");
                return;
            }
            
            // AUTO-CATEGORIZATION LOGIC
            // If the note doesn't already have a book prefix, and we have a book open, attach it
            if (!/^\[book:[^\]]+\]/.test(parsedNote.title || '')) {
                let targetBookId = null;
                const bookRegex = /^\[book:([^\]]+)\](?:\[ch:(\d+)\]\s*)?(.*)$/;
                
                if (window.currentExternalNoteId) {
                    const notes = await window.notesRepo.getAllNotes();
                    const currentNote = notes.find(n => String(n.id) === String(window.currentExternalNoteId));
                    if (currentNote) {
                        const m = bookRegex.exec(currentNote.title);
                        if (m) {
                            targetBookId = m[1];
                        }
                    }
                }
                
                if (targetBookId) {
                    const confirmAdd = confirm("You have a project open. Do you want to add this uploaded note to the current project?\n\nClick OK to add as a new chapter, or Cancel to keep it as an Uncategorized note.");
                    if (confirmAdd) {
                        // Find max chapter for this book
                        const notes = await window.notesRepo.getAllNotes();
                        let maxCh = 0;
                        for (const n of notes) {
                            const m = bookRegex.exec(n.title);
                            if (m && m[1] === targetBookId && m[2]) {
                                maxCh = Math.max(maxCh, parseInt(m[2], 10));
                            }
                        }
                        const newCh = maxCh + 1;
                        const oldTitle = parsedNote.title || 'Imported Note';
                        parsedNote.title = `[book:${targetBookId}][ch:${newCh}] ${oldTitle}`;
                    }
                }
            }
            
            await window.notesRepo.saveNote(parsedNote);
            if (typeof loadExternalNotesList === 'function') {
                loadExternalNotesList();
            }
            if (window.showToast) window.showToast('Note imported successfully');
            
        } catch (err) {
            console.error(err);
            alert("Failed to parse RAW note file. Make sure it is a valid .auranote.json file.");
        }
        
        // Reset input so the same file can be selected again
        event.target.value = '';
    };
    reader.readAsText(file);
};
if (typeof Worker !== 'undefined') {
  window.MarkdownWorker = new Worker('/static/js/workers/markdown-worker.js');
}

// --- Template Manager Integration ---
function initTemplateManager() {
    console.log('[TemplateManager] initTemplateManager called for Sidebar!');
    const menuContainer = document.getElementById('templates-sidebar-content') || document.getElementById('tools-dropdown-menu');
    
    if (!menuContainer) {
        console.warn('[TemplateManager] Missing menuContainer!');
        return false;
    }
    if (typeof TemplateManager === 'undefined') {
        console.warn('[TemplateManager] Missing TemplateManager class!');
        return false;
    }
    if (typeof EditorAdapter === 'undefined') {
        console.warn('[TemplateManager] Missing EditorAdapter class!');
        return false;
    }

    TemplateManager.renderDropdown(menuContainer, (strategy) => {
        console.log('[TemplateManager] Clicked strategy:', strategy.id);
        const quillContainer = document.getElementById('quill-editor') || document.getElementById('quill-editor-container');
        const mdEditor = document.getElementById('markdown-source-editor') || document.getElementById('external-notes-editor-md');
        
        const adapter = new EditorAdapter(window.quillEditor, quillContainer, mdEditor);
        adapter.insertStrategy(strategy);
        
        const sidebar = document.getElementById('templates-sidebar');
        if (sidebar) sidebar.style.right = '-250px';
    });
    return true;
}

// Try initializing immediately, if fail, try when DOM loaded, if fail, poll a few times
if (!initTemplateManager()) {
    document.addEventListener('DOMContentLoaded', () => {
        if (!initTemplateManager()) {
            let retries = 5;
            let timer = setInterval(() => {
                if (initTemplateManager() || retries <= 0) {
                    clearInterval(timer);
                }
                retries--;
            }, 500);
        }
    });
}








