/**
 * AuraReader Performance Monitor API (Robust V2)
 *
 * Implements a Plugin Architecture for modular telemetry tracking.
 * Strictly adheres to SOLID principles (Single Responsibility, Open/Closed, Dependency Inversion).
 */

// --- PLUGINS ---

class TelemetryPlugin {
  constructor() { this.name = 'BasePlugin'; }
  start() { } stop() { } gather(metrics) { }
}

class FPSTracker extends TelemetryPlugin {
  constructor() {
    super(); this.name = 'fps'; this._frameCount = 0; this._lastTime = 0;
  }
  start() { this._frameCount = 0; this._lastTime = performance.now(); }
  gather(metrics, timestamp) {
    this._frameCount++;
    const elapsed = timestamp - this._lastTime;
    if (elapsed >= 500) {
      metrics.fps = Math.round((this._frameCount * 1000) / elapsed);
      this._frameCount = 0; this._lastTime = timestamp;
      return true;
    }
    return false;
  }
}

class MemoryTracker extends TelemetryPlugin {
  constructor() { super(); this.name = 'memory'; }
  gather(metrics) {
    if (performance.memory) metrics.jsHeapMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
    else metrics.jsHeapMB = 'N/A';
  }
}

class ResourceTracker extends TelemetryPlugin {
  constructor() { super(); this.name = 'resources'; }
  gather(metrics) {
    const resources = performance.getEntriesByType('resource');
    metrics.resourceCount = resources.length;
    let payloadBytes = 0;
    for (let i = 0; i < resources.length; i++) payloadBytes += (resources[i].transferSize || resources[i].decodedBodySize || 0);
    metrics.resourcePayloadMB = (payloadBytes / 1048576).toFixed(2);
  }
}

