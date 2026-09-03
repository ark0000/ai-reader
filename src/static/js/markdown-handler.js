/**
 * markdown-handler.js
 * Handles Markdown and plain text file processing with robust Table of Contents & Anchor Navigation.
 */

class MarkdownDocumentHandler {
  constructor() {
    this._onScroll = this._onScroll.bind(this);
    this._onContentClick = this._onContentClick.bind(this);
    this._scrollSaveTimer = null;
    this._searchMarks = [];
    this._searchCurrentIdx = -1;
    this._slugMap = new Map();
    this._headings = [];
  }
  
  getScrollState() {
    if (!window.contentEl) return null;
    return { type: 'md', scrollTop: window.contentEl.scrollTop };
  }
  
  _onScroll() {
    this._updateBookScrollSpy();
    if (this._scrollSaveTimer) clearTimeout(this._scrollSaveTimer);
    this._scrollSaveTimer = setTimeout(() => {
      if (window.triggerStateSave) window.triggerStateSave();
    }, 1000);
  }

  _initBookScrollSpy() {
    let banner = document.getElementById('book-sticky-banner');
    if (!banner && window.contentEl) {
      banner = document.createElement('div');
      banner.id = 'book-sticky-banner';
      banner.style.cssText = 'position:sticky; top:12px; z-index:100; margin:0 auto -38px; width:fit-content; max-width:85%; display:none; align-items:center; gap:8px; padding:6px 16px; border-radius:20px; background:rgba(22,27,34,0.85); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.12); box-shadow:0 6px 20px rgba(0,0,0,0.4); font-size:12px; color:var(--text-1); pointer-events:none; transition:opacity 0.2s, transform 0.2s; user-select:none;';
      banner.innerHTML = `
        <span style="font-size:13px;">📖</span>
        <span id="book-sticky-chapter-name" style="font-weight:600; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px;">Book Overview</span>
        <span style="color:var(--text-3);">&bull;</span>
        <span id="book-sticky-progress" style="font-size:11px; color:var(--text-2); font-variant-numeric:tabular-nums;">0%</span>
      `;
      window.contentEl.insertBefore(banner, window.contentEl.firstChild);
    }
    this._updateBookScrollSpy();
  }

