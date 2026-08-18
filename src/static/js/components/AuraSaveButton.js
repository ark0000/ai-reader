class AuraSaveButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        .top-btn {
          background: #4ecdc4;
          color: #1a1a2e;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .top-btn:hover {
          background: #45b7af;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(78,205,196,0.2);
        }
        .top-btn.saved {
          background: #2ecc71;
          color: #fff;
        }
      </style>
      <button class="top-btn" id="save-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>Save</span>
      </button>
    `;
  }

  connectedCallback() {
    this.btn = this.shadowRoot.getElementById('save-btn');
    this.span = this.shadowRoot.querySelector('span');
    
    this.btn.addEventListener('click', () => {
      // Trigger the existing global save logic
      if (window.manualSaveDocument) {
        window.manualSaveDocument();
      }
      
      // Update our isolated UI state
      this.showSavedState();
      
      // Broadcast that a manual save occurred
      if (window.appEventBus) {
        window.appEventBus.emit('document:saved', {
          timestamp: Date.now()
        });
      }
    });
  }

  showSavedState() {
    const originalText = this.span.innerHTML;
    this.btn.classList.add('saved');
    this.span.innerHTML = '&#10004; Saved';
    
    setTimeout(() => {
      this.btn.classList.remove('saved');
      this.span.innerHTML = originalText;
    }, 2000);
  }
}

customElements.define('aura-save-button', AuraSaveButton);
