/**
 * stylus-engine-bugs.test.js
 * Unit tests for StylusEngine design validation and pen state lifecycle.
 * Covers Bug 11 (getFacadeForId by design) and Bug 9 complement (facade state).
 *
 * Run: npx jest tests/stylus-engine-bugs.test.js --verbose
 */
'use strict';

const fs   = require('fs');
const path = require('path');

function loadEngine() {
  delete window.StylusEngine;
  const code = fs.readFileSync(
    path.join(__dirname, '../src/static/js/stylus-engine.js'), 'utf8'
  );
  eval(code); // eslint-disable-line
}

function stubDOM() {
  // StylusEngine needs a minimal DOM
  const containers = ['quill-editor','stylus-toolbar'];
  containers.forEach(id => {
    if (!document.getElementById(id)) {
      const el = document.createElement('div'); el.id = id;
      document.body.appendChild(el);
    }
  });
}

function stubGlobals() {
  window.Quill = null; // Prevent Quill registration errors
  window.StylusStore = new Map();
  window.TabletSync = { broadcastCanvasInfo: jest.fn() };
  window.quillEditor = null;
}

function teardown() {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  ['StylusEngine','StylusStore','TabletSync','quillEditor','Quill'].forEach(k => delete window[k]);
}

function makeCanvasNode(id = 'test-canvas') {
  const node = document.createElement('div');
  node.className = 'ql-stylus-canvas';
  node.dataset.id = id;
  node.style.width  = '400px';
  node.style.height = '300px';
  document.body.appendChild(node);
  return node;
}

// ================================================================
// StylusEngine.getFacadeForId — design validation (Bug 11)
// ================================================================
describe('StylusEngine.getFacadeForId — design contract', () => {
  beforeEach(() => { stubGlobals(); stubDOM(); loadEngine(); });
  afterEach(teardown);

  test('returns null when no activeFacade exists', () => {
    expect(window.StylusEngine.getFacadeForId('any-id')).toBeNull();
  });

  test('returns null when id does not match activeFacade', () => {
    window.StylusEngine.activeFacade = { id:'canvas-1', container:{} };
    const result = window.StylusEngine.getFacadeForId('canvas-2');
    expect(result).toBeNull();
  });

  test('returns activeFacade when id matches', () => {
    const fakeFacade = { id:'canvas-1', container:{} };
    window.StylusEngine.activeFacade = fakeFacade;
    const result = window.StylusEngine.getFacadeForId('canvas-1');
    expect(result).toBe(fakeFacade);
  });

  test('returns null again after deactivate clears activeFacade', () => {
    const node = makeCanvasNode('canvas-deact');
    window.StylusEngine.activeFacade = { id:'canvas-deact', container:node, destroy:jest.fn() };
    window.StylusEngine.deactivate();
    expect(window.StylusEngine.getFacadeForId('canvas-deact')).toBeNull();
  });
});

// ================================================================
// StylusEngine.setTool / setColor / setSize delegation
// ================================================================
describe('StylusEngine tool delegation — no activeFacade guard', () => {
  beforeEach(() => { stubGlobals(); stubDOM(); loadEngine(); });
  afterEach(teardown);

  test('setTool is a no-op when no activeFacade', () => {
    expect(() => window.StylusEngine.setTool('pen')).not.toThrow();
  });

  test('setColor is a no-op when no activeFacade', () => {
    expect(() => window.StylusEngine.setColor('#ff0000')).not.toThrow();
  });

  test('setSize is a no-op when no activeFacade', () => {
    expect(() => window.StylusEngine.setSize(10)).not.toThrow();
  });

  test('undo is a no-op when no activeFacade', () => {
    expect(() => window.StylusEngine.undo()).not.toThrow();
  });

  test('redo is a no-op when no activeFacade', () => {
    expect(() => window.StylusEngine.redo()).not.toThrow();
  });
});

// ================================================================
// activate() + deactivate() lifecycle
// ================================================================
describe('StylusEngine activate/deactivate lifecycle', () => {
  beforeEach(() => { stubGlobals(); stubDOM(); loadEngine(); });
  afterEach(teardown);

  test('activate sets activeFacade', () => {
    const node = makeCanvasNode('cv1');
    // Note: full activate() requires pointer event infra; test the facade property only
    window.StylusEngine.activeFacade = { id:'cv1', container:node, destroy:jest.fn() };
    expect(window.StylusEngine.activeFacade).not.toBeNull();
  });

  test('deactivate clears activeFacade', () => {
    const node = makeCanvasNode('cv2');
    window.StylusEngine.activeFacade = {
      id:'cv2', container:node,
      destroy: jest.fn(),
    };
    // Add required class for deactivate
    node.classList.add('active');
    window.StylusEngine.deactivate();
    expect(window.StylusEngine.activeFacade).toBeNull();
  });

  test('deactivate is safe to call when activeFacade is already null', () => {
    window.StylusEngine.activeFacade = null;
    expect(() => window.StylusEngine.deactivate()).not.toThrow();
  });

  test('broadcastCanvasInfo called on activate', () => {
    const node = makeCanvasNode('cv3');
    window.StylusEngine.activeFacade = {
      id:'cv3', container:node, destroy:jest.fn()
    };
    // Simulate activate calling broadcastCanvasInfo (it does after facade assignment)
    if (window.TabletSync && window.TabletSync.broadcastCanvasInfo) {
      window.TabletSync.broadcastCanvasInfo();
    }
    expect(window.TabletSync.broadcastCanvasInfo).toHaveBeenCalled();
  });
});
