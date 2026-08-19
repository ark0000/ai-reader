
// --- STRUCTURAL RECOGNIZER STRATEGIES ---
class IStructuralRecognizer {
  recognize(page, viewport, textContent, operatorList) { return []; }
}

class CodeRecognizerStrategy extends IStructuralRecognizer {
  recognize(page, viewport, textContent, operatorList) {
    if (!textContent || !textContent.items) return [];
    let boxes = [];
    let currentBlock = null;

    for (let item of textContent.items) {
      // Heuristic: Monospace fonts or generic syntax
      let isCode = item.fontName && (item.fontName.toLowerCase().includes('mono') || item.fontName.toLowerCase().includes('courier'));
      if (!isCode && item.str.match(/[{}=>;]|def |function |import |class /)) isCode = true;

      if (isCode) {
        let pt1 = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        let w = Math.max(item.width * viewport.scale, 10);
        let h = Math.max((item.height || 10) * viewport.scale, 10);

        if (!currentBlock) {
          currentBlock = { x: pt1[0], y: pt1[1] - h, w: w, h: h * 2, lines: [item.str] }; // Rough bounding
        } else {
          // Vertical DBSCAN approximation
          let yDiff = Math.abs((currentBlock.y + currentBlock.h) - pt1[1]);
          if (yDiff < 40) {
            currentBlock.x = Math.min(currentBlock.x, pt1[0]);
            currentBlock.w = Math.max(currentBlock.w, (pt1[0] - currentBlock.x) + w);
            currentBlock.h = (pt1[1] - currentBlock.y) + h;
            currentBlock.lines.push(item.str);
          } else {
            if (currentBlock.lines.length >= 2 || currentBlock.lines[0].length > 40) {
              boxes.push({ ...currentBlock, content: currentBlock.lines.join('\n'), type: 'code' });
            }
            currentBlock = { x: pt1[0], y: pt1[1] - h, w: w, h: h * 2, lines: [item.str] };
          }
        }
      }
    }
    if (currentBlock && (currentBlock.lines.length >= 2 || currentBlock.lines[0].length > 40)) {
      boxes.push({ ...currentBlock, content: currentBlock.lines.join('\n'), type: 'code' });
    }
    return boxes;
  }
}

class ImageRecognizerStrategy extends IStructuralRecognizer {
  recognize(page, viewport, textContent, operatorList) {
    if (!operatorList || !operatorList.fnArray) return [];
    let boxes = [];
    let transformStack = [[1, 0, 0, 1, 0, 0]];

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      let fn = operatorList.fnArray[i];
      let args = operatorList.argsArray[i];

      if (fn === pdfjsLib.OPS.save) {
        transformStack.push([...transformStack[transformStack.length - 1]]);
      } else if (fn === pdfjsLib.OPS.restore) {
        transformStack.pop();
      } else if (fn === pdfjsLib.OPS.transform) {
        let t1 = transformStack[transformStack.length - 1];
        let t2 = args;
        transformStack[transformStack.length - 1] = [
          t1[0] * t2[0] + t1[2] * t2[1],
          t1[1] * t2[0] + t1[3] * t2[1],
          t1[0] * t2[2] + t1[2] * t2[3],
          t1[1] * t2[2] + t1[3] * t2[3],
          t1[0] * t2[4] + t1[2] * t2[5] + t1[4],
          t1[1] * t2[4] + t1[3] * t2[5] + t1[5]
        ];
      } else if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintJpegXObject) {
        let matrix = transformStack[transformStack.length - 1];
        let pt1 = viewport.convertToViewportPoint(matrix[4], matrix[5]);
        let pt2 = viewport.convertToViewportPoint(matrix[4] + matrix[0], matrix[5] + matrix[3]);

        let x = Math.min(pt1[0], pt2[0]);
        let y = Math.min(pt1[1], pt2[1]);
        let w = Math.abs(pt1[0] - pt2[0]);
        let h = Math.abs(pt1[1] - pt2[1]);

        // Filter out full-page backgrounds (e.g., width > 90% of viewport width and height > 90%)
        if (w < viewport.width * 0.95 || h < viewport.height * 0.95) {
          // only push if it's reasonably sized, not a tiny 1x1 pixel mask
          if (w > 20 && h > 20) {
            boxes.push({ x, y, w, h, type: 'image' });
          }
        }
      }
    }
    return boxes;
  }
}

window.runRecognizers = async function (page, viewport, textContent, textLayerDiv) {
  try {
    let results = [];
    let operatorList = null;

    if (window.safeStorage && window.safeStorage.getItem('aura-pdf-img') !== 'false') {
      operatorList = await page.getOperatorList();
      let imgStrat = new ImageRecognizerStrategy();
      results.push(...imgStrat.recognize(page, viewport, textContent, operatorList));
    }

    if (window.safeStorage && window.safeStorage.getItem('aura-pdf-code') !== 'false') {
      let codeStrat = new CodeRecognizerStrategy();
      results.push(...codeStrat.recognize(page, viewport, textContent, operatorList));
    }

    results.forEach(bbox => {
      let div = document.createElement('div');
      div.className = 'structural-overlay ' + (bbox.type === 'image' ? 'image-overlay' : '');
      div.style.left = bbox.x + 'px';
      div.style.top = bbox.y + 'px';
      div.style.width = bbox.w + 'px';
      div.style.height = bbox.h + 'px';

      // Options removed per user request
      // textLayerDiv.appendChild(div);
    });
  } catch (e) {
    console.warn("Recognizer failed:", e);
  }
};
// ------------------------------------------

/**
 * pdf-handler.js
 * Stable PDF virtualization with precise scroll-position preservation.
 * Pages are updated in-place — DOM is never destroyed on scale changes.
 */

class PdfDocumentHandler {
  constructor() {
    this.toc = {
      render: function () { if (window.renderPdfToc) window.renderPdfToc(); }
    };
    this.search = {
      toggleDeepSearch: function (enabled) { if (window.pdfToggleDeepSearch) window.pdfToggleDeepSearch(enabled); }
    };
    this.virtualization = {
      toggle: function (enabled) { if (window.pdfToggleVirtualization) window.pdfToggleVirtualization(enabled); }
    };
    this.lazyLoading = {
      toggle: function (enabled) { if (window.pdfToggleLazyLoading) window.pdfToggleLazyLoading(enabled); }
    };
    this.renderQuality = {
      toggleHighDPI: function (enabled) { if (window.pdfToggleHighDPI) window.pdfToggleHighDPI(enabled); },
      setFontAlgo: function (val) { if (window.pdfSetFontAlgo) window.pdfSetFontAlgo(val); },
      toggleThemeAware: function (enabled) { if (window.pdfToggleThemeAware) window.pdfToggleThemeAware(enabled); }
    };
  }
  setupToolbar() {
    document.getElementById('secondary-toolbar').style.display = 'flex';
    document.querySelectorAll('.pdf-only').forEach(function (el) { el.style.display = ''; });
    const fontControls = document.getElementById('font-size-controls');
    if (fontControls) fontControls.style.display = 'none';
  }
  async load(fileOrBlob) {
    var buf = (fileOrBlob instanceof File) ? await fileOrBlob.arrayBuffer() : fileOrBlob;
    await window.loadPdf(buf, false);
  }

  getScrollState() {
    return window.getPdfScrollState ? window.getPdfScrollState() : null;
  }

  jumpTo(pageNum) {
    var p = parseInt(pageNum, 10);
    if (!isNaN(p) && window.pdfGotoPage) {
      window.pdfGotoPage(p);
      var el = document.getElementById('page-wrap-' + p);
      if (el) {
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = '0 0 0 4px var(--accent)';
        setTimeout(() => { el.style.boxShadow = ''; }, 1200);
      }
    }
  }
}

// ─── Scroll-state helpers ───────────────────────────────────────────────────

/** Returns usable viewer width in px, excluding content padding. */
window.getPdfContainerWidth = function () {
  var el = window.contentEl;
  if (!el) return window.innerWidth;
  var cs = window.getComputedStyle(el);
  var ph = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
  return Math.max(el.clientWidth - ph, 200);
};

/**
 * Captures precise scroll state: which page is at the viewport top
 * and the fractional offset within that page (0..1).
 * This survives scale changes because we store a ratio, not pixel values.
 */
window.getPdfScrollState = function () {
  var el = window.contentEl;
  if (!el) return { page: 1, ratio: 0 };

  var wrappers = el.querySelectorAll('.pdf-page-wrapper');
  var viewportCenter = el.scrollTop + (el.clientHeight / 2);
  var bestPage = 1;
  var bestRatio = 0;

  for (var i = 0; i < wrappers.length; i++) {
    var w = wrappers[i];
    var wTop = w.offsetTop;
    var wH = w.offsetHeight;

    if (wTop > viewportCenter) break;

    bestPage = parseInt(w.dataset.page, 10) || (i + 1);
    bestRatio = Math.min(Math.max((viewportCenter - wTop) / (wH || 1), 0), 1);
  }

  var state = { page: bestPage, ratio: bestRatio };
  if (window.logUI) window.logUI('get-pdf-scroll', state);
  return state;
};

/**
 * Restores scroll to the exact position within a page after re-render.
 * Works correctly regardless of scale change because it uses the
 * new page's offsetTop + (ratio × new page height).
 */
