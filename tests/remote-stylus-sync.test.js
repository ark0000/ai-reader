/**
 * remote-stylus-sync.test.js — Unit & Component Tests
 * Covers: RemoteStylusSync message routing, canvas navigation,
 *         jumpToCanvas, loadCanvasStrokes, updateTabletCanvasSize, sendDoneBatch scaling.
 * Run: npx jest tests/remote-stylus-sync.test.js
 */

const fs = require("fs");
const path = require("path");

// ─── WebSocket mock ───────────────────────────────────────────────────────────
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = 1; // OPEN
        MockWebSocket.lastInstance = this;
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
    // Simulate a server message
    _receive(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
    _open() { if (this.onopen) this.onopen(); }
}
MockWebSocket.lastInstance = null;

function loadSync() {
    delete window.RemoteStylusSync;
    const code = fs.readFileSync(path.join(__dirname, "../src/static/js/remote-stylus-sync.js"), "utf8");
    eval(code); // eslint-disable-line no-eval
}

function stubDOM() {
    // Minimal DOM elements RemoteStylusSync needs
    ["nav-label", "btn-prev", "btn-next", "hamburger-sidebar", "canvas-container"].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) {
            el = document.createElement("div");
            el.id = id;
            document.body.appendChild(el);
        }
    });
    var canvas = document.getElementById("drawing-surface");
    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "drawing-surface";
        document.getElementById("canvas-container").appendChild(canvas);
    }
}

function stubGlobals() {
    window.WebSocket = MockWebSocket;
    window.showToast = jest.fn();
    window.StylusStore = new Map();
    window.StylusEngine = {
        activeFacade: null,
        activate: jest.fn(),
        deactivate: jest.fn(),
        setTool: jest.fn(),
        setColor: jest.fn(),
        setSize: jest.fn(),
    };
    window.TabletSync = {
        setActiveCanvas: jest.fn(),
        broadcastCanvasInfo: jest.fn(),
    };
    // jsdom requires delete before re-assigning window.location
    delete window.location;
    window.location = { protocol: "http:", host: "localhost:8500", search: "?roomId=r1&mode=A", href: "http://localhost:8500/remote-stylus?roomId=r1&mode=A" };
}


function teardown() {
    jest.clearAllMocks();
    document.body.innerHTML = "";
    delete window.RemoteStylusSync;
    delete window.StylusEngine;
    delete window.StylusStore;
    delete window.TabletSync;
    MockWebSocket.lastInstance = null;
}

// ================================================================
// 1. Constructor & connection
// ================================================================
describe("RemoteStylusSync — constructor & connection", function() {
    beforeEach(function() { stubGlobals(); stubDOM(); loadSync(); });
    afterEach(teardown);

    test("constructor opens WebSocket connection", function() {
        var sync = new RemoteStylusSync("room1", false);
        expect(MockWebSocket.lastInstance).not.toBeNull();
        expect(MockWebSocket.lastInstance.url).toContain("room1");
    });

    test("isConnected becomes true on ws open", function() {
        var sync = new RemoteStylusSync("room1", false);
        MockWebSocket.lastInstance._open();
        expect(sync.isConnected).toBe(true);
    });

    test("isConnected becomes false on ws close", function() {
        var sync = new RemoteStylusSync("room1", false);
        MockWebSocket.lastInstance._open();
        MockWebSocket.lastInstance.close();
        expect(sync.isConnected).toBe(false);
    });

    test("tablet sends hello on connect", function() {
        var sync = new RemoteStylusSync("room1", false);
        MockWebSocket.lastInstance._open();
        var hellos = MockWebSocket.lastInstance.sent.filter(function(m) { return m.type === "hello"; });
        expect(hellos.length).toBeGreaterThanOrEqual(1);
    });
});

