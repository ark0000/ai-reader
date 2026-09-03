/**
 * stylus-engine.test.js — Comprehensive Unit Tests
 * Covers: DrawingRepository, Strategies, StylusEngine Facade, SVG generation
 * Run: npx jest tests/stylus-engine.test.js
 */

const fs = require("fs");
const path = require("path");

// --- Test Helpers ---
function makeCtx() {
    return {
        clearRect: jest.fn(), beginPath: jest.fn(), moveTo: jest.fn(),
        lineTo: jest.fn(), stroke: jest.fn(), fillRect: jest.fn(),
        drawImage: jest.fn(), globalCompositeOperation: "",
        lineCap: "", lineJoin: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1,
    };
}

function makeCanvas(w, h) {
    w = w || 800; h = h || 300;
    const el = document.createElement("canvas");
    el.width = w; el.height = h;
    const ctx = makeCtx();
    el.getContext = jest.fn(() => ctx);
    el._ctx = ctx;
    el.getBoundingClientRect = jest.fn(() => ({ left: 0, top: 0, width: w, height: h }));
    return el;
}

function loadEngine() {
    delete window.StylusEngine;
    delete window.StylusStore;
    const code = fs.readFileSync(path.join(__dirname, "../src/static/js/stylus-engine.js"), "utf8");
    eval(code); // eslint-disable-line no-eval
}

function stubGlobals() {
    window.PointerEvent = class PointerEvent extends window.Event {
        constructor(type, p) { p = p || {}; super(type, p); Object.assign(this, p); }
    };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.Quill = {
        import: jest.fn(() => class { static create() { return document.createElement("div"); } }),
        register: jest.fn(),
        find: jest.fn(),
    };
    window.showToast = jest.fn();
    window.StylusStore = new Map();
}

function mountContainer(id) {
    id = id || "test";
    const container = document.createElement("div");
    container.classList.add("ql-stylus-canvas");
    container.dataset.id = id;
    container.appendChild(makeCanvas());
    document.body.appendChild(container);
    const tb = document.createElement("div");
    tb.id = "stylus-toolbar";
    tb.className = "hidden";
    document.body.appendChild(tb);
    window.StylusEngine.activate(container);
    return container;
}

function teardown() {
    jest.clearAllMocks();
    document.body.innerHTML = "";
    delete window.StylusEngine;
    delete window.StylusStore;
    delete window.Quill;
}

// ================================================================
// 1. DrawingRepository — stroke lifecycle
// ================================================================
describe("DrawingRepository — stroke lifecycle", function() {
    var repo;
    beforeEach(function() { stubGlobals(); loadEngine(); mountContainer("r"); repo = window.StylusEngine.activeFacade.repo; });
    afterEach(teardown);

    test("beginStroke stores tool color size", function() {
        repo.beginStroke("pen", "#f00", 5);
        expect(repo.currentStroke).toMatchObject({ tool: "pen", color: "#f00", size: 5, points: [] });
    });

    test("beginStroke defaults size to 3", function() {
        repo.beginStroke("pen", "#000");
        expect(repo.currentStroke.size).toBe(3);
    });

    test("addPoint stores rounded coords and pressure", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(10.6, 20.4, 0.5);
        expect(repo.currentStroke.points[0]).toEqual({ x: 11, y: 20, p: 0.5 });
    });

    test("addPoint drops points closer than 2px", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(10, 10, 1);
        repo.addPoint(10.5, 10.5, 1); // dist 0.7 - dropped
        repo.addPoint(20, 20, 1);     // dist > 2 - kept
        expect(repo.currentStroke.points).toHaveLength(2);
    });

    test("endStroke commits and clears currentStroke", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(0, 0, 1); repo.addPoint(10, 10, 1);
        repo.endStroke();
        expect(repo.strokes).toHaveLength(1);
        expect(repo.currentStroke).toBeNull();
    });

    test("endStroke discards zero-point strokes", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.endStroke();
        expect(repo.strokes).toHaveLength(0);
    });
});

// ================================================================
// 2. DrawingRepository — undo / redo
// ================================================================
describe("DrawingRepository — undo / redo", function() {
    var repo;
    beforeEach(function() { stubGlobals(); loadEngine(); mountContainer("ur"); repo = window.StylusEngine.activeFacade.repo; });
    afterEach(teardown);

    function addStroke() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(0, 0, 1); repo.addPoint(10, 10, 1);
        repo.endStroke();
    }

    test("undo removes last stroke and returns true", function() {
        addStroke();
        expect(repo.undo()).toBe(true);
        expect(repo.strokes).toHaveLength(0);
    });

    test("redo restores undone stroke and returns true", function() {
        addStroke();
        repo.undo();
        expect(repo.redo()).toBe(true);
        expect(repo.strokes).toHaveLength(1);
    });

    test("undo on empty stack returns false", function() {
        expect(repo.undo()).toBe(false);
    });

    test("redo on empty stack returns false", function() {
        expect(repo.redo()).toBe(false);
    });

    test("new stroke clears redo stack", function() {
        addStroke();
        repo.undo();
        addStroke(); // clears redo
        expect(repo.redo()).toBe(false);
    });

    test("multiple undo-redo round-trip", function() {
        addStroke(); addStroke();
        repo.undo(); repo.undo();
        expect(repo.strokes).toHaveLength(0);
        repo.redo(); repo.redo();
        expect(repo.strokes).toHaveLength(2);
    });
});

