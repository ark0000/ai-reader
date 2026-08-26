/**
 * drag-drop-reader.js
 * Isolated drag and drop feature for the document reader.
 * Uses the Adapter Pattern to hook into the existing window.openFile logic.
 */

class ReaderDragDropManager {
  constructor(targetElement, openFileCallback) {
    this.target = targetElement;
    this.openFileCallback = openFileCallback;
    this.dragCounter = 0;
    
    this.initOverlay();
    this.bindEvents();
  }

  initOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'drag-drop-overlay';
    
    const textNode = document.createElement('div');
    textNode.className = 'overlay-text';
    textNode.innerHTML = '&#128194; Drop File to Open';
    
    this.overlay.appendChild(textNode);
    document.body.appendChild(this.overlay);
  }

  bindEvents() {
    // Prevent default behaviors for drag events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      this.target.addEventListener(eventName, this.preventDefaults, false);
    });

    this.target.addEventListener('dragenter', this.handleDragEnter.bind(this), false);
    this.target.addEventListener('dragover', this.handleDragOver.bind(this), false);
    this.target.addEventListener('dragleave', this.handleDragLeave.bind(this), false);
    this.target.addEventListener('drop', this.handleDrop.bind(this), false);
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  isValidDrag(e) {
    if (e.dataTransfer && e.dataTransfer.types) {
      for (let i = 0; i < e.dataTransfer.types.length; i++) {
        if (e.dataTransfer.types[i] === 'Files') {
          return true;
        }
      }
    }
    return false;
  }

  handleDragEnter(e) {
    if (this.isValidDrag(e)) {
      this.dragCounter++;
      this.overlay.classList.add('active');
    }
  }

  handleDragOver(e) {
    if (this.isValidDrag(e)) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  handleDragLeave(e) {
    if (this.isValidDrag(e)) {
      this.dragCounter--;
      if (this.dragCounter === 0) {
        this.overlay.classList.remove('active');
      }
    }
  }

  async handleDrop(e) {
    this.dragCounter = 0;
    this.overlay.classList.remove('active');

    if (!this.isValidDrag(e)) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (this.openFileCallback) {
        try {
          await this.openFileCallback(file);
        } catch (err) {
          console.error("Error opening dropped file:", err);
        }
      }
    }
  }
}

// Auto-initialize if window.openFile is already available
document.addEventListener('DOMContentLoaded', () => {
  // Wait a small tick in case window.openFile is defined later in DOMContentLoaded
  setTimeout(() => {
    if (typeof window.openFile === 'function') {
      window.readerDragDrop = new ReaderDragDropManager(document.body, window.openFile);
    } else {
      console.warn("ReaderDragDropManager: window.openFile not found. Drag and drop will not work.");
    }
  }, 100);
});
