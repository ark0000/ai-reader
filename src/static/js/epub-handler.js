/**
 * epub-handler.js
 * Handles EPUB files natively using epub.js.
 */

class EpubDocumentHandler {
  setupToolbar() {
    document.getElementById('secondary-toolbar').style.display='flex';
    document.querySelectorAll('.pdf-only').forEach(function(el){ el.style.display = 'none'; });
    const fontControls = document.getElementById('font-size-controls');
    if (fontControls) fontControls.style.display = 'inline-flex';
  }
  
  constructor() {
    this.currentCfi = null;
    this._searchResults = [];
    this._searchCurrentIdx = -1;
  }

  getScrollState() {
    return this.currentCfi ? { type: 'epub', cfi: this.currentCfi } : null;
  }

  clearSearch() {
    this._searchResults = [];
    this._searchCurrentIdx = -1;
    // Remove highlights from epub iframe
    if (window.currentEpubRendition && window.currentEpubRendition.getContents) {
      window.currentEpubRendition.getContents().forEach(function(content) {
        if (content.document) {
          content.document.querySelectorAll('mark.search-hl').forEach(function(m) {
            var parent = m.parentNode;
            if (parent) {
              parent.replaceChild(content.document.createTextNode(m.textContent), m);
              parent.normalize();
            }
          });
        }
      });
    }
  }

  async performSearch(query, opts) {
    this.clearSearch();
    if (!query || !window.currentEpubBook) return;

    var container = document.getElementById('search-results');
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);">Searching EPUB...</div>';

    var book = window.currentEpubBook;
    var results = [];
    var _this = this;

    // Search through each spine section
    try {
      var spineItems = book.spine.spineItems;
      for (var i = 0; i < spineItems.length; i++) {
        var section = spineItems[i];
        var sectionResults = await section.find(query);
        if (sectionResults && sectionResults.length > 0) {
          sectionResults.forEach(function(r) {
            results.push({
              cfi: r.cfi,
              excerpt: r.excerpt || query,
              sectionIndex: i,
              sectionLabel: section.idref || ('Section ' + (i + 1))
            });
          });
        }
      }
    } catch(err) {
      console.warn('[EpubSearch] Error during search:', err);
    }

    this._searchResults = results;
    this._searchCurrentIdx = -1;

    document.getElementById('search-count').textContent = results.length + ' matches';
    container.innerHTML = '';

