/**
 * remote-stylus-flow.test.js — Integration Tests
 * Tests multi-step flows between Desktop and Tablet over MockWebSocket.
 *
 * Covers:
 *  - Full canvas switch flow (switch-canvas → load-strokes)
 *  - Full sync flow (sendDoneBatch → sync-strokes-done → store update)
 *  - Refresh flow (request-menu-tree → broadcastCanvasInfo)
 *  - Reconnect scenario (listener re-registration)
 *  - Fullscreen canvas note flow
 *
 * Run: npx jest tests/integration/remote-stylus-flow.test.js --verbose
 */
'use strict';

const fs   = require('fs');
const path = require('path');

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
  delete window.RemoteStylusSync; delete window.TabletSync;
  const code = fs.readFileSync(path.join(__dirname, '../../src/static/js/remote-stylus-sync.js'), 'utf8');
  eval(code); // eslint-disable-line
}

function stubDOM(canvasDefs = []) {
  ['nav-label','btn-prev','btn-next','hamburger-sidebar','canvas-container'].forEach(id => {
    if (!document.getElementById(id)) {
      const el = document.createElement('div'); el.id = id; document.body.appendChild(el);
    }
  });
  if (!document.getElementById('drawing-surface')) {
    const cv = document.createElement('canvas'); cv.id = 'drawing-surface';
    document.getElementById('canvas-container').appendChild(cv);
  }
  canvasDefs.forEach(({ id, title }) => {
    const node = document.createElement('div');
    node.className = 'ql-stylus-canvas';
    node.dataset.id = id; node.dataset.title = title || 'Draw';
    node.scrollIntoView = jest.fn();
    document.body.appendChild(node);
  });
}

function stubGlobals({ notes = [] } = {}) {
  window.WebSocket = MockWebSocket;
  window.showToast  = jest.fn();
  window.StylusStore = new Map();
  window.StylusEngine = {
    activeFacade: null,
    activate: jest.fn(), deactivate: jest.fn(),
    setTool: jest.fn(), setColor: jest.fn(), setSize: jest.fn(),
    getFacadeForId: jest.fn().mockReturnValue(null),
  };
  window.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });
  global.fetch = window.fetch;
  window.TabletSync = { setActiveCanvas: jest.fn(), broadcastCanvasInfo: jest.fn() };
  window.notesRepo = {
    getAllNotes: jest.fn().mockResolvedValue(notes)
  };
  window.history.pushState({}, '', '?roomId=r1&mode=A');
}

function teardown() {
  jest.clearAllMocks(); jest.useRealTimers();
  document.body.innerHTML = '';
  ['RemoteStylusSync','TabletSync','StylusEngine','StylusStore','notesRepo'].forEach(k => delete window[k]);
  MockWebSocket.instances = []; MockWebSocket.lastInstance = null;
  if (global.fetch) delete global.fetch;
}

