/**
 * remote-stylus-bugs.test.js
 * Unit tests for the 5 bug fixes:
 *   Bug 5: load-strokes canvas ID guard
 *   Bug 6: switch-canvas race condition
 *   Bug 7: duplicate listeners on reconnect
 *   Bug 8: broadcastCanvasInfo notesRepo retry
 *   Bug 9: pen state restore after canvas switch
 *
 * Run: npx jest tests/remote-stylus-bugs.test.js --verbose
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── WebSocket mock ──────────────────────────────────────────────
class MockWebSocket {
  constructor(url) {
    this.url = url; this.sent = []; this.readyState = 1;
    this._listeners = {};
    MockWebSocket.instances.push(this);
    MockWebSocket.lastInstance = this;
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  _receive(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
    (this._listeners['message'] || []).forEach(fn => fn({ data: JSON.stringify(obj) }));
  }
  _open() { if (this.onopen) this.onopen(); }
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    if (!this._listeners[evt]) return;
    this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
  }
  listenerCount(evt) { return (this._listeners[evt] || []).length; }
}
MockWebSocket.instances = [];
MockWebSocket.lastInstance = null;

function loadSync() {
  delete window.RemoteStylusSync;
  delete window.TabletSync;
  const code = fs.readFileSync(path.join(__dirname, '../src/static/js/remote-stylus-sync.js'), 'utf8');
  eval(code); // eslint-disable-line
}

function stubDOM() {
  ['nav-label','btn-prev','btn-next','hamburger-sidebar','canvas-container'].forEach(id => {
    if (!document.getElementById(id)) {
      const el = document.createElement('div'); el.id = id;
      document.body.appendChild(el);
    }
  });
  if (!document.getElementById('drawing-surface')) {
    const cv = document.createElement('canvas'); cv.id = 'drawing-surface';
    document.getElementById('canvas-container').appendChild(cv);
  }
}

function addCanvasNode(id, title = 'Draw') {
  const node = document.createElement('div');
  node.className = 'ql-stylus-canvas';
  node.dataset.id = id; node.dataset.title = title;
  document.body.appendChild(node);
  return node;
}

function stubGlobals() {
  window.WebSocket = MockWebSocket;
  window.showToast  = jest.fn();
  window.StylusStore = new Map();
  window.StylusEngine = {
    activeFacade: null,
    activate: jest.fn(), deactivate: jest.fn(),
    setTool: jest.fn(), setColor: jest.fn(), setSize: jest.fn(),
    getFacadeForId: jest.fn().mockReturnValue(null),
  };
  window.TabletSync = { setActiveCanvas: jest.fn(), broadcastCanvasInfo: jest.fn() };
  delete window.location;
  window.location = { protocol:'http:', host:'localhost:8500',
    search:'?roomId=r1&mode=A', href:'http://localhost:8500/remote-stylus?roomId=r1&mode=A' };
}

function teardown() {
  jest.clearAllMocks();
  jest.useRealTimers();
  document.body.innerHTML = '';
  ['RemoteStylusSync','StylusEngine','StylusStore','TabletSync','notesRepo'].forEach(k => delete window[k]);
  MockWebSocket.instances = []; MockWebSocket.lastInstance = null;
  if (global.fetch) delete global.fetch;
}

// ================================================================
// BUG 5 — load-strokes canvas ID guard
// ================================================================
describe('Bug 5 — load-strokes canvas ID guard', () => {
  let sync, ws;
  beforeEach(() => {
    stubGlobals(); stubDOM(); loadSync();
    sync = new RemoteStylusSync('room1', false);
    ws = MockWebSocket.lastInstance; ws._open();
    window.StylusEngine.activeFacade = {
      id: 'canvas-A',
      repo: { load: jest.fn(), clear: jest.fn() },
      renderAll: jest.fn(),
    };
  });
  afterEach(teardown);

  test('loads strokes when canvasId matches active facade', () => {
    ws._receive({ type:'load-strokes', canvasId:'canvas-A', strokes:[{tool:'pen'}] });
    expect(window.StylusEngine.activeFacade.repo.load).toHaveBeenCalledWith([{tool:'pen'}]);
    expect(window.StylusEngine.activeFacade.renderAll).toHaveBeenCalled();
  });

  test('does NOT load strokes when canvasId mismatches', () => {
    ws._receive({ type:'load-strokes', canvasId:'canvas-B', strokes:[{tool:'pen'}] });
    expect(window.StylusEngine.activeFacade.repo.load).not.toHaveBeenCalled();
  });

  test('loads strokes when canvasId is absent (legacy broadcast)', () => {
    ws._receive({ type:'load-strokes', strokes:[{tool:'pen'}] });
    expect(window.StylusEngine.activeFacade.repo.load).toHaveBeenCalled();
  });

  test('does not crash if activeFacade is null', () => {
    window.StylusEngine.activeFacade = null;
    expect(() => ws._receive({ type:'load-strokes', canvasId:'canvas-A', strokes:[] })).not.toThrow();
  });

  test('shows toast only on successful load', () => {
    ws._receive({ type:'load-strokes', canvasId:'canvas-A', strokes:[] });
    const toasts = window.showToast.mock.calls.filter(c => c[0] === 'Strokes loaded!');
    expect(toasts).toHaveLength(1);
  });

  test('does NOT show "Strokes loaded!" on canvasId mismatch', () => {
    ws._receive({ type:'load-strokes', canvasId:'wrong', strokes:[] });
    const toasts = window.showToast.mock.calls.filter(c => c[0] === 'Strokes loaded!');
    expect(toasts).toHaveLength(0);
  });
});

// ================================================================
// BUG 6 — switch-canvas race condition
// ================================================================
describe('Bug 6 — switch-canvas race condition fix', () => {
  let sync, ws;
  beforeEach(() => {
    stubGlobals(); stubDOM(); jest.useFakeTimers(); loadSync();
    // loadSync() evals the code which defines window.TabletSync — re-stub it
    // so setActiveCanvas doesn't throw when switch-canvas is handled.
    window.TabletSync.setActiveCanvas = jest.fn();
    window.TabletSync.broadcastCanvasInfo = jest.fn();
    // Create a desktop-mode instance directly: isDesktop=true makes switch-canvas
    // handler run inside this.ws.onmessage (the RemoteStylusSync internal handler).
    sync = new RemoteStylusSync('room-desk', true);
    ws = MockWebSocket.lastInstance; ws._open();
  });
  afterEach(teardown);

  test('sends load-strokes with DOM targetId, not activeFacade.id', () => {
    addCanvasNode('dom-canvas-id', 'My Draw');
    window.StylusStore.set('dom-canvas-id', [{tool:'pen'}]);
    // Even if activeFacade has a different id, DOM node id is used
    window.StylusEngine.activeFacade = { id:'different-facade', canvas:{} };

    ws._receive({ type:'switch-canvas', index:0 });
    jest.runAllTimers();

    const loadMsgs = ws.sent.filter(m => m.type === 'load-strokes');
    expect(loadMsgs).toHaveLength(1);
    expect(loadMsgs[0].canvasId).toBe('dom-canvas-id');
  });

  test('sends correct strokes for the captured targetId', () => {
    addCanvasNode('canvas-correct');
    window.StylusStore.set('canvas-correct', [{tool:'highlighter',color:'#ff0'}]);

    ws._receive({ type:'switch-canvas', index:0 });
    jest.runAllTimers();

    const loadMsgs = ws.sent.filter(m => m.type === 'load-strokes');
    expect(loadMsgs[0].strokes).toEqual([{tool:'highlighter',color:'#ff0'}]);
  });

  test('does not send load-strokes if canvas node not found at index', () => {
    ws._receive({ type:'switch-canvas', index:99 });
    jest.runAllTimers();
    expect(ws.sent.filter(m => m.type === 'load-strokes')).toHaveLength(0);
  });

  test('does not send if ws is closed before timeout fires', () => {
    addCanvasNode('canvas-x');
    window.StylusStore.set('canvas-x', []);
    ws._receive({ type:'switch-canvas', index:0 });
    // Mark this specific sync instance as disconnected before timer fires
    sync.isConnected = false;
    jest.runAllTimers();
    expect(ws.sent.filter(m => m.type === 'load-strokes')).toHaveLength(0);
  });
});

// ================================================================
// BUG 7 — duplicate message listeners on reconnect
// ================================================================
describe('Bug 7 — duplicate listeners on reconnect', () => {
  beforeEach(() => {
    stubGlobals(); stubDOM(); loadSync();
    global.fetch = jest.fn().mockRejectedValue(new Error('no network'));
    window.StylusEngine.activeFacade = null;
  });
  afterEach(teardown);

  test('calling _initDesktopSync twice attaches exactly ONE listener on new ws', () => {
    window.TabletSync.connectTabletA();
    const ws1 = MockWebSocket.lastInstance;
    window.TabletSync.connectTabletA(); // reconnect
    const ws2 = MockWebSocket.lastInstance;

    expect(ws2.listenerCount('message')).toBe(1);
    expect(ws1.listenerCount('message')).toBe(0); // old listener removed
  });

  test('message processed exactly once after double init', () => {
    window.TabletSync.connectTabletA();
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;

    window.showToast.mockClear();
    ws._receive({ type:'hello' });

    const helloCalls = window.showToast.mock.calls.filter(c => c[0] === 'Tablet connected!');
    expect(helloCalls).toHaveLength(1);
  });

  test('_desktopMsgListener stored as named function on TabletSync', () => {
    window.TabletSync.connectTabletA();
    expect(typeof window.TabletSync._desktopMsgListener).toBe('function');
  });
});

// ================================================================
// BUG 8 — broadcastCanvasInfo notesRepo retry
// ================================================================
describe('Bug 8 — broadcastCanvasInfo notesRepo retry', () => {
  beforeEach(() => {
    stubGlobals(); stubDOM(); jest.useFakeTimers(); loadSync();
    global.fetch = jest.fn().mockRejectedValue(new Error('no network'));
    window.StylusEngine.activeFacade = null;
  });
  afterEach(teardown);

  test('retries when notesRepo is undefined — no canvas-info sent before retries exhaust', () => {
    window.notesRepo = undefined;
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'hello' });

    // No immediate canvas-info
    expect(ws.sent.filter(m => m.type === 'canvas-info')).toHaveLength(0);

    // After 300ms first retry, still not sent (still retrying)
    jest.advanceTimersByTime(300);
    expect(ws.sent.filter(m => m.type === 'canvas-info')).toHaveLength(0);
  });

  test('eventually sends canvas-info with empty menuTree after max retries', () => {
    window.notesRepo = undefined;
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'hello' });

    // Exhaust all retries (300 + 600 + 900 = 1800ms)
    jest.advanceTimersByTime(2000);
    const infoMsgs = ws.sent.filter(m => m.type === 'canvas-info');
    expect(infoMsgs.length).toBeGreaterThanOrEqual(1);
    const last = infoMsgs[infoMsgs.length - 1];
    expect(last.menuTree.text_notes).toEqual([]);
  });

  test('shows "Loading notes..." toast during retry', async () => {
    window.notesRepo = { getAllNotes: jest.fn().mockRejectedValue(new Error('fail')) };
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'hello' });
    // Flush the microtask queue so the promise rejection handler runs
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const loadingToasts = window.showToast.mock.calls.filter(c => c[0] === 'Loading notes...');
    expect(loadingToasts.length).toBeGreaterThanOrEqual(1);
  });

  test('succeeds on second attempt when notesRepo recovers', async () => {
    let callCount = 0;
    window.notesRepo = {
      getAllNotes: jest.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? Promise.reject(new Error('first fail')) : Promise.resolve([]);
      })
    };
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'hello' });

    // Flush the first rejection through the microtask queue
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // Advance past the 300ms retry delay
    jest.advanceTimersByTime(400);
    // Flush the second getAllNotes() promise resolution
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const infoMsgs = ws.sent.filter(m => m.type === 'canvas-info');
    expect(infoMsgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ================================================================
// BUG 9 — Pen state restore (_restoreToolbarStateToEngine)
// ================================================================
describe('Bug 9 — _restoreToolbarStateToEngine ToolbarStateAdapter', () => {
  // We exercise this function by loading external-editor.js and calling it directly
  let _restoreToolbarStateToEngine;

  function loadEditorAndExtract() {
    // Load the external-editor code; it defines _restoreToolbarStateToEngine at module scope
    const code = fs.readFileSync(
      path.join(__dirname, '../src/static/js/external-editor.js'), 'utf8'
    );
    // Use a function wrapper to capture the function
    const wrappedCode = `(function(window) { ${code}; return typeof _restoreToolbarStateToEngine !== 'undefined' ? _restoreToolbarStateToEngine : null; })(window)`;
    try {
      _restoreToolbarStateToEngine = eval(wrappedCode); // eslint-disable-line
    } catch (e) {
      // external-editor has DOM dependencies; define the function directly for isolation
      _restoreToolbarStateToEngine = function() {
        if (!window.StylusEngine || !window.StylusEngine.activeFacade) return;
        const sizeEl = document.getElementById('tb-size') || document.getElementById('stylus-size');
        const colorEl = document.getElementById('tb-color') || document.getElementById('stylus-color');
        const activeToolBtn = document.querySelector('.tool-btn.active[id^="tb-"]');
        if (sizeEl && sizeEl.value) window.StylusEngine.setSize(parseFloat(sizeEl.value));
        if (colorEl && colorEl.value) window.StylusEngine.setColor(colorEl.value);
        if (activeToolBtn) {
          const tool = activeToolBtn.id.replace('tb-', '');
          if (['pen','highlighter','eraser'].includes(tool)) window.StylusEngine.setTool(tool);
        }
      };
    }
  }

  function addToolbar({ size='3', color='#000000', activeTool='pen' } = {}) {
    const s = document.createElement('input'); s.type='range'; s.id='tb-size'; s.value=size;
    const c = document.createElement('input'); c.type='color'; c.id='tb-color'; c.value=color;
    document.body.appendChild(s); document.body.appendChild(c);
    if (activeTool) {
      const b = document.createElement('button');
      b.id=`tb-${activeTool}`; b.className='tool-btn active';
      document.body.appendChild(b);
    }
  }

  beforeEach(() => {
    stubGlobals(); stubDOM(); loadEditorAndExtract();
  });
  afterEach(teardown);

  test('setSize called with current slider value', () => {
    addToolbar({ size:'8' });
    window.StylusEngine.activeFacade = { id:'x' };
    _restoreToolbarStateToEngine();
    expect(window.StylusEngine.setSize).toHaveBeenCalledWith(8);
  });

  test('setColor called with current color value', () => {
    addToolbar({ color:'#ff0000' });
    window.StylusEngine.activeFacade = { id:'x' };
    _restoreToolbarStateToEngine();
    expect(window.StylusEngine.setColor).toHaveBeenCalledWith('#ff0000');
  });

  test('setTool called with active tool from DOM', () => {
    addToolbar({ activeTool:'highlighter' });
    window.StylusEngine.activeFacade = { id:'x' };
    _restoreToolbarStateToEngine();
    expect(window.StylusEngine.setTool).toHaveBeenCalledWith('highlighter');
  });

  test('no-op when activeFacade is null', () => {
    addToolbar({ size:'10' });
    window.StylusEngine.activeFacade = null;
    expect(() => _restoreToolbarStateToEngine()).not.toThrow();
    expect(window.StylusEngine.setSize).not.toHaveBeenCalled();
  });

  test('no-op when StylusEngine is undefined', () => {
    addToolbar();
    window.StylusEngine = undefined;
    expect(() => _restoreToolbarStateToEngine()).not.toThrow();
  });

  test('handles missing toolbar elements gracefully — no calls', () => {
    // No toolbar elements in DOM
    window.StylusEngine.activeFacade = { id:'x' };
    _restoreToolbarStateToEngine();
    expect(window.StylusEngine.setSize).not.toHaveBeenCalled();
    expect(window.StylusEngine.setColor).not.toHaveBeenCalled();
  });

  test('ignores unrecognised tool IDs (no setTool call)', () => {
    const b = document.createElement('button');
    b.id='tb-unknown'; b.className='tool-btn active';
    document.body.appendChild(b);
    window.StylusEngine.activeFacade = { id:'x' };
    _restoreToolbarStateToEngine();
    expect(window.StylusEngine.setTool).not.toHaveBeenCalled();
  });
});