window.restorePdfScroll = function (state) {
  if (!state || !window.contentEl) return;
  var el = document.getElementById('page-wrap-' + state.page);
  if (!el) return;
  var targetScroll = el.offsetTop + (state.ratio * el.offsetHeight) - (window.contentEl.clientHeight / 2);
  if (window.logUI) window.logUI('restore-pdf-scroll', { targetScroll: targetScroll, page: state.page, ratio: state.ratio, offsetTop: el.offsetTop, offsetHeight: el.offsetHeight });
  window.contentEl.scrollTop = targetScroll;
};

// ─── IntersectionObserver singleton ─────────────────────────────────────────

// --- Font Quality Engine ---
window.FontQuality = { highDPI: true, algo: 'smart', themeAware: true, sessionSafeMode: false };
try {
  let stored = window.safeStorage.getItem('AuraFontQuality');
  if (stored) {
    let parsed = JSON.parse(stored);
    window.FontQuality.highDPI = !!parsed.highDPI;
    window.FontQuality.algo = parsed.algo || 'smart';
    window.FontQuality.themeAware = parsed.themeAware !== false;
  }
} catch (e) { console.warn('LocalStorage error for FontQuality', e); }

window.saveFontQuality = function () {
  try {
    window.safeStorage.setItem('AuraFontQuality', JSON.stringify({
      highDPI: window.FontQuality.highDPI,
      algo: window.FontQuality.algo,
      themeAware: window.FontQuality.themeAware
    }));
  } catch (e) { }
};

window.updateFontFilters = function () {
  if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) {
    window.contentEl.classList.remove('algo-smart-contrast', 'algo-thicker');
    return;
  }

  let algo = window.FontQuality.algo;
  if (window.FontQuality.themeAware) {
    // Determine luminance
    let bg = window.getComputedStyle(document.body).backgroundColor;
    let rgbMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      let r = parseInt(rgbMatch[1]), g = parseInt(rgbMatch[2]), b = parseInt(rgbMatch[3]);
      let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      // Hysteresis bands
      if (luminance >= 110 && luminance <= 140) {
        // Neutral - apply nothing or standard
        algo = 'none';
      } else if (luminance < 110) {
        // Dark theme
        algo = window.FontQuality.algo;
      } else {
        // Light theme - Explicitly disable Dark Mode Fix
        algo = 'none';
      }
    }
  }

  window.contentEl.classList.remove('algo-smart-contrast', 'algo-thicker');
  if (algo === 'smart') window.contentEl.classList.add('algo-smart-contrast');
  if (algo === 'thicker') window.contentEl.classList.add('algo-thicker');
};

window.pdfToggleHighDPI = function (enabled) {
  window.FontQuality.highDPI = enabled;
  window.FontQuality.sessionSafeMode = false; // reset safe mode on manual toggle
  window.saveFontQuality();
  if (window.currentPdfDoc) window.loadPdf(null, false, true);
};

window.pdfSetFontAlgo = function (val) {
  window.FontQuality.algo = val;
  window.saveFontQuality();
  window.updateFontFilters();
};

window.pdfToggleThemeAware = function (enabled) {
  window.FontQuality.themeAware = enabled;
  window.saveFontQuality();
  window.updateFontFilters();
};

var _pdfObserver = null;
var _unmountObserver = null;

window.teardownPdfObserver = function () {
  if (_pdfObserver) { _pdfObserver.disconnect(); _pdfObserver = null; }
  if (_unmountObserver) { _unmountObserver.disconnect(); _unmountObserver = null; }
};

function unmountPage(wrap) {
  if (wrap.dataset.loaded !== 'true') return;
  wrap.querySelectorAll('canvas, .textLayer, .draw-layer').forEach(function (c) {
    if (c.tagName && c.tagName.toLowerCase() === 'canvas') {
      c.width = 1; c.height = 1; // Flush VRAM
    }
    c.remove();
  });
  wrap.dataset.loaded = 'false';
}

function makePdfObserver() {
  window.teardownPdfObserver();

  _pdfObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var wrap = entry.target;
      if (wrap.dataset.loaded === 'true') return;
      wrap.dataset.loaded = 'true';
      renderPage(wrap);
    });
  }, { root: window.contentEl, rootMargin: '600px 0px' });

  if (window.pdfVirtualizationEnabled) {
    _unmountObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) return;
        var wrap = entry.target;
        if (wrap.dataset.loaded === 'false') return;
        unmountPage(wrap);
      });
    }, { root: window.contentEl, rootMargin: '3000px 0px' });
  }

  return {
    observe: function (wrap) {
      if (_pdfObserver) _pdfObserver.observe(wrap);
      if (_unmountObserver) _unmountObserver.observe(wrap);
    },
    disconnect: window.teardownPdfObserver
  };
}

function renderPage(wrap) {
  var pageNum = parseInt(wrap.dataset.page, 10);
  var pdf = window.currentPdfDoc;
  if (!pdf) return;
  pdf.getPage(pageNum).then(function (page) {
    var scale = window.pdfScale || 1.2;
    var rotation = window.pdfRotation || 0;
    var vp = page.getViewport({ scale: scale, rotation: rotation });

    var w = Math.floor(vp.width);
    var h = Math.floor(vp.height);

    // Resize wrapper to exact rendered size but allow CSS to smoothly shrink it
    wrap.style.width = w + 'px';
    wrap.style.maxWidth = window.isTwoPageMode ? 'calc(50% - 15px)' : '100%';
    wrap.style.height = 'auto';
    wrap.style.aspectRatio = w + ' / ' + h;
    wrap.querySelectorAll('canvas, .textLayer, .draw-layer').forEach(function (c) {
      c.width = 1; c.height = 1;
      c.remove();
    });

    let base = window.devicePixelRatio || 1;
    let dpr = base * (window.FontQuality.highDPI && !window.FontQuality.sessionSafeMode ? 2 : 1);

    // Smooth safety limit: don't let canvas exceed ~67 megapixels to prevent crashes
    let maxDimension = 8192;
    if (w * dpr > maxDimension) dpr = maxDimension / w;
    if (h * dpr > maxDimension) dpr = maxDimension / h;
    dpr = Math.max(1, Math.min(dpr, 4)); // Clamp between 1x and 4x

    var cv = document.createElement('canvas');
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';

    var ctx = cv.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(dpr, dpr);
    wrap.appendChild(cv);

    var tl = document.createElement('div');
    tl.className = 'textLayer';
    tl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;opacity:1;';
    wrap.appendChild(tl);

    var dl = document.createElement('canvas');
    dl.className = 'draw-layer';
    dl.width = Math.floor(w * dpr);
    dl.height = Math.floor(h * dpr);
    dl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    wrap.appendChild(dl);

    tl.onclick = function (ev) {
      if (window.pdfTool === 'crop') return;
      if (!window.pdfHighlights || !window.pdfHighlights.length) return;
      var rect = tl.getBoundingClientRect();
      var x = (ev.clientX - rect.left) / rect.width;
      var y = (ev.clientY - rect.top) / rect.height;
      var hls = window.pdfHighlights.filter(function (h) { return h.page === pageNum; });
      var clickedHl = null;
      for (var i = 0; i < hls.length; i++) {
        for (var j = 0; j < hls[i].rects.length; j++) {
          var r = hls[i].rects[j];
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            clickedHl = hls[i]; break;
          }
        }
        if (clickedHl) break;
      }
      if (clickedHl && window.showActionPopup) {
        window.showActionPopup(ev, '&#10005; Remove highlight', function () {
          if (window.deleteNote) window.deleteNote(clickedHl.id);
        });
      }
    };

    var rc = { canvasContext: ctx, viewport: vp };

    let t0 = performance.now();
    var task = page.render(rc);

    task.promise.catch(function (err) {
      if (err.name === 'ContextLoss' || err.message.includes('WebGL')) {
        window.FontQuality.sessionSafeMode = true;
        console.warn('Context loss! Fallback to safe mode.');
      }
    }).then(function () {
      let t1 = performance.now();
      if (window.AuraPerf) window.AuraPerf.logRender(t1 - t0);
      if (t1 - t0 > 2000 && window.FontQuality.highDPI && !window.FontQuality.sessionSafeMode) {
        window.FontQuality.sessionSafeMode = true;
        if (window.logUI) window.logUI('safe-mode-triggered', { time: t1 - t0 });
        console.warn('Performance watchdog tripped. Safe mode enabled.');
      }
      return page.getTextContent();
    }).then(function (tc) {
      try {
        if (!window.pdfSpatialIndexes) window.pdfSpatialIndexes = {};
        window.pdfSpatialIndexes[pageNum] = tc.items.map(item => {
          let pt1 = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
          let pt2 = vp.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] - (item.height || 10)); // fallback height
          return {
            str: item.str,
            x: Math.min(pt1[0], pt2[0]),
            y: Math.min(pt1[1], pt2[1]),
            w: Math.max(Math.abs(pt1[0] - pt2[0]), 1),
            h: Math.max(Math.abs(pt1[1] - pt2[1]), 5) // minimum height
          };
        });

        tl.style.setProperty('--scale-factor', vp.scale);
        var tlTask = pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] });

        tlTask.promise.then(function () {
          if (window.runRecognizers) window.runRecognizers(page, vp, tc, tl);
          if (window.redrawPdfHighlights) window.redrawPdfHighlights();
          if (window._activeSearchHighlight && window._activeSearchHighlight.page === pageNum) {
            if (window.doCustomHighlight) window.doCustomHighlight(tl, window._activeSearchHighlight.query);
          }
        });

        tlTask.promise.then(function () {
          if (window.redrawPdfHighlights) window.redrawPdfHighlights();
        });
      } catch (e) { }

      if (page.cleanup) page.cleanup();
    });
  });
}
window.renderPage = renderPage;

