const WebSocket = require('ws');

async function testSync() {
    console.log("Connecting to WebSocket...");
    const ws = new WebSocket('ws://localhost:8500/ws/stylus/notes-test123');

    ws.on('open', () => {
        console.log("Connected.");
        ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            doc_id: '123'
        }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log("Received message type:", msg.type);
        if (msg.type === 'LIBRARY_STATE') {
            console.log("Library notes count:", msg.notes ? msg.notes.length : 'undefined');
            console.log("SUCCESS: Received LIBRARY_STATE properly.");
            ws.close();
            process.exit(0);
        }
    });

    ws.on('error', (err) => {
        console.error("Error:", err);
        process.exit(1);
    });
    
    setTimeout(() => {
        console.log("Timeout waiting for LIBRARY_STATE");
        process.exit(1);
    }, 5000);
}

testSync();
