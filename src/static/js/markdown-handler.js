/**
 * markdown-handler.js
 * Handles Markdown and plain text file processing.
 */

class MarkdownDocumentHandler {
  setupToolbar() {
    document.getElementById('secondary-toolbar').style.display='flex';
    document.querySelectorAll('.pdf-only').forEach(function(el){ el.style.display = 'none'; });
    const fontControls = document.getElementById('font-size-controls');
    if (fontControls) fontControls.style.display = 'inline-flex';
  }
  async load(file) {
    var txt = await file.text();
    window.docText = txt;
    
    // Fallback if marked is missing for some reason
    if (typeof marked === 'undefined') {
       window.contentEl.innerHTML = '<div class="md-content"><pre style="white-space:pre-wrap"></pre></div>';
       window.contentEl.querySelector('pre').textContent = txt;
       return;
    }
    
    var rawHtml = marked.parse(txt);
    var cleanHtml = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
    
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto;">' + cleanHtml + '</div>';
    
    // Extract text for TTS
    var parser = new DOMParser();
    var doc = parser.parseFromString(window.contentEl.innerHTML, 'text/html');
    window.pdfParts = doc.body.textContent.split('\n\n').filter(function(t) { return t.trim().length > 0; });
    
    // Mermaid and diagrams logic
    window.contentEl.querySelectorAll('code.language-mermaid').forEach(function(el){
      var pre = el.parentElement;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent;
      pre.replaceWith(div);
    });
    
    if (typeof mermaid !== 'undefined') {
      try { mermaid.init(undefined, document.querySelectorAll('.mermaid')); } catch(e){ console.error('Mermaid error', e); }
    }
    
    window.contentEl.querySelectorAll('.md-content img, .md-content .mermaid').forEach(function(el){
      el.style.cursor = 'pointer'; el.title = 'Click to add to notes';
      el.onclick = function(ev){
        window.showActionPopup(ev, '&#128247; Add diagram to notes', function(){
          var clone = el.cloneNode(true);
          clone.removeAttribute('onclick'); clone.style.cursor='default';
          window.notes.push({q: clone.outerHTML, txt: 'Diagram', id: Date.now()});
          if (window.renderNotes) window.renderNotes();
          if (window.panel && window.panel.classList.contains('hidden')) window.togglePanel();
          if (window.switchTab) window.switchTab('notes');
        });
      };
    });
    
    window.contentEl.querySelectorAll('pre').forEach(function(p){
      if(p.className==='mermaid')return;
      p.onclick = function(){
        var cb = document.getElementById('auto-explain-cb');
        if(cb && cb.checked) {
          window.askAI('Explain this code:\n\n```\n'+p.textContent+'\n```');
        }
      }
    });
  }
}

class TextDocumentHandler {
  setupToolbar() {
    document.getElementById('secondary-toolbar').style.display='none';
  }
  async load(file) {
    var txt = await file.text();
    window.docText = txt;
    window.pdfParts = txt.split('\n\n').filter(function(t) { return t.trim().length > 0; });
    var escapedTxt = window.escapeHTML ? window.escapeHTML(txt) : txt;
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto;"><pre style="white-space:pre-wrap">' + escapedTxt + '</pre></div>';
  }
}

// Attach to window so DocumentHandlerFactory can use it
window.MarkdownDocumentHandler = MarkdownDocumentHandler;
window.TextDocumentHandler = TextDocumentHandler;

const markdownHandler = {
  toc: {
    render: function() {
  var list = document.getElementById('toc-list');
  if (!list || !window.contentEl) return;
  if (!window.docText) {
    list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128214;</span>Open a document to see its table of contents.</div>';
    return;
  }

  var headings = window.contentEl.querySelectorAll('h1, h2, h3, h4');

  if (headings.length === 0) {
    list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128203;</span>No headings found in this document.</div>';
    return;
  }

  headings.forEach(function(h, idx) {
    if (!h.id) h.id = 'heading-md-' + idx;
    var level = parseInt(h.tagName.substring(1));

    var div = document.createElement('div');
    div.className = 'toc-item toc-level-' + Math.min(level, 4);

    var titleSpan = document.createElement('span');
    titleSpan.className = 'toc-item-title';
    titleSpan.textContent = h.textContent;
    div.appendChild(titleSpan);

    div.onclick = function() {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.closeToc();
    };

    list.appendChild(div);
  });

  var badge = document.getElementById('toc-count');
  if (badge) badge.textContent = headings.length;
    } // end render
  } // end toc
}; // end handler

// Register Handler
if (window.registerDocumentHandler) {
  window.registerDocumentHandler('md', markdownHandler);
  window.registerDocumentHandler('txt', markdownHandler);
}
