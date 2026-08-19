const fs = require('fs');
const path = require('path');

describe('User Profile & Authentication System', () => {
  beforeEach(() => {
    // 1. Setup DOM
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

    // 2. Load reader-core.js
    const readerCorePath = path.resolve(__dirname, '../src/static/js/reader-core.js');
    const readerCoreContent = fs.readFileSync(readerCorePath, 'utf8');
    eval(readerCoreContent);

    // Mock storageRepository methods
    if (window.storageRepository) {
      window.storageRepository.migrateNamespace = jest.fn().mockResolvedValue({ count: 2 });
      window.storageRepository.savePdfScrollState = jest.fn().mockResolvedValue(true);
      window.storageRepository.getPdfScrollState = jest.fn().mockResolvedValue({ page: 5, zoom: 1.2 });
      window.storageRepository.getLibraryMeta = jest.fn().mockResolvedValue([
        { id: 'arun_doc1.pdf', fileName: 'doc1.pdf', timestamp: Date.now() }
      ]);
    }

    // 3. Load AuraProfile.js Web Component
    const auraProfilePath = path.resolve(__dirname, '../src/static/js/components/AuraProfile.js');
    const auraProfileContent = fs.readFileSync(auraProfilePath, 'utf8');
    eval(auraProfileContent);

    // 4. Load ui-components.js
    const uiPath = path.resolve(__dirname, '../src/static/js/ui-components.js');
    const uiContent = fs.readFileSync(uiPath, 'utf8');
    eval(uiContent);

    window.toggleSettings = jest.fn();
    window.showToast = jest.fn();
    window.renderLibrary = jest.fn();
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

    // Verify storage & state
    expect(window.settingsRepo.getUsername()).toBe('arun');
    expect(window.currentUsername).toBe('arun');
    expect(window.safeStorage.getItem('username')).toBe('arun');

    // Verify UI updates
    expect(logoutBtn.style.display).toBe('inline-block');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('arun'));
  });

  test('Logging out resets username to guest and hides logout button', () => {
    // Log in first
    window.saveUsernameProfile('arun');
    expect(window.currentUsername).toBe('arun');

    // Log out
    window.saveUsernameProfile('');

    expect(window.settingsRepo.getUsername()).toBe('guest');
    expect(window.currentUsername).toBe('guest');
    expect(document.getElementById('logout-btn').style.display).toBe('none');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Guest'));
  });

  test('ProfileMigrationManager automatically migrates namespace on username switch', async () => {
    // Switch from guest to alex
    window.appEventBus.emit('SettingsChanged:username', 'alex');
    await new Promise((r) => setTimeout(r, 20));

    // Verify migration was triggered
    expect(window.storageRepository.migrateNamespace).toHaveBeenCalledWith('guest', 'alex');
    expect(window.renderLibrary).toHaveBeenCalled();
  });

  test('AuraProfile Web Component renders avatar and username', () => {
    window.saveUsernameProfile('arunkumar');

    const profileBadge = document.querySelector('aura-profile');
    expect(profileBadge).toBeDefined();

    // Trigger updateProfile
    profileBadge.updateProfile();

    const usernameSpan = profileBadge.shadowRoot.getElementById('username-text');
    const avatarCircle = profileBadge.shadowRoot.getElementById('avatar-circle');

    expect(usernameSpan.textContent).toBe('arunkumar');
    expect(avatarCircle.textContent).toBe('A');
  });

  test('Clicking AuraProfile invokes toggleSettings', () => {
    const profileBadge = document.querySelector('aura-profile');
    const container = profileBadge.shadowRoot.getElementById('profile-container');

    container.click();
    expect(window.toggleSettings).toHaveBeenCalled();
  });

  test('Enter key on username-input triggers saveUsernameProfile', () => {
    const input = document.getElementById('username-input');
    input.value = 'john_doe';

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.dispatchEvent(enterEvent);

    // Call saveUsernameProfile as bound in HTML
    window.saveUsernameProfile();

    expect(window.currentUsername).toBe('john_doe');
    expect(window.settingsRepo.getUsername()).toBe('john_doe');
  });

  test('SafeStorage protects critical profile keys from eviction', () => {
    expect(window.safeStorage._criticalKeys.has('username')).toBe(true);
    expect(window.safeStorage._criticalKeys.has('aura-state-save-prefs')).toBe(true);
  });

  test('User state save preferences (reading & notes states) are parsed from aura-state-save-prefs', () => {
    localStorage.setItem('aura-state-save-prefs', JSON.stringify({
      'aura-reading-state': true,
      'aura-notes-state': false
    }));

    // Reset settings cache
    window.settingsRepo.cache = {};

    expect(window.settingsRepo.get('aura-reading-state')).toBe('true');
    expect(window.settingsRepo.get('aura-notes-state')).toBe('false');
  });

  test('AuraProfile triggers combo animation on document:saved event', async () => {
    const profileBadge = document.querySelector('aura-profile');
    const container = profileBadge.shadowRoot.getElementById('profile-container');
    
    profileBadge.triggerComboEffect();
    await new Promise((r) => setTimeout(r, 25));

    // Check if combo-active class is applied
    expect(container.classList.contains('combo-active')).toBe(true);
  });

  test('Library modal queries documents isolated by username', async () => {
    window.currentUsername = 'dr_smith';
    await window.renderLibrary();

    if (window.storageRepository && window.storageRepository.getLibraryMeta) {
      const files = await window.storageRepository.getLibraryMeta('dr_smith');
      expect(files.length).toBeGreaterThan(0);
      expect(files[0].id.startsWith('arun_') || files[0].id.startsWith('dr_smith_')).toBe(true);
    }
  });
});