// ================================================================
// 2. Tablet — canvas-info message handling
// ================================================================
describe("RemoteStylusSync — canvas-info (tablet)", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
    });
    afterEach(teardown);

    var canvasInfo = {
        type: "canvas-info",
        mode: "editor",
        canvases: [
            { id: "c1", title: "Draw 1", desktopW: 800, desktopH: 300 },
            { id: "c2", title: "Draw 2", desktopW: 800, desktopH: 300 },
        ],
        activeCanvasId: "c1",
        menuTree: { text_notes: [], standalone_notes: [] },
    };

    test("canvas-info updates canvases array", function() {
        ws._receive(canvasInfo);
        expect(sync.canvases).toHaveLength(2);
    });

    test("canvas-info sets currentCanvasIndex to active canvas", function() {
        ws._receive(canvasInfo);
        expect(sync.currentCanvasIndex).toBe(0);
    });

    test("canvas-info preserves current position when no activeCanvasId", function() {
        ws._receive(canvasInfo);
        sync.currentCanvasIndex = 1; // user navigated to second
        ws._receive(Object.assign({}, canvasInfo, { activeCanvasId: null }));
        expect(sync.currentCanvasIndex).toBe(1);
    });

    test("canvas-info sets targetWidth/targetHeight from active canvas", function() {
        ws._receive(canvasInfo);
        expect(sync.targetWidth).toBe(800);
        expect(sync.targetHeight).toBe(300);
    });

    test("canvas-info stores mode", function() {
        ws._receive(Object.assign({}, canvasInfo, { mode: "fullscreen" }));
        expect(sync.mode).toBe("fullscreen");
    });
});

// ================================================================
// 3. Tablet — load-strokes message
// ================================================================
describe("RemoteStylusSync — load-strokes (tablet)", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
        window.StylusEngine.activeFacade = {
            repo: { load: jest.fn(), clear: jest.fn() },
            renderAll: jest.fn(),
        };
    });
    afterEach(teardown);

    test("load-strokes calls repo.load and renderAll", function() {
        var strokes = [{ tool: "pen", color: "#000", size: 3, points: [{x:0,y:0,p:1},{x:10,y:10,p:1}] }];
        ws._receive({ type: "load-strokes", canvasId: "c1", strokes: strokes });
        expect(window.StylusEngine.activeFacade.repo.load).toHaveBeenCalledWith(strokes);
        expect(window.StylusEngine.activeFacade.renderAll).toHaveBeenCalled();
    });

    test("load-strokes shows toast", function() {
        ws._receive({ type: "load-strokes", canvasId: "c1", strokes: [] });
        expect(window.showToast).toHaveBeenCalled();
    });
});

// ================================================================
// 4. Desktop — switch-canvas message
// ================================================================
describe("RemoteStylusSync — switch-canvas (desktop)", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", true); // isDesktop = true
        ws = MockWebSocket.lastInstance;
        ws._open();
    });
    afterEach(teardown);

    test("switch-canvas calls TabletSync.setActiveCanvas with correct index", function() {
        // The desktop handler calls window.TabletSync.setActiveCanvas synchronously
        // We capture it before the message arrives and verify afterward
        var called = false;
        var calledWith = null;
        window.TabletSync = {
            setActiveCanvas: function(idx) { called = true; calledWith = idx; },
            broadcastCanvasInfo: jest.fn(),
        };
        ws._receive({ type: "switch-canvas", index: 2 });
        expect(called).toBe(true);
        expect(calledWith).toBe(2);
    });


    test("switch-canvas sends load-strokes after activation", function(done) {
        var facade = {
            id: "can1",
            canvas: { width: 800, height: 300 },
            repo: { strokes: [{ tool: "pen", color: "#000", size: 3, points: [{x:5,y:5,p:1},{x:10,y:10,p:1}] }] }
        };
        window.StylusStore.set("can1", facade.repo.strokes);
        window.StylusEngine.activeFacade = facade;
        ws._receive({ type: "switch-canvas", index: 0 });
        setTimeout(function() {
            var loadMsgs = ws.sent.filter(function(m) { return m.type === "load-strokes"; });
            expect(loadMsgs.length).toBeGreaterThanOrEqual(1);
            done();
        }, 200);
    });
});

