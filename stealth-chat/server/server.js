const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

console.log('Signaling Server running on port 8080');

// Store clients: { roomId: [client1, client2] }
// In a real app, manage this better to handle disconnects/reconnects
const rooms = {};

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON');
            return;
        }

        const { type, roomId, payload } = data;

        if (type === 'join') {
            if (!rooms[roomId]) {
                rooms[roomId] = [];
            }

            // Limit to 2 peers for this P2P demo
            if (rooms[roomId].length >= 2) {
                ws.send(JSON.stringify({ type: 'full' }));
                return;
            }

            rooms[roomId].push(ws);
            ws.roomId = roomId; // Tag the socket

            console.log(`User joined room: ${roomId}. Total: ${rooms[roomId].length}`);

            // Notify if another peer is waiting
            if (rooms[roomId].length === 2) {
                // Fix: Send 'ready' ONLY to the newly joined peer to avoid glare (race condition)
                ws.send(JSON.stringify({ type: 'ready' }));
            }
        } else if (type === 'signal') {
            // Forward signaling data (SDP/ICE) to the OTHER peer in the room
            if (rooms[roomId]) {
                rooms[roomId].forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'signal', payload }));
                    }
                });
            }
        }
    });

    ws.on('close', () => {
        if (ws.roomId && rooms[ws.roomId]) {
            rooms[ws.roomId] = rooms[ws.roomId].filter(client => client !== ws);
            console.log(`User left room: ${ws.roomId}`);
            if (rooms[ws.roomId].length === 0) {
                delete rooms[ws.roomId];
            } else {
                // Notify remaining peer that partner left
                rooms[ws.roomId].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'peer-left' }));
                    }
                });
            }
        }
    });
});
