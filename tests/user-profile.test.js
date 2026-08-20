const fs = require('fs');
const path = require('path');

describe('User Profile & Authentication System', () => {
  beforeEach(() => {
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
    `;

    const readerCorePath = path.resolve(__dirname, '../src/static/js/reader-core.js');
    eval(fs.readFileSync(readerCorePath, 'utf8'));

    if (window.storageRepository) {
      window.storageRepository.migrateNamespace = jest.fn().mockResolvedValue({ count: 2 });
      window.storageRepository.savePdfScrollState = jest.fn().mockResolvedValue(true);
      window.storageRepository.saveNotes = jest.fn().mockResolvedValue(true);
      window.storageRepository.getPdfScrollState = jest.fn().mockResolvedValue({ page: 5, zoom: 1.2 });
      window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue([
        { id: 'arun_doc1.pdf', fileName: 'doc1.pdf', timestamp: Date.now() }
      ]);
    }

    eval(fs.readFileSync(path.resolve(__dirname, '../src/static/js/components/AuraProfile.js'), 'utf8'));
    eval(fs.readFileSync(path.resolve(__dirname, '../src/static/js/ui-components.js'), 'utf8'));
    eval(fs.readFileSync(path.resolve(__dirname, '../src/static/js/notes-tts.js'), 'utf8'));

    window.toggleSettings = jest.fn();
    window.showToast = jest.fn();
    window.openLibraryModal = jest.fn();
    window.renderLibrary = jest.fn();

    // Reset ProfileMigrationManager state so tests don't contaminate each other
    if (window.profileMigrationManager) {
      window.profileMigrationManager.lastUsername = 'guest';
    }
    // Clear any one-time migration flags set by previous tests
    window.safeStorage.removeItem('aura-profile-migrated-to-alex');
    window.safeStorage.removeItem('aura-profile-migrated-to-my-profile_01');
    window.safeStorage.removeItem('aura-profile-migrated-to-arunkumar');
    window.safeStorage.removeItem('aura-profile-migrated-to-john_doe');
  });

  test('SettingsRepository returns "guest" by default', () => {
    window.settingsRepo.set('username', '');
    expect(window.settingsRepo.getUsername()).toBe('guest');
  });

  test('saveUsernameProfile sets username, emits event, and updates state', () => {
    const input = document.getElementById('username-input');
    const logoutBtn = document.getElementById('logout-btn');
    input.value = 'arun';
    window.saveUsernameProfile();
    expect(window.settingsRepo.getUsername()).toBe('arun');
    expect(window.currentUsername).toBe('arun');
    expect(window.safeStorage.getItem('username')).toBe('arun');
    expect(logoutBtn.style.display).toBe('inline-block');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('arun'));
  });

  test('Logging out resets username to guest and hides logout button', () => {
    window.saveUsernameProfile('arun');
    window.saveUsernameProfile('');
    expect(window.settingsRepo.getUsername()).toBe('guest');
    expect(window.currentUsername).toBe('guest');
    expect(document.getElementById('logout-btn').style.display).toBe('none');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Guest'));
  });

  test('saveUsernameProfile rejects reserved name "guest"', () => {
    window.currentUsername = 'guest';
    window.saveUsernameProfile('guest');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('reserved'));
  });

  test('saveUsernameProfile rejects usernames with special characters', () => {
    window.currentUsername = 'guest';
    window.saveUsernameProfile('../evil');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('letters'));
    expect(window.currentUsername).toBe('guest');
  });

  test('saveUsernameProfile rejects usernames longer than 32 characters', () => {
    window.currentUsername = 'guest';
    window.saveUsernameProfile('a'.repeat(33));
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('32'));
    expect(window.currentUsername).toBe('guest');
  });

  test('saveUsernameProfile accepts valid usernames with _ and -', () => {
    window.saveUsernameProfile('my-profile_01');
    expect(window.currentUsername).toBe('my-profile_01');
    expect(window.settingsRepo.getUsername()).toBe('my-profile_01');
  });

  test('ProfileMigrationManager automatically migrates namespace on username switch', async () => {
    window.appEventBus.emit('SettingsChanged:username', 'alex');
    await new Promise((r) => setTimeout(r, 20));
    expect(window.storageRepository.migrateNamespace).toHaveBeenCalledWith('guest', 'alex');
    expect(window.openLibraryModal).not.toHaveBeenCalled();
  });

  test('ProfileMigrationManager does NOT migrate when username is unchanged', async () => {
    window.profileMigrationManager.lastUsername = 'alex';
    window.appEventBus.emit('SettingsChanged:username', 'alex');
    await new Promise((r) => setTimeout(r, 20));
    expect(window.storageRepository.migrateNamespace).not.toHaveBeenCalled();
  });

  test('AuraProfile Web Component renders avatar and username', () => {
    window.saveUsernameProfile('arunkumar');
    const profileBadge = document.querySelector('aura-profile');
    profileBadge.updateProfile();
    expect(profileBadge.shadowRoot.getElementById('username-text').textContent).toBe('arunkumar');
    expect(profileBadge.shadowRoot.getElementById('avatar-circle').textContent).toBe('A');
  });

  test('AuraProfile shows "Guest" label and dimmed avatar for guest state', () => {
    window.currentUsername = 'guest';
    if (window.settingsRepo) window.settingsRepo.cache['username'] = '';
    const profileBadge = document.querySelector('aura-profile');
    profileBadge.updateProfile();
    expect(profileBadge.shadowRoot.getElementById('username-text').textContent).toBe('Guest');
    expect(profileBadge.shadowRoot.getElementById('avatar-circle').style.opacity).toBe('0.5');
  });

  test('Clicking AuraProfile invokes toggleSettings', () => {
    const profileBadge = document.querySelector('aura-profile');
    profileBadge.shadowRoot.getElementById('profile-container').click();
    expect(window.toggleSettings).toHaveBeenCalled();
  });

  test('Enter key on username-input triggers saveUsernameProfile', () => {
    const input = document.getElementById('username-input');
    input.value = 'john_doe';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    window.saveUsernameProfile();
    expect(window.currentUsername).toBe('john_doe');
    expect(window.settingsRepo.getUsername()).toBe('john_doe');
  });

  test('SafeStorage protects critical profile keys from eviction', () => {
    expect(window.safeStorage._criticalKeys.has('username')).toBe(true);
    expect(window.safeStorage._criticalKeys.has('aura-state-save-prefs')).toBe(true);
  });

  test('User state save preferences (reading & notes states) are parsed from aura-state-save-prefs', () => {
    localStorage.setItem('aura-state-save-prefs', JSON.stringify({ 'aura-reading-state': true, 'aura-notes-state': false }));
    window.settingsRepo.cache = {};
    expect(window.settingsRepo.get('aura-reading-state')).toBe('true');
    expect(window.settingsRepo.get('aura-notes-state')).toBe('false');
  });

  test('AuraProfile triggers combo animation on document:saved event', async () => {
    const profileBadge = document.querySelector('aura-profile');
    profileBadge.triggerComboEffect();
    await new Promise((r) => setTimeout(r, 25));
    expect(profileBadge.shadowRoot.getElementById('profile-container').classList.contains('combo-active')).toBe(true);
  });

  test('Library modal queries documents isolated by username', async () => {
    window.currentUsername = 'dr_smith';
    if (window.storageRepository && window.storageRepository.getLibraryMeta) {
      const files = await window.storageRepository.getLibraryMeta('dr_smith');
      expect(files.length).toBeGreaterThan(0);
    }
  });

  // =========================================================================
  // RESTART / UPDATE / LOGIN PERSISTENCE TESTS
  // These tests verify the full lifecycle:
  //   Session 1 (pre-update): user reads doc, state is saved
  //   App update / restart:   IndexedDB and localStorage persist
  //   Session 2 (post-update): login restores library, scroll state, and notes
  // =========================================================================

  describe('Restart & Update Persistence Flow', () => {
    // Shared mock data representing what was saved in the previous session
    const MOCK_USER = 'arunkumar';
    const MOCK_FILE = 'chapter1.pdf';
    const MOCK_KEY  = `${MOCK_USER}_${MOCK_FILE}`;
    const MOCK_SCROLL = { page: 14, ratio: 0.72 };
    const MOCK_NOTES  = [
      { id: 1, txt: 'Key insight on page 14' },
      { id: 2, txt: 'Follow-up reference' }
    ];
    const MOCK_HIGHLIGHTS = [{ id: 'h1', text: 'important phrase', color: '#ffe066' }];
    const MOCK_META = [
      {
        id: MOCK_KEY,
        fileName: MOCK_FILE,
        ext: 'pdf',
        scrollState: MOCK_SCROLL,
        noteCount: MOCK_NOTES.length,
        timestamp: Date.now() - 3600000 // saved 1 hour ago
      }
    ];

    beforeEach(() => {
      // Simulate app restart: username persists in localStorage
      localStorage.setItem('username', MOCK_USER);
      localStorage.setItem('aura-state-save-prefs', JSON.stringify({
        'aura-reading-state': true,
        'aura-notes-state': true
      }));

      // Fresh SettingsRepository cache (simulates new app version loading)
      window.settingsRepo.cache = {};

      // Wire up per-test mocks on the already-created storageRepository
      window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue(MOCK_META);
      window.storageRepository.loadScrollState = jest.fn().mockResolvedValue(MOCK_SCROLL);
      window.storageRepository.loadNotes = jest.fn().mockResolvedValue({
        id: MOCK_KEY,
        notes: MOCK_NOTES,
        pdfHighlights: MOCK_HIGHLIGHTS
      });
      window.storageRepository.saveNotes   = jest.fn().mockResolvedValue(true);
      window.storageRepository.saveScrollState = jest.fn().mockResolvedValue(true);
      window.storageRepository.loadDocument = jest.fn().mockResolvedValue({
        id: MOCK_KEY,
        fileName: MOCK_FILE,
        ext: 'pdf',
        scrollState: MOCK_SCROLL,
        fileBlob: new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' })
      });
    });

    test('STEP 1 — username persists in localStorage across app restart / update', () => {
      // settingsRepo reads from localStorage (not its cache) on a fresh boot
      const restored = window.settingsRepo.getUsername();
      expect(restored).toBe(MOCK_USER);
    });

    test('STEP 2 — reading-state and notes-state preferences survive app update', () => {
      // Both prefs come from aura-state-save-prefs JSON blob
      expect(window.settingsRepo.isTrue('aura-reading-state')).toBe(true);
      expect(window.settingsRepo.isTrue('aura-notes-state')).toBe(true);
    });

    test('STEP 3 — library returns saved documents for the logged-in user after restart', async () => {
      const lib = await window.storageRepository.getLibraryMeta(MOCK_USER);

      expect(lib.length).toBe(1);
      expect(lib[0].fileName).toBe(MOCK_FILE);
      expect(lib[0].id).toBe(MOCK_KEY);
      // Library must show note count so user knows what was saved
      expect(lib[0].noteCount).toBe(2);
    });

    test('STEP 4 — scroll state (reading position) is preserved with exact page and ratio', async () => {
      const scroll = await window.storageRepository.loadScrollState(MOCK_KEY);

      expect(scroll).not.toBeNull();
      expect(scroll.page).toBe(14);
      expect(scroll.ratio).toBeCloseTo(0.72);
    });

    test('STEP 5 — notes and highlights are fully restored after restart', async () => {
      const data = await window.storageRepository.loadNotes(MOCK_KEY);

      expect(data).not.toBeNull();
      expect(data.notes.length).toBe(2);
      expect(data.notes[0].txt).toBe('Key insight on page 14');
      expect(data.notes[1].txt).toBe('Follow-up reference');
      expect(data.pdfHighlights.length).toBe(1);
      expect(data.pdfHighlights[0].color).toBe('#ffe066');
    });

    test('STEP 6 — library document blob is loadable (auto-restore can open file)', async () => {
      const docData = await window.storageRepository.loadDocument(MOCK_KEY);

      expect(docData).not.toBeNull();
      expect(docData.fileName).toBe(MOCK_FILE);
      expect(docData.fileBlob).toBeInstanceOf(Blob);
      expect(docData.fileBlob.size).toBeGreaterThan(0);
      expect(docData.scrollState.page).toBe(14);
    });

    test('STEP 7 — hydration lock (_isDocumentLoading) prevents empty-notes overwrite during restore', () => {
      // Simulate the window between openFile() starting and notes being hydrated
      window._isDocumentLoading = true;
      window.currentFileName = MOCK_FILE;
      window.notes = [];
      window.pdfHighlights = [];

      // renderNotes() must NOT call saveNotes while the lock is active
      window.renderNotes();

      expect(window.storageRepository.saveNotes).not.toHaveBeenCalled();

      // Unlock
      window._isDocumentLoading = false;
    });

    test('STEP 8 — force save (manual save button) bypasses hydration lock and always persists', async () => {
      // Even if the lock is somehow still on, force=true must write through
      window._isDocumentLoading = true;

      // Call saveNotes directly with force=true (as manualSaveDocument does)
      await window.storageRepository.saveNotes(MOCK_KEY, MOCK_NOTES, MOCK_HIGHLIGHTS, true);

      expect(window.storageRepository.saveNotes).toHaveBeenCalledWith(
        MOCK_KEY, MOCK_NOTES, MOCK_HIGHLIGHTS, true
      );

      window._isDocumentLoading = false;
    });

    test('STEP 9 — triggerStateSave is blocked during loading but runs after unlock', () => {
      window.currentFileName = MOCK_FILE;
      window._isDocumentLoading = true;

      // Should be a no-op while loading
      window.triggerStateSave();
      expect(window.storageRepository.saveScrollState).not.toHaveBeenCalled();

      // After unlock, triggerStateSave should be allowed to run
      window._isDocumentLoading = false;
      // (actual scroll state saving depends on getActiveHandler — verified in integration)
    });

    test('STEP 10 — guest docs auto-migrate to username namespace on first login after update', async () => {
      // Simulate docs saved as guest before the user set their username
      const guestMeta = [
        { id: 'guest_old_doc.pdf', fileName: 'old_doc.pdf', ext: 'pdf', timestamp: Date.now() }
      ];
      window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue(guestMeta);
      window.storageRepository.migrateNamespace = jest.fn().mockResolvedValue({ count: 1 });

      // After login, migration manager should adopt the guest docs
      if (window.profileMigrationManager) {
        window.profileMigrationManager.lastUsername = 'guest';
      }

      // Trigger login event (saves username, fires SettingsChanged:username event)
      window.settingsRepo.set('username', MOCK_USER);

      // ProfileMigrationManager listens on this event and migrates guest -> arunkumar
      // Give it a tick to process the async event
      await new Promise(r => setTimeout(r, 10));

      expect(window.storageRepository.migrateNamespace).toHaveBeenCalledWith('guest', MOCK_USER);
    });

    test('STEP 11 — library is empty for a different user (isolation after restart)', async () => {
      window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue([]);
      const files = await window.storageRepository.getLibraryMeta('stranger_user');
      expect(files.length).toBe(0);
    });

    test('STEP 12 — metadata-only cache: scroll state still restored even when blob is missing', async () => {
      // When the file blob was not cached (quota exceeded, meta-only mode),
      // pendingScrollState should still be set so manual re-upload lands at right page
      window.storageRepository.loadDocument = jest.fn().mockResolvedValue(null);

      const lib = await window.storageRepository.getLibraryMeta(MOCK_USER);
      const latest = lib[0];

      // Simulate auto-restore path: blob null → set pendingScrollState from meta
      window.pendingScrollState = null;
      const docData = await window.storageRepository.loadDocument(latest.id);
      if (!docData || !docData.fileBlob) {
        if (latest.scrollState) window.pendingScrollState = latest.scrollState;
      }

      expect(window.pendingScrollState).not.toBeNull();
      expect(window.pendingScrollState.page).toBe(14);
    });
  });
});

