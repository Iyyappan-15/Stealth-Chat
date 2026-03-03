const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeRooms: Object.keys(rooms).length,
        totalConnections: Object.values(rooms).reduce((acc, room) => acc + room.length, 0)
    });
});

// Room status endpoint
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

// Store clients: { roomId: [ws1, ws2] }
// Store locked rooms: { roomId: { locked, connectedAt } }
// Store cleanup timers: { roomId: timer } — grace period before deleting lock
const rooms = {};
const lockedRooms = {};
const roomCleanupTimers = {};

// How long to keep the room alive after a peer's WebSocket drops.
// This lets brief network hiccups (mobile background, page tab switch) recover
// without destroying the session. Set to 20 seconds.
const ROOM_GRACE_PERIOD_MS = 20000;

wss.on('connection', (ws) => {
    console.log('New WebSocket connection at', new Date().toISOString());

    // Close idle connections that never join a room
    const connectionTimeout = setTimeout(() => {
        if (!ws.roomId) {
            console.log('Connection timeout — no room joined');
            ws.close();
        }
    }, 30000);

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON:', e.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            }
            return;
        }

        const { type, roomId, payload } = data;

        // Validate roomId on join
        if (type === 'join' && (!roomId || typeof roomId !== 'string' || roomId.trim() === '')) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
            return;
        }

        if (type === 'join') {
            clearTimeout(connectionTimeout);

            // FIX: If a cleanup timer is running for this room (grace period after peer drop),
            // cancel it — the peer has reconnected their WebSocket. This lets a brief WS drop
            // recover without locking out the peer.
            if (roomCleanupTimers[roomId]) {
                console.log(`Room ${roomId}: peer WS reconnected during grace period — cancelling cleanup.`);
                clearTimeout(roomCleanupTimers[roomId]);
                delete roomCleanupTimers[roomId];
                // Re-add this socket to the room (replacing the dropped one)
                if (!rooms[roomId]) rooms[roomId] = [];
                // Remove any stale/closed sockets first
                rooms[roomId] = rooms[roomId].filter(c => c.readyState === WebSocket.OPEN);
                if (rooms[roomId].length < 2) {
                    rooms[roomId].push(ws);
                    ws.roomId = roomId;
                    console.log(`Room ${roomId}: peer re-joined (WS recovery). Count: ${rooms[roomId].length}`);
                }
                return;
            }

            // Check if room is locked (already has an active full P2P session)
            if (lockedRooms[roomId] && lockedRooms[roomId].locked) {
                console.log(`Room ${roomId} is locked — rejecting.`);
                ws.send(JSON.stringify({
                    type: 'locked',
                    message: 'This room is already in use and locked for security. Please create a new room.'
                }));
                ws.close();
                return;
            }

            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length >= 2) {
                ws.send(JSON.stringify({ type: 'full' }));
                ws.close();
                return;
            }

            rooms[roomId].push(ws);
            ws.roomId = roomId;
            console.log(`User joined room: ${roomId}. Total: ${rooms[roomId].length}`);

            if (rooms[roomId].length === 2) {
                // Lock the room when both peers are connected
                lockedRooms[roomId] = {
                    locked: true,
                    connectedAt: new Date().toISOString()
                };
                console.log(`Room ${roomId} LOCKED (2 peers).`);
                // Tell the second peer (the joiner) to initiate the WebRTC offer
                ws.send(JSON.stringify({ type: 'ready' }));
            }

        } else if (type === 'signal') {
            if (!roomId || !rooms[roomId]) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid room' }));
                }
                return;
            }
            // Forward SDP/ICE to the other peer
            rooms[roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'signal', payload }));
                }
            });
        }
    });

    ws.on('close', () => {
        if (!ws.roomId || !rooms[ws.roomId]) return;

        const roomId = ws.roomId;
        console.log(`Peer WebSocket closed in room: ${roomId}`);

        // Remove this socket from the room array
        rooms[roomId] = rooms[roomId].filter(c => c !== ws);

        // Notify remaining peer that their partner's WebSocket dropped
        rooms[roomId].forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'peer-left' }));
            }
        });

        // FIX: Don't immediately destroy the room lock on WebSocket close.
        // The P2P DataChannel may still be alive (WebRTC survives brief WS drops).
        // Start a grace period — if the peer reconnects within 20s, cancel the cleanup.
        if (lockedRooms[roomId]) {
            console.log(`Starting ${ROOM_GRACE_PERIOD_MS / 1000}s grace period for room ${roomId} before unlock.`);
            roomCleanupTimers[roomId] = setTimeout(() => {
                console.log(`Room ${roomId}: grace period expired — unlocking and deleting.`);
                delete lockedRooms[roomId];
                delete roomCleanupTimers[roomId];
                if (rooms[roomId] && rooms[roomId].length === 0) {
                    delete rooms[roomId];
                }
            }, ROOM_GRACE_PERIOD_MS);
        } else if (rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stealth Chat Signaling Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready for connections`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`⏰ Started at ${new Date().toISOString()}`);
});
