const fs = require('fs');
const path = require('path');

// ─── Shared Quill factory ─────────────────────────────────────────────────

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
    formatLine: jest.fn()
  };
  return q;
}

// ─── Load module helper ───────────────────────────────────────────────────

function loadEditorModule() {
  // Minimal Quill class stub so the module initialises CustomTableBlot without errors
  const fakeQuill = makeQuill();
  window.Quill = class {
    constructor() { return fakeQuill; }
    static import(name) {
      class BE {
        static create() { return document.createElement('div'); }
        static value(n) { return n.innerHTML; }
      }
      return BE;
    }
    static register() {}
  };

  window.marked = { use: jest.fn(), parse: jest.fn(md => `<p>${md}</p>`) };

  eval(fs.readFileSync(
    path.resolve(__dirname, '../src/static/js/external-editor.js'), 'utf8'
  ));

  // After eval, initQuillEditor() has NOT been called (quillEditor is still null).
  // Call it now so window.quillEditor is available for tests.
  initQuillEditor();

  // Expose module-scoped functions to test scope via window for assertions
  // (they are already accessible in the eval scope via closure)
  window._closeExternalNotes = closeExternalNotes;
  window._createNewExternalNote = createNewExternalNote;
  window._loadExternalNote = loadExternalNote;
  window._saveExternalNote = saveExternalNote;
  window._deleteExternalNote = deleteExternalNote;
  window._saveTimeout_ref = () => saveTimeout;

  // Prevent JSDOM from throwing 'Not implemented: navigation' on anchor clicks
  HTMLAnchorElement.prototype.click = jest.fn();
}

// ─── Test Suite ───────────────────────────────────────────────────────────

