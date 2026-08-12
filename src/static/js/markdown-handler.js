/**
 * markdown-handler.js
 * Handles Markdown and plain text file processing.
 */

class MarkdownDocumentHandler {
  constructor() {
    this._onScroll = this._onScroll.bind(this);
    this._scrollSaveTimer = null;
    this._searchMarks = [];
    this._searchCurrentIdx = -1;
  }
  
  getScrollState() {
    if (!window.contentEl) return null;
    return { type: 'md', scrollTop: window.contentEl.scrollTop };
  }
  
  _onScroll() {
    if (this._scrollSaveTimer) clearTimeout(this._scrollSaveTimer);
    this._scrollSaveTimer = setTimeout(() => {
      if (window.triggerStateSave) window.triggerStateSave();
    }, 1000);
  }

  clearSearch() {
    this._searchMarks.forEach(function(mark) {
      var parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
    this._searchMarks = [];
    this._searchCurrentIdx = -1;
  }

  performSearch(query, opts) {
    this.clearSearch();
    if (!query || !window.contentEl) return;

    var mdContent = window.contentEl.querySelector('.md-content');
    if (!mdContent) return;

    var flags = opts.caseSensitive ? 'g' : 'gi';
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = opts.wholeWord ? '\\b(' + escaped + ')\\b' : '(' + escaped + ')';
    var regex;
    try { regex = new RegExp(pattern, flags); } catch(e) { return; }

    // Collect text nodes via TreeWalker
    var walker = document.createTreeWalker(mdContent, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim().length > 0) textNodes.push(node);
    }

    var marks = [];
    textNodes.forEach(function(textNode) {
      var text = textNode.nodeValue;
      regex.lastIndex = 0;
      var match;
      var parts = [];
      var lastIndex = 0;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: text.substring(lastIndex, match.index) });
        }
        parts.push({ type: 'mark', value: match[1] || match[0] });
        lastIndex = regex.lastIndex;
        if (match[0].length === 0) { regex.lastIndex++; } // prevent infinite loop
      }

      if (parts.length === 0) return; // no matches in this node

      if (lastIndex < text.length) {
        parts.push({ type: 'text', value: text.substring(lastIndex) });
      }

      var frag = document.createDocumentFragment();
      parts.forEach(function(part) {
        if (part.type === 'mark') {
          var mark = document.createElement('mark');
          mark.className = 'search-hl';
          mark.style.cssText = 'background:var(--gold, #f6e05e);color:#000;border-radius:2px;padding:0 1px;';
          mark.textContent = part.value;
          marks.push(mark);
          frag.appendChild(mark);
        } else {
          frag.appendChild(document.createTextNode(part.value));
        }
      });

