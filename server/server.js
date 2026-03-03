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
        locked: isLocked
    });
});

// Store clients: { roomId: [ws1, ws2] }
const rooms = {};
const lockedRooms = {};
const roomCleanupTimers = {};

// Grace period: keep room alive after a peer's WS drops so brief hiccups don't destroy the session
const ROOM_GRACE_PERIOD_MS = 20000; // 20 seconds

// Server-side keep-alive: ping all clients every 30s to prevent proxy/load-balancer timeouts
const SERVER_PING_INTERVAL = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
        }
    });
}, 30000);

wss.on('connection', (ws) => {
    console.log('New WebSocket connection at', new Date().toISOString());

    // Close idle connections that never join a room within 30s
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

        // Handle client-side heartbeat ping — just ignore it (server already sends pong)
        if (type === 'ping') return;

        // Validate roomId on join
        if (type === 'join' && (!roomId || typeof roomId !== 'string' || roomId.trim() === '')) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
            return;
        }

        if (type === 'join') {
            clearTimeout(connectionTimeout);

            // If a cleanup timer is running (grace period after peer WS drop),
            // this peer is reconnecting — cancel the cleanup and restore the session.
            if (roomCleanupTimers[roomId]) {
                console.log(`Room ${roomId}: peer WS reconnected during grace period — cancelling cleanup.`);
                clearTimeout(roomCleanupTimers[roomId]);
                delete roomCleanupTimers[roomId];

                // Restore room state
                if (!rooms[roomId]) rooms[roomId] = [];
                // Remove any stale (closed) sockets
                rooms[roomId] = rooms[roomId].filter(c => c.readyState === WebSocket.OPEN);

                if (!rooms[roomId].includes(ws)) {
                    rooms[roomId].push(ws);
                    ws.roomId = roomId;
                }

                console.log(`Room ${roomId}: restored. Peers: ${rooms[roomId].length}`);

                // If we now have 2 peers again, trigger ready for the reconnecting peer
                // so WebRTC can renegotiate if needed
                if (rooms[roomId].length === 2) {
                    ws.send(JSON.stringify({ type: 'ready' }));
                }
                return;
            }

            // Check if room is locked (already has a full active session)
            if (lockedRooms[roomId] && lockedRooms[roomId].locked) {
                console.log(`Room ${roomId} is locked — rejecting.`);
                ws.send(JSON.stringify({
                    type: 'locked',
                    message: 'This room is already in use. Please create a new room.'
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
                // Lock room when both peers are present
                lockedRooms[roomId] = { locked: true, connectedAt: new Date().toISOString() };
                console.log(`Room ${roomId} LOCKED (2 peers).`);
                // Tell the second peer (the joiner) to create the WebRTC offer
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
        console.log(`WebSocket closed for room: ${roomId}`);

        // Remove this socket from the room
        rooms[roomId] = rooms[roomId].filter(c => c !== ws);

        // Notify the remaining peer
        rooms[roomId].forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'peer-left' }));
            }
        });

        if (lockedRooms[roomId]) {
            // Start grace period — if same peer reconnects within 20s, restore the room
            console.log(`Room ${roomId}: starting ${ROOM_GRACE_PERIOD_MS / 1000}s grace period.`);
            roomCleanupTimers[roomId] = setTimeout(() => {
                console.log(`Room ${roomId}: grace period expired — clearing lock.`);
                delete lockedRooms[roomId];
                delete roomCleanupTimers[roomId];
                if (rooms[roomId] && rooms[roomId].length === 0) {
                    delete rooms[roomId];
                }
            }, ROOM_GRACE_PERIOD_MS);
        } else if (rooms[roomId] && rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error for room ${ws.roomId}:`, err.message);
    });
});

// Clean up ping interval when server shuts down
process.on('SIGTERM', () => {
    clearInterval(SERVER_PING_INTERVAL);
    server.close();
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stealth Chat Signaling Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready for connections`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`⏰ Started at ${new Date().toISOString()}`);
});
