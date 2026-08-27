/**
 * drag-drop-reader.js
 * Isolated drag and drop feature for the document reader.
 * Uses the Adapter Pattern to hook into the existing window.openFile logic.
 */

class ReaderDragDropManager {
  constructor(openFileCallback) {
    this.openFileCallback = openFileCallback;
    this.dragCounter = 0;
    
    this.initOverlay();
    this.bindEvents();
  }

  initOverlay() {
    // Inject styles to avoid caching issues with reader-engine.css
    if (!document.getElementById('drag-drop-style')) {
      const style = document.createElement('style');
      style.id = 'drag-drop-style';
      style.innerHTML = `
        #drag-drop-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 242, 254, 0.1);
          border: 4px dashed #00f2fe;
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        #drag-drop-overlay.active {
          opacity: 1;
        }
        #drag-drop-overlay .overlay-text {
          font-size: 2rem;
          font-weight: bold;
          color: #00f2fe;
          background: rgba(0, 0, 0, 0.7);
          padding: 20px 40px;
          border-radius: 12px;
        }
      `;
      document.head.appendChild(style);
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'drag-drop-overlay';
    
    const textNode = document.createElement('div');
    textNode.className = 'overlay-text';
    textNode.innerHTML = '&#128194; Drop File to Open';
    
    this.overlay.appendChild(textNode);
    document.body.appendChild(this.overlay);
  }

  bindEvents() {
    const target = document.documentElement; // More reliable than document.body
    
    // Using capture phase to ensure we intercept events before child elements stop propagation
    target.addEventListener('dragenter', this.handleDragEnter.bind(this), true);
    target.addEventListener('dragover', this.handleDragOver.bind(this), true);
    target.addEventListener('dragleave', this.handleDragLeave.bind(this), true);
    target.addEventListener('drop', this.handleDrop.bind(this), true);
  }

  isValidDrag(e) {
    if (!e.dataTransfer) return false;
    try {
      if (e.dataTransfer.types) {
        for (let i = 0; i < e.dataTransfer.types.length; i++) {
          const t = e.dataTransfer.types[i];
          if (t && (typeof t === 'string')) {
            const type = t.toLowerCase();
            if (type === 'files' || type === 'application/pdf') {
              return true;
            }
          }
        }
      }
    } catch(err) {
      console.warn("isValidDrag error:", err);
    }
    return true; // Fallback
  }

  handleDragEnter(e) {
    try {
      if (this.isValidDrag(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.dragCounter++;
        this.overlay.classList.add('active');
      }
    } catch(err) { console.warn(err); }
  }

  handleDragOver(e) {
    try {
      if (this.isValidDrag(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }
    } catch(err) { console.warn(err); }
  }

  handleDragLeave(e) {
    try {
      if (this.isValidDrag(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.dragCounter--;
        if (this.dragCounter <= 0) {
          this.dragCounter = 0;
          this.overlay.classList.remove('active');
        }
      }
    } catch(err) { console.warn(err); }
  }

  async handleDrop(e) {
    try {
      e.preventDefault();
      e.stopPropagation();
      this.dragCounter = 0;
      this.overlay.classList.remove('active');

      if (!this.isValidDrag(e)) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const openFn = this.openFileCallback || window.openFile;
        if (openFn) {
          await openFn(file);
        } else {
           console.error("No file opener function found.");
        }
      }
    } catch (err) {
      console.error("Drop error:", err);
    }
  }
}

// Auto-initialize 
document.addEventListener('DOMContentLoaded', () => {
  // Give ample time for other scripts to define window.openFile
  setTimeout(() => {
    window.readerDragDrop = new ReaderDragDropManager(window.openFile);
  }, 500);
});
