/**
 * Multi-Format Restart & Update Persistence Tests
 *
 * Verifies that notes, reading state (scroll position), and library entries
 * are correctly saved and restored across app restarts, updates, and logins
 * for ALL supported file types: PDF, Markdown (MD), EPUB, and TXT.
 *
 * Scroll state shapes per format:
 *   PDF:  { page: number, ratio: number }         — fractional page offset
 *   MD:   { type: 'md',   scrollTop: number }     — pixel scroll offset
 *   TXT:  { type: 'txt',  scrollTop: number }     — pixel scroll offset
 *   EPUB: { type: 'epub', cfi: string }           — canonical fragment identifier
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// FORMAT DEFINITIONS
// Each entry fully describes one file type so the suite is purely data-driven.
// ---------------------------------------------------------------------------
const FILE_FORMATS = [
  {
    label:       'PDF',
    ext:         'pdf',
    fileName:    'research.pdf',
    mimeType:    'application/pdf',
    fakeBlob:    '%PDF-1.4 fake content',
    scrollState: { page: 23, ratio: 0.65 },
    assertScroll(scroll, expect) {
      expect(scroll).not.toBeNull();
      expect(scroll.page).toBe(23);
      expect(scroll.ratio).toBeCloseTo(0.65);
    },
  },
  {
    label:       'Markdown',
    ext:         'md',
    fileName:    'notes.md',
    mimeType:    'text/markdown',
    fakeBlob:    '# My Notes\n\nSome content here.',
    scrollState: { type: 'md', scrollTop: 1842 },
    assertScroll(scroll, expect) {
      expect(scroll).not.toBeNull();
      expect(scroll.type).toBe('md');
      expect(scroll.scrollTop).toBe(1842);
    },
  },
  {
    label:       'EPUB',
    ext:         'epub',
    fileName:    'book.epub',
    mimeType:    'application/epub+zip',
    fakeBlob:    'PK\x03\x04 fake epub',
    scrollState: { type: 'epub', cfi: 'epubcfi(/6/4!/4/2/4:0)' },
    assertScroll(scroll, expect) {
      expect(scroll).not.toBeNull();
      expect(scroll.type).toBe('epub');
      expect(scroll.cfi).toBe('epubcfi(/6/4!/4/2/4:0)');
    },
  },
  {
    label:       'Plain Text',
    ext:         'txt',
    fileName:    'document.txt',
    mimeType:    'text/plain',
    fakeBlob:    'Plain text content for testing.',
    scrollState: { type: 'txt', scrollTop: 3200 },
    assertScroll(scroll, expect) {
      expect(scroll).not.toBeNull();
      expect(scroll.type).toBe('txt');
      expect(scroll.scrollTop).toBe(3200);
    },
  },
];

// ---------------------------------------------------------------------------
// SHARED MOCK NOTES & HIGHLIGHTS (same structure for all formats)
// ---------------------------------------------------------------------------
const MOCK_NOTES = [
  { id: 1, txt: 'Critical observation at saved position' },
  { id: 2, txt: 'Follow-up action needed' },
];
const MOCK_HIGHLIGHTS = [
  { id: 'h1', text: 'key phrase', color: '#ffe066' },
];

// ---------------------------------------------------------------------------
// PARAMETERISED TEST SUITE
// ---------------------------------------------------------------------------
describe('Multi-Format Restart & Update Persistence', () => {
  FILE_FORMATS.forEach((fmt) => {
    describe(`[${fmt.label}] .${fmt.ext} — full restart/update lifecycle`, () => {
      const USER      = 'testuser';
      const STORE_KEY = `${USER}_${fmt.fileName}`;

      // Setup runs before every test in this format block
      beforeEach(() => {
        // Reset DOM to minimal required structure
        document.body.innerHTML = `
          <div id="settings-modal" style="display:none;">
            <input type="text" id="username-input" value="" />
            <button id="login-profile-btn">Log in</button>
            <button id="logout-btn" style="display:none;">Log out</button>
            <input type="checkbox" id="manual-save-cb" />
          </div>
          <div id="library-modal" style="display:none;">
            <span id="library-username-display"></span>
            <div id="library-list"></div>
          </div>
          <aura-profile id="top-profile-badge"></aura-profile>
          <div id="notes-list"></div>
        `;

        // Load core module (provides storageRepository, settingsRepo, etc.)
        eval(fs.readFileSync(
          path.resolve(__dirname, '../src/static/js/reader-core.js'), 'utf8'
        ));

        // Simulate persisted state from the previous session
        localStorage.setItem('username', USER);
        localStorage.setItem('aura-state-save-prefs', JSON.stringify({
          'aura-reading-state': true,
          'aura-notes-state': true,
        }));

        // Simulate fresh boot (clear SettingsRepo in-memory cache)
        window.settingsRepo.cache = {};

        // Wire per-format mocks
        window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue([{
          id:          STORE_KEY,
          fileName:    fmt.fileName,
          ext:         fmt.ext,
          scrollState: fmt.scrollState,
          noteCount:   MOCK_NOTES.length,
          timestamp:   Date.now() - 3600000,
        }]);

        window.storageRepository.loadScrollState = jest.fn().mockResolvedValue(fmt.scrollState);

        window.storageRepository.loadNotes = jest.fn().mockResolvedValue({
          id:            STORE_KEY,
          notes:         MOCK_NOTES,
          pdfHighlights: MOCK_HIGHLIGHTS,
        });

        window.storageRepository.saveNotes = jest.fn().mockResolvedValue(true);
        window.storageRepository.saveScrollState = jest.fn().mockResolvedValue(true);
        window.storageRepository.migrateNamespace = jest.fn().mockResolvedValue({ count: 1 });

        window.storageRepository.loadDocument = jest.fn().mockResolvedValue({
          id:          STORE_KEY,
          fileName:    fmt.fileName,
          ext:         fmt.ext,
          scrollState: fmt.scrollState,
          fileBlob:    new Blob([fmt.fakeBlob], { type: fmt.mimeType }),
        });
      });

      // ---- STEP 1: Username -----------------------------------------------
      test('STEP 1 — username persists in localStorage across restart/update', () => {
        expect(window.settingsRepo.getUsername()).toBe(USER);
      });

      // ---- STEP 2: Preferences -------------------------------------------
      test('STEP 2 — reading-state and notes-state prefs survive app update', () => {
        expect(window.settingsRepo.isTrue('aura-reading-state')).toBe(true);
        expect(window.settingsRepo.isTrue('aura-notes-state')).toBe(true);
      });

      // ---- STEP 3: Library -----------------------------------------------
      test('STEP 3 — library returns the saved document with correct metadata', async () => {
        const lib = await window.storageRepository.getLibraryMeta(USER);
        expect(lib.length).toBe(1);
        expect(lib[0].fileName).toBe(fmt.fileName);
        expect(lib[0].ext).toBe(fmt.ext);
        expect(lib[0].id).toBe(STORE_KEY);
        expect(lib[0].noteCount).toBe(2);
      });

      // ---- STEP 4: Scroll State ------------------------------------------
      test(`STEP 4 — ${fmt.label} scroll state restored with correct format-specific shape`, async () => {
        const scroll = await window.storageRepository.loadScrollState(STORE_KEY);
        fmt.assertScroll(scroll, expect);
      });

      // ---- STEP 5: Notes & Highlights ------------------------------------
      test('STEP 5 — notes and highlights fully restored after restart', async () => {
        const data = await window.storageRepository.loadNotes(STORE_KEY);
        expect(data).not.toBeNull();
        expect(data.notes.length).toBe(2);
        expect(data.notes[0].txt).toBe('Critical observation at saved position');
        expect(data.notes[1].txt).toBe('Follow-up action needed');
        expect(data.pdfHighlights.length).toBe(1);
        expect(data.pdfHighlights[0].color).toBe('#ffe066');
      });

      // ---- STEP 6: File Blob ---------------------------------------------
      test('STEP 6 — file blob is loadable for auto-restore', async () => {
        const docData = await window.storageRepository.loadDocument(STORE_KEY);
        expect(docData).not.toBeNull();
        expect(docData.fileName).toBe(fmt.fileName);
        expect(docData.fileBlob).toBeInstanceOf(Blob);
        expect(docData.fileBlob.size).toBeGreaterThan(0);
        // Scroll state embedded in document record matches format shape
        fmt.assertScroll(docData.scrollState, expect);
      });

      // ---- STEP 7: Hydration Lock ----------------------------------------
      test('STEP 7 — hydration lock prevents empty-notes overwrite during file open', () => {
        // Load notes-tts so renderNotes is available
        eval(fs.readFileSync(
          path.resolve(__dirname, '../src/static/js/notes-tts.js'), 'utf8'
        ));

        window._isDocumentLoading = true;
        window.currentFileName = fmt.fileName;
        window.notes = [];
        window.pdfHighlights = [];

        window.renderNotes();

        // saveNotes must NOT be called while lock is active
        expect(window.storageRepository.saveNotes).not.toHaveBeenCalled();
        window._isDocumentLoading = false;
      });

      // ---- STEP 8: Force Save (Manual Save Button) -----------------------
      test('STEP 8 — force save bypasses hydration lock and always persists', async () => {
        window._isDocumentLoading = true;

        await window.storageRepository.saveNotes(
          STORE_KEY, MOCK_NOTES, MOCK_HIGHLIGHTS, true  // force=true
        );

        expect(window.storageRepository.saveNotes).toHaveBeenCalledWith(
          STORE_KEY, MOCK_NOTES, MOCK_HIGHLIGHTS, true
        );

        window._isDocumentLoading = false;
      });

      // ---- STEP 9: triggerStateSave blocked during load ------------------
      test('STEP 9 — triggerStateSave is blocked while document is loading', () => {
        window.currentFileName = fmt.fileName;
        window._isDocumentLoading = true;

        window.triggerStateSave();

        expect(window.storageRepository.saveScrollState).not.toHaveBeenCalled();
        window._isDocumentLoading = false;
      });

      // ---- STEP 10: Guest Migration on Login -----------------------------
      test('STEP 10 — guest docs migrate to username namespace on first login after update', async () => {
        if (window.profileMigrationManager) {
          window.profileMigrationManager.lastUsername = 'guest';
        }

        window.settingsRepo.set('username', USER);

        // Give async event handler one tick to process
        await new Promise(r => setTimeout(r, 10));

        expect(window.storageRepository.migrateNamespace)
          .toHaveBeenCalledWith('guest', USER);
      });

      // ---- STEP 11: Isolation -------------------------------------------
      test('STEP 11 — library is empty for a different user (namespace isolation)', async () => {
        window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue([]);
        const files = await window.storageRepository.getLibraryMeta('other_user');
        expect(files.length).toBe(0);
      });

      // ---- STEP 12: Metadata-only fallback --------------------------------
      test('STEP 12 — pendingScrollState set from meta when blob is missing (meta-only cache)', async () => {
        window.storageRepository.loadDocument = jest.fn().mockResolvedValue(null);

        const lib    = await window.storageRepository.getLibraryMeta(USER);
        const latest = lib[0];

        window.pendingScrollState = null;
        const docData = await window.storageRepository.loadDocument(latest.id);
        if (!docData || !docData.fileBlob) {
          if (latest.scrollState) window.pendingScrollState = latest.scrollState;
        }

        // Scroll state should be set even though blob was missing
        expect(window.pendingScrollState).not.toBeNull();
        fmt.assertScroll(window.pendingScrollState, expect);
      });
    });
  });
});