// ─── Main load ───────────────────────────────────────────────────────────────

window.loadPdf = async function (buf, isConverted, skipReloadBuf) {
  if (!buf && !skipReloadBuf && !window.currentPdfDoc) return;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    var pdf = skipReloadBuf
      ? window.currentPdfDoc
      : await pdfjsLib.getDocument({ data: buf }).promise;

    window.currentPdfDoc = pdf;

    // Fetch original page labels if they exist
    pdf.getPageLabels().then(function (labels) {
      window.pdfPageLabels = labels;
    }).catch(function (e) {
      window.pdfPageLabels = null;
    });

    // Initialise scale once
    if (window.pdfScale === undefined || window.pdfScale === null) {
      window.pdfScale = 1.2;
    }

    var pageCountEl = document.getElementById('pdf-page-count');
    if (pageCountEl) pageCountEl.textContent = pdf.numPages;

    // ── Measure NATURAL page size at scale=1 ───────────────────────────────
    if (!skipReloadBuf || !window.pdfDefaultPageWidth) {
      var page1 = await pdf.getPage(1);
      var vp1 = page1.getViewport({ scale: 1, rotation: window.pdfRotation || 0 });
      window.pdfDefaultPageWidth = vp1.width;
      window.pdfDefaultPageHeight = vp1.height;
    }

    var scaledW = Math.floor(window.pdfScale * window.pdfDefaultPageWidth);
    var scaledH = Math.floor(window.pdfScale * window.pdfDefaultPageHeight);

    // ── Decide: first load vs. in-place re-render ─────────────────────────
    var isFirstLoad = !skipReloadBuf;

    if (isFirstLoad) {
      // Full DOM reset only on genuine file open
      window.contentEl.innerHTML = '';
      window.pdfParts = [];
      window.pdfPageDimensions = [];
      window.pdfPageDimensions[1] = { w: vp1.width, h: vp1.height };

      // Status text removed to clean up UI

      var observer = makePdfObserver();

      for (var i = 1; i <= pdf.numPages; i++) {
        var wrap = document.createElement('div');
        wrap.id = 'page-wrap-' + i;
        wrap.className = 'pdf-page-wrapper' + (isConverted ? ' converted' : '');
        wrap.style.cssText = 'width:' + scaledW + 'px;height:' + scaledH +
          'px;background:#fff;position:relative;margin:0 auto 20px auto;';
        wrap.dataset.page = i;
        wrap.dataset.loaded = 'false';
        window.contentEl.appendChild(wrap);
        observer.observe(wrap);
      }

      // ── RESTORE SCROLL ON INITIAL LOAD ────────────────────────────────────
      if (window.pendingScrollState) {
        // Need a tiny timeout to ensure DOM layout is complete before scrolling
        setTimeout(() => {
          if (window.pendingScrollState) {
            window.restorePdfScroll(window.pendingScrollState);
            window.pendingScrollState = null;
          }
        }, 100);
      }


      // Background fetch to cache actual dimensions of all pages
      for (let i = 2; i <= pdf.numPages; i++) {
        pdf.getPage(i).then(function (p) {
          var vp = p.getViewport({ scale: 1, rotation: window.pdfRotation || 0 });
          window.pdfPageDimensions[i] = { w: vp.width, h: vp.height };
          var wEl = document.getElementById('page-wrap-' + i);
          if (wEl && wEl.dataset.loaded !== 'true') {
            wEl.style.width = Math.floor(window.pdfScale * vp.width) + 'px';
            wEl.style.height = Math.floor(window.pdfScale * vp.height) + 'px';
          }
        }).catch(function (e) { });
      }

    } else {
      // ── In-place re-render (zoom / fit-width / rotate) ──────────────────
      // 1. Capture PRECISE scroll state BEFORE any DOM mutation
      var scrollState = window.getPdfScrollState();

      // 2. Resize every wrapper synchronously so offsetTop values are correct
      var wrappers = window.contentEl.querySelectorAll('.pdf-page-wrapper');
      wrappers.forEach(function (wrap) {
        var pNum = parseInt(wrap.dataset.page, 10);
        var dim = (window.pdfPageDimensions && window.pdfPageDimensions[pNum]) ? window.pdfPageDimensions[pNum] : null;
        var sW, sH;
        if (dim) {
          sW = Math.floor(window.pdfScale * dim.w);
          sH = Math.floor(window.pdfScale * dim.h);
        } else {
          // Fallback: maintain current proportion to prevent sudden layout jumps
          if (wrap.offsetWidth && wrap.offsetHeight) {
            var proportion = wrap.offsetHeight / wrap.offsetWidth;
            sW = Math.floor(window.pdfScale * window.pdfDefaultPageWidth);
            sH = Math.floor(sW * proportion);
          } else {
            sW = Math.floor(window.pdfScale * window.pdfDefaultPageWidth);
            sH = Math.floor(window.pdfScale * window.pdfDefaultPageHeight);
          }
        }
        wrap.style.width = sW + 'px';
        wrap.style.height = sH + 'px';
        // Clear rendered content — mark for lazy re-render
        wrap.querySelectorAll('canvas, .textLayer, .draw-layer').forEach(function (c) { c.remove(); });
        wrap.dataset.loaded = 'false';
      });

      // 3. Restore scroll IMMEDIATELY (before observer fires)
      //    This works because all wrappers now have correct new dimensions
      window.restorePdfScroll(scrollState);

      // 4. THEN set up observer to lazy-render visible pages
      var observer = makePdfObserver();
      wrappers.forEach(function (wrap) {
        observer.observe(wrap);
      });
    }

    // ── Background TTS & RAG text extraction ─────────────────────────────────────
    if (isFirstLoad) {
      setTimeout(async function () {
        if (!window.pdfParts) window.pdfParts = [];
        for (var j = 1; j <= pdf.numPages; j++) {
          try {
            var p = await pdf.getPage(j);
            var tc = await p.getTextContent();
            window.pdfParts[j - 1] = tc.items.map(function (it) { return it.str; }).join(' ');
          } catch (e) { }
        }

        if (window.pdfParts.length > 0) {
          var fullText = window.pdfParts.join('\n\n');
          if (!window.currentFileId) {
            var docName = window.currentFileName || 'document.pdf';
            var fSize = (file && file.size) ? file.size : fullText.length;
            window.currentFileId = 'doc_' + btoa(encodeURIComponent(docName + '_' + fSize)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
          }
          try {
            fetch('/api/rag/index_text', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ file_id: window.currentFileId, text: fullText })
            }).catch(e => console.error("RAG Index error:", e));
          } catch (e) { }
        }
      }, 500);
    }

  } catch (e) {
    window.contentEl.innerHTML =
      '<div style="padding:2rem"><h2 style="color:#fc8181">Error</h2>' +
      '<p style="color:#8899aa">' + e.message + '</p></div>';
    console.error(e);
  }
};

// ─── Navigation ─────────────────────────────────────────────────────────────

