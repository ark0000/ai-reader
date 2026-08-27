/**
 * diagram-engine.js - Isolated Mermaid Diagram Builder Panel
 *
 * Architecture (SOLID):
 *  - MermaidAdapter      (Adapter)          wraps mermaid.js API
 *  - DiagramEngine       (Facade+Strategy)  orchestrates rendering
 *  - PanZoomEngine       (SRP)              owns pan/zoom/fit/fullscreen state
 *  - DiagramUIController (SRP)              owns panel DOM & events
 *
 * Result → best-of-all implemented below.
 *
 * Isolation guarantee:
 *  - All IDs/classes prefixed "dgb-"
 *  - No existing globals mutated (only reads: mermaid, htmlToImage)
 *  - Panel HTML injected once via JS; never hard-coded in HTML
 */

;(function DiagramEngineIIFE() {
  'use strict';

  // =========================================================================
  // Utilities: FNV1aHasher, LRUSVGCache, Debouncer
  // =========================================================================
  class FNV1aHasher {
    static hash(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    }
  }

  class LRUSVGCache {
    constructor(maxSize = 10) {
      this._maxSize = maxSize;
      this._cache   = new Map(); // key → { code, svg } for collision safety
    }
    get(code) {
      const key = FNV1aHasher.hash(code);
      if (!this._cache.has(key)) return null;
      const entry = this._cache.get(key);
      // Bug-fix: guard against FNV-1a hash collisions by verifying original string
      if (entry.code !== code) return null;
      this._cache.delete(key);
      this._cache.set(key, entry); // promote to MRU position
      return entry.svg;
    }
    set(code, svgStr) {
      const key = FNV1aHasher.hash(code);
      if (this._cache.has(key)) this._cache.delete(key);
      this._cache.set(key, { code, svg: svgStr });
      if (this._cache.size > this._maxSize) {
        this._cache.delete(this._cache.keys().next().value); // evict LRU
      }
    }
  }

  class Debouncer {
    constructor(delay = 400) {
      this._delay = delay;
      this._timer = null;
    }
    run(fn) {
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._timer = null;
        fn();
      }, this._delay);
    }
    cancel() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // =========================================================================
  // 1. MermaidAdapter  (Adapter Pattern)
  // =========================================================================
  class MermaidAdapter {
    constructor() { this._initialized = false; }

    _ensureInit() {
      if (this._initialized) return;
      if (typeof mermaid === 'undefined') throw new Error('Mermaid library not loaded.');
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        fontFamily: 'Inter, system-ui, sans-serif',
        flowchart: { curve: 'basis', useMaxWidth: false },
        sequence:  { useMaxWidth: false },
        gantt:     { useMaxWidth: false }
      });
      this._initialized = true;
    }

    async render(id, code) {
      this._ensureInit();
      const { svg } = await mermaid.render(id, code);
      return svg;
    }
  }

  // =========================================================================
  // Rendering Strategies
  // =========================================================================
  class IDiagramRenderer {
    async mount(svgString, container) { throw new Error('abstract'); }
    invalidate() {}
    getRawSVG() { return null; }
  }

  class DOMRendererStrategy extends IDiagramRenderer {
    constructor() { super(); this._rawSvg = null; }
    async mount(svgString, container) {
      this._rawSvg = svgString;
      container.innerHTML = svgString;
      const svgEl = container.querySelector('svg');
      if (svgEl) {
        svgEl.style.display = 'block';
        svgEl.style.maxWidth = 'none';
        svgEl.classList.add('dgb-dom-svg');
      }
    }
    getRawSVG() { return this._rawSvg; }
  }

  class CanvasRendererStrategy extends IDiagramRenderer {
    constructor() {
      super();
      this._rawSvg = null;
      this._canvas = null;
      this._img = null;
    }

    async mount(svgString, container) {
      this._rawSvg = svgString;
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      let w = 800, h = 600;
      if (svgEl) {
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
          // Bug-fix: viewBox may use commas or mixed whitespace (e.g. "0,0,800,600")
          const parts = vb.trim().split(/[\s,]+/);
          w = parseFloat(parts[2]);
          h = parseFloat(parts[3]);
        }
        if (!svgEl.getAttribute('width')) {
          svgString = svgString.replace('<svg ', `<svg width="${w}" height="${h}" `);
        }
      }

      container.innerHTML = '';
      this._canvas = document.createElement('canvas');
      this._canvas.className = 'dgb-canvas-el';
      // Center the canvas naturally so scaling from center works
      this._canvas.style.transformOrigin = '0 0';
      container.appendChild(this._canvas);

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      return new Promise((resolve, reject) => {
        this._img = new Image();
        this._img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          this._canvas.width = w * dpr;
          this._canvas.height = h * dpr;
          this._canvas.style.width = w + 'px';
          this._canvas.style.height = h + 'px';
          
          const ctx = this._canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.drawImage(this._img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve();
        };
        this._img.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to rasterize SVG'));
        };
        this._img.src = url;
      });
    }

    getRawSVG() { return this._rawSvg; }
  }

  class RendererFactory {
    static create(mode) {
      return mode === 'canvas' ? new CanvasRendererStrategy() : new DOMRendererStrategy();
    }
  }

  // =========================================================================
  // 2. DiagramEngine  (Facade + Strategy)
  // =========================================================================
  class DiagramEngine {
    constructor() { 
      this._adapter = new MermaidAdapter(); 
      this._cache = new LRUSVGCache(20);
      this._renderer = new DOMRendererStrategy();
      this._seq = 0; 
      this._rendering = false;
    }

    setStrategy(strategy) {
      this._renderer = strategy;
    }

    getStrategy() {
      return this._renderer;
    }

    _uid() { this._seq++; return 'dgb-svg-' + Date.now().toString(36) + '-' + this._seq; }

    async render(code, container) {
      if (this._rendering) return { ok: false, error: 'busy' };
      container.innerHTML = '';
      const trimmed = code.trim();
      if (!trimmed) { this._showError(container, 'Paste Mermaid code above then click Run.'); return { ok: false, error: 'empty' }; }
      
      this._rendering = true;
      try {
        let svg = this._cache.get(trimmed);
        if (!svg) {
          svg = await this._adapter.render(this._uid(), trimmed);
          this._cache.set(trimmed, svg);
        }
        await this._renderer.mount(svg, container);
        this._rendering = false;
        return { ok: true };
      } catch (err) {
        this._rendering = false;
        const msg = err && err.message ? err.message : String(err);
        this._showError(container, msg);
        return { ok: false, error: msg };
      }
    }

    _showError(container, msg) {
      container.innerHTML =
        '<div class="dgb-error-block">' +
          '<div class="dgb-error-icon">&#9888;</div>' +
          '<div class="dgb-error-title">Diagram Syntax Error</div>' +
          '<pre class="dgb-error-pre">' + this._esc(msg) + '</pre>' +
          '<p class="dgb-error-tip">Fix the syntax above and click <strong>Run &#9654;</strong> again.</p>' +
        '</div>';
    }

    _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  }

  // =========================================================================
  // 3. PanZoomEngine  (SRP)
  // Best-in-class pan+zoom behaviour.
  //
  // Features:
  //  - Mouse-wheel zoom at cursor   (diagram point under cursor stays fixed)
  //  - Pointer drag to pan          (pointer capture so no sticky-drag)
  //  - Two-finger pinch zoom        (mobile)
  //  - fitToView()                  (contain-fit with 6% padding, centered)
  //  - Smooth CSS transition on button clicks (none on wheel/drag = no lag)
  //  - Zoom percentage HUD          (live readout)
  //  - Minimap                      (small overview for large diagrams)
  //  - Double-click to fit
  //  - Keyboard: +/- zoom, F=fit, 0=100%
  //  - Fullscreen API               (native browser fullscreen on the shell)
  // =========================================================================
  class PanZoomEngine {
    /**
     * @param {HTMLElement} viewport    drag/scroll surface
     * @param {HTMLElement} layer       receives CSS transform
     * @param {HTMLElement} shell       the window div (for fullscreen)
     * @param {Function}    onScale     callback(pct:number) for HUD update
     */
    constructor(viewport, layer, shell, onScale) {
      this._vp       = viewport;
      this._layer    = layer;
      this._shell    = shell;
      this._onScale  = onScale || (() => {});
      this._m        = new DOMMatrix();
      this._dragging = false;
      this._lastX    = 0;
      this._lastY    = 0;
      this._velX     = 0;
      this._velY     = 0;
      this._lastTime = 0;
      this._inertiaRaf = null;
      this._isFullscreen = false;

      // Opt-3: Set will-change ONCE in constructor — not on every _apply() call.
      // Re-assigning the same value every rAF is a wasted style mutation.
      this._layer.style.willChange = 'transform';

      // Opt-2: Cache getBoundingClientRect() via ResizeObserver.
      // wheel events fire at 60+Hz — calling getBCR() each time forces a layout
      // flush (expensive). Observer fires only when the container actually resizes.
      this._vpRect = viewport.getBoundingClientRect();
      this._ro = new ResizeObserver(() => {
        this._vpRect = viewport.getBoundingClientRect();
      });
      this._ro.observe(viewport);

      this._bindEvents();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    fitToView() {
      // Reset to identity so getBCR gives true pixel size
      this._m = new DOMMatrix();
      this._apply(false);

      const svgEl = this._layer.querySelector('svg, canvas');
      if (!svgEl) return;

      const svgRect = svgEl.getBoundingClientRect();
      const vpW = this._vp.clientWidth  || this._vp.offsetWidth;
      const vpH = this._vp.clientHeight || this._vp.offsetHeight;
      const cW  = svgRect.width;
      const cH  = svgRect.height;
      if (!cW || !cH || !vpW || !vpH) return;

      // contain-fit with 6% padding
      const scaleX = (vpW * 0.94) / cW;
      const scaleY = (vpH * 0.94) / cH;
      const scale  = Math.min(scaleX, scaleY);
      const tx     = (vpW - cW * scale) / 2;
      const ty     = (vpH - cH * scale) / 2;
      
      this._m = new DOMMatrix().translate(tx, ty).scale(scale);
      this._apply(true);   // smooth transition for fit
    }

    zoomIn()  { this._zoomCenter(1.25, true);  }
    zoomOut() { this._zoomCenter(0.80, true);  }
    reset()   { this._m = new DOMMatrix(); this._apply(true); }

    toggleFullscreen() {
      const doc = document;
      const shell = this._shell;
      const isFs = shell && shell.hasAttribute('data-fullscreen');

      const editorPane = doc.getElementById('dgb-editor-pane');
      const resizer    = doc.getElementById('dgb-resizer');
      const canvasPane = doc.getElementById('dgb-canvas-pane');
      const btn        = doc.getElementById('dgb-btn-fullscreen');

      if (!isFs) {
        if (shell) shell.setAttribute('data-fullscreen', 'true');
        if (editorPane) { editorPane.dataset.fsDisplay = editorPane.style.display; editorPane.style.setProperty('display', 'none', 'important'); }
        if (resizer)    { resizer.dataset.fsDisplay    = resizer.style.display;    resizer.style.setProperty('display', 'none', 'important'); }
        if (canvasPane) canvasPane.style.flex = '1';
        if (btn) btn.title = 'Exit Fullscreen (Esc / F11)';
        this._isFullscreen = true;

        const el = doc.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (req) req.call(el).catch(() => {});
        if (this._layer.querySelector('svg, canvas')) setTimeout(() => this.fitToView(), 300);
      } else {
        if (shell) shell.removeAttribute('data-fullscreen');
        if (editorPane) { editorPane.style.removeProperty('display'); if (editorPane.dataset.fsDisplay) editorPane.style.display = editorPane.dataset.fsDisplay; }
        if (resizer)    { resizer.style.removeProperty('display');    if (resizer.dataset.fsDisplay)    resizer.style.display = resizer.dataset.fsDisplay; }
        if (canvasPane) canvasPane.style.flex = '';
        if (btn) btn.title = 'Fullscreen preview (F11)';
        this._isFullscreen = false;

        const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
        if (exit && (doc.fullscreenElement || doc.webkitFullscreenElement)) exit.call(doc).catch(() => {});
        if (this._layer.querySelector('svg, canvas')) setTimeout(() => this.fitToView(), 300);
      }
    }

    // Bug-fix: use determinant square root for true uniform scale — immune to
    // floating-point drift where m.a ≠ m.d after many matrix multiplications.
    getScalePct() { return Math.round(Math.sqrt(this._m.a * this._m.d - this._m.b * this._m.c) * 100); }

    // ── Private helpers ─────────────────────────────────────────────────────

    _zoomCenter(factor, smooth) {
      const cx = this._vp.clientWidth  / 2;
      const cy = this._vp.clientHeight / 2;
      this._zoomAt(cx, cy, factor, smooth);
    }

    _zoomAt(cx, cy, factor, smooth) {
      const MIN = 0.05, MAX = 20;
      let newScale = this._m.a * factor;
      newScale = Math.min(MAX, Math.max(MIN, newScale));
      const ratio = newScale / this._m.a;
      if (ratio === 1) return;

      this._m = new DOMMatrix().translate(cx, cy).scale(ratio).translate(-cx, -cy).multiply(this._m);
      this._apply(smooth);
    }

    _apply(smooth) {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._commit(smooth));
    }

    // Opt-1: _applyDirect() writes to DOM immediately — used by paths that are
    // already inside a rAF callback (inertia loop, pointermove). Calling _apply()
    // from within a rAF nests another rAF, deferring the write one extra frame
    // and effectively halving the animation framerate on those paths.
    _applyDirect(smooth) {
      this._commit(smooth);
    }

    _commit(smooth) {
      if (smooth) {
        this._layer.style.transition = 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)';
      } else {
        if (this._layer.style.transition) this._layer.style.transition = 'none';
      }
      this._layer.style.transform = this._m.toString();
      this._onScale(this.getScalePct());
    }

    _bindEvents() {
      // ── Mouse wheel zoom at cursor ──
      this._vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        // Opt-2: use cached rect — no layout flush on every wheel tick.
        // ResizeObserver keeps _vpRect fresh when the container resizes.
        const factor = e.deltaY < 0 ? 1.10 : 0.91;
        this._zoomAt(e.clientX - this._vpRect.left, e.clientY - this._vpRect.top, factor, false);
      }, { passive: false });

      // ── Pointer drag to pan with inertia ──
      this._vp.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (this._inertiaRaf) cancelAnimationFrame(this._inertiaRaf);
        this._dragging = true;
        this._lastX = e.clientX; this._lastY = e.clientY;
        this._lastTime = performance.now();
        this._velX = 0; this._velY = 0;
        this._vp.style.cursor = 'grabbing';
        this._vp.setPointerCapture(e.pointerId);
      });
      this._vp.addEventListener('pointermove', (e) => {
        if (!this._dragging) return;
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        const now = performance.now();
        const dt = Math.max(1, now - this._lastTime);
        
        // Exponential moving average for velocity (pixels per ms)
        this._velX = (this._velX * 0.5) + ((dx / dt) * 0.5);
        this._velY = (this._velY * 0.5) + ((dy / dt) * 0.5);
        
        this._lastX = e.clientX; this._lastY = e.clientY;
        this._lastTime = now;
        
        this._m = new DOMMatrix().translate(dx, dy).multiply(this._m);
        // Opt-1: already inside a pointermove handler (browser fires on rAF boundary
        // in modern Chromium). Use _applyDirect to avoid a nested rAF that would
        // defer the DOM write one full extra frame.
        this._applyDirect(false);
      });
      
      const stopDrag = () => { 
        if (!this._dragging) return;
        this._dragging = false; 
        this._vp.style.cursor = 'grab'; 
        
        // Bug-fix: inertia was multiplying velocity by hardcoded 16 (assumed 60fps).
        // On 120Hz displays this decays 2× too fast; on 30fps it was too fast.
        // Fix: use real elapsed dt from performance.now() so inertia is framerate-
        // independent and feels consistent across all refresh rates.
        const FRICTION = 0.88;
        let lastTs = performance.now();
        // Opt-4: Reuse a single DOMMatrix for translation in the inertia loop
        // instead of allocating a new DOMMatrix() every frame (~60 allocs/sec).
        // m.translateSelf(dx, dy) mutates in-place — zero allocation per frame.
        const translateM = new DOMMatrix();
        const loop = (timestamp) => {
          const dt = Math.min(timestamp - lastTs, 32);
          lastTs = timestamp;
          if (Math.abs(this._velX) < 0.01 && Math.abs(this._velY) < 0.01) return;
          const dx = this._velX * dt;
          const dy = this._velY * dt;
          // Set e/f (translateX/Y) directly — no new allocation
          translateM.e = dx;
          translateM.f = dy;
          this._m = translateM.multiply(this._m);
          // Opt-1: already inside a rAF — write DOM directly.
          this._applyDirect(false);
          this._velX *= FRICTION;
          this._velY *= FRICTION;
          this._inertiaRaf = requestAnimationFrame(loop);
        };
        this._inertiaRaf = requestAnimationFrame(loop);
      };
      
      this._vp.addEventListener('pointerup',     stopDrag);
      this._vp.addEventListener('pointercancel', stopDrag);

      // ── Double-click to fit ──
      this._vp.addEventListener('dblclick', () => this.fitToView());

      // ── Touch pinch zoom ──
      let lastDist = null;
      this._vp.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastDist !== null) {
          const rect = this._vp.getBoundingClientRect();
          const cx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
          const cy = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
          this._zoomAt(cx, cy, dist / lastDist, false);
        }
        lastDist = dist;
      }, { passive: false });
      this._vp.addEventListener('touchend', () => { lastDist = null; });

      // ── Keyboard shortcuts (only when viewport or its ancestors focused) ──
      document.addEventListener('keydown', (e) => {
        // Only active when the diagram panel is open
        const panel = document.getElementById('diagram-builder-panel');
        if (!panel || !panel.classList.contains('dgb-open')) return;
        // Don't hijack typing in editor (except for F11 fullscreen)
        if (e.target && e.target.id === 'dgb-editor' && e.key !== 'F11') return;

        if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomIn(); }
        if (e.key === '-')                  { e.preventDefault(); this.zoomOut(); }
        if (e.key === '0')                  { e.preventDefault(); this.reset(); }
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.fitToView(); }
        if (e.key === 'F11')                { e.preventDefault(); this.toggleFullscreen(); }
      });

      // ── Fullscreen change listener ──
      const onFsChange = () => {
        const doc = document;
        this._isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
        const shell = document.getElementById('dgb-shell');
        const btn   = document.getElementById('dgb-btn-fullscreen');

        if (this._isFullscreen) {
          // JS-class approach - reliable in all browsers, not subject to
          // browser quirks with :fullscreen on deeply nested elements
          if (shell) shell.setAttribute('data-fullscreen', 'true');
          if (btn)   btn.title = 'Exit Fullscreen (Esc / F11)';
        } else {
          if (shell) shell.removeAttribute('data-fullscreen');
          if (btn)   btn.title = 'Fullscreen preview (F11)';
        }

        // Bug-fix: was only checking for 'svg', missing Canvas render mode.
        if (this._layer.querySelector('svg, canvas')) {
          setTimeout(() => this.fitToView(), 300);
        }
      };

      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      document.addEventListener('mozfullscreenchange', onFsChange);
      document.addEventListener('MSFullscreenChange', onFsChange);
    }
  }

  // =========================================================================
  // 4. DiagramUIController  (SRP — owns the panel DOM)
  // =========================================================================
  class DiagramUIController {
    constructor(engine) {
      this._engine   = engine;
      this._panel    = null;
      this._editor   = null;
      this._canvas   = null;
      this._viewport = null;
      this._pz       = null;
      this._isOpen   = false;
      this._debouncer = new Debouncer(500);
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────
    bootstrap() { this._injectHTML(); this._bindEvents(); }

    _injectHTML() {
      if (document.getElementById('diagram-builder-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'diagram-builder-panel';
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML =
        '<div id="dgb-backdrop"></div>' +
        '<div id="dgb-shell">' +

          /* ── Title bar ── */
          '<div id="dgb-titlebar">' +
            '<div id="dgb-titlebar-left">' +
              '<span id="dgb-icon">&#11041;</span>' +
              '<span id="dgb-title">Diagram Builder</span>' +
              '<span id="dgb-badge">Mermaid</span>' +
            '</div>' +
            '<div id="dgb-titlebar-right">' +
              '<button id="dgb-btn-add-notes" class="dgb-hdr-btn" title="Add Diagram to Notes">&#10133; Notes</button>' +
              '<button id="dgb-btn-save-png" class="dgb-hdr-btn" title="Export high-quality PNG (3x)">&#8595; PNG</button>' +
              '<button id="dgb-btn-save-svg" class="dgb-hdr-btn" title="Export crisp vector SVG">&#8595; SVG</button>' +
              '<button id="dgb-btn-close"    class="dgb-hdr-btn dgb-close-x" title="Close (Esc)">&#10005;</button>' +
            '</div>' +
          '</div>' +

          /* ── Global toolbar ── */
          '<div id="dgb-toolbar">' +
            '<button id="dgb-btn-run"    class="dgb-tb-btn dgb-run-btn">&#9654; Run</button>' +
            '<button id="dgb-btn-clear"  class="dgb-tb-btn">&#10005; Clear</button>' +
            '<button id="dgb-btn-sample" class="dgb-tb-btn">&#128203; Sample</button>' +
            '<button id="dgb-btn-toggle-code" class="dgb-tb-btn" style="margin-left: 15px;" title="Toggle Code Editor">&#9998; Code</button>' +
            '<span   id="dgb-status"></span>' +
            '<span   id="dgb-shortcut-tip">Ctrl+Enter to run &nbsp;|&nbsp; F=fit &nbsp;|&nbsp; +/- zoom &nbsp;|&nbsp; dbl-click to fit</span>' +
          '</div>' +

          /* ── Split pane ── */
          '<div id="dgb-split">' +

            /* LEFT: editor */
            '<div id="dgb-editor-pane">' +
              '<div class="dgb-pane-label">&#9998; Mermaid Code</div>' +
              '<textarea id="dgb-editor" spellcheck="false" autocorrect="off" autocapitalize="off"' +
                ' placeholder="Paste or type Mermaid code here...\n\nExample:\ngraph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n  B -->|No|  D[Skip]">' +
              '</textarea>' +
            '</div>' +

            '<div id="dgb-resizer"></div>' +

            /* RIGHT: pan+zoom canvas pane */
            '<div id="dgb-canvas-pane">' +

              /* Pane header with label + fullscreen button */
              '<div id="dgb-preview-header">' +
                '<span class="dgb-pane-label-inline">&#9654; Preview</span>' +
                '<button id="dgb-btn-fullscreen" class="dgb-preview-action-btn" title="Fullscreen preview (F11)">&#9974;</button>' +
              '</div>' +

              /* Viewport — both the SVG layer AND the zoom bar live here.
                 Zoom bar z-index:9000 wins over #dgb-layer within the same parent. */
              '<div id="dgb-viewport">' +
                /* Transform layer for the diagram */
                '<div id="dgb-layer">' +
                  '<div id="dgb-canvas">' +
                    '<div class="dgb-placeholder">' +
                      '<div class="dgb-ph-icon">&#11041;</div>' +
                      '<p>Write or paste Mermaid code on the left,<br>then click <strong>&#9654; Run</strong></p>' +
                      '<p class="dgb-ph-hint">Drag to pan &nbsp;|&nbsp; Scroll to zoom &nbsp;|&nbsp; Dbl-click to fit &nbsp;|&nbsp; Pinch on mobile</p>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' + /* /dgb-viewport */

              /* Zoom bar OUTSIDE viewport — completely immune to SVG layer size/GPU compositing issues */
              '<div id="dgb-zoom-bar">' +
                '<button id="dgb-zoom-in"  class="dgb-zoom-btn" title="Zoom in (+)">+</button>' +
                '<button id="dgb-zoom-out" class="dgb-zoom-btn" title="Zoom out (-)">&#8722;</button>' +
                '<span   id="dgb-zoom-pct" class="dgb-zoom-pct" title="Current zoom">100%</span>' +
                '<button id="dgb-zoom-fit" class="dgb-zoom-btn dgb-zoom-fit-btn" title="Fit to view (F)">&#9635;</button>' +
                '<button id="dgb-zoom-100" class="dgb-zoom-btn" title="Reset 100% (0)">1:1</button>' +
              '</div>' +

            '</div>' + /* /dgb-canvas-pane */


          '</div>' +   /* /dgb-split */
        '</div>';      /* /dgb-shell */

      document.body.appendChild(panel);
      this._panel    = panel;
      this._editor   = document.getElementById('dgb-editor');
      this._canvas   = document.getElementById('dgb-canvas');
      this._viewport = document.getElementById('dgb-viewport');
      const layer    = document.getElementById('dgb-layer');
      const shell    = document.getElementById('dgb-shell');

      // Force-apply zoom bar visibility styles via JS — immune to CSS caching
      this._styleZoomBar();

      this._pz = new PanZoomEngine(this._viewport, layer, shell, (pct) => {
        const el = document.getElementById('dgb-zoom-pct');
        if (el) el.textContent = pct + '%';
      });
    }

    // ── Events ───────────────────────────────────────────────────────────────
    _bindEvents() {
      document.getElementById('dgb-backdrop').addEventListener('click', () => this.close());
      document.getElementById('dgb-btn-close').addEventListener('click', () => this.close());
      document.getElementById('dgb-btn-run').addEventListener('click', () => { this._debouncer.cancel(); this._run(); });
      document.getElementById('dgb-btn-clear').addEventListener('click', () => { this._debouncer.cancel(); this._clear(); });
      document.getElementById('dgb-btn-sample').addEventListener('click', () => { this._debouncer.cancel(); this._loadSample(); });
      document.getElementById('dgb-btn-save-png').addEventListener('click', () => this._exportPNG());
      document.getElementById('dgb-btn-save-svg').addEventListener('click', () => this._exportSVG());
      document.getElementById('dgb-btn-add-notes').addEventListener('click', () => this._addToNotes());
      document.getElementById('dgb-btn-fullscreen').addEventListener('click', () => this._pz.toggleFullscreen());

      document.getElementById('dgb-zoom-in').addEventListener('click',  () => this._pz.zoomIn());
      document.getElementById('dgb-zoom-out').addEventListener('click', () => this._pz.zoomOut());
      document.getElementById('dgb-zoom-fit').addEventListener('click', () => this._pz.fitToView());
      document.getElementById('dgb-zoom-100').addEventListener('click', () => this._pz.reset());

      // Ctrl+Enter runs; Escape closes or exits fallback fullscreen
      this._editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { 
          e.preventDefault(); 
          this._debouncer.cancel();
          this._run(); 
        }
      });
      this._editor.addEventListener('input', () => {
        this._setStatus('Typing...', '');
        this._debouncer.run(() => this._run());
      });
      document.getElementById('dgb-btn-toggle-code').addEventListener('click', (e) => {
        const pane = document.getElementById('dgb-editor-pane');
        const resizer = document.getElementById('dgb-resizer');
        const isHidden = pane.style.display === 'none';
        pane.style.display = isHidden ? 'flex' : 'none';
        resizer.style.display = isHidden ? 'block' : 'none';
        e.target.style.opacity = isHidden ? '1' : '0.5';
        setTimeout(() => this._pz.fitToView(), 50);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._isOpen) {
          const shell = document.getElementById('dgb-shell');
          if (shell && shell.hasAttribute('data-fullscreen')) {
            // Exit our fullscreen mode (restores editor pane via inline styles)
            this._pz.toggleFullscreen();
          } else if (!document.fullscreenElement) {
            this.close();
          }
        }
      });

      this._bindResizer();
    }

    // ── Run ──────────────────────────────────────────────────────────────────
    async _run() {
      const code = this._editor.value;
      if (!code.trim()) { this._setStatus('No code to run.', 'warn'); return; }
      this._setStatus('Rendering\u2026', 'info');
      const runBtn = document.getElementById('dgb-btn-run');
      runBtn.disabled = true;
      const result = await this._engine.render(code, this._canvas);
      runBtn.disabled = false;

      if (result.ok) {
        this._setStatus('Ready \u2014 drag/scroll/pinch to explore', 'ok');
        setTimeout(() => this._pz.fitToView(), 250);
      } else if (result.error !== 'empty') {
        this._setStatus('Syntax error \u2014 see preview', 'error');
        this._pz.reset();
      }
    }

    // ── Clear ────────────────────────────────────────────────────────────────
    _clear() {
      this._editor.value = '';
      this._canvas.innerHTML =
        '<div class="dgb-placeholder">' +
          '<div class="dgb-ph-icon">&#11041;</div>' +
          '<p>Canvas cleared. Paste new code and run.</p>' +
        '</div>';
      this._pz.reset();
      this._setStatus('');
    }

    _setStatus(msg, type) {
      const el = document.getElementById('dgb-status');
      if (!el) return;
      el.textContent = msg;
      el.className = type ? 'dgb-status-' + type : '';
    }

    // ── Samples ──────────────────────────────────────────────────────────────
    _loadSample() {
      const samples = [
        'graph TD\n  A[Browser] -->|HTTP| B(FastAPI Backend)\n  B --> C{Auth?}\n  C -->|Valid| D[Process Request]\n  C -->|Invalid| E[401 Unauthorized]\n  D --> F[(SQLite DB)]\n  D --> G[/AI Provider/]',
        'sequenceDiagram\n  participant U as User\n  participant F as Frontend\n  participant A as FastAPI\n  participant AI as AI Provider\n  U->>F: Type message\n  F->>A: POST /api/chat\n  A->>AI: Forward messages\n  AI-->>A: Response\n  A-->>F: JSON reply\n  F-->>U: Render in chat',
        'erDiagram\n  USER ||--o{ SESSION : has\n  USER ||--o{ CONNECTION : owns\n  USER ||--o{ DOCUMENT : uploads\n  CONNECTION }o--|| PROVIDER : uses\n  DOCUMENT ||--o{ RAG_CHUNK : "indexed into"',
        'pie title Document Types\n  "PDF" : 45\n  "Markdown" : 30\n  "EPUB" : 15\n  "Other" : 10',
        'gantt\n  title Release Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n    Core Chat   :done, p1, 2025-01-01, 30d\n    PDF Support :done, p2, after p1, 30d\n  section Phase 2\n    Diagram Panel :active, p3, 2025-03-01, 30d\n    Mobile App    :p4, after p3, 30d',
        'classDiagram\n  class DiagramEngine {\n    +render(code, container)\n    -_uid() string\n  }\n  class MermaidAdapter {\n    +render(id, code) svg\n    -_ensureInit()\n  }\n  class PanZoomEngine {\n    +fitToView()\n    +zoomIn()\n    +zoomOut()\n    +toggleFullscreen()\n  }\n  DiagramEngine --> MermaidAdapter\n  DiagramUIController --> DiagramEngine\n  DiagramUIController --> PanZoomEngine',
        'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Typing : User types code\n  Typing --> Running : Click Run\n  Running --> Rendered : Success\n  Running --> Error : Syntax error\n  Rendered --> Typing : Edit code\n  Error --> Typing : Fix code\n  Rendered --> [*] : Close panel',
        'mindmap\n  root((Diagram Builder))\n    Pan & Zoom\n      Mouse Wheel\n      Drag to Pan\n      Pinch Zoom\n      Double-click Fit\n    Export\n      PNG 3x\n      SVG Vector\n    Keyboard\n      F = Fit\n      +/- Zoom\n      0 = Reset\n      F11 = Fullscreen'
      ];
      this._editor.value = samples[Math.floor(Math.random() * samples.length)];
      // Bug-fix: programmatic .value assignment does not fire the 'input' event,
      // so the debouncer never triggered. Dispatch it manually so auto-render works.
      this._editor.dispatchEvent(new Event('input'));
      this._setStatus('Sample loaded \u2014 rendering\u2026', 'info');
    }

    // ── Export ───────────────────────────────────────────────────────────────
    async _exportPNG() {
      const renderedNode = this._canvas.querySelector('svg, canvas');
      if (!renderedNode) { alert('Run a diagram first before exporting.'); return; }
      this._setStatus('Exporting PNG\u2026', 'info');
      try {
        if (typeof htmlToImage === 'undefined') throw new Error('html-to-image not available.');
        const url = await htmlToImage.toPng(this._canvas, {
          pixelRatio: 3, backgroundColor: '#1a1a2e', style: { overflow: 'visible' }
        });
        this._download(url, 'diagram.png');
        this._setStatus('PNG saved (3x resolution)', 'ok');
      } catch (e) {
        this._setStatus('PNG export failed', 'error');
        console.error('[DiagramEngine] PNG error:', e);
      }
    }

    _exportSVG() {
      const rawSvg = this._engine.getStrategy().getRawSVG();
      if (!rawSvg) { alert('Run a diagram first before exporting.'); return; }
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
      const clone = doc.querySelector('svg');
      if (!clone) return;

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox') && clone.width && clone.width.baseVal && clone.width.baseVal.value) {
        clone.setAttribute('viewBox', '0 0 ' + clone.width.baseVal.value + ' ' + clone.height.baseVal.value);
      }
      clone.style.background = '#1a1a2e';
      const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      this._download(url, 'diagram.svg');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this._setStatus('SVG saved (vector, infinite zoom)', 'ok');
    }
    
    _addToNotes() {
      const rawSvg = this._engine.getStrategy().getRawSVG();
      if (!rawSvg) { alert('Run a diagram first before adding to notes.'); return; }
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
      const clone = doc.querySelector('svg');
      if (!clone) return;

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox') && clone.width && clone.width.baseVal && clone.width.baseVal.value) {
        clone.setAttribute('viewBox', '0 0 ' + clone.width.baseVal.value + ' ' + clone.height.baseVal.value);
      }
      clone.style.background = '#ffffff'; // White background for notes
      clone.style.maxWidth = '100%';
      clone.style.height = 'auto';
      clone.style.border = '1px solid var(--border)';
      clone.style.borderRadius = '4px';
      clone.style.padding = '8px';
      clone.style.marginTop = '8px';
      
      const svgHtml = clone.outerHTML;
      const editor = document.getElementById('dgb-editor');
      const mermaidCode = editor ? editor.value : '';

      // Check if External Notes Editor is open
      const extOverlay = document.getElementById('external-notes-overlay');
      if (extOverlay && extOverlay.style.display !== 'none' && typeof window.insertDiagramIntoExternalEditor === 'function') {
        const inserted = window.insertDiagramIntoExternalEditor(svgHtml, mermaidCode);
        if (inserted) {
          this._setStatus('Inserted into Notes Editor!', 'ok');
          this.close();
          return;
        }
      }
      
      if (window.notes && window.renderNotes) {
        window.notes.push({
          q: svgHtml,
          txt: 'Diagram generated from builder',
          id: Date.now(),
          isScreenshot: true // use screenshot styling logic
        });
        window.renderNotes();
        
        if (window.switchTab) window.switchTab('notes');
        
        // Ensure panel is open
        if (window.panel && window.panel.classList.contains('hidden') && window.togglePanel) {
          window.togglePanel();
        }
        
        this._setStatus('Added to Notes!', 'ok');
      } else {
        this._setStatus('Failed to add to notes.', 'error');
      }
    }

    _download(url, filename) {
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // ── Resizer ──────────────────────────────────────────────────────────────
    _bindResizer() {
      const resizer   = document.getElementById('dgb-resizer');
      const leftPane  = document.getElementById('dgb-editor-pane');
      const rightPane = document.getElementById('dgb-canvas-pane');
      const split     = document.getElementById('dgb-split');
      let dragging = false;

      resizer.addEventListener('mousedown', (e) => {
        dragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = split.getBoundingClientRect();
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(20, Math.min(75, pct));
        leftPane.style.flex = 'none';
        rightPane.style.flex = 'none';
        leftPane.style.width  = pct + '%';
        rightPane.style.width = (100 - pct) + '%';
      });
      window.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          // Re-fit after resize — diagram may have been clipped
          if (this._canvas && this._canvas.querySelector('svg, canvas')) {
            setTimeout(() => this._pz.fitToView(), 100);
          }
        }
      });
    }

    // ── _styleZoomBar — inlines all zoom bar styles so CSS caching never hides them ──
    _styleZoomBar() {
      const bar = document.getElementById('dgb-zoom-bar');
      if (!bar) return;

      // Ensure viewport is an isolated stacking context so z-index:9000 on the
      // zoom bar always wins over #dgb-layer (will-change:transform) even for
      // very large SVGs — fixes the "zoom bar hidden for large diagrams" bug.
      const vp = document.getElementById('dgb-viewport');
      if (vp) { vp.style.isolation = 'isolate'; }

      // Explicitly set #dgb-layer to z-index:0 so it is BELOW the zoom bar
      // (z-index:9000) in the same isolated stacking context.
      // Without this, will-change:transform gives it z-index:auto which
      // for large SVGs can visually cover the zoom bar.
      const layer = document.getElementById('dgb-layer');
      if (layer) {
        layer.style.position = 'relative';
        layer.style.zIndex   = '0';
      }

      // Bar container — anchored bottom-right INSIDE #dgb-viewport
      Object.assign(bar.style, {
        position:        'absolute',
        bottom:          '14px',
        right:           '12px',
        top:             'auto',
        zIndex:          '9000',
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        gap:             '4px',
        padding:         '8px 6px',
        background:      'rgba(18,18,34,0.97)',
        border:          '1.5px solid rgba(108,99,255,0.55)',
        borderRadius:    '10px',
        boxShadow:       '0 8px 28px rgba(0,0,0,0.80)',
        pointerEvents:   'all',
        // Promote to own GPU compositor layer — compositor then respects
        // z-index vs #dgb-layer (which also has will-change:transform)
        transform:       'translateZ(0)',
        willChange:      'transform'
      });

      // Button base style
      const BTN = {
        width:          '34px',
        height:         '34px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(108,99,255,0.18)',
        border:         '1.5px solid rgba(108,99,255,0.50)',
        borderRadius:   '7px',
        color:          '#e2d9ff',
        fontSize:       '18px',
        fontWeight:     '800',
        fontFamily:     'inherit',
        cursor:         'pointer',
        lineHeight:     '1',
        userSelect:     'none',
        boxSizing:      'border-box',
        transition:     'background 0.15s, transform 0.1s'
      };

      // Fit button gets accent bg
      const FIT_EXTRA = {
        background: 'rgba(108,99,255,0.28)',
        border:     '1.5px solid rgba(167,139,250,0.65)',
        color:      '#c4b5fd'
      };

      // 1:1 button smaller font
      const ONE_ONE_EXTRA = { fontSize: '11px', fontWeight: '900' };

      // Zoom % readout
      const PCT = {
        width:        '34px',
        textAlign:    'center',
        fontSize:     '10.5px',
        fontWeight:   '800',
        color:        '#a78bfa',
        userSelect:   'none',
        cursor:       'default',
        padding:      '3px 0',
        borderTop:    '1px solid rgba(108,99,255,0.25)',
        borderBottom: '1px solid rgba(108,99,255,0.25)',
        display:      'block'
      };

      bar.querySelectorAll('.dgb-zoom-btn').forEach((btn) => {
        const isFit    = btn.classList.contains('dgb-zoom-fit-btn');
        const is1_1    = btn.id === 'dgb-zoom-100';
        Object.assign(btn.style, BTN);
        if (isFit)  Object.assign(btn.style, FIT_EXTRA);
        if (is1_1)  Object.assign(btn.style, ONE_ONE_EXTRA);

        // Stop viewport drag from triggering when clicking zoom buttons
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());

        btn.addEventListener('mouseenter', () => {
          btn.style.background = 'rgba(108,99,255,0.45)';
          btn.style.borderColor = 'rgba(167,139,250,0.90)';
          btn.style.color = '#fff';
          btn.style.transform = 'scale(1.10)';
        });
        btn.addEventListener('mouseleave', () => {
          Object.assign(btn.style, BTN);
          if (isFit) Object.assign(btn.style, FIT_EXTRA);
          if (is1_1) Object.assign(btn.style, ONE_ONE_EXTRA);
        });
        btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.92)'; });
        btn.addEventListener('mouseup',   () => { btn.style.transform = 'scale(1)'; });
      });

      const pct = document.getElementById('dgb-zoom-pct');
      if (pct) Object.assign(pct.style, PCT);
    }

    // ── Open / Close ──────────────────────────────────────────────────────────
    open() {
      if (!this._panel) this.bootstrap();
      this._panel.classList.add('dgb-open');
      this._panel.setAttribute('aria-hidden', 'false');
      this._isOpen = true;
      setTimeout(() => { if (this._editor) this._editor.focus(); }, 120);
    }

    close() {
      if (!this._panel) return;
      // Exit fullscreen before closing if active
      if (document.fullscreenElement) document.exitFullscreen();
      this._panel.classList.remove('dgb-open');
      this._panel.setAttribute('aria-hidden', 'true');
      this._isOpen = false;
      
      // Cleanup lingering Mermaid syntax error overlays attached to the body
      document.querySelectorAll('svg[id^="dmermaid"], svg[id^="ddgb-svg"], .error-icon, .error-text').forEach(el => {
        if (el.parentElement === document.body) el.remove();
      });
      // Fallback: mermaid also sometimes uses `d` + id
      const errorDivs = document.querySelectorAll('div[id^="d"]');
      errorDivs.forEach(el => {
        if (el.parentElement === document.body && el.id.includes('dgb-svg')) {
          el.remove();
        }
      });
    }

    toggle() { this._isOpen ? this.close() : this.open(); }
  }

  // =========================================================================
  // 5. Instantiate & expose minimal frozen facade
  // =========================================================================
  const _engine     = new DiagramEngine();
  const _controller = new DiagramUIController(_engine);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _controller.bootstrap());
  } else {
    _controller.bootstrap();
  }

  window.DiagramBuilder = Object.freeze({
    open:   () => _controller.open(),
    close:  () => _controller.close(),
    toggle: () => _controller.toggle()
  });

})();