class PdfDomTracker extends TelemetryPlugin {
  constructor() { super(); this.name = 'pdf_dom'; this._isGathering = false; }
  gather(metrics) {
    if (this._isGathering) return;
    this._isGathering = true;
    const updateDom = () => {
      try {
        const contentEl = document.getElementById('content');
        if (contentEl) {
          metrics.domNodes = contentEl.getElementsByTagName('*').length;
          const wrappers = contentEl.getElementsByClassName('pdf-page-wrapper');
          let canvasCount = 0, totalBytes = 0;
          for (let i = 0; i < wrappers.length; i++) {
            const canvases = wrappers[i].getElementsByTagName('canvas');
            if (canvases.length > 0) {
              canvasCount++;
              const w = canvases[0].width || 0;
              const h = canvases[0].height || 0;
              totalBytes += (w * h * 4); // 4 bytes per pixel (RGBA)
            }
          }
          metrics.activeCanvases = canvasCount;
          metrics.estimatedRamMB = (totalBytes / 1048576).toFixed(2);
        }
      } finally { this._isGathering = false; }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(updateDom, { timeout: 1000 });
    else setTimeout(updateDom, 0);
  }
}

class MarkdownPerfTracker extends TelemetryPlugin {
  constructor() { super(); this.name = 'md_perf'; this._isGathering = false; }
  gather(metrics) {
    if (this._isGathering) return;
    this._isGathering = true;
    const updateDom = () => {
      try {
        const contentEl = document.getElementById('content');
        if (contentEl) {
          metrics.domNodes = contentEl.getElementsByTagName('*').length;
        }
      } finally { this._isGathering = false; }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(updateDom, { timeout: 1000 });
    else setTimeout(updateDom, 0);
  }
}

class EpubPerfTracker extends TelemetryPlugin {
  constructor() { super(); this.name = 'epub_perf'; this._isGathering = false; }
  gather(metrics) {
    if (this._isGathering) return;
    this._isGathering = true;
    const updateDom = () => {
      try {
        const contentEl = document.getElementById('content');
        if (contentEl) {
          metrics.domNodes = contentEl.getElementsByTagName('*').length;
          const iframes = contentEl.getElementsByTagName('iframe');
          metrics.epubIframes = iframes.length;
        }
      } finally { this._isGathering = false; }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(updateDom, { timeout: 1000 });
    else setTimeout(updateDom, 0);
  }
}

class ApiTracker extends TelemetryPlugin {
  constructor() {
    super(); this.name = 'api'; this.originalFetch = null; this.apiCalls = 0;
    this.latencies = []; this.maxBufferSize = 50; this.enabled = true; this._lastTime = 0;
  }
  start() {
    if (this.originalFetch) return;
    this.originalFetch = window.fetch;
    const self = this;
    window.fetch = async function (...args) {
      if (!self.enabled) return self.originalFetch.apply(this, args);
      const start = performance.now();
      try {
        const response = await self.originalFetch.apply(this, args);
        const duration = performance.now() - start;
        self._recordLatency(duration);
        
        // Track AI Latency specifically
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url && (url.includes('/api/ai') || url.includes('/chat') || url.includes('/completion'))) {
            if (window.AuraPerf && window.AuraPerf.core && window.AuraPerf.core.metrics) {
                window.AuraPerf.core.metrics.aiLatencyMs = duration.toFixed(1);
            }
        } else if (url && url.includes('/api/rag')) {
            if (window.AuraPerf && window.AuraPerf.core && window.AuraPerf.core.metrics) {
                window.AuraPerf.core.metrics.ragLatencyMs = duration.toFixed(1);
            }
        }
        
        return response;
      } catch (err) {
        self._recordLatency(performance.now() - start);
        throw err;
      }
    };
  }
  stop() {
    if (this.originalFetch) { window.fetch = this.originalFetch; this.originalFetch = null; }
  }
  _recordLatency(timeMs) {
    this.apiCalls++; this.latencies.push(timeMs);
    if (this.latencies.length > this.maxBufferSize) this.latencies.shift();
  }
  gather(metrics) {
    metrics.apiCount = this.apiCalls;
    if (this.latencies.length === 0) metrics.apiLatencyMs = 0;
    else metrics.apiLatencyMs = (this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length).toFixed(1);
    
    // Ensure aiLatencyMs is initialized if not set yet
    if (metrics.aiLatencyMs === undefined) metrics.aiLatencyMs = 0;
  }
}

// --- CORE ORCHESTRATOR ---

class TelemetryProfile {
  constructor(name) { this.name = name; this.stats = []; this.plugins = []; }
  getStats() { return this.stats; }
  getPlugins() { return this.plugins; }
}

class PdfTelemetryProfile extends TelemetryProfile {
  constructor() {
    super('pdf');
    this.plugins = [new FPSTracker(), new MemoryTracker(), new ResourceTracker(), new PdfDomTracker(), new ApiTracker()];
    this.stats = [
      { id: 'fps', label: 'Speed (FPS)', tooltip: 'How smooth the app is running. 60 FPS is perfect!' },
      { id: 'domNodes', label: 'DOM Nodes', tooltip: 'Total HTML elements currently on the page.' },
      { id: 'jsHeapMB', label: 'JS Heap', tooltip: "Actual computer memory used by the app's logic.", formatter: v => v + ' MB' },
      { id: 'resourceCount', label: 'Resources', tooltip: 'Number of files downloaded.' },
      { id: 'activeCanvases', label: 'PDF Canvases', tooltip: 'Number of actively rendered PDF canvases.' },
      { id: 'estimatedRamMB', label: 'PDF RAM (Est.)', tooltip: 'Estimated RAM used by PDF canvases.', formatter: v => v + ' MB' },
      { id: 'lastRenderTimeMs', label: 'PDF Render Time', tooltip: 'Time taken to render the last PDF page.', formatter: v => v + ' ms' },
      { id: 'aiLatencyMs', label: 'AI Latency', tooltip: 'Time taken for the last AI response.', formatter: v => v > 0 ? v + ' ms' : 'N/A' },
      { id: 'apiLatencyMs', label: 'API Latency', tooltip: 'Average API latency (ms).', formatter: v => v + ' ms' }
    ];
  }
}

class MarkdownTelemetryProfile extends TelemetryProfile {
  constructor() {
    super('md');
    this.plugins = [new FPSTracker(), new MemoryTracker(), new ResourceTracker(), new MarkdownPerfTracker(), new ApiTracker()];
    this.stats = [
      { id: 'fps', label: 'Speed (FPS)', tooltip: 'How smooth the app is running.' },
      { id: 'domNodes', label: 'DOM Nodes', tooltip: 'Total HTML elements currently on the page.' },
      { id: 'jsHeapMB', label: 'JS Heap', tooltip: "Actual computer memory used.", formatter: v => v + ' MB' },
      { id: 'mdParseTimeMs', label: 'MD Parse Time', tooltip: 'Time taken by marked.js to parse text.', formatter: v => v > 0 ? v + ' ms' : 'N/A' },
      { id: 'mathRenderTimeMs', label: 'Math Rendering', tooltip: 'Time taken by KaTeX to parse math.', formatter: v => v > 0 ? v + ' ms' : 'N/A' },
      { id: 'aiLatencyMs', label: 'AI Latency', tooltip: 'Time taken for the last AI response.', formatter: v => v > 0 ? v + ' ms' : 'N/A' },
      { id: 'apiLatencyMs', label: 'API Latency', tooltip: 'Average API latency (ms).', formatter: v => v + ' ms' }
    ];
  }
}

class EpubTelemetryProfile extends TelemetryProfile {
  constructor() {
    super('epub');
    this.plugins = [new FPSTracker(), new MemoryTracker(), new ResourceTracker(), new EpubPerfTracker(), new ApiTracker()];
    this.stats = [
      { id: 'fps', label: 'Speed (FPS)', tooltip: 'How smooth the app is running.' },
      { id: 'domNodes', label: 'DOM Nodes', tooltip: 'Total HTML elements currently on the page.' },
      { id: 'epubIframes', label: 'Active iFrames', tooltip: 'Number of chapter iframes loaded by epub.js.' },
      { id: 'jsHeapMB', label: 'JS Heap', tooltip: "Actual computer memory used.", formatter: v => v + ' MB' },
      { id: 'epubReflowTimeMs', label: 'Reflow Latency', tooltip: 'Time taken to paginate or reflow columns.', formatter: v => v > 0 ? v + ' ms' : 'N/A' },
      { id: 'aiLatencyMs', label: 'AI Latency', tooltip: 'Time taken for the last AI response.', formatter: v => v > 0 ? v + ' ms' : 'N/A' }
    ];
  }
}

class PerformanceCore {
  constructor() {
    this.isActive = false;
    this.metrics = {
      fps: 0, activeCanvases: 0, domNodes: 0, estimatedRamMB: 0,
      jsHeapMB: 'N/A', resourceCount: 0, resourcePayloadMB: 0,
      lastRenderTimeMs: 0, apiCount: 0, apiLatencyMs: 0,
      ragLatencyMs: 0, mathRenderTimeMs: 0, mdParseTimeMs: 0,
      epubIframes: 0, epubReflowTimeMs: 0
    };
    this.plugins = [];
    this.customStats = []; // Dynamically populated by profile
    this.uiCallback = null; this._rafId = null; this.telemetryLevel = 2;
    this.currentProfile = null;
  }
  