window.updateTocActiveState = function (pageNum) {
  var items = document.querySelectorAll('.toc-item');
  var activeItem = null;
  var maxPage = -1;
  items.forEach(function (el) {
    el.classList.remove('active');
    var p = parseInt(el.getAttribute('data-page'), 10);
    if (!isNaN(p) && p <= pageNum && p > maxPage) {
      maxPage = p;
      activeItem = el;
    }
  });
  if (activeItem) {
    activeItem.classList.add('active');
    if (activeItem.scrollIntoViewIfNeeded) {
      activeItem.scrollIntoViewIfNeeded();
    } else {
      activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
};

window.pdfGotoPage = function (p) {
  var el = document.getElementById('page-wrap-' + p);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};

// ─── Fit to Width ────────────────────────────────────────────────────────────

window.pdfFitWidth = function (w) {
  if (window.logUI) window.logUI('fit-width');
  if (!w) {
    var sel = document.getElementById('width-sel');
    w = sel ? sel.value : '100%';
  }

  var containerWidth = window.getPdfContainerWidth();
  var containerHeight = window.contentEl ? window.contentEl.clientHeight : window.innerHeight;
  var newScale = 1.2;

  if (!window.pdfDefaultPageWidth || window.pdfDefaultPageWidth <= 0) return;

  if (w === 'fit-page' && window.pdfDefaultPageHeight) {
    // Fit the entire page within the viewport height and width
    var scaleWidth = containerWidth / window.pdfDefaultPageWidth;
    // Account for padding by taking 95% of the container height
    var scaleHeight = (containerHeight * 0.95) / window.pdfDefaultPageHeight;
    newScale = Math.min(scaleWidth, scaleHeight);

    // If Two-Page mode is active, width might be the constraint
    if (window.isTwoPageMode) {
      var twoPageScaleWidth = ((containerWidth - 20) / 2) / window.pdfDefaultPageWidth;
      newScale = Math.min(twoPageScaleWidth, scaleHeight);
    }
  } else {
    var targetWidth;
    if (w === '100%' || w === 'full' || w === 'fit-page') {
      targetWidth = containerWidth;
    } else if (typeof w === 'string' && w.endsWith('px')) {
      targetWidth = Math.min(parseInt(w, 10), containerWidth);
    } else if (typeof w === 'number') {
      targetWidth = Math.min(w, containerWidth);
    } else {
      targetWidth = Math.min(parseInt(w, 10) || containerWidth, containerWidth);
    }

    // If Two-Page mode is active, we need to fit TWO pages inside the target width
    if (window.isTwoPageMode) {
      targetWidth = (targetWidth - 20) / 2; // account for outer padding only, no middle gap
    }

    newScale = targetWidth / window.pdfDefaultPageWidth;
  }

  newScale = Math.max(0.3, Math.min(newScale, 6.0));
  window.pdfScale = newScale;

  if (window.currentPdfDoc) {
    window.loadPdf(null, false, true);
  }
};

// ─── Zoom ────────────────────────────────────────────────────────────────────

window.pdfZoom = function (step) {
  if (!window.currentPdfDoc) return;
  if (window.logUI) window.logUI('pdf-zoom', { step: step });
  window.pdfScale = Math.max(0.3, Math.min((window.pdfScale || 1.2) + step, 6.0));
  window.loadPdf(null, false, true);
};

// ─── Rotate ──────────────────────────────────────────────────────────────────

window.pdfRotate = function () {
  window.pdfRotation = (window.pdfRotation || 0) + 90;
  if (window.currentPdfDoc) window.loadPdf(null, false, true);
};

// ─── Tool selection ──────────────────────────────────────────────────────────

window.setPdfTool = function (tool) {
  window.pdfTool = tool;
  document.querySelectorAll('#secondary-toolbar .tb-btn').forEach(function (b) {
    b.classList.remove('active');
  });
  var btn = document.getElementById('pdf-btn-' + tool);
  if (btn) btn.classList.add('active');

  if (tool === 'crop') {
    window.contentEl.classList.add('pdf-tool-active');
    window.contentEl.style.cursor = 'crosshair';
  } else {
    window.contentEl.classList.remove('pdf-tool-active');
    window.contentEl.style.cursor = '';
  }
};

// ─── Crop / Screenshot tool ──────────────────────────────────────────────────

window.addEventListener('mousedown', function (e) {
  if (window.currentExt !== 'pdf' || window.pdfTool !== 'crop') return;
  var wrapper = e.target.closest('.pdf-page-wrapper');
  if (!wrapper) return;

  e.preventDefault();
  var rect = wrapper.getBoundingClientRect();
  var startX = e.clientX - rect.left;
  var startY = e.clientY - rect.top;

  var overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.style.cssText =
    'position:absolute;border:2px dashed #63b3ed;background:rgba(99,179,237,0.2);' +
    'pointer-events:none;z-index:100;left:' + startX + 'px;top:' + startY + 'px;width:0;height:0;';
  wrapper.appendChild(overlay);

  function onMove(ev) {
    var cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    overlay.style.width = Math.abs(cx - startX) + 'px';
    overlay.style.height = Math.abs(cy - startY) + 'px';
    overlay.style.left = Math.min(startX, cx) + 'px';
    overlay.style.top = Math.min(startY, cy) + 'px';
  }

  function onUp(ev) {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    var cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    var fx = Math.min(startX, cx), fy = Math.min(startY, cy);
    var fw = Math.abs(cx - startX), fh = Math.abs(cy - startY);

    overlay.remove();
    window.setPdfTool('pan');
    if (fw < 10 || fh < 10) return;

    var cv = wrapper.querySelector('canvas');
    if (!cv) return;

    var cc = document.createElement('canvas');
    cc.width = fw; cc.height = fh;
    var ratio = cv.width / cv.offsetWidth;
    cc.getContext('2d').drawImage(cv, fx * ratio, fy * ratio, fw * ratio, fh * ratio, 0, 0, fw, fh);

    if (window.addScreenshotNote) window.addScreenshotNote(cc.toDataURL('image/png'));
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

// ─── Table of Contents ───────────────────────────────────────────────────────

window.renderPdfToc = function () {
  var list = document.getElementById('toc-list');
  if (!list) return;
  list.innerHTML = '';

  if (!window.currentPdfDoc) {
    list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128214;</span>Open a PDF to see its table of contents.</div>';
    return;
  }

  window.currentPdfDoc.getOutline().then(function (outline) {
    if (!outline || outline.length === 0) {
      list.innerHTML = '<div class="toc-empty"><span class="toc-empty-icon">&#128203;</span>This PDF has no bookmarks or table of contents.</div>';
      return;
    }

    var count = 0;
    function renderItems(items, level) {
      items.forEach(function (item) {
        count++;
        var div = document.createElement('div');
        div.className = 'toc-item toc-level-' + Math.min(level, 4);

        var titleSpan = document.createElement('span');
        titleSpan.className = 'toc-item-title';
        titleSpan.textContent = item.title || '(Untitled)';
        div.appendChild(titleSpan);

        var pageSpan = document.createElement('span');
        pageSpan.className = 'toc-item-page';
        pageSpan.textContent = '...';
        div.appendChild(pageSpan);

        // Resolve page number asynchronously
        var resolvePageNum = function (dest) {
          if (!dest) { pageSpan.textContent = ''; return; }
          window.currentPdfDoc.getPageIndex(dest[0]).then(function (idx) {
            pageSpan.textContent = 'p.' + (idx + 1);
            div.dataset.page = idx + 1;
          }).catch(function () { pageSpan.textContent = ''; });
        };
        if (typeof item.dest === 'string') {
          window.currentPdfDoc.getDestination(item.dest).then(resolvePageNum);
        } else if (Array.isArray(item.dest)) {
          resolvePageNum(item.dest);
        } else {
          pageSpan.textContent = '';
        }

        div.onclick = function () {
          var resolve = function (dest) {
            if (!dest) return;
            window.currentPdfDoc.getPageIndex(dest[0]).then(function (idx) {
              window.pdfGotoPage(idx + 1);
              window.closeToc();
            });
          };
          if (typeof item.dest === 'string') {
            window.currentPdfDoc.getDestination(item.dest).then(resolve);
          } else if (Array.isArray(item.dest)) {
            resolve(item.dest);
          }
        };

        list.appendChild(div);

        if (item.items && item.items.length > 0) {
          renderItems(item.items, level + 1);
        }
      });
    }

    renderItems(outline, 1);

    // Update badge count
    var badge = document.getElementById('toc-count');
    if (badge) badge.textContent = count;
  });
};

// ─── Factory / File loading ──────────────────────────────────────────────────

class DocumentHandlerFactory {
  static getHandler(ext) {
    // Open-Closed Principle: Resolve via dynamic handler registry first
    if (window.DocumentHandlers && window.DocumentHandlers[ext]) {
      return window.DocumentHandlers[ext];
    }

    // Fallback instantiations (for backward compatibility)
    if (ext === 'pdf') return new PdfDocumentHandler();
    if (ext === 'md' || ext === 'txt') return new window.MarkdownDocumentHandler();
    if (ext === 'epub') return new window.EpubDocumentHandler();
    return new window.TextDocumentHandler();
  }
}
window.DocumentHandlerFactory = DocumentHandlerFactory;

if (window.registerDocumentHandler) {
  window.registerDocumentHandler('pdf', new PdfDocumentHandler());
}

document.addEventListener('DOMContentLoaded', function () {
  var fileUpload = document.getElementById('file-upload');
  if (fileUpload) {
    window.openFile = async function (f) {
      if (!f) return;

      // CLEANUP Memory (Prevent PDF/EPUB leaks)
      if (window.currentPdfDoc && window.currentPdfDoc.destroy) {
        try { window.currentPdfDoc.destroy(); } catch (err) { }
      }
      if (window.currentEpubRendition && window.currentEpubRendition.destroy) {
        try { window.currentEpubRendition.destroy(); } catch (err) { }
      }
      if (window.currentEpubBook && window.currentEpubBook.destroy) {
        try { window.currentEpubBook.destroy(); } catch (err) { }
      }
      window.currentPdfDoc = null;
      window.currentEpubRendition = null;
      window.currentEpubBook = null;
      if (window.finishTTS) window.finishTTS();
      if (window.clearHighlighter) window.clearHighlighter();

      // CLEANUP Document State
      window.currentFileName = null; // Prevent accidental overwrite of previous file's notes in DB
      window.notes = [];
      window.pdfHighlights = [];
      if (window.renderNotes) window.renderNotes();
      window.pageTextCache = new Map();
      window.docText = '';
      window.pdfPageLabels = null;
      window.currentFileId = null;

      var docParser = new DOMParser();
      var decodedName = docParser.parseFromString(f.name.replace(/&_039_/g, "'"), "text/html").documentElement.textContent;

      window.docTitleEl.textContent = '🌀 ' + decodedName;
      document.title = 'Emanation Reader: ' + decodedName;
      window.contentEl.innerHTML = '<div class="msg msg-s" style="margin-top:40px">Loading...</div>';

      var tocPopup = document.getElementById('toc-popup');
      if (tocPopup) {
        tocPopup.classList.remove('open');
        var tocList = document.getElementById('toc-list');
        if (tocList) tocList.innerHTML = '';
      }

      // Reset scale on new file
      window.pdfScale = 1.2;
      window.pdfRotation = 0;

      var ext = f.name.split('.').pop().toLowerCase();
      window.currentExt = ext;
      window.currentFileName = f.name;
      if (window.ReadingExperience && window.ReadingExperience.Font) window.ReadingExperience.Font.disableFontForPdf(ext === 'pdf');

      var handler = DocumentHandlerFactory.getHandler(ext);
      window._activeDocHandler = handler; // Store for search dispatcher
      if (handler.setupToolbar) handler.setupToolbar();

      if (window.AuraPerf) {
        if (ext === 'pdf' && window.AuraPerf.PdfTelemetryProfile) window.AuraPerf.setActiveProfile(new window.AuraPerf.PdfTelemetryProfile());
        else if (ext === 'md' && window.AuraPerf.MarkdownTelemetryProfile) window.AuraPerf.setActiveProfile(new window.AuraPerf.MarkdownTelemetryProfile());
        else if (ext === 'epub' && window.AuraPerf.EpubTelemetryProfile) window.AuraPerf.setActiveProfile(new window.AuraPerf.EpubTelemetryProfile());
      }

      await handler.load(f);

      // Save file to IndexedDB for persistence via central trigger
      if (window.triggerLibrarySave) {
        window.triggerLibrarySave(f, f.name, ext);
      }

      // Always attempt to load notes if they exist in the database (e.g. from a manual save)
      if (window.storageRepository) {
        var uname2 = window.settingsRepo ? window.settingsRepo.getUsername() : (window.currentUsername || 'guest');
        var loadKey = uname2 + '_' + f.name;
        console.log("Loading notes for key: ", loadKey);
        
        window.storageRepository.loadNotes(loadKey).then(noteData => {
          if (noteData) {
            window.notes = noteData.notes || [];
            window.pdfHighlights = noteData.pdfHighlights || [];
            
            console.log("Aura Diagnostics: Key searched: " + loadKey + " Notes found: " + window.notes.length);
            
            if (window.renderNotes) window.renderNotes();
            if (window.redrawPdfHighlights) window.redrawPdfHighlights();
          } else {
            console.log("Aura Diagnostics: No notes found in database for key: " + loadKey);
          }
        }).catch(err => {
            console.error("Aura Diagnostics Error: ", err);
        });
      }
    };

    if (fileUpload) {
      fileUpload.addEventListener('change', async function (e) {
        if (e.target.files[0]) {
          await window.openFile(e.target.files[0]);
        }
      });
    }
  }

  // --- Debounced scroll-position saver ---
  var _scrollSaveTimer = null;
  if (window.contentEl) {
    window.contentEl.addEventListener('scroll', function () {
      if (!window.currentFileName || !window.storageRepository) return;
      if (window.safeStorage.getItem('aura-pdf-reading-state') !== 'true') return;
      if (window.safeStorage.getItem('aura-manual-save') !== 'false') return; // Skip if manual save is ON (default true)
      clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(function () {
        var uname = window.currentUsername || window.safeStorage.getItem('username') || 'guest';
        if (window.triggerStateSave) {
          window.triggerStateSave();
        }
      }, 2000); // Save 2s after scrolling stops
    });
  }
});

// --- Save scroll state before page unload ---
window.addEventListener('beforeunload', function () {
  if (!window.currentFileName || !window.storageRepository) return;
  if (!window.settingsRepo || !window.settingsRepo.isTrue('aura-reading-state')) return;
  var uname = window.settingsRepo.getUsername();
  if (window.triggerStateSave) {
    window.triggerStateSave();
  }
});

/* AUTO-LOAD FROM task_id */
window.addEventListener('load', async function () {
  try { mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' }); } catch (e) { }
  var taskId = new URLSearchParams(window.location.search).get('task_id');
  if (!taskId) return;
  window.contentEl.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:18px">' +
    '<div style="width:52px;height:52px;border:5px solid rgba(99,179,237,.2);border-top-color:#63b3ed;' +
    'border-radius:50%;animation:spin .8s linear infinite"></div>' +
    '<p style="color:#63b3ed;font-weight:600">Loading document...</p></div>' +
    '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
  try {
    var statusRes = await fetch('/api/status/' + taskId);
    var statusData = await statusRes.json();
    var ext = statusData.ext || 'pdf';

    var res = await fetch('/api/download/' + taskId);
    if (!res.ok) throw new Error('Document ready but download failed: ' + res.status);
    var blob = await res.blob();

    var handler = window.DocumentHandlers ? window.DocumentHandlers[ext] : null;
    if (ext === 'epub' && handler && handler.load) {
      window.currentExt = 'epub';
      window._activeDocHandler = handler;
      var fileObj = new File([blob], "document.epub", { type: "application/epub+zip" });
      document.title = 'Emanation Reader: EPUB';
      await handler.load(fileObj);
    } else if (ext === 'md' && handler && handler.load) {
      window.currentExt = 'md';
      window._activeDocHandler = handler;
      var fileObj = new File([blob], "document.md", { type: "text/markdown" });
      document.title = 'Emanation Reader: Markdown';
      await handler.load(fileObj);
    } else {
      var buf = await blob.arrayBuffer();
      var txt = document.createElement("textarea");
      txt.innerHTML = 'Dark_Mode_Converted.pdf';
      var decodedName = txt.value;
      window.docTitleEl.textContent = '🌀 ' + decodedName;
      document.title = 'Emanation Reader: Converted PDF';
      window.currentExt = 'pdf';
      window.pdfScale = 1.2;
      window.pdfRotation = 0;
      if (window.ReadingExperience && window.ReadingExperience.Font) window.ReadingExperience.Font.disableFontForPdf(true);
      document.getElementById('secondary-toolbar').style.display = 'flex';
      document.querySelectorAll('.pdf-only').forEach(function (el) { el.style.display = ''; });
      const fontControls = document.getElementById('font-size-controls');
      if (fontControls) fontControls.style.display = 'none';
      await window.loadPdf(buf, true);
    }
  } catch (err) {
    window.contentEl.innerHTML =
      '<div style="padding:2rem"><h2 style="color:#fc8181">Download Failed</h2>' +
      '<p style="color:#8899aa">' + err.message + '</p></div>';
  }
});

window.addEventListener('DOMContentLoaded', function () {
  if (window.contentEl) {
    let isPdfScrollThrottled = false;
    window.contentEl.addEventListener('scroll', function () {
      if (!isPdfScrollThrottled && window.currentExt === 'pdf') {
        isPdfScrollThrottled = true;
        window.requestAnimationFrame(function () {
          isPdfScrollThrottled = false;
          var state = window.getPdfScrollState();
          var pageInput = document.getElementById('pdf-page-in');
          if (pageInput && document.activeElement !== pageInput) {
            pageInput.value = state.page;
          }
          if (window.updateTocActiveState) window.updateTocActiveState(state.page);

          var bookPageSpan = document.getElementById('pdf-book-page');
          if (bookPageSpan) {
            if (window.pdfPageLabels && window.pdfPageLabels[state.page - 1]) {
              var label = window.pdfPageLabels[state.page - 1];
              if (label !== String(state.page)) {
                bookPageSpan.textContent = '(Book Pg. ' + label + ')';
              } else {
                bookPageSpan.textContent = '';
              }
            } else {
              bookPageSpan.textContent = '';
            }
          }
        });
      }
    });
  }
});

// Clear cache if version changed
if (localStorage.getItem('auraVersion') !== '15') {
  localStorage.setItem('auraVersion', '15');
  if (window.searchTextCache) window.searchTextCache.clear();
}


// ─── Custom Search Logic ──────────────────────────────────────────────────
window.searchTextCache = new Map();
window.currentSearchResults = [];
window.currentResultIndex = -1;
window.currentSearchQuery = '';
window._activeSearchHighlight = null;

// old search functions removed

// Global Ctrl+F / Cmd+F interception
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    if (window.currentExt === 'pdf') {
      window.openCustomSearch();
    }
  }
  // Escape to close
  if (e.key === 'Escape') {
    window.closeCustomSearch();
  }
});

document.getElementById('search-close')?.addEventListener('click', window.closeCustomSearch);


window.performCustomSearch = async function (query) {
  if (!query.trim()) {
    window.currentSearchResults = [];
    window.updateSearchResultsUI();
    return;
  }
  if (query === window.currentSearchQuery && window.currentSearchResults.length > 0) {
    document.getElementById('search-next').click();
    return;
  }

  window.currentSearchQuery = query;
  window.currentSearchResults = [];
  window.currentResultIndex = -1;
  window._activeSearchHighlight = null;

  var pdf = window.currentPdfDoc;
  if (!pdf) return;

  var progressCont = document.getElementById('search-progress-container');
  var progressBar = document.getElementById('search-progress-bar');

  if (progressCont) progressCont.classList.remove('hidden');

  const lowerQuery = query.toLowerCase();

  // LRU Eviction for cache if memory concerns
  if (window.searchTextCache.size > 200) {
    window.searchTextCache.clear();
  }

  for (let i = 1; i <= pdf.numPages; i++) {
    if (query !== window.currentSearchQuery) break;

    let pageText = window.searchTextCache.get(i);
    if (!pageText) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        pageText = textContent.items.map(item => item.str).join(' ');
        // normalize hyphens and spaces
        pageText = pageText.replace(/-\s+/g, '').replace(/\s+/g, ' ');
        window.searchTextCache.set(i, pageText);
      } catch (e) {
        pageText = '';
      }

      if (i % 5 === 0) {
        if (progressBar) progressBar.style.width = Math.floor((i / pdf.numPages) * 100) + '%';
        await new Promise(r => setTimeout(r, 0)); // yield
      }
    }

    const lowerText = pageText.toLowerCase();
    let index = lowerText.indexOf(lowerQuery);

    while (index !== -1) {
      window.currentSearchResults.push({
        page: i,
        index: index,
        snippet: window.extractSnippet(pageText, index, query.length)
      });
      index = lowerText.indexOf(lowerQuery, index + 1);
    }
  }

  if (progressCont) progressCont.classList.add('hidden');

  if (query === window.currentSearchQuery) {
    if (window.currentSearchResults.length > 0) {
      window.currentResultIndex = 0;
      window.navigateToResult(window.currentSearchResults[0]);
    }
    window.updateSearchResultsUI();
  }
};

window.extractSnippet = function (text, index, queryLength) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + queryLength + 40);
  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  const matchRegex = new RegExp(`(${window.escapeRegExp(window.currentSearchQuery)})`, 'gi');
  return snippet.replace(matchRegex, '<mark>$1</mark>');
}

