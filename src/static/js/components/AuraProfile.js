class AuraProfile extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .profile-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          position: relative;
        }
        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .username {
          font-size: 13px;
          font-weight: 500;
          color: #a0aec0;
          transition: color 0.3s ease;
        }
        
        /* Combo Effect Animations */
        @keyframes profileGlow {
          0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); transform: scale(1); }
          50% { box-shadow: 0 0 0 10px rgba(46, 204, 113, 0); transform: scale(1.1); }
          100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); transform: scale(1); }
        }
        .combo-active .avatar {
          animation: profileGlow 0.8s ease-out;
          background: linear-gradient(135deg, #2ecc71, #27ae60);
        }
        .combo-active .username {
          color: #2ecc71;
        }
        .update-marker {
          display: none;
          position: absolute;
          top: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          background: #ef4444;
          border-radius: 50%;
          border: 2px solid var(--bg-toolbar, #1a202c);
          animation: pulseMarker 2s infinite;
        }
        @keyframes pulseMarker {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      </style>
      <div class="profile-wrapper" id="profile-container" title="Active Profile Namespace">
        <div style="position:relative;">
          <div class="avatar" id="avatar-circle">A</div>
          <div class="update-marker" id="update-marker" title="Update Available"></div>
        </div>
        <span class="username" id="username-text">arun</span>
      </div>
    `;
  }

  connectedCallback() {
    this.container = this.shadowRoot.getElementById('profile-container');
    this.avatar = this.shadowRoot.getElementById('avatar-circle');
    this.usernameText = this.shadowRoot.getElementById('username-text');
    
    this.updateProfile();

    if (window.appEventBus) {
      window.appEventBus.on('document:saved', () => this.triggerComboEffect());
      window.appEventBus.on('SettingsChanged:username', () => this.updateProfile());
    }
    
    // Optional: click to open settings
    this.container.addEventListener('click', () => {
      if (window.toggleSettings) window.toggleSettings();
    });
  }

  updateProfile() {
    let uname = 'guest';
    if (window.settingsRepo) {
      uname = window.settingsRepo.getUsername();
    } else if (window.currentUsername) {
      uname = window.currentUsername;
    } else if (window.safeStorage) {
      uname = window.safeStorage.getItem('username') || 'guest';
    }

    const isGuest = !uname || uname === 'guest';
    const displayName = isGuest ? 'Guest' : uname;

    this.usernameText.textContent = displayName;
    this.avatar.textContent = (displayName.charAt(0) || 'G').toUpperCase();

    // FIX: Update title attribute so tooltip reflects the real state clearly.
    const container = this.shadowRoot.getElementById('profile-container');
    if (container) {
      container.title = isGuest
        ? 'Guest profile \u2014 open Settings to log in'
        : `Active profile: ${displayName}`;
    }

    // FIX: Distinct visual cue for guest vs named user (dim avatar for guest).
    if (this.avatar) {
      this.avatar.style.opacity = isGuest ? '0.5' : '1';
      this.avatar.style.background = isGuest
        ? 'linear-gradient(135deg, #718096, #4a5568)'
        : 'linear-gradient(135deg, #ff6b6b, #4ecdc4)';
    }
  }

  triggerComboEffect() {
    // Re-trigger CSS animation
    this.container.classList.remove('combo-active');
    // void this.container.offsetWidth; // trigger reflow
    setTimeout(() => {
        this.container.classList.add('combo-active');
    }, 10);
    
    setTimeout(() => {
      this.container.classList.remove('combo-active');
    }, 1000);
  }

  showUpdateMarker(hasUpdate, onClickCallback) {
    const marker = this.shadowRoot.getElementById('update-marker');
    if (marker) {
      marker.style.display = hasUpdate ? 'block' : 'none';
      if (hasUpdate && onClickCallback) {
        // override container click to open updater
        this.container.onclick = (e) => {
          e.stopPropagation();
          onClickCallback();
        };
      }
    }
  }
}

if (!customElements.get('aura-profile')) {
  customElements.define('aura-profile', AuraProfile);
}