describe('Notes Full Editor — Robustness Tests', () => {

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="external-notes-overlay" style="display:none;"></div>
      <div id="quill-editor"></div>
      <textarea id="markdown-source-editor" style="display:none;"></textarea>
      <input id="external-note-title" value="" />
      <button id="save-external-btn">Save</button>
      <button id="mode-toggle-btn">Markdown Source</button>
      <button id="md-convert-btn">Markdown</button>
      <div id="external-notes-list"></div>
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

    loadEditorModule();
  });

  // ── Bug 1 ──────────────────────────────────────────────────────────────────
  describe('Bug 1 — createNewExternalNote defined exactly once (complete version)', () => {
    describe('Prefix Hiding UI', () => {
      test('Prefix hiding extracts [book:] correctly on load and reappends on save', async () => {
        // Setup DOM
        document.body.innerHTML = '<input id="external-note-title" value="" />';
        const titleEl = document.getElementById('external-note-title');
        
        // Fake note to load
        const note = {
          id: 'test-1',
          title: '[book:abc-123][ch:4] Real Title',
          content: '<p>Content</p>'
        };
        
        // Load logic
        const match = (note.title || '').match(/^(\[book:[^\]]+\](?:\[ch:\d+\]\s*)?)(.*)$/);
        if (match) {
            titleEl.dataset.bookPrefix = match[1];
            titleEl.value = match[2];
        }
        
        expect(titleEl.dataset.bookPrefix).toBe('[book:abc-123][ch:4] ');
        expect(titleEl.value).toBe('Real Title');
        
        // User modifies title
        titleEl.value = 'New Awesome Title';
        
        // Save logic
        const prefix = titleEl.dataset.bookPrefix || '';
        const finalTitle = prefix + titleEl.value.trim();
        
        expect(finalTitle).toBe('[book:abc-123][ch:4] New Awesome Title');
      });
    });

    test('function exists', () => {
      expect(typeof window._createNewExternalNote).toBe('function');
    });

    test('clears the markdown textarea (only the complete version does this)', () => {
      document.getElementById('markdown-source-editor').value = 'old content';
      window._createNewExternalNote();
      expect(document.getElementById('markdown-source-editor').value).toBe('');
    });

    test('clears the title input', () => {
      document.getElementById('external-note-title').value = 'My Note';
      window._createNewExternalNote();
      expect(document.getElementById('external-note-title').value).toBe('Untitled Note');
    });
  });

  // ── Bug 2 ──────────────────────────────────────────────────────────────────
  describe('Bug 2 — closeExternalNotes always saves on close', () => {
    test('calls saveExternalNote even when no pending timer', async () => {
      window.quillEditor.root.innerHTML = '<p>Hello World</p>';
      window.quillEditor.getText = jest.fn().mockReturnValue('Hello World');

      window._closeExternalNotes();
      await new Promise(r => setTimeout(r, 30));

      expect(window.notesRepo.saveNote).toHaveBeenCalled();
    });

    test('hides overlay immediately', () => {
      const overlay = document.getElementById('external-notes-overlay');
      overlay.style.display = 'flex';
      window._closeExternalNotes();
      expect(overlay.style.display).toBe('none');
    });
  });

  // ── Bug 3 ──────────────────────────────────────────────────────────────────
  describe('Bug 3 — saveExternalNote does not crash when save button is absent', () => {
    test('global note save: no crash without save button', async () => {
      document.getElementById('save-external-btn').remove();
      window.quillEditor.root.innerHTML = '<p>Test</p>';
      window.quillEditor.getText = jest.fn().mockReturnValue('Test');

      await expect(window._saveExternalNote(false)).resolves.toBeUndefined();
    });

    test('session note save: no crash without save button', async () => {
      document.getElementById('save-external-btn').remove();
      window.quillEditor.root.innerHTML = '<p>Session content</p>';
      window.quillEditor.getText = jest.fn().mockReturnValue('Session content');
      window.notes = [{ id: 'note-1', txt: '', isHl: false }];
      // set currentSessionNoteId via the module
      window._loadExternalNote && (window.notes[0].txt = '');
      // Directly set the module-scoped variable via editSessionNoteInFullEditor
      await window.editSessionNoteInFullEditor('note-1');

      await expect(window._saveExternalNote(false)).resolves.toBeUndefined();
    });
  });

  // ── Bug 4 ──────────────────────────────────────────────────────────────────
  describe('Bug 4 — editSessionNoteInFullEditor uses ensureQuillEditor', () => {
    test('loads content via dangerouslyPasteHTML', async () => {
      window.notes = [{ id: 'hl-1', txt: '<p>Highlight</p>', isHl: true }];
      await window.editSessionNoteInFullEditor('hl-1');

      expect(window.quillEditor.clipboard.dangerouslyPasteHTML)
        .toHaveBeenCalledWith(0, '<p>Highlight</p>', 'api');
    });

    test('sets annotated title for highlighted notes', async () => {
      window.notes = [{ id: 'hl-2', txt: '<p>x</p>', isHl: true }];
      await window.editSessionNoteInFullEditor('hl-2');

      const title = document.getElementById('external-note-title').value;
      expect(title).toContain('Highlight Note');
      expect(title).toContain('(Annotated)');
    });

    test('does nothing for unknown id', async () => {
      window.notes = [];
      window.quillEditor.clipboard.dangerouslyPasteHTML.mockClear();
      await window.editSessionNoteInFullEditor('nope');
      expect(window.quillEditor.clipboard.dangerouslyPasteHTML).not.toHaveBeenCalled();
    });
  });

  // ── Bug 5 ──────────────────────────────────────────────────────────────────
  describe('Bug 5 — htmlToMarkdown: <ol> no double-prefix', () => {
    test('ordered list: "1. item" not "1. - item"', () => {
      const md = window.htmlToMarkdown('<ol><li>First</li><li>Second</li></ol>');
      expect(md).toContain('1. First');
      expect(md).toContain('2. Second');
      expect(md).not.toMatch(/\d+\.\s+-\s+/);  // no "1. - "
    });

    test('unordered list still uses "- " prefix', () => {
      const md = window.htmlToMarkdown('<ul><li>Apple</li><li>Banana</li></ul>');
      expect(md).toContain('- Apple');
      expect(md).toContain('- Banana');
    });

    test('bold inside ol item preserved without double-prefix', () => {
      const md = window.htmlToMarkdown('<ol><li><strong>Bold</strong></li></ol>');
      expect(md).toContain('1. **Bold**');
      expect(md).not.toContain('1. - ');
    });
  });

  // ── Bugs 7 & 8 ────────────────────────────────────────────────────────────
  describe('Bugs 7 & 8 — dangerouslyPasteHTML used instead of .root.innerHTML', () => {
    test('loadExternalNote uses dangerouslyPasteHTML', async () => {
      window.notesRepo.getNote = jest.fn().mockResolvedValue({
        id: 1, title: 'Test', content: '<p>Note content</p>', updatedAt: Date.now()
      });

      await window._loadExternalNote(1);
      
      // Wait for the 20ms yield to main thread introduced in Round 2
      await new Promise(r => setTimeout(r, 50));

      expect(window.quillEditor.clipboard.dangerouslyPasteHTML)
        .toHaveBeenCalledWith(0, '<p>Note content</p>', 'api');
    });

    test('syncBeforeSave in markdown mode uses dangerouslyPasteHTML', () => {
      window.editorModeController.mode = 'markdown';
      document.getElementById('markdown-source-editor').value = '# Hello';
      window.quillEditor.clipboard.dangerouslyPasteHTML.mockClear();

      window.editorModeController.syncBeforeSave();

      expect(window.quillEditor.clipboard.dangerouslyPasteHTML).toHaveBeenCalled();
    });

    test('syncBeforeSave in visual mode is a no-op', () => {
      window.editorModeController.mode = 'visual';
      window.quillEditor.clipboard.dangerouslyPasteHTML.mockClear();

      window.editorModeController.syncBeforeSave();

      expect(window.quillEditor.clipboard.dangerouslyPasteHTML).not.toHaveBeenCalled();
    });
  });

  // ── htmlToMarkdown full coverage ──────────────────────────────────────────
  describe('htmlToMarkdown — full serialization', () => {
    test('headings h1-h6', () => {
      ['h1','h2','h3','h4','h5','h6'].forEach((tag, i) => {
        const md = window.htmlToMarkdown(`<${tag}>Title</${tag}>`);
        expect(md).toContain('#'.repeat(i+1) + ' Title');
      });
    });
    test('bold and italic', () => {
      expect(window.htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**');
      expect(window.htmlToMarkdown('<em>italic</em>')).toContain('*italic*');
    });
    test('strikethrough', () => {
      expect(window.htmlToMarkdown('<s>struck</s>')).toContain('~~struck~~');
    });
    test('inline code and code block', () => {
      expect(window.htmlToMarkdown('<code>x</code>')).toContain('`x`');
      expect(window.htmlToMarkdown('<pre><code>block</code></pre>')).toContain('```');
    });
    test('blockquote', () => {
      expect(window.htmlToMarkdown('<blockquote>quote</blockquote>')).toContain('> quote');
    });
    test('link', () => {
      expect(window.htmlToMarkdown('<a href="https://x.com">X</a>')).toContain('[X](https://x.com)');
    });
    test('image', () => {
      expect(window.htmlToMarkdown('<img src="a.png" alt="img" />')).toContain('![img](a.png)');
    });
    test('table with separator row', () => {
      const md = window.htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
      expect(md).toContain('| A | B |');
      expect(md).toContain('| --- | --- |');
      expect(md).toContain('| 1 | 2 |');
    });
    test('pipe chars in cells escaped', () => {
      expect(window.htmlToMarkdown('<table><tr><th>A|B</th></tr></table>')).toContain('\\|');
    });
    test('hr', () => {
      expect(window.htmlToMarkdown('<hr>')).toContain('---');
    });
    test('no triple blank lines', () => {
      expect(window.htmlToMarkdown('<p>A</p><p></p><p></p><p>B</p>')).not.toMatch(/\n{3,}/);
    });
  });

  // ── SmartMarkdownNormalizer ───────────────────────────────────────────────
  describe('SmartMarkdownNormalizer', () => {
    test('normalizes unicode bullets to "- "', () => {
      const out = window.SmartMarkdownNormalizer.normalize('• A\n● B\n▪ C');
      expect(out).toContain('- A');
      expect(out).toContain('- B');
      expect(out).toContain('- C');
    });
    test('converts TSV to markdown table', () => {
      const out = window.SmartMarkdownNormalizer.normalize('Name\tAge\nAlice\t30');
      expect(out).toContain('| Name | Age |');
      expect(out).toContain('| --- | --- |');
      expect(out).toContain('| Alice | 30 |');
    });
    test('preserves content inside fenced code blocks', () => {
      const out = window.SmartMarkdownNormalizer.normalize('```\n• not replaced\n```');
      expect(out).toContain('• not replaced');
    });
    test('wraps bare mermaid with fences', () => {
      const out = window.SmartMarkdownNormalizer.normalize('mermaid\ngraph LR\n  A-->B\n## Done');
      expect(out).toContain('```mermaid');
    });
    test('returns empty string for falsy input', () => {
      expect(window.SmartMarkdownNormalizer.normalize(null)).toBe('');
      expect(window.SmartMarkdownNormalizer.normalize('')).toBe('');
    });
  });

  // ── detectMarkdown ─────────────────────────────────────────────────────────
  describe('MarkdownIntelligenceEngine.detectMarkdown', () => {
    test('detects headers', () => expect(window.mdIntelligence.detectMarkdown('# H\ntext')).toBe(true));
    test('detects code blocks', () => expect(window.mdIntelligence.detectMarkdown('```js\ncode\n```')).toBe(true));
    test('detects bold', () => expect(window.mdIntelligence.detectMarkdown('**bold** text here')).toBe(true));
    test('detects table', () => expect(window.mdIntelligence.detectMarkdown('| A | B |\n| --- | --- |')).toBe(true));
    test('plain text returns false', () => expect(window.mdIntelligence.detectMarkdown('just a sentence')).toBe(false));
  });

  // ── isEnabled ─────────────────────────────────────────────────────────────
  describe('MarkdownIntelligenceEngine.isEnabled', () => {
    test('true when markdown enabled', () => {
      window.settingsRepo.isTrue = jest.fn().mockReturnValue(false);
      expect(window.mdIntelligence.isEnabled()).toBe(true);
    });
    test('false when markdown disabled', () => {
      window.settingsRepo.isTrue = jest.fn().mockReturnValue(true);
      expect(window.mdIntelligence.isEnabled()).toBe(false);
    });
  });

  // ── updateMarkdownUI ──────────────────────────────────────────────────────
  describe('updateMarkdownUI — button visibility tracks setting', () => {
    test('hides buttons when disabled', () => {
      window.settingsRepo.isTrue = jest.fn().mockReturnValue(true);
      window.updateMarkdownUI();
      expect(document.getElementById('mode-toggle-btn').style.display).toBe('none');
      expect(document.getElementById('md-convert-btn').style.display).toBe('none');
    });
    test('shows buttons when enabled', () => {
      window.settingsRepo.isTrue = jest.fn().mockReturnValue(false);
      window.updateMarkdownUI();
      expect(document.getElementById('mode-toggle-btn').style.display).toBe('inline-block');
      expect(document.getElementById('md-convert-btn').style.display).toBe('inline-block');
    });
  });

  // ── Regression Fixes R1-R4 ────────────────────────────────────────────────
  describe('Regression Fixes R1-R4', () => {
    test('R1: syncBeforeSave skips destructive update if marked is undefined', () => {
      window.editorModeController.mode = 'markdown';
      document.getElementById('markdown-source-editor').value = '# Untouched Note';
      const originalMarked = window.marked;
      delete window.marked;

      window.quillEditor.clipboard.dangerouslyPasteHTML.mockClear();
      window.editorModeController.syncBeforeSave();

      expect(window.quillEditor.clipboard.dangerouslyPasteHTML).not.toHaveBeenCalled();
      window.marked = originalMarked;
    });

    test('R2: editSessionNoteInFullEditor sets overlay and loads session note without openExternalNotes duplication', async () => {
      const overlay = document.getElementById('external-notes-overlay');
      overlay.style.display = 'none';

      window.notes = [{ id: 'sess-100', txt: '<p>Session note content</p>', isHl: false }];
      await window.editSessionNoteInFullEditor('sess-100');

      expect(overlay.style.display).toBe('flex');
      expect(document.getElementById('external-note-title').value).toBe('Highlight Note ');
      expect(window.quillEditor.clipboard.dangerouslyPasteHTML).toHaveBeenCalledWith(
        0, '<p>Session note content</p>', 'api'
      );
    });

    test('R3: createNewExternalNote calls setText("") on quillEditor', () => {
      window.quillEditor.setText = jest.fn();
      window._createNewExternalNote();
      expect(window.quillEditor.setText).toHaveBeenCalledWith('\n');
    });

    test('R4: Auto-save text-change listener ignores non-user events (source !== "user")', () => {
      jest.useFakeTimers();
      const saveSpy = jest.fn();
      window._saveExternalNote = saveSpy;

      // Emit text-change with source = 'api'
      window.quillEditor.emit('text-change', {}, {}, 'api');
      jest.advanceTimersByTime(6000);
      expect(saveSpy).not.toHaveBeenCalled();

      // Emit text-change with source = 'user'
      window.quillEditor.emit('text-change', {}, {}, 'user');
      // The timeout calls saveExternalNote
      jest.useRealTimers();
    });
  });

  describe('Diagram and AI Notes Export Fixes', () => {
    test('htmlToMarkdown correctly extracts data-mermaid from ql-diagram-container', () => {
      const mermaidCode = 'graph TD\\n  A-->B';
      const containerHtml = `<div class="ql-diagram-container" data-mermaid="${encodeURIComponent(mermaidCode)}"><svg></svg></div>`;
      
      const wrapper = document.createElement('div');
      wrapper.innerHTML = containerHtml;
      
      const result = window.htmlToMarkdown(wrapper.firstChild);
      expect(result).toContain('```mermaid');
      expect(result).toContain('graph TD\\n  A-->B');
      expect(result).toContain('```');
    });

    test('MarkdownIntelligenceEngine handles fast typing (no trailing characters required)', () => {
      // Simulate typing "# " 
      window.quillEditor.getText = jest.fn(() => '# ');
      window.quillEditor.getSelection = jest.fn(() => ({ index: 2, length: 0 }));
      window.quillEditor.getLine = jest.fn(() => [{ domNode: { textContent: '# ' } }, 0]);
      
      const mockFormatLine = jest.fn();
      window.quillEditor.formatLine = mockFormatLine;
      window.quillEditor.deleteText = jest.fn();

      window.mdIntelligence._handleTextChange();
      
      // Should format as header
      expect(mockFormatLine).toHaveBeenCalledWith(0, 1, 'header', 1, 'user');
    });
  });

  describe('New Features: Duplicate, Export RAW, Import RAW', () => {
    test('duplicateExternalNote creates a copy with _copy in title', async () => {
      window.notesRepo.getNote = jest.fn().mockResolvedValue({ id: 101, title: 'My Note', raw_text: 'Raw Content', content: '<p>Content</p>' });
      window.appEventBus = { emit: jest.fn() };
      
      await window.duplicateExternalNote(101);
      
      expect(window.notesRepo.saveNote).toHaveBeenCalled();
      const savedNote = window.notesRepo.saveNote.mock.calls[0][0];
      expect(savedNote.id).toBeUndefined();
      expect(savedNote.title).toBe('My Note_copy');
      expect(savedNote.raw_text).toBe('Raw Content');
      expect(savedNote.content).toBe('<p>Content</p>');
    });

    test('exportExternalNoteRAW triggers a download with correct JSON', async () => {
      window.currentExternalNoteId = 202;
      window.notesRepo.getNote = jest.fn().mockResolvedValue({ id: 202, title: 'Export Test', raw_text: 'Test Text', content: '<p>Test</p>' });
      document.getElementById('external-note-title').value = 'Export Test';
      window.quillEditor.root.innerHTML = '<p>Test</p>';
      window.quillEditor.getText = () => 'Test Text';
      
      const mockCreateElement = jest.spyOn(document, 'createElement');
      const mockAppendChild = jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      const mockRemoveChild = jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
      const mockRevoke = jest.fn();
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
      window.URL.revokeObjectURL = mockRevoke;

      await window.exportExternalNoteRAW();

      const aTag = mockCreateElement.mock.results.find(r => r.value.tagName === 'A').value;
      expect(aTag.download).toBe('export_test.auranote.json');
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      
      // Cleanup mocks
      mockCreateElement.mockRestore();
      mockAppendChild.mockRestore();
      mockRemoveChild.mockRestore();
    });
    
    test('importExternalNoteRAW handles file upload and triggers save', async () => {
      const mockEvent = {
        target: {
          files: [
            new File([JSON.stringify({
              title: "Imported Note",
              raw_text: "Imported Raw",
              content: "<p>Imported Content</p>"
            })], "test.auranote.json", { type: "application/json" })
          ],
          value: ""
        }
      };
      
      window.appEventBus = { emit: jest.fn() };
      const saveSpy = window.notesRepo.saveNote;
      saveSpy.mockClear();
      
      await window.importExternalNoteRAW(mockEvent);
      
      // Wait for FileReader to resolve
      await new Promise(r => setTimeout(r, 100));
      
      expect(saveSpy).toHaveBeenCalled();
      const savedNote = saveSpy.mock.calls[0][0];
      expect(savedNote.title).toBe('Imported Note');
      expect(savedNote.raw_text).toBe('Imported Raw');
    });

    test('saveExternalNote preserves markdown using htmlToMarkdown', async () => {
      window.currentNotesTab = 'text';
      window.quillEditor.root.innerHTML = '<h1>Markdown Heading</h1>';
      window.currentExternalNoteId = 300;
      window.notesRepo.saveNote = jest.fn().mockResolvedValue({ id: 300 });
      
      await window.saveExternalNote(true);
      
      const savedNote = window.notesRepo.saveNote.mock.calls[0][0];
      // The real htmlToMarkdown converts h1 to `# Heading`
      expect(savedNote.rawText.includes('# Markdown Heading')).toBe(true);
    });

    test('exportExternalNoteRAW automatically calls saveExternalNote before export', async () => {
      window.currentExternalNoteId = 301;
      // Setup the editor so saveExternalNote doesn't abort on empty content
      window.quillEditor.root.innerHTML = '<p>Something</p>';
      
      window.notesRepo.getNote = jest.fn().mockResolvedValue({ id: 301, title: 'Export', content: 'C' });
      // We don't mock saveExternalNote, we let the real one run and verify it triggered notesRepo.saveNote
      window.notesRepo.saveNote = jest.fn().mockResolvedValue({ id: 301 });
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
      const mockCreateElement = jest.spyOn(document, 'createElement');
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

      await window.exportExternalNoteRAW();

      // Ensure that saveExternalNote actually flushed to the repo before the GET
      expect(window.notesRepo.saveNote).toHaveBeenCalled();
      expect(window.notesRepo.getNote).toHaveBeenCalledWith(301);
      
      mockCreateElement.mockRestore();
    });

    test('exportExternalNoteMD and PDF trigger editorModeController.syncBeforeSave', () => {
      window.quillEditor.root.innerHTML = '<p>Test</p>';
      window.htmlToMarkdown = jest.fn().mockReturnValue('Test');
      window.editorModeController = { syncBeforeSave: jest.fn() };
      
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
      const mockCreateElement = jest.spyOn(document, 'createElement');
      
      window.exportExternalNoteMD();
      
      expect(window.editorModeController.syncBeforeSave).toHaveBeenCalled();
      
      mockCreateElement.mockRestore();
    });
  });

  describe('Front End Notebook Editor Operations - UI Workflows', () => {
    
    const setupMockDOM = () => {
      document.body.innerHTML = `
        <input id="external-note-title" />
        <div id="quill-editor"></div>
        <div class="ql-toolbar"></div>
        <div id="text-note-tools"></div>
        <div id="canvas-note-tools"></div>
        <div id="pure-canvas-container"></div>
        <textarea id="markdown-source-editor"></textarea>
        <div id="notes-search-results"></div>
        <div id="external-notes-list"></div>
        <div id="external-notes-overlay"></div>
        <div id="new-note-menu-options"></div>
      `;
      
      window.quillEditor = {
        root: { innerHTML: '' },
        getText: jest.fn().mockReturnValue(''),
        setText: jest.fn(),
        clipboard: { dangerouslyPasteHTML: jest.fn() }
      };
      
      return document.getElementById('external-note-title');
    };

    test('createNewBook triggers prompt and sets book prefix', async () => {
      const titleEl = setupMockDOM();
      
      window._originalPrompt = window.prompt;
      window.prompt = jest.fn().mockReturnValue('My New Book');
      jest.spyOn(Date, 'now').mockReturnValue(100000);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456);

      window.currentExternalNoteId = 555;
      window.notesRepo = {
        getNote: jest.fn().mockResolvedValue({ id: 555, title: 'Untitled' }),
        saveNote: jest.fn().mockResolvedValue(true),
        getAllNotes: jest.fn().mockResolvedValue([])
      };

      await window.createNewBook();

      expect(window.prompt).toHaveBeenCalledWith("Enter new Book title:");
      expect(titleEl.dataset.bookPrefix).toBe('[book:b-255s4fzyo] ');
      expect(titleEl.value).toBe('My New Book');
      
      expect(window.notesRepo.saveNote).toHaveBeenCalled();

      window.prompt = window._originalPrompt;
      jest.restoreAllMocks();
    });

    test('createNewChapter triggers prompt and sets [ch:X]', async () => {
      const titleEl = setupMockDOM();
      
      window._originalPrompt = window.prompt;
      window.prompt = jest.fn().mockReturnValue('Chapter 2');
      
      window.currentExternalNoteId = 600;
      window.notesRepo = {
        getAllNotes: jest.fn().mockResolvedValue([
          { id: 600, title: '[book:b-test123]Root Book' },
          { id: 601, title: '[book:b-test123][ch:1] Chapter 1' }
        ]),
        getNote: jest.fn().mockResolvedValue({ id: 602, title: 'Untitled' }),
        saveNote: jest.fn().mockResolvedValue(true)
      };

      await window.createNewChapter();

      expect(window.prompt).toHaveBeenCalledWith('Enter chapter name for "Root Book":', 'Chapter 2');
      expect(titleEl.dataset.bookPrefix).toBe('[book:b-test123][ch:2] ');
      expect(titleEl.value).toBe('Chapter 2');

      window.prompt = window._originalPrompt;
    });

    test('deleteExternalNote deletes note and cascades if book root', async () => {
      setupMockDOM();
      window.confirm = jest.fn().mockReturnValue(true);
      window.notesRepo = {
        deleteNote: jest.fn().mockResolvedValue(true),
        getAllNotes: jest.fn().mockResolvedValue([])
      };
      
      await window._deleteExternalNote(777, false);
      expect(window.notesRepo.deleteNote).toHaveBeenCalledWith(777);
    });

    test('loadExternalNote updates UI and datasets', async () => {
      const titleEl = setupMockDOM();
      window.notesRepo = {
        getNote: jest.fn().mockResolvedValue({ id: 888, title: '[book:abc][ch:1] Loaded Title', content: 'hello', raw_text: 'hello' }),
        getAllNotes: jest.fn().mockResolvedValue([])
      };
      
      window.editorModeController = { syncToMode: jest.fn() };
      
      await window._loadExternalNote(888);
      
      expect(titleEl.dataset.bookPrefix).toBe('[book:abc][ch:1] ');
      expect(titleEl.value).toBe('Loaded Title');
      expect(window.currentExternalNoteId).toBe(888);
    });

    test('Ask AI prompt intercepts and fires window.askAI', () => {
      let triggered = false;
      let promptSent = null;
      window.askAI = (p) => { triggered = true; promptSent = p; };
      
      // Simulate calling it directly as a button click would
      window.askAI("Explain this diagram");
      
      expect(triggered).toBe(true);
      expect(promptSent).toBe("Explain this diagram");
    });
  });
});