  setActiveProfile(profile) {
    let wasActive = this.isActive;
    if (wasActive) this.stop();
    
    this.currentProfile = profile;
    this.plugins = profile.getPlugins();
    this.customStats = profile.getStats();
    
    // Notify UI to rebuild
    if (window.AuraPerf && window.AuraPerf.ui) {
        window.AuraPerf.ui.rebuild();
    }
    
    if (wasActive) this.start(this.uiCallback);
  }

  setTelemetryLevel(level) {
    this.telemetryLevel = parseInt(level, 10);
    this.plugins.forEach(p => {
      if (p.name === 'api') p.enabled = (this.telemetryLevel > 0);
    });
    const lbl = document.getElementById('pd-telemetry-lbl');
    if (lbl) {
      if (this.telemetryLevel === 0) lbl.textContent = 'Minimal';
      else if (this.telemetryLevel === 1) lbl.textContent = 'Basic';
      else lbl.textContent = 'Full';
    }
  }
  start(callback) {
    if (this.isActive) return;
    this.isActive = true; this.uiCallback = callback;
    this.plugins.forEach(p => p.start && p.start());
    const loop = (timestamp) => {
      if (!this.isActive) return;
      let shouldUpdateUI = false;
      this.plugins.forEach(p => { if (p.gather(this.metrics, timestamp)) shouldUpdateUI = true; });
      if (shouldUpdateUI && this.uiCallback) this.uiCallback(this.metrics);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }
  stop() {
    this.isActive = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this.plugins.forEach(p => p.stop && p.stop());
  }
  logRender(timeMs) { this.metrics.lastRenderTimeMs = timeMs.toFixed(1); }
  logMdParse(timeMs) { this.metrics.mdParseTimeMs = timeMs.toFixed(1); }
  logEpubReflow(timeMs) { this.metrics.epubReflowTimeMs = timeMs.toFixed(1); }
  recordFormatTime(ms) { this.metrics.mathRenderTimeMs = ms.toFixed(1); }
}


// --- UNIVERSAL UI FACTORY ---
class PerfDashboardUI {
  constructor(core) {
    this.core = core;
    this.isMounted = false;
    this.isVisible = false;
    this.container = null;
  }
  