// ================================================================
// 5. Desktop — request-strokes message
// ================================================================
describe("RemoteStylusSync — request-strokes (desktop)", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", true);
        ws = MockWebSocket.lastInstance;
        ws._open();
        window.StylusStore.set("canvas-abc", [{ tool: "pen", color: "#000", size: 3, points: [{x:1,y:1,p:1},{x:5,y:5,p:1}] }]);
    });
    afterEach(teardown);

    test("request-strokes responds with load-strokes containing correct strokes", function() {
        ws._receive({ type: "request-strokes", canvasId: "canvas-abc" });
        var loadMsgs = ws.sent.filter(function(m) { return m.type === "load-strokes"; });
        expect(loadMsgs).toHaveLength(1);
        expect(loadMsgs[0].canvasId).toBe("canvas-abc");
        expect(loadMsgs[0].strokes).toHaveLength(1);
    });

    test("request-strokes returns empty array for unknown canvasId", function() {
        ws._receive({ type: "request-strokes", canvasId: "does-not-exist" });
        var loadMsgs = ws.sent.filter(function(m) { return m.type === "load-strokes"; });
        expect(loadMsgs[0].strokes).toHaveLength(0);
    });
});

// ================================================================
// 6. Tablet — switchCanvas navigation
// ================================================================
describe("RemoteStylusSync — switchCanvas navigation", function() {
    var sync, ws;
    var canvasInfo = {
        type: "canvas-info", mode: "editor",
        canvases: [
            { id: "c0", title: "Draw 1", desktopW: 800, desktopH: 300 },
            { id: "c1", title: "Draw 2", desktopW: 800, desktopH: 300 },
            { id: "c2", title: "Draw 3", desktopW: 800, desktopH: 300 },
        ],
        activeCanvasId: "c0",
        menuTree: { text_notes: [], standalone_notes: [] },
    };
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
        window.StylusEngine.activeFacade = { repo: { clear: jest.fn(), load: jest.fn() }, renderAll: jest.fn() };
        ws._receive(canvasInfo);
    });
    afterEach(teardown);

    test("switchCanvas(1) advances to next canvas", function() {
        expect(sync.currentCanvasIndex).toBe(0);
        sync.switchCanvas(1);
        expect(sync.currentCanvasIndex).toBe(1);
    });

    test("switchCanvas wraps from last to first", function() {
        sync.currentCanvasIndex = 2;
        sync.switchCanvas(1);
        expect(sync.currentCanvasIndex).toBe(0);
    });

    test("switchCanvas wraps from first to last", function() {
        sync.currentCanvasIndex = 0;
        sync.switchCanvas(-1);
        expect(sync.currentCanvasIndex).toBe(2);
    });

    test("switchCanvas sends switch-canvas to desktop", function() {
        sync.switchCanvas(1);
        var msgs = ws.sent.filter(function(m) { return m.type === "switch-canvas"; });
        expect(msgs.length).toBeGreaterThanOrEqual(1);
        expect(msgs[msgs.length - 1].index).toBe(1);
    });
});