  _updateBookScrollSpy() {
    const banner = document.getElementById('book-sticky-banner');
    if (!banner || !window.contentEl) return;

    const dividers = window.contentEl.querySelectorAll('.book-chapter-divider');
    if (!dividers || dividers.length === 0) {
      banner.style.display = 'none';
      return;
    }

    const scrollTop = window.contentEl.scrollTop;
    const scrollHeight = window.contentEl.scrollHeight;
    const clientHeight = window.contentEl.clientHeight;

    if (scrollTop > 70) {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }

    const maxScroll = scrollHeight - clientHeight;
    const pct = maxScroll > 0 ? Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100))) : 0;
    const progressEl = document.getElementById('book-sticky-progress');
    if (progressEl) progressEl.textContent = pct + '%';

    const containerTop = window.contentEl.getBoundingClientRect().top;
    let activeTitle = 'Book Overview';

    dividers.forEach(div => {
      const rect = div.getBoundingClientRect();
      if (rect.top - containerTop <= 160) {
        const chTitle = div.getAttribute('data-title') || div.textContent;
        const chNum = div.getAttribute('data-ch');
        if (chNum && chNum !== '0') {
          activeTitle = `Ch ${chNum}: ${chTitle}`;
        } else {
          activeTitle = chTitle;
        }
      }
    });

    const titleEl = document.getElementById('book-sticky-chapter-name');
    if (titleEl && titleEl.textContent !== activeTitle) {
      titleEl.textContent = activeTitle;
    }
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
    var countEl = document.getElementById('search-count');
    if (countEl) countEl.textContent = marks.length + ' matches';
    var container = document.getElementById('search-results');
    if (!container) return;
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
        var parentEl = mark.parentNode;
        var snippet = parentEl ? parentEl.textContent.substring(0, 120) : mark.textContent;
        if (parentEl && parentEl.textContent.length > 120) snippet += '...';

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
    
    var countEl = document.getElementById('search-count');
    if (countEl) countEl.textContent = (idx + 1) + ' of ' + this._searchMarks.length;
    
    // Update selected state in results list
    document.querySelectorAll('.search-result-item').forEach(function(el) { el.classList.remove('selected'); });
    var activeEl = document.querySelector('.search-result-item[data-idx="' + idx + '"]');
    if (activeEl) {
      activeEl.classList.add('selected');
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  setupToolbar() {
    var secToolbar = document.getElementById('secondary-toolbar');
    if (secToolbar) secToolbar.style.display = 'flex';
    document.querySelectorAll('.pdf-only').forEach(function(el){ el.style.display = 'none'; });
    const fontControls = document.getElementById('font-size-controls');
    if (fontControls) fontControls.style.display = 'inline-flex';
  }

  // --- SLUG & ANCHOR NAVIGATION STRATEGIES ---

  _generateGfmSlug(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, '') // remove HTML tags
      .replace(/[§#?.,/\\()\[\]{}!@$%^&*+=~`'":;<>|]/g, '') // remove symbols & punctuation
      .trim()
      .replace(/[\s—–_]+/g, '-') // replace spaces, em-dashes, en-dashes with hyphen
      .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
  }

  _generateStrictSlug(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  _normalizeHeadingText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  _indexHeadingsAndAnchors() {
    if (!window.contentEl) return;
    const mdContent = window.contentEl.querySelector('.md-content');
    if (!mdContent) return;

    this._slugMap = new Map();
    this._headings = [];
    const slugCounts = {};

    const headingNodes = mdContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headingNodes.forEach((h, idx) => {
      const rawText = (h.textContent || '').trim();
      let baseSlug = this._generateGfmSlug(rawText) || ('heading-' + idx);
      
      // Handle slug collisions
      let uniqueSlug = baseSlug;
      if (slugCounts[baseSlug] !== undefined) {
        slugCounts[baseSlug]++;
        uniqueSlug = baseSlug + '-' + slugCounts[baseSlug];
      } else {
        slugCounts[baseSlug] = 0;
      }

      // Assign ID to heading
      if (!h.id || h.id.startsWith('heading-md-')) {
        h.id = uniqueSlug;
      }

      const level = parseInt(h.tagName.substring(1), 10) || 1;
      h.setAttribute('data-slug', uniqueSlug);
      h.setAttribute('data-heading-idx', String(idx));
      h.setAttribute('data-heading-level', String(level));

      // Register primary and alias slugs in slugMap
      this._slugMap.set(uniqueSlug, h);
      this._slugMap.set(baseSlug, h);
      this._slugMap.set(h.id, h);

      const strictSlug = this._generateStrictSlug(rawText);
      if (strictSlug) this._slugMap.set(strictSlug, h);

      // Register double-hyphen variant for em-dashes (e.g. how-to-read--persona-guide)
      const emDashSlug = rawText
        .toLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/[§#?.,/\\()\[\]{}!@$%^&*+=~`'":;<>|]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/—|–/g, '--')
        .replace(/^-+|-+$/g, '');
      if (emDashSlug) this._slugMap.set(emDashSlug, h);

      // Register section-number-stripped alias (e.g. "§0.6 Future ML Roadmap" -> "future-ml-roadmap")
      const noNumberSlug = this._generateGfmSlug(rawText.replace(/^[§\d.\s-]+/, ''));
      if (noNumberSlug) this._slugMap.set(noNumberSlug, h);

      // Register normalized text for text-based match
      const normText = this._normalizeHeadingText(rawText);
      if (normText) this._slugMap.set('norm:' + normText, h);

      this._headings.push({
        el: h,
        id: h.id,
        slug: uniqueSlug,
        title: rawText,
        level: level
      });
    });

    // Also index explicit anchor tags <a name="...">, <a id="...">, and elements with id
    const namedAnchors = mdContent.querySelectorAll('a[name], a[id], [id]');
    namedAnchors.forEach((a) => {
      const name = a.getAttribute('name');
      const id = a.getAttribute('id');
      if (name) this._slugMap.set(name, a);
      if (id) this._slugMap.set(id, a);
    });
  }

  resolveTarget(rawHash, linkText) {
    if (!rawHash && !linkText) return null;

    let target = (rawHash || '').replace(/^#/, '');
    try { target = decodeURIComponent(target); } catch(e) {}
    target = target.trim();

    if (this._slugMap) {
      // 1. Direct slug map lookup
      if (target && this._slugMap.has(target)) return this._slugMap.get(target);

      // 2. Lowercase lookup
      const lower = target.toLowerCase();
      if (this._slugMap.has(lower)) return this._slugMap.get(lower);

      // 3. GFM and Strict slug conversion lookup
      const gfmTarget = this._generateGfmSlug(target);
      if (gfmTarget && this._slugMap.has(gfmTarget)) return this._slugMap.get(gfmTarget);

      const strictTarget = this._generateStrictSlug(target);
      if (strictTarget && this._slugMap.has(strictTarget)) return this._slugMap.get(strictTarget);

      // 4. Normalized text lookup
      const normTarget = this._normalizeHeadingText(target);
      if (normTarget && this._slugMap.has('norm:' + normTarget)) return this._slugMap.get('norm:' + normTarget);

      // 5. Match by link text if available
      if (linkText) {
        const gfmLink = this._generateGfmSlug(linkText);
        if (gfmLink && this._slugMap.has(gfmLink)) return this._slugMap.get(gfmLink);

        const normLink = this._normalizeHeadingText(linkText);
        if (normLink && this._slugMap.has('norm:' + normLink)) return this._slugMap.get('norm:' + normLink);
      }
    }

    // 6. Direct querySelector lookup inside window.contentEl
    if (window.contentEl && target) {
      try {
        const byId = window.contentEl.querySelector('#' + CSS.escape(target));
        if (byId) return byId;

        const byName = window.contentEl.querySelector('a[name="' + CSS.escape(target) + '"], [name="' + CSS.escape(target) + '"]');
        if (byName) return byName;

        const bySlug = window.contentEl.querySelector('[data-slug="' + CSS.escape(target) + '"]');
        if (bySlug) return bySlug;
      } catch(e) {}
    }

    // 7. Fuzzy heading text fallback (prefix/contains match)
    if (this._headings && this._headings.length > 0) {
      const cleanQuery = (target || linkText || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanQuery.length >= 3) {
        for (let i = 0; i < this._headings.length; i++) {
          const h = this._headings[i];
          const normH = this._normalizeHeadingText(h.title);
          if (normH.includes(cleanQuery) || cleanQuery.includes(normH) || normH.startsWith(cleanQuery) || cleanQuery.startsWith(normH)) {
            return h.el;
          }
        }
      }
    }

    return null;
  }

  scrollToTarget(targetEl) {
    if (!targetEl || !window.contentEl) return;

    const targetRect = targetEl.getBoundingClientRect();
    const containerRect = window.contentEl.getBoundingClientRect();
    const offset = 24; // 24px comfortable top padding
    const targetScrollTop = window.contentEl.scrollTop + (targetRect.top - containerRect.top) - offset;

    window.contentEl.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth'
    });

    // Pulse highlight animation on target element
    targetEl.classList.remove('md-target-highlight');
    void targetEl.offsetWidth; // Force reflow
    targetEl.classList.add('md-target-highlight');
    setTimeout(() => {
      targetEl.classList.remove('md-target-highlight');
    }, 2000);
  }

  _onContentClick(ev) {
    if (window.getSelection && window.getSelection().toString().trim().length > 0) {
      return; // Do not intercept if user is selecting text
    }

    // 1. Intercept Markdown Links & TOC Anchors
    const link = ev.target.closest('a');
    if (link && window.contentEl && window.contentEl.contains(link)) {
      const href = link.getAttribute('href');
      if (href) {
        // Internal anchor navigation (#anchor or same-page hash)
        if (href.startsWith('#') || href.startsWith(window.location.pathname + '#') || href.includes('#')) {
          const hashIdx = href.indexOf('#');
          if (hashIdx !== -1) {
            ev.preventDefault();
            ev.stopPropagation();

            const hash = href.substring(hashIdx);
            const targetEl = this.resolveTarget(hash, link.textContent);
            if (targetEl) {
              this.scrollToTarget(targetEl);
            } else {
              console.warn('[Markdown] Target heading not found for anchor:', href);
            }
            return;
          }
        }

        // External links open in new tab
        if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        }
        return;
      }
    }

    // 2. Media / Code / Diagram Action Popup
    var mediaEl = ev.target.closest('.md-content img, .md-content .mermaid, .md-content pre code');
    if (mediaEl && window.contentEl && window.contentEl.contains(mediaEl)) {
      ev.stopPropagation();
      var actions = [];
      let prompt = '';
      let typeName = 'diagram';

      if (mediaEl.tagName.toLowerCase() === 'code') {
        prompt = 'Please explain this code:\n\n```\n' + mediaEl.textContent + '\n```';
        typeName = 'code';
      } else if (mediaEl.tagName.toLowerCase() === 'img') {
        prompt = 'Please explain this image (from URL: ' + mediaEl.src + ' / alt: ' + (mediaEl.alt || '') + ').';
        typeName = 'image';
      } else {
        prompt = 'Please explain this diagram:\n\n```mermaid\n' + mediaEl.textContent + '\n```';
      }

      actions.push({
        label: '&#10024; Explain with AI',
        actionFn: function() {
          if (window.askAI) {
            window.askAI(prompt);
            const oldBg = mediaEl.style.backgroundColor;
            mediaEl.style.transition = 'background-color 0.3s';
            mediaEl.style.backgroundColor = 'rgba(99,179,237,0.3)';
            setTimeout(() => { mediaEl.style.backgroundColor = oldBg; }, 300);
          }
        }
      });

      actions.push({
        label: '&#128247; Add ' + typeName + ' to notes',
        actionFn: function() {
          var clone = mediaEl.cloneNode(true);
          clone.style.cursor = 'default';
          window.notes.push({ q: clone.outerHTML, txt: typeName.charAt(0).toUpperCase() + typeName.slice(1), id: Date.now() });
          if (window.renderNotes) window.renderNotes();
          if (window.panel && window.panel.classList.contains('hidden')) window.togglePanel();
          if (window.switchTab) window.switchTab('notes');
        }
      });

      if (mediaEl.tagName.toLowerCase() !== 'code') {
        actions.push({
          label: '&#9651; Enlarge',
          actionFn: function() {
            if (window.showEnlargedMedia) {
              var clone = mediaEl.cloneNode(true);
              clone.style.cursor = 'default';
              window.showEnlargedMedia(clone);
            }
          }
        });
      }

      // Open mermaid source in the Diagram Builder panel
      if (mediaEl.classList && mediaEl.classList.contains('mermaid') && window.DiagramBuilder) {
        var _mermaidSrc = mediaEl.getAttribute('data-dgb-src') || mediaEl.textContent || '';
        actions.push({
          label: '&#11041; Open in Diagram Builder',
          actionFn: function() {
            var editor = document.getElementById('dgb-editor');
            window.DiagramBuilder.open();
            // Populate the editor after the panel is open
            setTimeout(function() {
              var ed = document.getElementById('dgb-editor');
              if (ed) {
                ed.value = _mermaidSrc.trim();
                // Trigger run automatically so diagram renders immediately
                var runBtn = document.getElementById('dgb-btn-run');
                if (runBtn) runBtn.click();
              }
            }, 150);
          }
        });
      }

      if (window.showActionPopup) {
        window.showActionPopup(ev, actions);
      }
    }
  }

  async load(file) {
    var txt = await file.text();
    window.docText = txt;
    
    // Set deterministic file ID and trigger RAG index
    var docName = file.name || window.currentFileName || 'document.md';
    var fSize = file.size || txt.length;
    window.currentFileId = 'doc_' + btoa(encodeURIComponent(docName + '_' + fSize)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    
    if (txt.trim()) {
      try {
        fetch('/api/rag/index_text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: window.currentFileId, text: txt })
        }).catch(e => console.error("MD RAG Index error:", e));
      } catch(e) {}
    }
    
    // Fallback if marked is missing
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
    
    // Sanitize with preserved IDs and anchor attributes
    var cleanHtml = rawHtml;
    if (typeof DOMPurify !== 'undefined') {
      cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: ['strong', 'em', 'code', 'pre', 'br', 'a', 'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'mspace', 'mtext', 'annotation', 'mark', 'hr', 'img', 'details', 'summary', 'svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon'],
        ALLOWED_ATTR: ['href', 'id', 'name', 'style', 'class', 'target', 'rel', 'title', 'alt', 'src', 'width', 'height', 'xmlns', 'display', 'encoding', 'data-slug', 'data-heading-idx', 'data-heading-level', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2']
      });
    }
    
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto; font-size: var(--reader-size, 16px);">' + cleanHtml + '</div>';
    
    // Inject interactive styles
    let style = document.getElementById('md-interactive-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'md-interactive-style';
      style.innerHTML = `
        @keyframes mdHighlightPulse {
          0% {
            background-color: rgba(99, 179, 237, 0.35);
            box-shadow: 0 0 0 4px rgba(99, 179, 237, 0.3);
            border-radius: 6px;
          }
          60% {
            background-color: rgba(99, 179, 237, 0.15);
            box-shadow: 0 0 0 2px rgba(99, 179, 237, 0.15);
          }
          100% {
            background-color: transparent;
            box-shadow: none;
          }
        }
        .md-target-highlight {
          animation: mdHighlightPulse 2s ease-out forwards !important;
          border-radius: 6px;
          transition: background-color 0.3s ease;
        }
        .md-content a {
          cursor: pointer;
          color: var(--accent, #60a5fa);
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: opacity 0.15s ease, color 0.15s ease;
        }
        .md-content a:hover {
          opacity: 0.85;
        }
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

    // Index all headings and anchors immediately for reliable TOC navigation
    this._indexHeadingsAndAnchors();

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
      // Preserve raw source so Diagram Builder can retrieve it after mermaid.init() replaces textContent
      div.setAttribute('data-dgb-src', el.textContent);
      pre.replaceWith(div);
    });
    
    if (typeof mermaid !== 'undefined') {
      setTimeout(() => {
        try { 
          mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
          mermaid.init(undefined, document.querySelectorAll('.mermaid')); 
        } catch(e){ console.error('Mermaid error', e); }
      }, 50);
    }
    
    // Event delegation for anchor links, TOC clicks, and media popups
    window.contentEl.removeEventListener('click', this._onContentClick);
    window.contentEl.addEventListener('click', this._onContentClick);
    
    window.contentEl.removeEventListener('scroll', this._onScroll);
    window.contentEl.addEventListener('scroll', this._onScroll);
    
    if (window.pendingScrollState && (window.pendingScrollState.type === 'md' || window.pendingScrollState.scrollTop !== undefined)) {
       const targetScrollTop = window.pendingScrollState.scrollTop;
       [50, 300, 800, 1500, 3000].forEach(delay => {
           setTimeout(() => {
             if (window.contentEl) window.contentEl.scrollTop = targetScrollTop;
           }, delay);
       });
       setTimeout(() => { window.pendingScrollState = null; }, 3100);
    }
    
    // Initialize Book Multi-Chapter Scroll Spy if this document is an assembled book
    if (window.contentEl && window.contentEl.querySelector('.book-chapter-divider')) {
      this._initBookScrollSpy();
    } else {
      const banner = document.getElementById('book-sticky-banner');
      if (banner) banner.style.display = 'none';
    }
    
    if (window.triggerLibrarySave) {
        window.triggerLibrarySave(file, file.name, 'md');
    }
  }

  jumpTo(target) {
    if (!window.contentEl) return;
    var headings = window.contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6, [data-slug]');
    var p = parseInt(target, 10);
    if (!isNaN(p) && headings && headings[p - 1]) {
      var h = headings[p - 1];
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      h.style.transition = 'background-color 0.3s ease';
      var oldBg = h.style.backgroundColor;
      h.style.backgroundColor = 'rgba(255, 107, 0, 0.25)';
      setTimeout(() => { h.style.backgroundColor = oldBg; }, 1500);
    } else if (typeof target === 'string') {
      var match = Array.from(headings).find(el => el.textContent.toLowerCase().includes(target.toLowerCase()));
      if (match) {
        match.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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
    var secToolbar = document.getElementById('secondary-toolbar');
    if (secToolbar) secToolbar.style.display = 'none';
  }

  async load(file) {
    var txt = await file.text();
    window.docText = txt;
    window.pdfParts = txt.split('\n\n').filter(function(t) { return t.trim().length > 0; });
    var escapedTxt = window.escapeHTML ? window.escapeHTML(txt) : txt;
    window.contentEl.innerHTML = '<div class="md-content prose prose-slate dark:prose-invert" style="max-width: var(--reader-width); margin: 0 auto; font-size: var(--reader-size, 16px);"><pre style="white-space:pre-wrap">' + escapedTxt + '</pre></div>';
    
    window.contentEl.removeEventListener('scroll', this._onScroll);
    window.contentEl.addEventListener('scroll', this._onScroll);
    
    if (window.pendingScrollState && (window.pendingScrollState.type === 'txt' || window.pendingScrollState.scrollTop !== undefined)) {
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

    var headings = window.contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128203;</span>No headings found in this document.</div>';
      return;
    }

    var handler = window.getActiveHandler();

    headings.forEach(function(h, idx) {
      var level = parseInt(h.tagName.substring(1), 10) || 1;

      var div = document.createElement('div');
      div.className = 'toc-item toc-level-' + Math.min(level, 4);

      var titleSpan = document.createElement('span');
      titleSpan.className = 'toc-item-title';
      titleSpan.textContent = (h.textContent || '(Untitled)').trim();
      div.appendChild(titleSpan);

      // Calculate approximate progress percentage based on offsetTop
      var pageSpan = document.createElement('span');
      pageSpan.className = 'toc-item-page';
      
      var percent = 0;
      if (window.contentEl && window.contentEl.scrollHeight > 0) {
          percent = Math.max(0, Math.min(100, Math.round((h.offsetTop / window.contentEl.scrollHeight) * 100)));
      }
      pageSpan.textContent = percent + '%';
      pageSpan.title = 'Approximate position in document';
      div.appendChild(pageSpan);

      div.onclick = function() {
        if (handler && handler.scrollToTarget) {
          handler.scrollToTarget(h);
        } else {
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (window.closeToc) window.closeToc();
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

// Register Handlers
if (window.registerDocumentHandler) {
  window.registerDocumentHandler('md', mdInstance);
  window.registerDocumentHandler('txt', txtInstance);
}