  rebuild() {
    if (this.isMounted && this.container) {
        let customHTML = '';
        if (this.core.customStats && this.core.customStats.length > 0) {
          for (const stat of this.core.customStats) {
            customHTML += `<div class="perf-stat" data-tooltip="${stat.tooltip}"><span>${stat.label}:</span> <strong id="${stat.id}">N/A</strong></div>`;
          }
        }
        const bodyEl = this.container.querySelector('.perf-body');
        if (bodyEl) bodyEl.innerHTML = customHTML;
    }
  }

  injectStyles() {
    if (document.getElementById('perf-dashboard-style')) return;
    const style = document.createElement('style');
    style.id = 'perf-dashboard-style';
    style.innerHTML = `
      .universal-perf-dashboard {
        position: fixed; bottom: 24px; right: 24px; width: 280px;
        background: rgba(30, 41, 59, 0.95); border: 1px solid #334155;
        border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        z-index: 999999; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        color: #f8fafc; font-family: sans-serif;
        animation: slideUpFade 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: none;
      }
      .universal-perf-dashboard.minimized .perf-body {
        display: none !important;
      }
      @keyframes slideUpFade {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .universal-perf-dashboard .perf-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 16px; border-bottom: 1px solid #334155;
        background: rgba(255, 255, 255, 0.02);
      }
      .universal-perf-dashboard .perf-body {
        padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;
      }
      .universal-perf-dashboard .perf-stat {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 13px; color: #cbd5e1; position: relative; cursor: help;
      }
      .universal-perf-dashboard .perf-stat strong {
        color: #6c63ff; font-family: monospace; font-weight: 600;
      }
      .universal-perf-dashboard .perf-stat[data-tooltip]:hover::after {
        content: attr(data-tooltip); position: absolute; right: calc(100% + 15px); top: 50%;
        transform: translateY(-50%); background: #f8fafc; color: #0f172a;
        padding: 6px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap;
        pointer-events: none; z-index: 9999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
      .universal-perf-dashboard .perf-stat[data-tooltip]:hover::before {
        content: ''; position: absolute; right: 100%; top: 50%;
        transform: translateY(-50%); border-width: 6px; border-style: solid;
        border-color: transparent transparent transparent #f8fafc; pointer-events: none; z-index: 9999999;
      }
    `;
    document.head.appendChild(style);
  }