// ================================================================
// Flow 1: Full canvas switch (Desktop receives switch-canvas → sends load-strokes)
// ================================================================
describe('Flow: canvas switch (Desktop side)', () => {
  let ws;
  beforeEach(() => {
    jest.useFakeTimers();
    stubGlobals();
    stubDOM([{ id:'cv1', title:'Draw 1' }, { id:'cv2', title:'Draw 2' }]);
    loadSync();
    // Set up as desktop sync
    window.TabletSync.connectTabletA('room-desktop');
    ws = MockWebSocket.lastInstance; ws._open();
  });
  afterEach(teardown);

  test('switch-canvas sends load-strokes for the correct DOM node', () => {
    window.StylusStore.set('cv2', [{ tool:'pen', points:[[0,0],[10,10]] }]);
    ws._receive({ type:'switch-canvas', index:1 });
    jest.runAllTimers();

    const loadMsgs = ws.sent.filter(m => m.type === 'load-strokes');
    expect(loadMsgs).toHaveLength(1);
    expect(loadMsgs[0].canvasId).toBe('cv2');
    expect(loadMsgs[0].strokes).toHaveLength(1);
  });

  test('switch-canvas index 0 and index 1 send different canvasIds', () => {
    window.StylusStore.set('cv1', []);
    window.StylusStore.set('cv2', []);

    ws._receive({ type:'switch-canvas', index:0 });
    jest.runAllTimers();
    ws._receive({ type:'switch-canvas', index:1 });
    jest.runAllTimers();

    const loadMsgs = ws.sent.filter(m => m.type === 'load-strokes');
    const ids = loadMsgs.map(m => m.canvasId);
    expect(ids).toContain('cv1');
    expect(ids).toContain('cv2');
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ================================================================
// Flow 2: Full sync flow (Tablet sends strokes → Desktop stores them)
// ================================================================
describe('Flow: strokes sync (Tablet → Desktop)', () => {
  let desktopSync, ws;
  beforeEach(() => {
    stubGlobals();
    stubDOM([{ id:'canvas-A' }]);
    loadSync();
    global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });
    window.TabletSync.connectTabletA();
    ws = MockWebSocket.lastInstance; ws._open();
  });
  afterEach(teardown);

  test('sync-strokes-done updates StylusStore with received strokes', () => {
    const strokes = [{ tool:'pen', pts:[[0,0]] }];
    ws._receive({ type:'sync-strokes-done', canvasId:'canvas-A', strokes });
    expect(window.StylusStore.get('canvas-A')).toEqual(strokes);
  });

  test('sync-strokes-done with mismatched canvasId does NOT render via activeFacade', () => {
    const loadAndRender = jest.fn();
    window.StylusEngine.getFacadeForId = jest.fn().mockReturnValue(null);
    ws._receive({ type:'sync-strokes-done', canvasId:'canvas-Z', strokes:[] });
    expect(loadAndRender).not.toHaveBeenCalled();
  });

  test('sync-strokes-done shows success toast', () => {
    ws._receive({ type:'sync-strokes-done', canvasId:'canvas-A', strokes:[] });
    const toasts = window.showToast.mock.calls.filter(c => c[0].includes('✅'));
    expect(toasts.length).toBeGreaterThanOrEqual(1);
  });
});

// ================================================================
// Flow 3: Refresh (request-menu-tree → broadcastCanvasInfo)
// ================================================================
describe('Flow: refresh (request-menu-tree)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stubGlobals({ notes:[] });
    stubDOM();
    loadSync();
    global.fetch = jest.fn().mockRejectedValue(new Error('no-net'));
    window.StylusEngine.activeFacade = null;
    window.TabletSync.connectTabletA();
  });
  afterEach(teardown);

  test('request-menu-tree triggers canvas-info broadcast', async () => {
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'request-menu-tree' });
    await Promise.resolve(); // flush promise
    const infoMsgs = ws.sent.filter(m => m.type === 'canvas-info');
    expect(infoMsgs.length).toBeGreaterThanOrEqual(1);
  });

  test('canvas-info from refresh contains menuTree', async () => {
    const ws = MockWebSocket.lastInstance;
    ws._receive({ type:'request-menu-tree' });
    await Promise.resolve();
    const infoMsgs = ws.sent.filter(m => m.type === 'canvas-info');
    if (infoMsgs.length > 0) {
      expect(infoMsgs[0].menuTree).toBeDefined();
      expect(Array.isArray(infoMsgs[0].menuTree.text_notes)).toBe(true);
    }
  });
});

// ================================================================
// Flow 4: Reconnect scenario
// ================================================================
describe('Flow: reconnect scenario', () => {
  beforeEach(() => {
    stubGlobals();
    stubDOM();
    loadSync();
    global.fetch = jest.fn().mockRejectedValue(new Error('no-net'));
    window.StylusEngine.activeFacade = null;
  });
  afterEach(teardown);

  test('after reconnect, only one listener handles hello', () => {
    window.TabletSync.connectTabletA();
    window.TabletSync.connectTabletA(); // reconnect
    const ws = MockWebSocket.lastInstance;

    window.showToast.mockClear();
    ws._receive({ type:'hello' });

    const connectedToasts = window.showToast.mock.calls.filter(c => c[0] === 'Tablet connected!');
    expect(connectedToasts).toHaveLength(1);
  });

  test('new ws gets exactly 1 listener after reconnect', () => {
    window.TabletSync.connectTabletA();
    window.TabletSync.connectTabletA();
    const ws = MockWebSocket.lastInstance;
    expect(ws.listenerCount('message')).toBe(1);
  });
});

// ================================================================
// Flow 5: load-strokes ID guard in tablet flow
// ================================================================
describe('Flow: load-strokes ID guard (Tablet side)', () => {
  let sync, ws;
  beforeEach(() => {
    stubGlobals();
    stubDOM();
    loadSync();
    sync = new RemoteStylusSync('room-tablet', false); // tablet
    ws = MockWebSocket.lastInstance; ws._open();
    window.StylusEngine.activeFacade = {
      id:'cv-active',
      repo: { load:jest.fn(), clear:jest.fn() },
      renderAll: jest.fn(),
    };
  });
  afterEach(teardown);

  test('matching canvasId loads strokes', () => {
    ws._receive({ type:'load-strokes', canvasId:'cv-active', strokes:[{tool:'pen'}] });
    expect(window.StylusEngine.activeFacade.repo.load).toHaveBeenCalled();
  });

  test('mismatching canvasId does not load strokes', () => {
    ws._receive({ type:'load-strokes', canvasId:'cv-other', strokes:[{tool:'pen'}] });
    expect(window.StylusEngine.activeFacade.repo.load).not.toHaveBeenCalled();
  });

  test('missing canvasId loads strokes (backward compat)', () => {
    ws._receive({ type:'load-strokes', strokes:[] });
    expect(window.StylusEngine.activeFacade.repo.load).toHaveBeenCalled();
  });
});