window.escapeRegExp = function (string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

window.updateSearchResultsUI = function () {
  var countEl = document.getElementById('search-count');
  var resultsContainer = document.getElementById('search-results');

  if (!countEl || !resultsContainer) return;

  if (window.currentSearchResults.length === 0) {
    countEl.textContent = window.currentSearchQuery ? '0 matches' : '0 of 0';
    resultsContainer.innerHTML = window.currentSearchQuery ? '<div style="padding:16px;text-align:center;color:var(--text-2);font-size:0.9rem;">No matches found</div>' : '';
    return;
  }

  countEl.textContent = `${window.currentResultIndex + 1} of ${window.currentSearchResults.length}`;

  resultsContainer.innerHTML = '';
  const displayResults = window.currentSearchResults.slice(0, 100);

  displayResults.forEach((res, i) => {
    var div = document.createElement('div');
    div.className = 'search-result-item' + (i === window.currentResultIndex ? ' selected' : '');
    div.innerHTML = `
      <div class="search-result-page">Page ${res.page}</div>
      <div class="search-result-snippet">${res.snippet}</div>
    `;
    div.addEventListener('click', () => {
      window.currentResultIndex = i;
      window.navigateToResult(res);
    });
    resultsContainer.appendChild(div);
  });

  if (window.currentSearchResults.length > 100) {
    var div = document.createElement('div');
    div.className = 'search-result-item';
    div.style.textAlign = 'center';
    div.style.color = 'var(--text-3)';
    div.textContent = `...and ${window.currentSearchResults.length - 100} more results`;
    resultsContainer.appendChild(div);
  }

  var selectedEl = resultsContainer.querySelector('.selected');
  if (selectedEl) selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.navigateToResult = function (result) {
  if (!result) return;
  const pageNum = result.page;
  window._activeSearchHighlight = { page: pageNum, query: window.currentSearchQuery };
  window.updateSearchResultsUI();

  // Calculate average page height or use fallback
  let averagePageHeight = 800;
  if (window.pdfPageLabels && window.pdfPageLabels.length > 0) {
    let rendered = document.querySelector('.pdf-page-wrapper[data-loaded="true"]');
    if (rendered && rendered.offsetHeight > 0) averagePageHeight = rendered.offsetHeight;
  }

  let targetY = 0;
  for (let i = 1; i < pageNum; i++) {
    var wrap = document.getElementById('page-wrap-' + i);
    if (wrap) {
      targetY += (wrap.offsetHeight > 0 ? wrap.offsetHeight : averagePageHeight) + 20; // 20px is bottom margin
    }
  }

  if (window.contentEl) {
    window.contentEl.scrollTo({ top: targetY, behavior: 'smooth' });
  }

  // Event-driven highlight scroll
  const wrapTarget = document.getElementById('page-wrap-' + pageNum);
  if (!wrapTarget) return;

  const attemptHighlightScroll = () => {
    const tl = wrapTarget.querySelector('.textLayer');
    if (tl && wrapTarget.dataset.loaded === 'true' && tl.children.length > 0) {
      window.doCustomHighlight(tl, window.currentSearchQuery);
      requestAnimationFrame(() => {
        const activeMark = tl.querySelector('mark.active-hl') || tl.querySelector('mark.custom-hl');
        if (activeMark && window.contentEl) {
          // Calculate precise Y offset relative to contentEl
          const markRect = activeMark.getBoundingClientRect();
          const contentRect = window.contentEl.getBoundingClientRect();
          const preciseY = window.contentEl.scrollTop + (markRect.top - contentRect.top) - (contentRect.height / 3);
          window.contentEl.scrollTo({ top: preciseY, behavior: 'smooth' });
        }
      });
      return true; // Success
    }
    return false; // Not ready
  };

  if (!attemptHighlightScroll()) {
    // Poll up to 2 seconds for text layer if unloaded
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (attemptHighlightScroll() || attempts > 20) {
        clearInterval(interval);
      }
    }, 100);
  }
};

