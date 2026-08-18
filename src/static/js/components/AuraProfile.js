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
      </style>
      <div class="profile-wrapper" id="profile-container" title="Active Profile Namespace">
        <div class="avatar" id="avatar-circle">A</div>
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
    let uname = 'arun';
    if (window.settingsRepo) {
      uname = window.settingsRepo.getUsername();
    }
    this.usernameText.textContent = uname;
    this.avatar.textContent = uname.charAt(0).toUpperCase();
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
}

customElements.define('aura-profile', AuraProfile);