// ================================================================
// 3. DrawingRepository — eraseAt
// ================================================================
describe("DrawingRepository — eraseAt", function() {
    var repo;
    beforeEach(function() { stubGlobals(); loadEngine(); mountContainer("er"); repo = window.StylusEngine.activeFacade.repo; });
    afterEach(teardown);

    test("eraseAt removes strokes within 20px radius", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(50, 50, 1); repo.addPoint(60, 60, 1);
        repo.endStroke();
        expect(repo.eraseAt(52, 52)).toBe(true);
        expect(repo.strokes).toHaveLength(0);
    });

    test("eraseAt returns false for far strokes", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(50, 50, 1); repo.addPoint(60, 60, 1);
        repo.endStroke();
        expect(repo.eraseAt(200, 200)).toBe(false);
        expect(repo.strokes).toHaveLength(1);
    });

    test("eraseAt pushes to undoStack", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(50, 50, 1); repo.addPoint(60, 60, 1);
        repo.endStroke();
        var beforeLen = repo.undoStack.length;
        repo.eraseAt(52, 52);
        expect(repo.undoStack.length).toBeGreaterThan(beforeLen);
    });

    test("undo restores erased stroke", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(50, 50, 1); repo.addPoint(60, 60, 1);
        repo.endStroke();
        repo.eraseAt(52, 52);
        repo.undo();
        expect(repo.strokes).toHaveLength(1);
    });
});

// ================================================================
// 4. DrawingRepository — serialize / load / clear
// ================================================================
describe("DrawingRepository — persistence", function() {
    var repo;
    beforeEach(function() { stubGlobals(); loadEngine(); mountContainer("p"); repo = window.StylusEngine.activeFacade.repo; });
    afterEach(teardown);

    test("serialize returns valid JSON array", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(0, 0, 1); repo.addPoint(10, 10, 1);
        repo.endStroke();
        var parsed = JSON.parse(repo.serialize());
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(1);
    });

    test("load replaces strokes and resets history", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(0, 0, 1); repo.addPoint(10, 10, 1);
        repo.endStroke();
        repo.load([{ tool: "highlighter", color: "#ff0", size: 8, points: [{x:5,y:5,p:1},{x:20,y:20,p:1}] }]);
        expect(repo.strokes).toHaveLength(1);
        expect(repo.strokes[0].tool).toBe("highlighter");
        expect(repo.undoStack).toHaveLength(0);
    });

    test("clear empties strokes and all history", function() {
        repo.beginStroke("pen", "#000", 3);
        repo.addPoint(0, 0, 1); repo.addPoint(10, 10, 1);
        repo.endStroke();
        repo.clear();
        expect(repo.strokes).toHaveLength(0);
        expect(repo.undoStack).toHaveLength(0);
        expect(repo.redoStack).toHaveLength(0);
    });
});

// ================================================================
// 5. StylusEngine Facade
// ================================================================
describe("StylusEngine Facade", function() {
    beforeEach(function() { stubGlobals(); loadEngine(); });
    afterEach(teardown);

    test("activate creates activeFacade and shows toolbar", function() {
        mountContainer("f1");
        expect(window.StylusEngine.activeFacade).not.toBeNull();
        expect(document.getElementById("stylus-toolbar").classList.contains("hidden")).toBe(false);
    });

    test("deactivate clears activeFacade and hides toolbar", function() {
        mountContainer("f2");
        window.StylusEngine.deactivate();
        expect(window.StylusEngine.activeFacade).toBeNull();
        expect(document.getElementById("stylus-toolbar").classList.contains("hidden")).toBe(true);
    });

    test("setTool updates currentTool", function() {
        mountContainer("f3");
        window.StylusEngine.setTool("eraser");
        expect(window.StylusEngine.activeFacade.currentTool).toBe("eraser");
    });

    test("setColor updates currentColor", function() {
        mountContainer("f4");
        window.StylusEngine.setColor("#aabbcc");
        expect(window.StylusEngine.activeFacade.currentColor).toBe("#aabbcc");
    });

    test("setSize updates currentSize as float", function() {
        mountContainer("f5");
        window.StylusEngine.setSize("12");
        expect(window.StylusEngine.activeFacade.currentSize).toBe(12);
    });

    test("setTool setColor setSize no-op without activeFacade", function() {
        expect(function() {
            window.StylusEngine.setTool("pen");
            window.StylusEngine.setColor("#000");
            window.StylusEngine.setSize(5);
        }).not.toThrow();
    });

    test("getFacadeForId returns null for unknown ID", function() {
        mountContainer("f6");
        expect(window.StylusEngine.getFacadeForId("nope")).toBeNull();
    });

    test("getFacadeForId returns active facade matching ID", function() {
        mountContainer("f7");
        expect(window.StylusEngine.getFacadeForId("f7")).not.toBeNull();
    });

    test("activating second container deactivates first", function() {
        var tb = document.createElement("div"); tb.id = "stylus-toolbar"; tb.className = "hidden"; document.body.appendChild(tb);
        var c1 = document.createElement("div"); c1.classList.add("ql-stylus-canvas"); c1.dataset.id = "c1"; c1.appendChild(makeCanvas()); document.body.appendChild(c1);
        var c2 = document.createElement("div"); c2.classList.add("ql-stylus-canvas"); c2.dataset.id = "c2"; c2.appendChild(makeCanvas()); document.body.appendChild(c2);
        window.StylusEngine.activate(c1);
        window.StylusEngine.activate(c2);
        expect(window.StylusEngine.activeFacade.id).toBe("c2");
    });
});