// ================================================================
// 7. Tablet — jumpToCanvas
// ================================================================
describe("RemoteStylusSync — jumpToCanvas", function() {
    var sync, ws;
    var canvasInfo = {
        type: "canvas-info", mode: "editor",
        canvases: [
            { id: "c0", title: "Draw 1", desktopW: 800, desktopH: 300 },
            { id: "c1", title: "Draw 2", desktopW: 800, desktopH: 300 },
        ],
        activeCanvasId: "c0",
        menuTree: { text_notes: [], standalone_notes: [] },
    };
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
        window.StylusEngine.activeFacade = { repo: { clear: jest.fn(), load: jest.fn() }, renderAll: jest.fn() };
        ws._receive(canvasInfo);
        window.RemoteStylusSyncInstance = sync;
    });
    afterEach(function() { delete window.RemoteStylusSyncInstance; teardown(); });

    test("jumpToCanvas navigates to existing canvas by ID", function() {
        RemoteStylusSync.jumpToCanvas("c1", "note1");
        expect(sync.currentCanvasIndex).toBe(1);
    });

    test("jumpToCanvas sends switch-canvas message", function() {
        RemoteStylusSync.jumpToCanvas("c1", "note1");
        var msgs = ws.sent.filter(function(m) { return m.type === "switch-canvas"; });
        expect(msgs.length).toBeGreaterThanOrEqual(1);
    });

    test("jumpToCanvas sends open-note when canvas not in list", function() {
        RemoteStylusSync.jumpToCanvas("unknown-canvas", "other-note");
        var msgs = ws.sent.filter(function(m) { return m.type === "open-note"; });
        expect(msgs.length).toBeGreaterThanOrEqual(1);
        expect(msgs[0].id).toBe("other-note");
    });
});

// ================================================================
// 8. Tablet — loadCanvasStrokes
// ================================================================
describe("RemoteStylusSync — loadCanvasStrokes", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
        window.StylusEngine.activeFacade = { repo: { clear: jest.fn(), load: jest.fn() }, renderAll: jest.fn() };
        ws._receive({
            type: "canvas-info", mode: "editor",
            canvases: [{ id: "c0", title: "Draw 1", desktopW: 800, desktopH: 300 }],
            activeCanvasId: "c0",
            menuTree: { text_notes: [], standalone_notes: [] },
        });
    });
    afterEach(teardown);

    test("loadCanvasStrokes sends request-strokes with canvasId", function() {
        sync.loadCanvasStrokes("c0");
        var msgs = ws.sent.filter(function(m) { return m.type === "request-strokes"; });
        expect(msgs.length).toBeGreaterThanOrEqual(1);
        expect(msgs[msgs.length - 1].canvasId).toBe("c0");
    });

    test("loadCanvasStrokes updates currentCanvasIndex if canvas found", function() {
        sync.currentCanvasIndex = 999;
        sync.loadCanvasStrokes("c0");
        expect(sync.currentCanvasIndex).toBe(0);
    });
});

// ================================================================
// 9. sendDoneBatch — stroke scaling
// ================================================================
describe("RemoteStylusSync — sendDoneBatch scaling", function() {
    var sync, ws;
    beforeEach(function() {
        stubGlobals(); stubDOM(); loadSync();
        sync = new RemoteStylusSync("room1", false);
        ws = MockWebSocket.lastInstance;
        ws._open();
        sync.targetWidth = 1600;
        sync.targetHeight = 600;
    });
    afterEach(teardown);

    test("sendDoneBatch scales strokes proportionally to desktop dimensions", function() {
        window.StylusEngine.activeFacade = {
            id: "test",
            canvas: { width: 800, height: 300 },
            repo: {
                strokes: [{
                    tool: "pen", color: "#000", size: 3,
                    points: [{ x: 400, y: 150, p: 1 }, { x: 800, y: 300, p: 1 }]
                }]
            }
        };
        sync.sendDoneBatch();
        var sent = ws.sent.filter(function(m) { return m.type === "sync-strokes-done"; });
        expect(sent).toHaveLength(1);
        // scaleX = 1600/800 = 2, scaleY = 600/300 = 2
        expect(sent[0].strokes[0].points[0].x).toBeCloseTo(800, 0);
        expect(sent[0].strokes[0].points[0].y).toBeCloseTo(300, 0);
    });

    test("sendDoneBatch shows toast when not connected", function() {
        sync.isConnected = false;
        window.StylusEngine.activeFacade = null;
        sync.sendDoneBatch();
        expect(window.showToast).toHaveBeenCalled();
    });
});