window.doCustomHighlight = function (textLayer, query) {
  var marks = textLayer.querySelectorAll('mark.custom-hl');
  marks.forEach(m => {
    var p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });

  if (!query) return;

  const textNodes = [];
  const walk = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null, false);
  let n;
  while ((n = walk.nextNode())) {
    textNodes.push(n);
  }
  if (textNodes.length === 0) return;

  let fullText = textNodes.map(node => node.nodeValue).join('');
  let normalizedText = fullText.replace(/-\s+/g, '').replace(/\s+/g, ' ');

  let regexFlags = (window.AuraSearch && window.AuraSearch.isCaseSensitive) ? 'g' : 'gi';
  let escapedQuery = (window.AuraSearch && window.AuraSearch.escapeRegExp) ? window.AuraSearch.escapeRegExp(query) : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regexPattern = escapedQuery;

  if (window.AuraSearch && window.AuraSearch.isWholeWord) {
    if (/[^a-zA-Z0-9_ ]/.test(query)) {
      regexPattern = `(^|[\\s\\.,!?;:])(${escapedQuery})(?=[\\s\\.,!?;:]|$)`;
    } else {
      regexPattern = `\\b(${escapedQuery})\\b`;
    }
  } else {
    regexPattern = `(${escapedQuery})`;
  }

  let searchRegex;
  try {
    searchRegex = new RegExp(regexPattern, regexFlags);
  } catch (e) { return; }

  let indices = [];
  let match;
  searchRegex.lastIndex = 0;
  while ((match = searchRegex.exec(normalizedText)) !== null) {
    let matchText = match[1] || match[0];
    let matchIdx = match.index;
    if (match.length > 2 && match[2]) {
      matchIdx = match.index + match[1].length;
      matchText = match[2];
    }
    indices.push({ index: matchIdx, length: matchText.length });
  }

  for (let i = indices.length - 1; i >= 0; i--) {
    let index = indices[i].index;
    let qLen = indices[i].length;

    try {
      const range = document.createRange();
      let currentOffset = 0;
      let startNode = null, startOffset = 0;
      let endNode = null, endOffset = 0;

      for (let node of textNodes) {
        let len = node.nodeValue.length;
        if (!startNode && currentOffset + len > index) {
          startNode = node;
          startOffset = index - currentOffset;
        }
        if (startNode && currentOffset + len >= index + qLen) {
          endNode = node;
          endOffset = index + qLen - currentOffset;
          break;
        }
        currentOffset += len;
      }

      if (startNode && endNode) {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        const mark = document.createElement('mark');
        mark.className = 'custom-hl';
        mark.style.background = 'color-mix(in srgb, var(--gold) 40%, transparent)';
        mark.style.color = 'var(--text-1)';
        mark.style.borderRadius = '2px';
        range.surroundContents(mark);

        textNodes.length = 0;
        const newWalk = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null, false);
        while ((n = newWalk.nextNode())) {
          textNodes.push(n);
        }
      }
    } catch (e) { }
  }

  if (window._activeSearchHighlight && window._activeSearchHighlight.query === query) {
    const activeMarks = textLayer.querySelectorAll('mark.custom-hl');
    activeMarks.forEach(m => {
      m.style.background = 'var(--gold)';
      m.style.boxShadow = '0 0 8px color-mix(in srgb, var(--gold) 50%, transparent)';
      m.classList.add('active-hl');
    });
  }
};