    if (results.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);">No results found.</div>';
      return;
    }

    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var flags = opts.caseSensitive ? 'g' : 'gi';
    var limit = Math.min(results.length, 100);

    for (var j = 0; j < limit; j++) {
      (function(idx) {
        var r = results[idx];
        var snippet = r.excerpt.substring(0, 120);
        if (r.excerpt.length > 120) snippet += '...';
        var highlighted = snippet.replace(new RegExp(escaped, flags),
          '<mark style="background:var(--gold);color:#000;border-radius:2px;">$&</mark>');

        var el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.idx = idx;
        el.innerHTML = '<div class="search-result-snippet">' + highlighted + '</div>';
        el.onclick = function() { _this.navigateSearch(0, idx); };
        container.appendChild(el);
      })(j);
    }

    if (results.length > limit) {
      var moreEl = document.createElement('div');
      moreEl.style.cssText = 'padding:10px;text-align:center;color:var(--text-2);font-size:0.85rem;';
      moreEl.textContent = '... and ' + (results.length - limit) + ' more matches';
      container.appendChild(moreEl);
    }

    // Navigate to first result
    this.navigateSearch(0, 0);
  }

  navigateSearch(dir, absoluteIdx) {
    if (this._searchResults.length === 0) return;
    var idx;
    if (typeof absoluteIdx === 'number') {
      idx = absoluteIdx;
    } else {
      idx = this._searchCurrentIdx + dir;
      if (idx < 0) idx = this._searchResults.length - 1;
      if (idx >= this._searchResults.length) idx = 0;
    }

    this._searchCurrentIdx = idx;
    var result = this._searchResults[idx];

    // Navigate to the CFI in the EPUB rendition
    if (window.currentEpubRendition && result.cfi) {
      window.currentEpubRendition.display(result.cfi);
    }

    document.getElementById('search-count').textContent = (idx + 1) + ' of ' + this._searchResults.length;

    document.querySelectorAll('.search-result-item').forEach(function(el) { el.classList.remove('selected'); });
    var activeEl = document.querySelector('.search-result-item[data-idx="' + idx + '"]');
    if (activeEl) {
      activeEl.classList.add('selected');
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async load(file) {
    if (typeof ePub === 'undefined') {
       window.contentEl.innerHTML = '<div style="padding:2rem"><h2 style="color:#fc8181">Error</h2><p style="color:#8899aa">EPUB engine is not loaded.</p></div>';
       return;
    }
    
    window.contentEl.innerHTML = '<div class="msg msg-s" style="margin-top:40px">Loading EPUB...</div>';
    
    // Read the file as ArrayBuffer
    var buf = await file.arrayBuffer();
    
    window.contentEl.innerHTML = '<div id="viewer" class="epub-viewer" style="width:100%; max-width:var(--reader-width); margin:0 auto; height:80vh; position:relative; overflow:hidden;"></div>';
    
    // Set up layout
    var controls = document.createElement('div');
    controls.className = 'epub-controls';
    controls.style.cssText = 'display:flex; justify-content:space-between; max-width:var(--reader-width); margin:10px auto;';
    
    var prevBtn = document.createElement('button');
    prevBtn.className = 'tb-btn';
    prevBtn.innerHTML = '&#9664; Prev';
    
    var nextBtn = document.createElement('button');
    nextBtn.className = 'tb-btn';
    nextBtn.innerHTML = 'Next &#9654;';
    
    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);
    window.contentEl.appendChild(controls);
    
    // Initialize EPUB
    var book = ePub(buf);
    var rendition = book.renderTo("viewer", {
       width: "100%",
       height: "100%",
       spread: "none"
    });
    
    window.currentEpubBook = book;
    window.currentEpubRendition = rendition;
    
    var reflowStart = performance.now();
    var targetCfi = (window.pendingScrollState && (window.pendingScrollState.type === 'epub' || window.pendingScrollState.cfi)) ? window.pendingScrollState.cfi : null;
    
    if (targetCfi) {
      rendition.display(targetCfi).then(function() {
          if(window.AuraPerf && window.AuraPerf.logEpubReflow) {
              window.AuraPerf.logEpubReflow(performance.now() - reflowStart);
          }
          window.pendingScrollState = null;
      }).catch(function() {
          rendition.display();
      });
    } else {
      rendition.display().then(function() {
          if(window.AuraPerf && window.AuraPerf.logEpubReflow) {
              window.AuraPerf.logEpubReflow(performance.now() - reflowStart);
          }
      });
    }

    // Set deterministic file ID and trigger background RAG indexing
    var docName = file.name || window.currentFileName || 'document.epub';
    var fSize = file.size || buf.byteLength;
    window.currentFileId = 'doc_' + btoa(encodeURIComponent(docName + '_' + fSize)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);

    book.ready.then(async function() {
      try {
        var spineItems = book.spine.spineItems;
        var fullEpubText = [];
        for (var sIdx = 0; sIdx < spineItems.length; sIdx++) {
          var item = spineItems[sIdx];
          if (item && item.load) {
            var doc = await item.load(book.load.bind(book));
            if (doc && doc.body) {
              fullEpubText.push(doc.body.innerText || doc.body.textContent || '');
            }
          }
        }
        var combinedText = fullEpubText.join('\n\n').trim();
        if (combinedText) {
          fetch('/api/rag/index_text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: window.currentFileId, text: combinedText })
          }).catch(e => console.error("EPUB RAG Index error:", e));
        }
      } catch(err) {
        console.warn("[EpubRAG] Error extracting text for RAG:", err);
      }
    });

    if (window.triggerLibrarySave) {
        window.triggerLibrarySave(file, file.name, 'epub');
    }
    
    var _this = this;
    var _scrollSaveTimer;
    
    rendition.on("rendered", function(section, view) {
        if (view && view.document && window.injectCodeToolbars) {
            window.injectCodeToolbars(view.document.body);
        }
    });

    rendition.on("relocated", function(location) {
        if (location && location.start) {
            _this.currentCfi = location.start.cfi;
            clearTimeout(_scrollSaveTimer);
            _scrollSaveTimer = setTimeout(() => {
                if (window.triggerStateSave) window.triggerStateSave();
            }, 1000);
        }
        if (reflowStart > 0) {
           if(window.AuraPerf && window.AuraPerf.logEpubReflow) window.AuraPerf.logEpubReflow(performance.now() - reflowStart);
           reflowStart = 0;
        }
    });
    
    prevBtn.onclick = function() {
       reflowStart = performance.now();
       rendition.prev();
    };
    
    nextBtn.onclick = function() {
       reflowStart = performance.now();
       rendition.next();
    };
    
    // Theming hook for EPUB — pass computed theme colors into the iframe
    rendition.hooks.content.register(function(contents) {
        var doc = contents.document;
        var dp = document.getElementById('doc-pane') || document.documentElement;
      var cs = getComputedStyle(dp);
        var textColor = cs.getPropertyValue('--text-1').trim() || '#2d3748';
        var bgColor   = cs.getPropertyValue('--bg-pane').trim() || '#ffffff';
        var linkColor = cs.getPropertyValue('--accent').trim()  || '#3182ce';

        var style = doc.createElement('style');
        style.id = 'aurareader-theme';
        style.innerHTML =
          'body { color: ' + textColor + ' !important; background: ' + bgColor + ' !important; font-family: inherit !important; }' +
          'a { color: ' + linkColor + ' !important; }';
        doc.head.appendChild(style);

        contents.on("mouseup", function(e) {
            // Forward selection events to main window
            var sel = contents.window.getSelection();
            var txt = sel ? sel.toString().trim() : '';
            if(txt && txt.length > 0) {
              window.selText = txt;
              try { window.selRange = sel.getRangeAt(0).cloneRange(); } catch(ex){}

              var popup = document.getElementById('popup');
              if (popup) {
                 var iframeRect = document.getElementById('viewer').querySelector('iframe').getBoundingClientRect();
                 popup.style.display = 'flex';
                 popup.style.left = Math.min(e.clientX + iframeRect.left, window.innerWidth - 210) + 'px';
                 popup.style.top = (e.clientY + iframeRect.top + 12) + 'px';
              }
            } else {
              setTimeout(function(){
                 var popup = document.getElementById('popup');
                 if(popup) popup.style.display = 'none';
              }, 110);
            }
        });
    });
    
    // Table of contents support
    book.loaded.navigation.then(function(toc) {
      window.epubToc = toc;
    });
  }

  jumpTo(target) {
    if (window.currentEpubRendition) {
      if (typeof target === 'string' && target.startsWith('epubcfi')) {
        window.currentEpubRendition.display(target);
      } else {
        var p = parseInt(target, 10);
        if (!isNaN(p) && window.currentEpubBook && window.currentEpubBook.spine && window.currentEpubBook.spine.spineItems) {
          var items = window.currentEpubBook.spine.spineItems;
          if (items[p - 1]) {
            window.currentEpubRendition.display(items[p - 1].href);
          }
        }
      }
    }
  }
}

