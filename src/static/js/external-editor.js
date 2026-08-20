window.quillEditor = null;
let currentExternalNoteId = null; // Used for global notes
let currentSessionNoteId = null;  // Used for highlight notes
let saveTimeout = null;

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
    const toolbarOptions = [
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
        toolbar: toolbarOptions
      },
      placeholder: 'Start writing your note here (Markdown shortcuts supported: #, -, >, ```, **bold**)...'
    });

    // Attach Markdown Intelligence Engine
    window.mdIntelligence = new MarkdownIntelligenceEngine(window.quillEditor);

    // Auto-save logic
    window.quillEditor.on('text-change', function(delta, oldDelta, source) {
      // FIX R4: Ignore programmatic/API text changes to prevent phantom auto-save loops
      if (source !== 'user') return;
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveExternalNote, 5000); // Auto-save every 5 seconds
    });
  } catch (err) {
    console.error("Failed to initialize Quill editor:", err);
    alert("An error occurred while loading the editor: " + err.message);
  }
}

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
      { pattern: /^#{6}\s$/, format: { header: 6 }, prefixLen: 7 },
      { pattern: /^#{5}\s$/, format: { header: 5 }, prefixLen: 6 },
      { pattern: /^#{4}\s$/, format: { header: 4 }, prefixLen: 5 },
      { pattern: /^#{3}\s$/, format: { header: 3 }, prefixLen: 4 },
      { pattern: /^#{2}\s$/, format: { header: 2 }, prefixLen: 3 },
      { pattern: /^#{1}\s$/, format: { header: 1 }, prefixLen: 2 },
      { pattern: /^[-*+]\s$/, format: { list: 'bullet' }, prefixLen: 2 },
      { pattern: /^\d+\.\s$/, format: { list: 'ordered' }, prefixLen: (text) => text.indexOf('.') + 2 },
      { pattern: /^>\s$/, format: { blockquote: true }, prefixLen: 2 },
      { pattern: /^```\s*$/, format: { 'code-block': true }, prefixLen: 3 }
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

    // 1. Listen for keydown / text-change for live typing shortcuts
    this.quill.on('text-change', (delta, oldDelta, source) => {
      if (source !== 'user') return;
      this._handleTextChange();
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
          if (marked.use) {
            marked.use({ gfm: true, breaks: true });
          }
          html = marked.parse(normalized);
          // Wrap all <table>...</table> in custom-table container so Quill preserves them
          html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
            return `<div class="ql-custom-table-container">${match}</div>`;
          });
          // Strip light-mode inline styles that clash with dark theme
          html = html
            .replace(/\s*style="[^"]*background(?:-color)?:\s*(?:white|#fff|#ffffff)[^"]*"/gi, '')
            .replace(/\s*style="[^"]*color:\s*(?:black|#000|#000000)[^"]*"/gi, '')
            .replace(/background(?:-color)?:\s*(?:white|#fff|#ffffff)\s*;?/gi, '')
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
      if (marked.use) marked.use({ gfm: true, breaks: true });
      let html = marked.parse(normalized);
      // Wrap all <table>...</table> in custom-table container
      html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
        return `<div class="ql-custom-table-container">${match}</div>`;
      });
      
      if (this.quill.clipboard && this.quill.clipboard.dangerouslyPasteHTML) {
        this.quill.setText('');
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
  currentSessionNoteId = null;
  
  const titleInput = document.getElementById('external-note-title');
  if (titleInput) titleInput.value = title || 'Untitled Note';
  
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
    const notes = await window.notesRepo.getAllNotes();
    const listEl = document.getElementById('external-notes-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    if (notes.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-3); font-size:12px; padding:10px;">No saved notes.</div>';
      return;
    }
    
    notes.forEach(note => {
      const isSelected = currentExternalNoteId === note.id;
      const div = document.createElement('div');
      div.style.padding = '12px 16px';
      div.style.borderBottom = '1px solid var(--border)';
      div.style.cursor = 'pointer';
      div.style.background = isSelected ? 'rgba(255,107,0,0.1)' : 'transparent';
      div.style.borderLeft = isSelected ? '3px solid var(--accent)' : '3px solid transparent';
      div.style.transition = 'all 0.2s ease';
      
      div.onclick = () => loadExternalNote(note.id);
      
      const title = note.title || 'Untitled Note';
      const date = new Date(note.updatedAt).toLocaleString();
      
      div.innerHTML = `
        <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:11px; color:var(--text-3);">${date}</div>
          <div style="display:flex; gap:4px;">
            <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: var(--accent); background: transparent; border: 1px solid transparent; border-radius: 4px;" onclick="event.stopPropagation(); readNoteInReader('${note.id}')">Read</button>
            <button class="tb-btn" style="padding: 2px 6px; font-size: 10px; color: #e53e3e; background: transparent; border: 1px solid transparent; border-radius: 4px;" onclick="event.stopPropagation(); deleteExternalNote('${note.id}')">Delete</button>
          </div>
        </div>
      `;
      listEl.appendChild(div);
    });
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

  switchToMarkdown() {
    const rawEditor = document.getElementById('markdown-source-editor');
    const visualEditor = document.getElementById('quill-editor');
    const qlToolbar = document.querySelector('.ql-toolbar');
    const toggleBtn = document.getElementById('mode-toggle-btn');
    if (!rawEditor || !visualEditor || !window.quillEditor) return;

    // Convert current Quill HTML to Markdown
    const html = window.quillEditor.root.innerHTML;
    const md = htmlToMarkdown(html);
    rawEditor.value = md;

    visualEditor.style.display = 'none';
    if (qlToolbar) qlToolbar.style.display = 'none';
    rawEditor.style.display = 'block';
    rawEditor.focus();

    if (toggleBtn) {
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
      if (marked.use) marked.use({ gfm: true, breaks: true });
      html = marked.parse(normalized);
      html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
        return `<div class="ql-custom-table-container">${match}</div>`;
      });
    } else {
      html = normalized.replace(/\n/g, '<br>');
    }

    if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
      window.quillEditor.setText('');
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
          if (marked.use) marked.use({ gfm: true, breaks: true });
          html = marked.parse(normalized);
          html = html.replace(/<table(\s*[^>]*)>([\s\S]*?)<\/table>/gi, (match) => {
            return `<div class="ql-custom-table-container">${match}</div>`;
          });
          // FIX Bug 7 & R1: Use dangerouslyPasteHTML to go through Quill's Delta model.
          // Skip destructive raw-text replacement if marked parser is unavailable.
          if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
            window.quillEditor.setText('');
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
  
  if (!isEnabled && window.editorModeController && window.editorModeController.mode === 'markdown') {
    window.editorModeController.switchToVisual();
  }
}
window.updateMarkdownUI = updateMarkdownUI;

function createNewExternalNote() {
  currentExternalNoteId = null;
  currentSessionNoteId = null;
  document.getElementById('external-note-title').value = '';
  // FIX R3: Reset Delta model properly using setText('') instead of .root.innerHTML = ''
  if (window.quillEditor) window.quillEditor.setText('');
  const rawEditor = document.getElementById('markdown-source-editor');
  if (rawEditor) rawEditor.value = '';
  if (window.editorModeController && window.editorModeController.mode === 'markdown') {
    window.editorModeController.switchToVisual();
  }
  loadExternalNotesList();
}

async function loadExternalNote(id) {
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  if (!window.notesRepo) return;
  try {
    const note = await window.notesRepo.getNote(parsedId);
    if (note) {
      currentExternalNoteId = note.id;
      currentSessionNoteId = null; // Clear session note context
      document.getElementById('external-note-title').value = note.title || '';
      if (window.quillEditor) {
        // FIX Bug 8: Use dangerouslyPasteHTML to go through Quill's Delta model.
        // Direct .root.innerHTML assignment bypasses undo history — Ctrl+Z after load shows garbage.
        const html = note.content || '';
        if (window.quillEditor.clipboard && window.quillEditor.clipboard.dangerouslyPasteHTML) {
          window.quillEditor.setText('');
          window.quillEditor.clipboard.dangerouslyPasteHTML(0, html, 'api');
        } else {
          window.quillEditor.root.innerHTML = html;
        }
      }
      const rawEditor = document.getElementById('markdown-source-editor');
      if (rawEditor) {
        rawEditor.value = htmlToMarkdown(note.content || '');
      }
      loadExternalNotesList(); // Refresh list to update selection highlight
    }
  } catch(e) {
    console.error("Failed to load note:", e);
  }
}

async function saveExternalNote(silent = false) {
  if (!window.quillEditor) return;
  if (window.editorModeController) window.editorModeController.syncBeforeSave();
  
  const title = document.getElementById('external-note-title').value.trim();
  const content = window.quillEditor.root.innerHTML;
  const rawText = window.quillEditor.getText().trim();
  
  if (!content || content === '<p><br></p>') {
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
    title: title || 'Untitled Note',
    content: content,
    rawText: rawText
  };
  
  try {
    const saved = await window.notesRepo.saveNote(noteToSave);
    currentExternalNoteId = saved.id;
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

async function deleteExternalNote(id) {
    const parsedId = isNaN(Number(id)) ? id : Number(id);
    // Removed confirm() because Chrome's "Prevent this page from creating additional dialogs" permanently breaks it
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
      case 'hr': return `\n---\n\n`;
      case 'br': return `\n`;
      default: return childrenText;
    }
  }

  return traverse(container).trim().replace(/\n{3,}/g, '\n\n');
}
window.htmlToMarkdown = htmlToMarkdown;

function exportExternalNoteMD() {
  if (!window.quillEditor) return;
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
  if (window.mdIntelligence) {
    window.mdIntelligence.convertCurrentContent();
  } else if (window.quillEditor && typeof marked !== 'undefined' && marked.parse) {
    const raw = window.quillEditor.getText().trim();
    if (raw) window.quillEditor.root.innerHTML = marked.parse(raw);
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
      editor.setText('');
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
      const blob = new Blob([note.content], { type: 'text/markdown' });
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
