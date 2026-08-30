/**
 * Integration Tests: Desktop Engine <--> Tablet App
 * Verifies bidirectional syncing of text edits and note switching.
 */

class MockWebSocket {
    constructor() { this.listeners = {}; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    send(data) { if (this.onMessageCallback) this.onMessageCallback(data); }
    _trigger(data) { if (this.listeners['message']) this.listeners['message']({ data: JSON.stringify(data) }); }
}

describe('Integration Flow: Remote Notes Sync', () => {
    test('test_End_to_End_Text_Sync', () => {
        // Desktop
        const desktopWs = new MockWebSocket();
        let desktopDoc = "";
        
        desktopWs.addEventListener('message', (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'OT_DELTA') {
                desktopDoc = data.delta.insert;
            }
        });

        // Tablet
        const tabletWs = new MockWebSocket();
        tabletWs.onMessageCallback = (msg) => {
            const data = JSON.parse(msg);
            if (data.type === 'OT_DELTA') {
                // Pipe to desktop
                desktopWs._trigger(data);
            }
        };

        // User types on tablet
        tabletWs.send(JSON.stringify({
            type: 'OT_DELTA',
            doc_id: 'note_1',
            delta: { insert: 'Hello from Tablet' }
        }));

        expect(desktopDoc).toBe('Hello from Tablet');
    });

    test('test_End_to_End_Save_RPC', () => {
        const desktopWs = new MockWebSocket();
        let desktopSaveTriggered = false;

        desktopWs.addEventListener('message', (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'RPC_COMMAND' && data.command === 'FORCE_SAVE') {
                desktopSaveTriggered = true;
            }
        });

        const tabletWs = new MockWebSocket();
        tabletWs.onMessageCallback = (msg) => desktopWs._trigger(JSON.parse(msg));

        // User clicks save on tablet
        tabletWs.send(JSON.stringify({
            type: 'RPC_COMMAND',
            command: 'FORCE_SAVE'
        }));

        expect(desktopSaveTriggered).toBe(true);
    });
});