// Attach to window so DocumentHandlerFactory can use it
window.EpubDocumentHandler = EpubDocumentHandler;

// Dedicated render function for EPUB TOC
window.renderEpubToc = function() {
  var list = document.getElementById('toc-list');
  if (!list) return;
  list.innerHTML = '';

  if (!window.epubToc || window.epubToc.length === 0) {
    list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128218;</span>This EPUB has no table of contents.</div>';
    return;
  }

  var count = 0;
  function renderItems(items, level) {
    items.forEach(function(item) {
      count++;
      var div = document.createElement('div');
      div.className = 'toc-item toc-level-' + Math.min(level, 4);

      var titleSpan = document.createElement('span');
      titleSpan.className = 'toc-item-title';
      titleSpan.textContent = item.label || '(Untitled)';
      div.appendChild(titleSpan);

      div.onclick = function() {
        if (window.currentEpubRendition) {
          window.currentEpubRendition.display(item.href);
          window.closeToc();
        }
      };

      list.appendChild(div);

      if (item.subitems && item.subitems.length > 0) {
        renderItems(item.subitems, level + 1);
      }
    });
  }

  renderItems(window.epubToc, 1);

  var badge = document.getElementById('toc-count');
  if (badge) badge.textContent = count;
};

EpubDocumentHandler.prototype.toc = {
  render: function() {
    if (window.renderEpubToc) window.renderEpubToc();
  }
};

EpubDocumentHandler.prototype.layout = {
  fitWidth: function(val) {
    if (window.currentEpubRendition) {
      setTimeout(function() { window.currentEpubRendition.resize(); }, 100);
    }
  }
};

EpubDocumentHandler.prototype.theme = {
  apply: function(cssVars, isDark) {
    const rendition = window.currentEpubRendition;
    if (!rendition) return;
    var cs = getComputedStyle(document.documentElement);
    var textColor = cs.getPropertyValue('--text-1').trim() || '#2d3748';
    var bgColor   = cs.getPropertyValue('--bg-pane').trim() || '#ffffff';
    var linkColor = cs.getPropertyValue('--accent').trim()  || '#3182ce';

    var cssText = 'body { color: ' + textColor + ' !important; background: ' + bgColor + ' !important; font-family: inherit !important; } a { color: ' + linkColor + ' !important; }';
    if (rendition.getContents) {
      rendition.getContents().forEach(function(content) {
        if (content.document) {
          var style = content.document.getElementById('aurareader-theme');
          if (style) style.innerHTML = cssText;
        }
      });
    }
  }
};

const epubInstance = new EpubDocumentHandler();

if (window.registerDocumentHandler) {
  window.registerDocumentHandler('epub', epubInstance);
}
