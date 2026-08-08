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
    
    rendition.display();
    
    prevBtn.onclick = function() {
       rendition.prev();
    };
    
    nextBtn.onclick = function() {
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

const epubHandler = {
  toc: {
    render: function() { if (window.renderEpubToc) window.renderEpubToc(); }
  },
  layout: {
    fitWidth: function(val) {
      if (window.currentEpubRendition) {
        setTimeout(function() { window.currentEpubRendition.resize(); }, 100);
      }
    }
  },
  theme: {
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
  }
};

if (window.registerDocumentHandler) {
  window.registerDocumentHandler('epub', epubHandler);
}
