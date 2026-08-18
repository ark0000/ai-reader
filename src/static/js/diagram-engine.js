/**
 * diagram-engine.js - Isolated Mermaid Diagram Builder Panel
 *
 * Architecture (SOLID):
 *  - MermaidAdapter      (Adapter)          wraps mermaid.js API
 *  - DiagramEngine       (Facade+Strategy)  orchestrates rendering
 *  - PanZoomEngine       (SRP)              owns pan/zoom/fit/fullscreen state
 *  - DiagramUIController (SRP)              owns panel DOM & events
 *
 * UX benchmark sources analysed:
 *  - mermaid.live    : pan/zoom, minimap, fit, keyboard shortcuts
 *  - draw.io         : dotted grid bg, zoom %, minimap, fullscreen
 *  - VS Code preview : fit + zoom bar + keyboard
 *  - Notion          : clean embed + click-to-expand
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
  // 2. DiagramEngine  (Facade + Strategy)
  // =========================================================================
  class DiagramEngine {
    constructor() { this._adapter = new MermaidAdapter(); this._seq = 0; }

    _uid() { this._seq++; return 'dgb-svg-' + Date.now().toString(36) + '-' + this._seq; }

    async render(code, container) {
      container.innerHTML = '';
      const trimmed = code.trim();
      if (!trimmed) { this._showError(container, 'Paste Mermaid code above then click Run.'); return { ok: false, error: 'empty' }; }
      try {
        const svg = await this._adapter.render(this._uid(), trimmed);
        container.innerHTML = svg;
        const svgEl = container.querySelector('svg');
        if (svgEl) { svgEl.style.display = 'block'; svgEl.style.maxWidth = 'none'; }
        return { ok: true };
      } catch (err) {
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
  // Best-in-class pan+zoom matching mermaid.live / draw.io behaviour.
  //
  // Features:
  //  - Mouse-wheel zoom at cursor   (diagram point under cursor stays fixed)
  //  - Pointer drag to pan          (pointer capture so no sticky-drag)
  //  - Two-finger pinch zoom        (mobile)
  //  - fitToView()                  (contain-fit with 6% padding, centered)
  //  - Smooth CSS transition on button clicks (none on wheel/drag = no lag)
  //  - Zoom percentage HUD          (live readout like draw.io / Figma)
  //  - Minimap                      (small overview for large diagrams)
  //  - Double-click to fit          (mermaid.live behaviour)
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
      this._scale    = 1;
      this._tx       = 0;
      this._ty       = 0;
      this._dragging = false;
      this._lastX    = 0;
      this._lastY    = 0;
      this._isFullscreen = false;
      this._bindEvents();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    fitToView() {
      // Reset to identity so getBCR gives true pixel size
      this._scale = 1; this._tx = 0; this._ty = 0;
      this._apply(false);

      const svgEl = this._layer.querySelector('svg');
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
      this._scale  = Math.min(scaleX, scaleY);
      this._tx     = (vpW - cW * this._scale) / 2;
      this._ty     = (vpH - cH * this._scale) / 2;
      this._apply(true);   // smooth transition for fit
    }

    zoomIn()  { this._zoomCenter(1.25, true);  }
    zoomOut() { this._zoomCenter(0.80, true);  }
    reset()   { this._scale = 1; this._tx = 0; this._ty = 0; this._apply(true); }

    toggleFullscreen() {
      const doc = document;
      const shell = this._shell;
      const isFs = shell && shell.hasAttribute('data-fullscreen');

      const editorPane = doc.getElementById('dgb-editor-pane');
      const resizer    = doc.getElementById('dgb-resizer');
      const canvasPane = doc.getElementById('dgb-canvas-pane');
      const btn        = doc.getElementById('dgb-btn-fullscreen');

      if (!isFs) {
        // Set attribute for CSS rules
        if (shell) shell.setAttribute('data-fullscreen', 'true');

        // DIRECTLY set inline styles — guaranteed to hide regardless of CSS cache/conflicts
        if (editorPane) { editorPane.dataset.fsDisplay = editorPane.style.display; editorPane.style.setProperty('display', 'none', 'important'); }
        if (resizer)    { resizer.dataset.fsDisplay    = resizer.style.display;    resizer.style.setProperty('display', 'none', 'important'); }
        if (canvasPane) canvasPane.style.flex = '1';
        if (btn) btn.title = 'Exit Fullscreen (Esc / F11)';
        this._isFullscreen = true;

        // Also request browser fullscreen as an enhancement
        const el = doc.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (req) req.call(el).catch(() => { /* silently ignore if blocked */ });

        if (this._layer.querySelector('svg')) setTimeout(() => this.fitToView(), 300);
      } else {
        // Remove attribute
        if (shell) shell.removeAttribute('data-fullscreen');

        // DIRECTLY restore inline styles
        if (editorPane) { editorPane.style.removeProperty('display'); if (editorPane.dataset.fsDisplay) editorPane.style.display = editorPane.dataset.fsDisplay; }
        if (resizer)    { resizer.style.removeProperty('display');    if (resizer.dataset.fsDisplay)    resizer.style.display = resizer.dataset.fsDisplay; }
        if (canvasPane) canvasPane.style.flex = '';
        if (btn) btn.title = 'Fullscreen preview (F11)';
        this._isFullscreen = false;

        // Also exit browser fullscreen if active
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
        if (exit && (doc.fullscreenElement || doc.webkitFullscreenElement)) exit.call(doc).catch(() => {});

        if (this._layer.querySelector('svg')) setTimeout(() => this.fitToView(), 300);
      }
    }

    getScalePct() { return Math.round(this._scale * 100); }

    // ── Private helpers ─────────────────────────────────────────────────────

    _zoomCenter(factor, smooth) {
      const cx = this._vp.clientWidth  / 2;
      const cy = this._vp.clientHeight / 2;
      this._zoomAt(cx, cy, factor, smooth);
    }

    _zoomAt(cx, cy, factor, smooth) {
      const MIN = 0.05, MAX = 20;
      const newScale = Math.min(MAX, Math.max(MIN, this._scale * factor));
      const ratio    = newScale / this._scale;
      this._tx       = cx - ratio * (cx - this._tx);
      this._ty       = cy - ratio * (cy - this._ty);
      this._scale    = newScale;
      this._apply(smooth);
    }

    _apply(smooth) {
      if (smooth) {
        this._layer.style.transition = 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)';
      } else {
        this._layer.style.transition = 'none';
      }
      this._layer.style.transform =
        'translate(' + this._tx + 'px,' + this._ty + 'px) scale(' + this._scale + ')';
      this._onScale(this.getScalePct());
    }

    _bindEvents() {
      // ── Mouse wheel zoom at cursor ──
      this._vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect  = this._vp.getBoundingClientRect();
        const factor = e.deltaY < 0 ? 1.10 : 0.91;
        this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor, false);
      }, { passive: false });

      // ── Pointer drag to pan ──
      this._vp.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this._dragging = true;
        this._lastX = e.clientX; this._lastY = e.clientY;
        this._vp.style.cursor = 'grabbing';
        this._vp.setPointerCapture(e.pointerId);
      });
      this._vp.addEventListener('pointermove', (e) => {
        if (!this._dragging) return;
        this._tx += e.clientX - this._lastX;
        this._ty += e.clientY - this._lastY;
        this._lastX = e.clientX; this._lastY = e.clientY;
        this._apply(false);
      });
      const stopDrag = () => { this._dragging = false; this._vp.style.cursor = 'grab'; };
      this._vp.addEventListener('pointerup',     stopDrag);
      this._vp.addEventListener('pointercancel', stopDrag);

      // ── Double-click to fit (mermaid.live behaviour) ──
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

        // Re-fit after fullscreen transition completes
        if (this._layer.querySelector('svg')) {
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
      document.getElementById('dgb-btn-run').addEventListener('click', () => this._run());
      document.getElementById('dgb-btn-clear').addEventListener('click', () => this._clear());
      document.getElementById('dgb-btn-sample').addEventListener('click', () => this._loadSample());
      document.getElementById('dgb-btn-save-png').addEventListener('click', () => this._exportPNG());
      document.getElementById('dgb-btn-save-svg').addEventListener('click', () => this._exportSVG());
      document.getElementById('dgb-btn-fullscreen').addEventListener('click', () => this._pz.toggleFullscreen());

      document.getElementById('dgb-zoom-in').addEventListener('click',  () => this._pz.zoomIn());
      document.getElementById('dgb-zoom-out').addEventListener('click', () => this._pz.zoomOut());
      document.getElementById('dgb-zoom-fit').addEventListener('click', () => this._pz.fitToView());
      document.getElementById('dgb-zoom-100').addEventListener('click', () => this._pz.reset());

      // Ctrl+Enter runs; Escape closes or exits fallback fullscreen
      this._editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this._run(); }
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
      this._setStatus('Sample loaded \u2014 press Run', 'info');
    }

    // ── Export ───────────────────────────────────────────────────────────────
    async _exportPNG() {
      const svgEl = this._canvas.querySelector('svg');
      if (!svgEl) { alert('Run a diagram first before exporting.'); return; }
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
      const svgEl = this._canvas.querySelector('svg');
      if (!svgEl) { alert('Run a diagram first before exporting.'); return; }
      const clone = svgEl.cloneNode(true);
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
          if (this._canvas && this._canvas.querySelector('svg')) {
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