// ─── AURA SEARCH OVERHAUL ────────────────────────────────────────────────────
window.AuraSearch = {
  tocMap: [],
  tocIndex: {}, // cache page -> chapter string
  isCaseSensitive: false,
  isWholeWord: false,
  currentQuery: '',
  allMatches: {}, // grouped by chapter
  flatMatches: [],
  currentIndex: -1,

  init: function () {
    this.buildTocMap();

    const cBtn = document.getElementById('search-filter-case');
    const wBtn = document.getElementById('search-filter-word');
    if (cBtn) {
      cBtn.addEventListener('click', (e) => {
        this.isCaseSensitive = cBtn.classList.contains('active');
        if (this.currentQuery) this.triggerSearch();
      });
    }
    if (wBtn) {
      wBtn.addEventListener('click', (e) => {
        this.isWholeWord = wBtn.classList.contains('active');
        if (this.currentQuery) this.triggerSearch();
      });
    }
  },

  buildTocMap: function () {
    this.tocMap = [];
    this.tocIndex = {};
    if (!window.currentPdfDoc) return;

    window.currentPdfDoc.getOutline().then((outline) => {
      if (!outline || outline.length === 0) return;
      let promises = [];
      let pendingMap = [];

      const traverse = (items) => {
        for (let item of items) {
          if (item.dest) {
            let title = item.title || "Untitled";
            let p = null;
            if (typeof item.dest === 'string') {
              p = window.currentPdfDoc.getDestination(item.dest).then(dest => dest ? window.currentPdfDoc.getPageIndex(dest[0]) : null);
            } else if (Array.isArray(item.dest)) {
              p = window.currentPdfDoc.getPageIndex(item.dest[0]);
            }
            if (p) {
              promises.push(p.then(idx => {
                if (idx !== null) pendingMap.push({ page: idx + 1, title: title });
              }).catch(() => { }));
            }
          }
          if (item.items && item.items.length > 0) traverse(item.items);
        }
      };

      traverse(outline);
      Promise.all(promises).then(() => {
        pendingMap.sort((a, b) => a.page - b.page);
        this.tocMap = pendingMap;
      });
    });
  },

  getChapterForPage: function (pageNum) {
    if (this.tocIndex[pageNum]) return this.tocIndex[pageNum];
    if (this.tocMap.length === 0) {
      let chunkStart = Math.floor((pageNum - 1) / 20) * 20 + 1;
      let chunkEnd = chunkStart + 19;
      return `Pages ${chunkStart}-${chunkEnd}`;
    }

    let chapter = "Front Matter";
    for (let i = 0; i < this.tocMap.length; i++) {
      if (this.tocMap[i].page <= pageNum) {
        chapter = this.tocMap[i].title;
      } else {
        break;
      }
    }
    this.tocIndex[pageNum] = chapter;
    return chapter;
  },

  escapeRegExp: function (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  getSnippet: function (fullText, index, queryLength) {
    let startBoundary = fullText.lastIndexOf(' ', Math.max(0, index - 40));
    if (startBoundary === -1) startBoundary = Math.max(0, index - 40);

    let endBoundary = fullText.indexOf(' ', Math.min(fullText.length, index + queryLength + 40));
    if (endBoundary === -1) endBoundary = Math.min(fullText.length, index + queryLength + 40);

    let snippet = fullText.substring(startBoundary, endBoundary).trim();
    if (startBoundary > 0) snippet = "..." + snippet;
    if (endBoundary < fullText.length) snippet = snippet + "...";
    return snippet;
  },

  triggerSearch: function () {
    let q = document.getElementById('doc-query-box').value;
    if (window.performCustomSearch) window.performCustomSearch(q);
  }
};


window.performCustomSearch = async function (query) {
  if (!query) return;
  window.AuraSearch.currentQuery = query;

  var pdf = window.currentPdfDoc;
  if (!pdf) return;

  if (!window.searchTextCache) window.searchTextCache = new Map();
  var container = document.getElementById('search-results');
  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);">Searching...</div>';

  window.AuraSearch.allMatches = {};
  window.AuraSearch.flatMatches = [];

  let regexFlags = window.AuraSearch.isCaseSensitive ? 'g' : 'gi';
  let escapedQuery = window.AuraSearch.escapeRegExp(query);
  let regexPattern = escapedQuery;

  if (window.AuraSearch.isWholeWord) {
    // Non-ASCII fallback check
    if (/[^a-zA-Z0-9_ ]/.test(query)) {
      // Basic fallback for CJK / special chars where  fails: allow space or punctuation
      regexPattern = `(^|[\\s\\.,!?;:])(${escapedQuery})(?=[\\s\\.,!?;:]|$)`;
    } else {
      regexPattern = `\\b(${escapedQuery})\\b`;
    }
  } else {
    // Wrap in capture group so match index is always group 1 or 0
    regexPattern = `(${escapedQuery})`;
  }

  let searchRegex;
  try {
    searchRegex = new RegExp(regexPattern, regexFlags);
  } catch (e) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:red;">Invalid regex query</div>`;
    return;
  }

  for (let i = 1; i <= pdf.numPages; i++) {
    let fullText = window.searchTextCache.get(i);

    if (!fullText) {
      try {
        let page = await pdf.getPage(i);
        let textContent = await page.getTextContent();
        fullText = textContent.items.map(item => item.str).join(' ');
        window.searchTextCache.set(i, fullText);
      } catch (e) {
        fullText = '';
      }

      if (i % 10 === 0) {
        // Yield occasionally to prevent UI freezing
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (!fullText) continue;

    // Normalize text (similar to rendering)
    let normalized = fullText.replace(/-\s+/g, '').replace(/\s+/g, ' ');

    searchRegex.lastIndex = 0;
    let match;
    while ((match = searchRegex.exec(normalized)) !== null) {
      // If we used fallback ^|\s capture group, the actual match is match[2], so adjust index
      let matchText = match[1] || match[0];
      let matchIdx = match.index;
      if (match.length > 2 && match[2]) { // Fallback case
        matchIdx = match.index + match[1].length;
        matchText = match[2];
      }

      let snippet = window.AuraSearch.getSnippet(normalized, matchIdx, matchText.length);

      let chapter = window.AuraSearch.getChapterForPage(i);
      if (!window.AuraSearch.allMatches[chapter]) window.AuraSearch.allMatches[chapter] = [];

      let resItem = { page: i, snippet: snippet, text: matchText };
      window.AuraSearch.allMatches[chapter].push(resItem);
      window.AuraSearch.flatMatches.push(resItem);
    }
  }

  document.getElementById('search-count').textContent = `${window.AuraSearch.flatMatches.length} matches`;
  container.innerHTML = '';

  if (window.AuraSearch.flatMatches.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);">No results found.</div>';
    return;
  }

  // Render accordion DOM
  for (let [chapter, items] of Object.entries(window.AuraSearch.allMatches)) {
    let group = document.createElement('div');
    group.className = 'search-chapter-group';

    let header = document.createElement('div');
    header.className = 'search-chapter-header';
    header.innerHTML = `<span>${chapter}</span> <span style="color:var(--text-2); font-size:0.9rem;">${items.length}</span>`;

    let listContainer = document.createElement('div');
    listContainer.className = 'search-chapter-items';

    let maxInitial = 15;
    let renderItems = (startIndex, count) => {
      let limit = Math.min(startIndex + count, items.length);
      for (let i = startIndex; i < limit; i++) {
        let item = items[i];
        let el = document.createElement('div');
        el.className = 'search-result-item';
        // Add data-flat-idx to map back to flat array
        let flatIdx = window.AuraSearch.flatMatches.indexOf(item);
        el.dataset.idx = flatIdx;
        el.innerHTML = `
          <div class="search-result-page">Page ${item.page}</div>
          <div class="search-result-snippet">${item.snippet.replace(new RegExp(window.AuraSearch.escapeRegExp(item.text), 'gi'), '<mark style="background:var(--gold);color:#000;border-radius:2px;">$&</mark>')}</div>
        `;
        el.onclick = () => window.gotoSearchResult(flatIdx);
        listContainer.appendChild(el);
      }

      // Handle "Show more"
      let existingMore = listContainer.querySelector('.search-load-more');
      if (existingMore) existingMore.remove();

      if (limit < items.length) {
        let btn = document.createElement('button');
        btn.className = 'search-load-more';
        btn.textContent = `Show more (${items.length - limit} remaining)`;
        btn.onclick = () => renderItems(limit, 50);
        listContainer.appendChild(btn);
      }
    };

    renderItems(0, maxInitial);

    header.onclick = () => listContainer.classList.toggle('collapsed');

    group.appendChild(header);
    group.appendChild(listContainer);
    container.appendChild(group);
  }

  window.gotoSearchResult(0);
};

window.gotoSearchResult = function (idx) {
  if (idx < 0 || idx >= window.AuraSearch.flatMatches.length) return;
  window.AuraSearch.currentIndex = idx;

  document.querySelectorAll('.search-result-item').forEach(el => el.classList.remove('selected'));
  let activeEl = document.querySelector(`.search-result-item[data-idx="${idx}"]`);
  if (activeEl) {
    activeEl.classList.add('selected');
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  let item = window.AuraSearch.flatMatches[idx];
  document.getElementById('search-count').textContent = `${idx + 1} of ${window.AuraSearch.flatMatches.length}`;

  window._activeSearchHighlight = { page: item.page, query: item.text };

  var wEl = document.getElementById('page-wrap-' + item.page);

  const attemptHighlightScroll = () => {
    var textLayer = wEl.querySelector('.textLayer');
    if (textLayer && textLayer.childNodes.length > 0) {
      if (window.doCustomHighlight) window.doCustomHighlight(textLayer, item.text);
      var mark = textLayer.querySelector('mark.active-hl');
      if (mark) {
        // Calculate precise Y offset relative to contentEl
        const markRect = mark.getBoundingClientRect();
        const contentRect = window.contentEl.getBoundingClientRect();
        const preciseY = window.contentEl.scrollTop + (markRect.top - contentRect.top) - (contentRect.height / 3);
        window.contentEl.scrollTo({ top: preciseY, behavior: 'smooth' });
        return true;
      }
    }
    return false;
  };

  if (wEl) {
    if (window.contentEl) {
      // First scroll to the page wrapper
      let targetY = 0;
      let averagePageHeight = 800;
      for (let i = 1; i < item.page; i++) {
        let wrap = document.getElementById('page-wrap-' + i);
        targetY += (wrap && wrap.offsetHeight > 0 ? wrap.offsetHeight : averagePageHeight) + 20;
      }
      window.contentEl.scrollTo({ top: targetY, behavior: 'smooth' });
    }
    if (!attemptHighlightScroll()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (attemptHighlightScroll() || attempts > 20) {
          clearInterval(interval);
        }
      }, 100);
    }
  }
};

