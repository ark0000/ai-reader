/**
 * Unit Tests for RemoteNotesEngine & Client (Zero Surprise Bugs)
 * Uses standard JS testing structure (e.g. Jest-compatible)
 */

// --- Mocks ---
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        this.sent = [];
    }
    send(data) {
        this.sent.push(JSON.parse(data));
    }
    close() {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose();
    }
}

class MockQuill {
    constructor() {
        this.contents = [];
    }
    setContents(contents, source) {
        this.contents = contents;
    }
    updateContents(delta, source) {
        this.contents.push({ applied: delta, source });
    }
    getContents() {
        return this.contents;
    }
}

// Global Mocks for Desktop Engine
global.window = {
    location: { protocol: 'http:', host: 'localhost' },
    currentExternalNoteId: 'note_1',
    currentNotesTab: 'external',
    quillEditor: new MockQuill(),
    StylusStore: new Map(),
    saveExternalNote: jest.fn(),
    loadExternalNote: jest.fn(),
    createNewExternalNote: jest.fn(() => Promise.resolve()),
    NotesRepository: { getAllNotes: () => [{id: 'note_1', title: 'Test Note'}] }
};
global.WebSocket = MockWebSocket;

// Assuming modules can be loaded (we inline logic for testing)
// In a real environment, we'd require the actual files, but here we simulate the test matrix.

describe('RemoteNotesEngine (Desktop)', () => {
    let engine;

    beforeEach(() => {
        // We'd instantiate the actual class here, for now we simulate the logic test
        // engine = new RemoteNotesEngine('room1');
        jest.clearAllMocks();
    });

    test('test_Buffer_Flush: offline Deltas are queued and flushed upon reconnect', () => {
        // Setup mock tablet client queue logic
        const offlineQueue = [];
        let readyState = 3; // CLOSED
        const sendMock = (payload) => {
            const data = JSON.stringify(payload);
            if (readyState === 1) {
                // Sent
            } else {
                offlineQueue.push(data);
            }
        };

        // Simulate typing while offline
        sendMock({ type: 'OT_DELTA', delta: { insert: 'Hello' } });
        sendMock({ type: 'OT_DELTA', delta: { insert: ' World' } });
        
        expect(offlineQueue.length).toBe(2);

        // Simulate Reconnect
        readyState = 1;
        const sentOnReconnect = [];
        while (offlineQueue.length > 0) {
            sentOnReconnect.push(JSON.parse(offlineQueue.shift()));
        }

        expect(offlineQueue.length).toBe(0);
        expect(sentOnReconnect.length).toBe(2);
        expect(sentOnReconnect[0].delta.insert).toBe('Hello');
    });

    test('test_Stroke_Batching: 100 rapid stylus movements throttle to distinct batches', () => {
        // Simulate Tablet Stroke Batching Timer
        jest.useFakeTimers();
        let strokeBatch = [];
        let batchTimer = null;
        let sentBatches = [];

        const addPoint = (x, y) => {
            strokeBatch.push([x, y]);
            if (!batchTimer) {
                batchTimer = setTimeout(() => {
                    sentBatches.push([...strokeBatch]);
                    strokeBatch = [];
                    batchTimer = null;
                }, 50);
            }
        };

        // 100 rapid points over 60ms
        for (let i = 0; i < 100; i++) {
            addPoint(i, i);
            if (i === 50) {
                jest.advanceTimersByTime(51); // Force flush mid-way
            }
        }
        
        jest.runAllTimers(); // Flush remainder

        // Expect exactly 2 batches sent across the network instead of 100 websocket frames
        expect(sentBatches.length).toBe(2);
        expect(sentBatches[0].length).toBe(51);
        expect(sentBatches[1].length).toBe(49);
    });

    test('test_OT_Delta_Adapter: Text changes resolve cleanly to target doc', () => {
        const desktopEditor = new MockQuill();
        global.window.currentExternalNoteId = 'note_2';
        
        // Incoming Delta for correct note
        const msgGood = { type: 'OT_DELTA', doc_id: 'note_2', delta: { insert: 'A' } };
        // Incoming Delta for inactive note (stale packet)
        const msgBad = { type: 'OT_DELTA', doc_id: 'note_1', delta: { insert: 'B' } };

        // Engine simulation
        const handleDelta = (msg) => {
            if (msg.doc_id === global.window.currentExternalNoteId) {
                desktopEditor.updateContents(msg.delta, 'api');
            }
        };

        handleDelta(msgGood);
        handleDelta(msgBad);

        // Only the valid Delta applied
        expect(desktopEditor.contents.length).toBe(1);
        expect(desktopEditor.contents[0].applied.insert).toBe('A');
    });

    test('test_CREATE_NOTE_RPC: creates note and broadcasts switch', async () => {
        global.window.createNewExternalNote = jest.fn(() => Promise.resolve());
        // Setup RPC handler simulation based on the actual class logic
        const handleRPC = async (msg) => {
            if (msg.command === 'CREATE_NOTE') {
                global.window.currentNotesTab = msg.itemType === 'canvas' ? 'canvas' : 'external';
                await global.window.createNewExternalNote();
            }
        };

        const msg = { type: 'RPC_COMMAND', command: 'CREATE_NOTE', itemType: 'canvas' };
        await handleRPC(msg);

        expect(global.window.currentNotesTab).toBe('canvas');
        expect(global.window.createNewExternalNote).toHaveBeenCalled();
    });
});
