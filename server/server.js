const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// Enable CORS for all routes
// In production, you may want to restrict this to your Netlify domain
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
    credentials: true
};
app.use(cors(corsOptions));

// Serve static files from the client directory
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

console.log(`Serving static files from: ${clientPath}`);

// Health check endpoint for deployment verification
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeRooms: Object.keys(rooms).length,
        totalConnections: Object.values(rooms).reduce((acc, room) => acc + room.length, 0)
    });
});

// API endpoint to check room status
app.get('/api/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms[roomId];
    const isLocked = lockedRooms[roomId] && lockedRooms[roomId].locked;
    res.json({
        roomId,
        exists: !!room,
        peerCount: room ? room.length : 0,
        full: room && room.length >= 2,
        locked: isLocked,
        lockedAt: isLocked ? lockedRooms[roomId].connectedAt : null
    });
});

// Store clients: { roomId: [client1, client2] }
// Store locked rooms: { roomId: { locked: true, connectedAt: timestamp } }
const rooms = {};
const lockedRooms = {};

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established at', new Date().toISOString());

    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
        if (!ws.roomId) {
            console.log('Connection timeout - no room joined');
            ws.close();
        }
    }, 30000); // 30 seconds to join a room

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received:', e.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            }
            return;
        }

        const { type, roomId, payload } = data;

        // Validate room ID
        if (type === 'join' && (!roomId || typeof roomId !== 'string' || roomId.trim() === '')) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
            return;
        }

        if (type === 'join') {
            clearTimeout(connectionTimeout);

            // Check if room is locked (already has active connection)
            if (lockedRooms[roomId] && lockedRooms[roomId].locked) {
                console.log(`Room ${roomId} is locked - rejecting connection`);
                ws.send(JSON.stringify({
                    type: 'locked',
                    message: 'This room is already in use and locked for security'
                }));
                ws.close();
                return;
            }

            if (!rooms[roomId]) {
                rooms[roomId] = [];
            }

            // Limit to 2 peers for this P2P demo
            if (rooms[roomId].length >= 2) {
                ws.send(JSON.stringify({ type: 'full' }));
                ws.close();
                return;
            }

            rooms[roomId].push(ws);
            ws.roomId = roomId; // Tag the socket

            console.log(`User joined room: ${roomId}. Total: ${rooms[roomId].length}`);

            // Notify if another peer is waiting
            if (rooms[roomId].length === 2) {
                // Lock the room now that 2 peers are connected
                lockedRooms[roomId] = {
                    locked: true,
                    connectedAt: new Date().toISOString()
                };
                console.log(`Room ${roomId} is now LOCKED (2 peers connected)`);

                // Send 'ready' ONLY to the newly joined peer to avoid glare (race condition)
                ws.send(JSON.stringify({ type: 'ready' }));
            }
        } else if (type === 'signal') {
            // Forward signaling data (SDP/ICE) to the OTHER peer in the room
            if (!roomId || !rooms[roomId]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid room' }));
                return;
            }

            rooms[roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'signal', payload }));
                }
            });
        }
    });

    ws.on('close', () => {
        if (ws.roomId && rooms[ws.roomId]) {
            rooms[ws.roomId] = rooms[ws.roomId].filter(client => client !== ws);
            console.log(`User left room: ${ws.roomId}`);

            // Unlock and delete room when anyone leaves (security measure)
            if (lockedRooms[ws.roomId]) {
                console.log(`Room ${ws.roomId} UNLOCKED and deleted (peer disconnected)`);
                delete lockedRooms[ws.roomId];
            }

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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stealth Chat Signaling Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready for connections`);
    console.log(`🏥 Health check available at http://localhost:${PORT}/health`);
    console.log(`⏰ Started at ${new Date().toISOString()}`);
});
