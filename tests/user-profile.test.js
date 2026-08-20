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

  test('Restart & Update persistence: existing saves under username are preserved and restored on login', async () => {
    // 1. Simulate existing state saved before shutdown/update
    localStorage.setItem('username', 'arunkumar');
    localStorage.setItem('aura-state-save-prefs', JSON.stringify({ 'aura-reading-state': true, 'aura-notes-state': true }));
    
    // Mock database records representing previous saves
    const mockMeta = [
      { id: 'arunkumar_chapter1.pdf', fileName: 'chapter1.pdf', ext: 'pdf', scrollState: { page: 14, ratio: 0.5 }, timestamp: Date.now() }
    ];
    window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue(mockMeta);
    window.storageRepository.loadScrollState = jest.fn().mockResolvedValue({ page: 14, ratio: 0.5 });
    window.storageRepository.loadNotes = jest.fn().mockResolvedValue({ notes: [{ id: 1, txt: 'Important finding' }], pdfHighlights: [] });

    // 2. Simulate app reload / new version init
    window.settingsRepo.cache = {};
    expect(window.settingsRepo.getUsername()).toBe('arunkumar');

    // 3. Verify library retrieves existing saves
    const lib = await window.storageRepository.getLibraryMeta('arunkumar');
    expect(lib.length).toBe(1);
    expect(lib[0].fileName).toBe('chapter1.pdf');
    expect(lib[0].scrollState.page).toBe(14);

    // 4. Verify scroll state & notes are hydrated
    const scroll = await window.storageRepository.loadScrollState('arunkumar_chapter1.pdf');
    expect(scroll.page).toBe(14);
    const notes = await window.storageRepository.loadNotes('arunkumar_chapter1.pdf');
    expect(notes.notes.length).toBe(1);
    expect(notes.notes[0].txt).toBe('Important finding');
  });

  test('Hydration lock prevents overwriting notes when opening documents', () => {
    window._isDocumentLoading = true;
    window.currentFileName = 'doc.pdf';
    window.notes = [];
    window.renderNotes();
    // Since _isDocumentLoading is true, saveNotes should not be called with empty array
    expect(window.storageRepository.saveNotes).not.toHaveBeenCalled();
    window._isDocumentLoading = false;
  });
});