      textNode.parentNode.replaceChild(frag, textNode);
    });

    this._searchMarks = marks;
    this._searchCurrentIdx = -1;

    // Update UI
    document.getElementById('search-count').textContent = marks.length + ' matches';
    var container = document.getElementById('search-results');
    container.innerHTML = '';

    if (marks.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);">No results found.</div>';
      return;
    }

    // Generate result list (max 100 items for performance)
    var limit = Math.min(marks.length, 100);
    var _this = this;
    for (var i = 0; i < limit; i++) {
      (function(idx) {
        var mark = marks[idx];
        // Get snippet from surrounding text
        var parentEl = mark.parentNode;
        var snippet = parentEl ? parentEl.textContent.substring(0, 120) : mark.textContent;
        if (parentEl && parentEl.textContent.length > 120) snippet += '...';

        // Highlight the query in the snippet
        var highlightedSnippet = snippet.replace(new RegExp(escaped, flags),
          '<mark style="background:var(--gold);color:#000;border-radius:2px;">$&</mark>');

        var el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.idx = idx;
        el.innerHTML = '<div class="search-result-snippet">' + highlightedSnippet + '</div>';
        el.onclick = function() { _this.navigateSearch(0, idx); };
        container.appendChild(el);
      })(i);
    }

    if (marks.length > limit) {
      var moreEl = document.createElement('div');
      moreEl.style.cssText = 'padding:10px;text-align:center;color:var(--text-2);font-size:0.85rem;';
      moreEl.textContent = '... and ' + (marks.length - limit) + ' more matches';
      container.appendChild(moreEl);
    }

    // Navigate to first result
    this.navigateSearch(0, 0);
  }

  navigateSearch(dir, absoluteIdx) {
    if (this._searchMarks.length === 0) return;
    var idx;
    if (typeof absoluteIdx === 'number') {
      idx = absoluteIdx;
    } else {
      idx = this._searchCurrentIdx + dir;
      if (idx < 0) idx = this._searchMarks.length - 1;
      if (idx >= this._searchMarks.length) idx = 0;
    }
    
    // Deactivate previous
    if (this._searchCurrentIdx >= 0 && this._searchCurrentIdx < this._searchMarks.length) {
      this._searchMarks[this._searchCurrentIdx].style.background = 'var(--gold, #f6e05e)';
    }
    
    this._searchCurrentIdx = idx;
    var mark = this._searchMarks[idx];
    mark.style.background = '#f97316'; // Active highlight (orange)
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    document.getElementById('search-count').textContent = (idx + 1) + ' of ' + this._searchMarks.length;
    
    // Update selected state in results list
    document.querySelectorAll('.search-result-item').forEach(function(el) { el.classList.remove('selected'); });
    var activeEl = document.querySelector('.search-result-item[data-idx="' + idx + '"]');
    if (activeEl) {
      activeEl.classList.add('selected');
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

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
       window.contentEl.innerHTML = '<div class="md-content" style="font-size: var(--reader-size, 16px);"><pre style="white-space:pre-wrap"></pre></div>';
       window.contentEl.querySelector('pre').textContent = txt;
       
       window.contentEl.removeEventListener('scroll', this._onScroll);
       window.contentEl.addEventListener('scroll', this._onScroll);
       
       if (window.pendingScrollState && window.pendingScrollState.type === 'md') {
          setTimeout(() => {
            window.contentEl.scrollTop = window.pendingScrollState.scrollTop;
          }, 50);
       }
       return;
    }
    
    var pStart = performance.now();
    var rawHtml = marked.parse(txt);
    var pEnd = performance.now();
    if (window.AuraPerf && window.AuraPerf.logMdParse) {
       window.AuraPerf.logMdParse(pEnd - pStart);
    }
    var cleanHtml = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
    
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto; font-size: var(--reader-size, 16px);">' + cleanHtml + '</div>';
    
    if (window.injectCodeToolbars) {
      window.injectCodeToolbars(window.contentEl);
    }

    // Extract text for TTS
    window.pdfParts = txt.split('\n\n').filter(function(t) { return t.trim().length > 0; });
    
    // Mermaid and diagrams logic
    window.contentEl.querySelectorAll('code.language-mermaid').forEach(function(el){
      var pre = el.parentElement;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = el.textContent;
      pre.replaceWith(div);
    });
    
    if (typeof mermaid !== 'undefined') {
      setTimeout(() => {
        try { mermaid.init(undefined, document.querySelectorAll('.mermaid')); } catch(e){ console.error('Mermaid error', e); }
      }, 50);
    }
    
    let style = document.getElementById('md-interactive-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'md-interactive-style';
      style.innerHTML = `
        .md-content img, .md-content .mermaid { 
          cursor: zoom-in; 
          transition: all 0.2s ease-in-out;
          border-radius: 4px;
        }
        .md-content img:hover, .md-content .mermaid:hover { 
          box-shadow: 0 0 0 3px rgba(99, 179, 237, 0.4); 
          transform: scale(1.01);
        }
        .md-content pre code { 
          cursor: pointer; 
        }
      `;
      document.head.appendChild(style);
    }
    
    // Event delegation for img, mermaid, pre code
    this._mdClickHandler = function(ev) {
        if (window.getSelection().toString().trim().length > 0) return; // Don't trigger if user is selecting text
        var el = ev.target.closest('.md-content img, .md-content .mermaid, .md-content pre code');
        if (!el || !window.contentEl.contains(el)) return;
        
        ev.stopPropagation(); // prevent bubbling up
        var actions = [];
        let prompt = '';
        let typeName = 'diagram';
        
        if (el.tagName.toLowerCase() === 'code') {
          prompt = 'Please explain this code:\n\n```\n' + el.textContent + '\n```';
          typeName = 'code';
        } else if (el.tagName.toLowerCase() === 'img') {
          prompt = 'Please explain this image (from URL: ' + el.src + ' / alt: ' + (el.alt||'') + ').';
          typeName = 'image';
        } else {
          prompt = 'Please explain this diagram:\n\n```mermaid\n' + el.textContent + '\n```';
        }
        
        actions.push({
          label: '&#10024; Explain with AI',
          actionFn: function() {
            if(window.askAI) {
              window.askAI(prompt);
              const oldBg = el.style.backgroundColor;
              el.style.transition = 'background-color 0.3s';
              el.style.backgroundColor = 'rgba(99,179,237,0.3)';
              setTimeout(() => { el.style.backgroundColor = oldBg; }, 300);
            }
          }
        });
        
        actions.push({
          label: '&#128247; Add ' + typeName + ' to notes',
          actionFn: function() {
            var clone = el.cloneNode(true);
            clone.style.cursor='default';
            window.notes.push({q: clone.outerHTML, txt: typeName.charAt(0).toUpperCase() + typeName.slice(1), id: Date.now()});
            if (window.renderNotes) window.renderNotes();
            if (window.panel && window.panel.classList.contains('hidden')) window.togglePanel();
            if (window.switchTab) window.switchTab('notes');
          }
        });
        
        if (el.tagName.toLowerCase() !== 'code') {
          actions.push({
            label: '&#128269; Enlarge',
            actionFn: function() {
              if (window.showEnlargedMedia) {
                var clone = el.cloneNode(true);
                clone.style.cursor='default';
                window.showEnlargedMedia(clone);
              }
            }
          });
        }
        
        window.showActionPopup(ev, actions);
    };
    
    window.contentEl.removeEventListener('click', this._mdClickHandler);
    window.contentEl.addEventListener('click', this._mdClickHandler);
    
    // The global click handler for md-content handles code block explanations
    
    window.contentEl.removeEventListener('scroll', this._onScroll);
    window.contentEl.addEventListener('scroll', this._onScroll);
    
    if (window.pendingScrollState && window.pendingScrollState.type === 'md') {
       const targetScrollTop = window.pendingScrollState.scrollTop;
       // Attempt to restore scroll multiple times to account for layout shifts
       // caused by asynchronous image loading and mermaid diagram rendering.
       [50, 300, 800, 1500, 3000].forEach(delay => {
           setTimeout(() => {
             if (window.contentEl) window.contentEl.scrollTop = targetScrollTop;
           }, delay);
       });
       // Clear it so it doesn't apply to subsequent manual file opens
       setTimeout(() => { window.pendingScrollState = null; }, 3100);
    }
    
    if (window.triggerLibrarySave) {
        window.triggerLibrarySave(file, file.name, 'md');
    }
  }
}