  injectHTML() {
    if (document.getElementById('universal-perf-dashboard')) return;
    this.container = document.createElement('div');
    this.container.id = 'universal-perf-dashboard';
    this.container.className = 'universal-perf-dashboard';

    let customHTML = '';
    if (this.core.customStats && this.core.customStats.length > 0) {
      for (const stat of this.core.customStats) {
        customHTML += `<div class="perf-stat" data-tooltip="${stat.tooltip}"><span>${stat.label}:</span> <strong id="${stat.id}">N/A</strong></div>`;
      }
    }

    this.container.innerHTML = `
      <div class="perf-header">
        <h4 style="margin:0;font-size:14px;pointer-events:none;">AuraPerf Telemetry</h4>
        <div style="display:flex; gap:8px;">
           <button onclick="document.getElementById('universal-perf-dashboard').classList.toggle('minimized')" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:16px;line-height:1;" title="Minimize/Restore">&ndash;</button>
           <button onclick="window.AuraPerf.toggleUI(false)" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:16px;line-height:1;" title="Close">&times;</button>
        </div>
      </div>
      <div class="perf-body">
        ${customHTML}
      </div>
    `;
    document.body.appendChild(this.container);
    
    const header = this.container.querySelector('.perf-header');
    header.style.cursor = 'move';
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    header.addEventListener('pointerdown', (e) => {
        if (e.target.tagName.toLowerCase() === 'button') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.container.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        this.container.style.bottom = 'auto';
        this.container.style.right = 'auto';
        this.container.style.left = initialLeft + 'px';
        this.container.style.top = initialTop + 'px';
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.container.style.left = (initialLeft + dx) + 'px';
        this.container.style.top = (initialTop + dy) + 'px';
    });

    header.addEventListener('pointerup', (e) => {
        isDragging = false;
        header.releasePointerCapture(e.pointerId);
    });
    
    this.isMounted = true;
  }

  updateDOM(metrics) {
    if (!this.isVisible || !this.isMounted) return;

    const write = (id, val) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(val)) {
        el.textContent = val;
      }
    };

    if (this.core.customStats) {
      for (const stat of this.core.customStats) {
        if (metrics[stat.id] !== undefined) {
          write(stat.id, stat.formatter ? stat.formatter(metrics[stat.id]) : metrics[stat.id]);
        }
      }
    }
  }

  toggle(forceState) {
    this.isVisible = typeof forceState === 'boolean' ? forceState : !this.isVisible;
    if (this.isVisible) {
      if (!this.isMounted) {
        this.injectStyles();
        this.injectHTML();
      }
      this.container.style.display = 'block';
      this.core.start((metrics) => this.updateDOM(metrics));
    } else {
      if (this.container) this.container.style.display = 'none';
      this.core.stop();
    }
  }
}
const core = new PerformanceCore();
const dashUI = new PerfDashboardUI(core);
window.AuraPerf = core;
window.AuraPerf.ui = dashUI;
window.AuraPerf.toggleUI = (forceState) => dashUI.toggle(forceState);
window.AuraPerf.PdfTelemetryProfile = PdfTelemetryProfile;
window.AuraPerf.MarkdownTelemetryProfile = MarkdownTelemetryProfile;
window.AuraPerf.EpubTelemetryProfile = EpubTelemetryProfile;
window.AuraPerf.setActiveProfile(new PdfTelemetryProfile()); // default

window.exportUITrace = function() {
    if (!window.uiTrace || window.uiTrace.length === 0) {
      alert("No UI trace logs to export yet.");
      return;
    }

    if (typeof JSZip !== 'undefined') {
      var zip = new JSZip();
      var traceCopy = JSON.parse(JSON.stringify(window.uiTrace));
      var imgFolder = zip.folder("screenshots");
      
      traceCopy.forEach(function(entry, idx) {
        if (entry.image) {
          var base64Data = entry.image.split(',')[1];
          if (base64Data) {
            var filename = "screenshot_" + Math.round(entry.t) + "ms_" + idx + ".jpg";
            imgFolder.file(filename, base64Data, {base64: true});
            entry.image = "[Saved to screenshots/" + filename + "]";
          }
        }
      });
      
      zip.file("ui-trace.json", JSON.stringify(traceCopy, null, 2));
      
      zip.generateAsync({type:"blob"}).then(function(content) {
        var url = URL.createObjectURL(content);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ui-trace-' + Date.now() + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    } else {
      var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.uiTrace, null, 2));
      var dlAnchorElem = document.createElement('a');
      dlAnchorElem.setAttribute("href", dataStr);
      dlAnchorElem.setAttribute("download", "ui-trace-" + Date.now() + ".json");
      document.body.appendChild(dlAnchorElem);
      dlAnchorElem.click();
      document.body.removeChild(dlAnchorElem);
    }
  };
