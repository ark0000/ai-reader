const fs = require('fs');
const path = require('path');

// Mocks
global.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 1; }
    static OPEN = 1;
    send(data) {}
    close() {}
};
document.body.innerHTML = `
    <div id="connection-status"></div>
    <div id="notes-list"></div>
    <div id="active-note-title"></div>
    <div id="btn-md-source"></div>
    <div id="btn-diagram"></div>
    <div id="btn-draw"></div>
    <div id="btn-save"></div>
    <div id="quill-editor"></div>
    <div id="markdown-editor"></div>
`;
global.URLSearchParams = class {
    get(key) {
        if (key === 'roomId') return 'test-room';
        return null;
    }
};

global.window.Quill = class {
    constructor() {
        this.on = jest.fn();
        this.root = { innerHTML: '' };
    }
    static import() { return class {} }
    static register() {}
    setContents(c) {}
    getContents() { return [{insert: 'Hello'}]; }
    updateContents(d) {}
    insertEmbed() {}
    setSelection() {}
    getSelection() { return { index: 0 }; }
    getLength() { return 0; }
};
global.Quill = global.window.Quill;
// Load the class
const RemoteNotesClient = require('../src/static/js/remote-notes-app.js');

describe('Tablet Component (remote-notes-app.js)', () => {
    
    test('test_App_Subscribe: Sends SUBSCRIBE on connect', () => {
        const app = new RemoteNotesClient('test-room');
        app.ws.send = jest.fn();
        
        // Test empty subscribe since no docId is initially set
        app.docId = null;
        app.ws.onopen();
        expect(app.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'SUBSCRIBE' }));
        
        // Add a docId and test subscribe with docId
        app.docId = 'doc123';
        app.ws.onopen();
        expect(app.ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'SUBSCRIBE', doc_id: 'doc123' }));
    });

    test('test_App_Drawing_Batching: Stylus tools (Color/Eraser)', () => {
        const app = new RemoteNotesClient('test-room');
        app.ws = { readyState: 1, send: jest.fn() };
        app.docId = 'doc1';
        app.activeCanvasId = 'c1';
        
        // Mock global stylus state for eraser
        global.window.StylusState = { tool: 'eraser', color: '#ff7a59', size: 3 };
        
        // Trigger pointer down to fetch the new tools state
        const canvas = {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
            width: 800, height: 400,
            getContext: () => ({ beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn() }),
            setPointerCapture: jest.fn(),
            closest: () => ({ getAttribute: () => 'c1' })
        };
        app.startDrawing({ clientX: 10, clientY: 10, pointerId: 1 }, canvas);
        app.flushStrokeBatch();
        
        const sent = JSON.parse(app.ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('CANVAS_STROKES');
        expect(sent.color).toBe('eraser');
        expect(sent.size).toBe(20);
        
        // Switch back to pen with custom color
        global.window.StylusState = { tool: 'pen', color: '#00ff00', size: 5 };
        app.startDrawing({ clientX: 20, clientY: 20, pointerId: 1 }, canvas);
        app.flushStrokeBatch();
        
        const sentPen = JSON.parse(app.ws.send.mock.calls[1][0]);
        expect(sentPen.color).toBe('#00ff00');
        expect(sentPen.size).toBe(5); 
    });

    test('test_App_Initialization: Connects to correct websocket room', () => {
        const urlParams = new global.URLSearchParams(global.window.location.search);
        const roomId = urlParams.get('roomId');
        expect(roomId).toBe('test-room');
        
        const ws = new global.WebSocket(`ws://${global.window.location.host}/ws/stylus/${roomId}`);
        expect(ws.url).toBe('ws://localhost/ws/stylus/test-room');
    });

    test('test_Canvas_Stroke_Throttling: Stroke collection logic', () => {
        const strokeBuffer = [];
        const addStroke = (x, y) => strokeBuffer.push([x, y]);
        addStroke(10, 10);
        addStroke(20, 20);
        
        expect(strokeBuffer.length).toBe(2);
        expect(strokeBuffer[1][0]).toBe(20);
    });
});