class TextDocumentHandler {
  constructor() {
    this._onScroll = this._onScroll.bind(this);
    this._scrollSaveTimer = null;
    this._searchMarks = [];
    this._searchCurrentIdx = -1;
  }
  
  getScrollState() {
    if (!window.contentEl) return null;
    return { type: 'txt', scrollTop: window.contentEl.scrollTop };
  }
  
  _onScroll() {
    if (this._scrollSaveTimer) clearTimeout(this._scrollSaveTimer);
    this._scrollSaveTimer = setTimeout(() => {
      if (window.triggerStateSave) window.triggerStateSave();
    }, 1000);
  }

  setupToolbar() {
    document.getElementById('secondary-toolbar').style.display='none';
  }
  async load(file) {
    var txt = await file.text();
    window.docText = txt;
    window.pdfParts = txt.split('\n\n').filter(function(t) { return t.trim().length > 0; });
    var escapedTxt = window.escapeHTML ? window.escapeHTML(txt) : txt;
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto; font-size: var(--reader-size, 16px);"><pre style="white-space:pre-wrap">' + escapedTxt + '</pre></div>';
    
    window.contentEl.removeEventListener('scroll', this._onScroll);
    window.contentEl.addEventListener('scroll', this._onScroll);
    
    if (window.pendingScrollState && window.pendingScrollState.type === 'txt') {
       const targetScrollTop = window.pendingScrollState.scrollTop;
       [50, 300, 800].forEach(delay => {
           setTimeout(() => {
             if (window.contentEl) window.contentEl.scrollTop = targetScrollTop;
           }, delay);
       });
       setTimeout(() => { window.pendingScrollState = null; }, 900);
    }
    
    if (window.triggerLibrarySave) {
        window.triggerLibrarySave(file, file.name, 'txt');
    }
  }
}

// Attach to window so DocumentHandlerFactory can use it
window.MarkdownDocumentHandler = MarkdownDocumentHandler;
window.TextDocumentHandler = TextDocumentHandler;

// Share search methods from Markdown handler to Text handler (same DOM structure)
TextDocumentHandler.prototype.clearSearch = MarkdownDocumentHandler.prototype.clearSearch;
TextDocumentHandler.prototype.performSearch = MarkdownDocumentHandler.prototype.performSearch;
TextDocumentHandler.prototype.navigateSearch = MarkdownDocumentHandler.prototype.navigateSearch;

const mdInstance = new MarkdownDocumentHandler();
MarkdownDocumentHandler.prototype.toc = {
  render: function() {
    var list = document.getElementById('toc-list');
    if (!list || !window.contentEl) return;
    list.innerHTML = '';
    
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
      titleSpan.textContent = h.textContent || '(Untitled)';
      div.appendChild(titleSpan);

      // Calculate approximate progress percentage instead of page numbers
      var pageSpan = document.createElement('span');
      pageSpan.className = 'toc-item-page';
      
      // Calculate percentage based on offsetTop vs scrollHeight
      // Fallback to 0 if contentEl is missing or height is 0
      var percent = 0;
      if (window.contentEl && window.contentEl.scrollHeight > 0) {
          percent = Math.max(0, Math.min(100, Math.round((h.offsetTop / window.contentEl.scrollHeight) * 100)));
      }
      pageSpan.textContent = percent + '%';
      pageSpan.title = 'Approximate position in document';
      div.appendChild(pageSpan);

      div.onclick = function() {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.closeToc();
      };

      list.appendChild(div);
    });

    var badge = document.getElementById('toc-count');
    if (badge) badge.textContent = headings.length;
  }
};

const txtInstance = new TextDocumentHandler();
TextDocumentHandler.prototype.toc = {
  render: function() {
    var list = document.getElementById('toc-list');
    if (!list) return;
    list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128203;</span>Plain text documents do not have a table of contents.</div>';
  }
};

// Register Handler
if (window.registerDocumentHandler) {
  window.registerDocumentHandler('md', mdInstance);
  window.registerDocumentHandler('txt', txtInstance);
}