window.navigateSearchResult = function (dir) {
  if (window.AuraSearch.flatMatches.length === 0) return;
  let newIdx = window.AuraSearch.currentIndex + dir;
  if (newIdx < 0) newIdx = window.AuraSearch.flatMatches.length - 1;
  if (newIdx >= window.AuraSearch.flatMatches.length) newIdx = 0;
  window.gotoSearchResult(newIdx);
};



// --- Toggle Features ---
window.isTwoPageMode = false;
window.toggleTwoPageMode = function () {
  window.isTwoPageMode = !window.isTwoPageMode;
  document.body.classList.toggle('two-page-mode', window.isTwoPageMode);
  let btn = document.getElementById('pdf-btn-twopage');
  if (btn) btn.classList.toggle('active', window.isTwoPageMode);

  let content = document.getElementById('content');
  if (content) {
    if (window.isTwoPageMode) {
      content.style.flexDirection = 'row';
      content.style.flexWrap = 'wrap';
      content.style.justifyContent = 'center';
      content.style.alignItems = 'flex-start';
      content.style.gap = '0px';

      // Auto-fit to the screen optimally!
      if (window.currentPdfDoc) {
        window.pdfFitWidth();
      } else {
        window.pdfScale = 0.7; // fallback
      }
    } else {
      content.style.flexDirection = 'column';
      content.style.flexWrap = 'nowrap';
      content.style.justifyContent = 'flex-start';
      content.style.alignItems = 'center';
      content.style.gap = '0px';

      if (window.currentPdfDoc) {
        window.pdfFitWidth(); // fit single page based on selected dropdown
      } else {
        window.pdfScale = 1.2; // fallback
      }
    }

    // pdfFitWidth already triggers loadPdf/re-render, but if no doc, we do nothing
    if (window.currentPdfDoc) {
      // Just to be safe, if pdfFitWidth triggered a load, we don't need another, but it handles debouncing usually
      // Actually, pdfFitWidth calls loadPdf internally.
    }
  }
};

window.pdfVirtualizationEnabled = true;
window.pdfToggleVirtualization = function (enabled) {
  window.pdfVirtualizationEnabled = enabled;
  var observer = makePdfObserver();

  const wraps = document.querySelectorAll('.pdf-page-wrapper');
  wraps.forEach(w => {
    observer.observe(w);
  });
};

window.forceRenderAllPages = function () {
  if (!window.currentPdfDoc) return;
  const totalPages = window.currentPdfDoc.numPages;
  let current = 1;
  function renderNextBatch() {
    let end = Math.min(current + 5, totalPages + 1);
    let renderedAny = false;
    for (let i = current; i < end; i++) {
      let wrap = document.getElementById('page-wrap-' + i);
      if (wrap && wrap.dataset.loaded !== 'true') {
        wrap.dataset.loaded = 'true';
        if (window.renderPage) window.renderPage(wrap);
        renderedAny = true;
      }
    }
    current = end;
    if (current <= totalPages) {
      setTimeout(renderNextBatch, renderedAny ? 50 : 0);
    }
  }
  renderNextBatch();
};

window.pdfLazyLoadingEnabled = true;
window.pdfToggleLazyLoading = function (enabled) {
  window.pdfLazyLoadingEnabled = enabled;
  if (!enabled && window.currentPdfDoc) {
    window.forceRenderAllPages();
  }
};

window.pdfDeepSearchEnabled = false;
window.pdfToggleDeepSearch = function (enabled) {
  window.pdfDeepSearchEnabled = enabled;
  if (enabled && window.currentPdfDoc) {
    window.forceRenderAllPages();
  }
};

// Listen for layout changes from ReadingExperience EventBus
window.addEventListener('DOMContentLoaded', () => {
  if (window.ReadingExperience && window.ReadingExperience.Events) {
    window.ReadingExperience.Events.on('layout:changed', (state) => {
      if (window.currentExt === 'pdf' && window.pdfFitWidth) {
        window.pdfFitWidth(state.widthMax);
      }
    });
  }
});

// =========================================================================
// ROBUST SPATIAL TEXT SELECTION ENGINE
// =========================================================================
window.pdfSpatialIndexes = window.pdfSpatialIndexes || {};
window._selectionState = { active: false, startPage: -1, startIndex: -1, currentIdx: -1, startX: 0, startY: 0 };

window.initRobustSelection = function () {
  let enabled = window.safeStorage && window.safeStorage.getItem('aura-robust-selection') !== 'false';
  if (enabled) {
    document.body.classList.add('robust-selection-enabled');
  } else {
    document.body.classList.remove('robust-selection-enabled');
    clearSelectionUI();
  }
};

function clearSelectionUI() {
  document.querySelectorAll('.draw-layer').forEach(cv => {
    let ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
  });
}

function getNearestItemIndex(items, x, y) {
  if (!items || items.length === 0) return -1;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < items.length; i++) {
    let it = items[i];
    let cx = it.x + (it.w / 2);
    let cy = it.y + (it.h / 2);
    let dist = Math.pow(cx - x, 2) + Math.pow(cy - y, 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

window.addEventListener('mousedown', function (e) {
  if (!document.body.classList.contains('robust-selection-enabled')) return;
  let tl = e.target.closest('.textLayer');
  if (!tl) return;

  let wrap = tl.closest('.pdf-page-wrapper');
  if (!wrap) return;

  let pageNum = parseInt(wrap.dataset.page, 10);
  let items = window.pdfSpatialIndexes[pageNum];
  if (!items) return;

  let rect = tl.getBoundingClientRect();
  let x = e.clientX - rect.left;
  let y = e.clientY - rect.top;

  let idx = getNearestItemIndex(items, x, y);
  if (idx !== -1) {
    window._selectionState = { active: true, startPage: pageNum, startIndex: idx, currentIdx: idx, startX: x, startY: y };
    clearSelectionUI();
  }
});

window.addEventListener('mousemove', function (e) {
  if (!window._selectionState.active) return;
  if (!document.body.classList.contains('robust-selection-enabled')) return;

  let tl = e.target.closest('.textLayer');
  if (!tl) return;

  let wrap = tl.closest('.pdf-page-wrapper');
  if (!wrap) return;

  let pageNum = parseInt(wrap.dataset.page, 10);
  // For simplicity, we only allow selection within a single page
  if (pageNum !== window._selectionState.startPage) return;

  let items = window.pdfSpatialIndexes[pageNum];
  if (!items) return;

  let rect = tl.getBoundingClientRect();
  let x = e.clientX - rect.left;
  let y = e.clientY - rect.top;

  let idx = getNearestItemIndex(items, x, y);
  if (idx !== -1 && idx !== window._selectionState.currentIdx) {
    window._selectionState.currentIdx = idx;

    let cv = wrap.querySelector('.draw-layer');
    if (!cv) return;
    let ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);

    let dpr = cv.width / parseFloat(wrap.style.width);
    ctx.fillStyle = 'rgba(49, 130, 206, 0.45)';

    let minIdx = Math.min(window._selectionState.startIndex, window._selectionState.currentIdx);
    let maxIdx = Math.max(window._selectionState.startIndex, window._selectionState.currentIdx);

    for (let i = minIdx; i <= maxIdx; i++) {
      let it = items[i];
      ctx.fillRect(it.x * dpr, (it.y - it.h) * dpr, it.w * dpr, (it.h + 2) * dpr);
    }
  }
});

window.addEventListener('mouseup', function (e) {
  if (window._selectionState.active) {
    window._selectionState.active = false;
    // Selection is kept drawn on canvas. 
    // We set the actual text into a hidden textarea to allow native Ctrl+C
    let s = window._selectionState;
    if (s.startIndex !== s.currentIdx) {
      let items = window.pdfSpatialIndexes[s.startPage];
      if (items) {
        let minIdx = Math.min(s.startIndex, s.currentIdx);
        let maxIdx = Math.max(s.startIndex, s.currentIdx);
        let text = [];
        let lastY = items[minIdx].y;
        for (let i = minIdx; i <= maxIdx; i++) {
          if (Math.abs(items[i].y - lastY) > 5) {
            text.push('\n');
            lastY = items[i].y;
          }
          text.push(items[i].str);
        }
        window._activeRobustSelectionText = text.join('').replace(/\n/g, '\n').replace(/  +/g, ' ');
      }
    }
  }
});

document.addEventListener('copy', function (e) {
  if (document.body.classList.contains('robust-selection-enabled') && window._activeRobustSelectionText) {
    e.clipboardData.setData('text/plain', window._activeRobustSelectionText);
    e.preventDefault();
    // Clear selection after copy? Optional.
    clearSelectionUI();
    window._activeRobustSelectionText = null;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  window.initRobustSelection();
});
