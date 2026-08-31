/**
 * auranote-handler.js
 * Engine for rendering .auranote.json files in the reading interface.
 * Implements the Adapter pattern over MarkdownDocumentHandler to reuse
 * its diagram rendering and formatting capabilities.
 */

class AuraNoteDocumentHandler {
  constructor() {
    this.mdHandler = new window.MarkdownDocumentHandler();
  }

  setupToolbar() {
    // Delegate toolbar setup to Markdown handler
    if (this.mdHandler && typeof this.mdHandler.setupToolbar === 'function') {
      this.mdHandler.setupToolbar();
    }
  }

  async load(file) {
    try {
      const text = await file.text();
      let noteData;
      
      try {
        noteData = JSON.parse(text);
      } catch (err) {
        throw new Error("Invalid .auranote.json format");
      }

      // Extract raw Markdown/text from the note object
      const rawText = noteData.raw_text || noteData.rawText || noteData.content || '';
      const title = noteData.title || file.name || 'AuraNote';

      // Create a virtual file object to adapter to Markdown handler
      const virtualFile = new File([rawText], title + ".md", { type: "text/markdown" });
      
      // Update reader core variables 
      if (window.docTitleEl) {
        window.docTitleEl.textContent = '🌀 ' + title;
      }
      
      // Delegate parsing, Mermaid rendering, and UI rendering
      await this.mdHandler.load(virtualFile);

    } catch (error) {
      console.error("[AuraNoteHandler] Failed to load note:", error);
      if (window.contentEl) {
        window.contentEl.innerHTML = `<div class="msg msg-err" style="margin-top:40px; color: red;">Failed to load AuraNote: ${error.message}</div>`;
      }
    }
  }
}

// Attach to window and register for 'json' extensions
window.AuraNoteDocumentHandler = AuraNoteDocumentHandler;

if (typeof window.registerDocumentHandler === 'function') {
  window.registerDocumentHandler('json', new AuraNoteDocumentHandler());
}