// ================================================================
// 6. SVG generation
// ================================================================
describe("SVG generation", function() {
    var facade;
    beforeEach(function() {
        stubGlobals(); loadEngine();
        mountContainer("svg");
        facade = window.StylusEngine.activeFacade;
    });
    afterEach(teardown);

    test("generateSVG produces valid SVG with path", function() {
        facade.repo.beginStroke("pen", "#000", 3);
        facade.repo.addPoint(0, 0, 1); facade.repo.addPoint(100, 50, 1);
        facade.repo.endStroke();
        var svg = facade.generateSVG();
        expect(svg).toContain("<svg");
        expect(svg).toContain("</svg>");
        expect(svg).toContain("<path");
    });

    test("generateSVG uses pen stroke size", function() {
        facade.repo.beginStroke("pen", "#f00", 7);
        facade.repo.addPoint(0, 0, 1); facade.repo.addPoint(50, 50, 1);
        facade.repo.endStroke();
        expect(facade.generateSVG()).toContain("stroke-width=\"7\"");
    });

    test("generateSVG uses 3x size for highlighter", function() {
        facade.repo.beginStroke("highlighter", "#ff0", 5);
        facade.repo.addPoint(0, 0, 1); facade.repo.addPoint(50, 50, 1);
        facade.repo.endStroke();
        expect(facade.generateSVG()).toContain("stroke-width=\"15\"");
    });

    test("generateSVG skips single-point strokes", function() {
        facade.repo.beginStroke("pen", "#000", 3);
        facade.repo.addPoint(0, 0, 1); // only 1 point
        facade.repo.endStroke();
        expect(facade.generateSVG()).not.toContain("<path");
    });

    test("generateSVG returns valid SVG when no strokes", function() {
        var svg = facade.generateSVG();
        expect(svg).toContain("<svg");
        expect(svg).not.toContain("<path");
    });
});

// ================================================================
// 7. Click Outside Deactivation Logic
// ================================================================
describe("StylusEngine Facade — Click Outside", function() {
    var facade;
    beforeEach(function() {
        stubGlobals(); 
        loadEngine();
        
        // Setup mock UI elements to test click outside ignoring
        document.body.innerHTML += `
            <div id="external-notes-sidebar">
                <button id="new-note-btn">+ New</button>
            </div>
            <div id="canvas-note-tools">
                <button id="clear-btn">Clear</button>
            </div>
            <div id="stylus-toolbar"></div>
            <div id="random-div"></div>
        `;
        
        mountContainer("click-test");
        facade = window.StylusEngine.activeFacade;
    });
    afterEach(teardown);

    test("Clicking outside the canvas on an ignored element (sidebar) does NOT deactivate", function() {
        const btn = document.getElementById("new-note-btn");
        const clickEvent = new window.Event("click", { bubbles: true });
        Object.defineProperty(clickEvent, 'target', { value: btn });
        
        document.dispatchEvent(clickEvent);
        
        expect(window.StylusEngine.activeFacade).not.toBeNull();
    });

    test("Clicking outside the canvas on an ignored element (canvas tools) does NOT deactivate", function() {
        const btn = document.getElementById("clear-btn");
        const clickEvent = new window.Event("click", { bubbles: true });
        Object.defineProperty(clickEvent, 'target', { value: btn });
        
        document.dispatchEvent(clickEvent);
        
        expect(window.StylusEngine.activeFacade).not.toBeNull();
    });

    test("Clicking outside the canvas on a non-ignored element DOES deactivate", function() {
        const div = document.getElementById("random-div");
        const clickEvent = new window.Event("click", { bubbles: true });
        Object.defineProperty(clickEvent, 'target', { value: div });
        
        document.dispatchEvent(clickEvent);
        
        expect(window.StylusEngine.activeFacade).toBeNull();
    });
});
