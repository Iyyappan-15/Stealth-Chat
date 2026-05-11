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

const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));
console.log(`Serving static files from: ${clientPath}`);

// ─── Data Stores ───────────────────────────────────────────────────────────────
// rooms: { roomId: [ ws, ws, ... ] }
// roomModes: { roomId: 'p2p' | 'group' }
// lockedRooms: { roomId: { locked: true, connectedAt } }  — P2P only
// roomCleanupTimers: { roomId: timer }  — P2P grace period
const rooms = {};
const roomModes = {};
const lockedRooms = {};
const roomCleanupTimers = {};

const ROOM_GRACE_PERIOD_MS = 20000;

// ─── Health / Status ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeRooms: Object.keys(rooms).length,
        totalConnections: Object.values(rooms).reduce((acc, room) => acc + room.length, 0)
    });
});

app.get('/api/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms[roomId];
    const mode = roomModes[roomId] || 'unknown';
    const isLocked = lockedRooms[roomId] && lockedRooms[roomId].locked;
    res.json({
        roomId,
        mode,
        exists: !!room,
        peerCount: room ? room.length : 0,
        full: mode === 'p2p' && room && room.length >= 2,
        locked: isLocked
    });
});

// ─── Keep-alive ping ───────────────────────────────────────────────────────────
// Sent every 20s — keeps free-tier hosts (Render etc.) alive and detects dead clients faster
const SERVER_PING_INTERVAL = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) { /* ignore */ }
        }
    });
}, 20000);

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build anonymized participant list for broadcasting */
function buildParticipantList(roomId) {
    if (!rooms[roomId]) return [];
    return rooms[roomId]
        .filter(c => c.readyState === WebSocket.OPEN)
        .map(c => ({ name: c.peerName || 'Anonymous', id: c.peerId }));
}

/** Broadcast participants list to all members of a room */
function broadcastParticipants(roomId) {
    if (!rooms[roomId]) return;
    const list = buildParticipantList(roomId);
    const msg = JSON.stringify({ type: 'participants-list', participants: list });
    rooms[roomId].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(msg); } catch (e) { /* ignore */ }
        }
    });
}

/** Broadcast a message to all room members except sender */
function broadcastToRoom(roomId, senderWs, msgObj) {
    if (!rooms[roomId]) return;
    const msg = JSON.stringify(msgObj);
    rooms[roomId].forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            try { client.send(msg); } catch (e) { /* ignore */ }
        }
    });
}

/** Generate a short unique id for a peer */
function genPeerId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── WebSocket Handler ─────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
    console.log('New WebSocket connection at', new Date().toISOString());

    // Close idle connections that never join a room within 10s
    const connectionTimeout = setTimeout(() => {
        if (!ws.roomId) {
            console.log('Connection timeout — no room joined');
            ws.close();
        }
    }, 10000);

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

        const { type, roomId, payload, name, mode } = data;

        // Ignore client heartbeats
        if (type === 'ping') return;

        // ── JOIN ──────────────────────────────────────────────────────────────
        if (type === 'join') {
            clearTimeout(connectionTimeout);

            if (!roomId || typeof roomId !== 'string' || roomId.trim() === '') {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
                return;
            }

            const chatMode = mode === 'group' ? 'group' : 'p2p';
            ws.peerName = (name && typeof name === 'string' && name.trim()) ? name.trim().substring(0, 30) : 'Anonymous';
            ws.peerId = genPeerId();
            ws.roomMode = chatMode;

            // ── P2P Join Logic ──
            if (chatMode === 'p2p') {
                // Grace period reconnect
                if (roomCleanupTimers[roomId]) {
                    console.log(`Room ${roomId}: peer WS reconnected during grace period — handling restore.`);
                    clearTimeout(roomCleanupTimers[roomId]);
                    delete roomCleanupTimers[roomId];
                    if (!rooms[roomId]) rooms[roomId] = [];
                    rooms[roomId] = rooms[roomId].filter(c => c.readyState === WebSocket.OPEN);
                    if (!rooms[roomId].includes(ws)) {
                        rooms[roomId].push(ws);
                        ws.roomId = roomId;
                    }
                    console.log(`Room ${roomId}: restored. Peers: ${rooms[roomId].length}`);
                    if (rooms[roomId].length === 2) {
                        // Both peers are back — trigger new WebRTC handshake
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else {
                        // Only 1 peer reconnected so far — restart grace timer so
                        // the 2nd peer can also reconnect through the grace path
                        // (instead of being rejected by the lockedRooms check).
                        console.log(`Room ${roomId}: only 1 peer back — restarting grace timer for 2nd peer.`);
                        roomCleanupTimers[roomId] = setTimeout(() => {
                            console.log(`Room ${roomId}: extended grace period expired — clearing lock.`);
                            delete lockedRooms[roomId];
                            delete roomCleanupTimers[roomId];
                            if (rooms[roomId] && rooms[roomId].length === 0) {
                                delete rooms[roomId];
                                delete roomModes[roomId];
                            }
                        }, ROOM_GRACE_PERIOD_MS);
                    }
                    broadcastParticipants(roomId);
                    return;
                }

                // Locked room check
                if (lockedRooms[roomId] && lockedRooms[roomId].locked) {
                    console.log(`Room ${roomId} is locked — rejecting.`);
                    ws.send(JSON.stringify({ type: 'locked', message: 'This room is already in use. Please create a new room.' }));
                    ws.close();
                    return;
                }

                if (!rooms[roomId]) { rooms[roomId] = []; roomModes[roomId] = 'p2p'; }

                if (rooms[roomId].length >= 2) {
                    ws.send(JSON.stringify({ type: 'full' }));
                    ws.close();
                    return;
                }

                rooms[roomId].push(ws);
                ws.roomId = roomId;
                console.log(`[P2P] User "${ws.peerName}" joined room: ${roomId}. Total: ${rooms[roomId].length}`);

                broadcastParticipants(roomId);

                if (rooms[roomId].length === 2) {
                    lockedRooms[roomId] = { locked: true, connectedAt: new Date().toISOString() };
                    console.log(`Room ${roomId} LOCKED (2 peers).`);
                    // Notify the second peer (the joiner) to create the WebRTC offer
                    ws.send(JSON.stringify({ type: 'ready' }));
                    // Notify the first peer that the second joined (with name)
                    const firstPeer = rooms[roomId].find(c => c !== ws);
                    if (firstPeer && firstPeer.readyState === WebSocket.OPEN) {
                        firstPeer.send(JSON.stringify({ type: 'peer-joined', name: ws.peerName }));
                    }
                }
            }

            // ── GROUP Join Logic ──
            else if (chatMode === 'group') {
                if (!rooms[roomId]) { rooms[roomId] = []; roomModes[roomId] = 'group'; }

                // If room exists but was created as P2P, reject
                if (roomModes[roomId] === 'p2p') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room exists as P2P mode. Cannot join as group.' }));
                    ws.close();
                    return;
                }

                rooms[roomId].push(ws);
                ws.roomId = roomId;
                console.log(`[GROUP] User "${ws.peerName}" joined room: ${roomId}. Total: ${rooms[roomId].length}`);

                // Acknowledge join to this new member
                ws.send(JSON.stringify({ type: 'group-joined', peerId: ws.peerId, name: ws.peerName }));

                // Notify all existing members that someone joined
                broadcastToRoom(roomId, ws, {
                    type: 'participant-joined',
                    name: ws.peerName,
                    id: ws.peerId
                });

                // Send participant list to everyone
                broadcastParticipants(roomId);
            }
        }

        // ── SIGNAL (P2P WebRTC signaling) ─────────────────────────────────────
        else if (type === 'signal') {
            if (!roomId || !rooms[roomId]) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid room' }));
                }
                return;
            }
            // Forward SDP/ICE to the other peer (P2P only)
            rooms[roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'signal', payload }));
                }
            });
        }

        // ── RELAY-MSG (Group chat — onion relay hop) ──────────────────────────
        // Server receives ciphertext and re-broadcasts without inspecting content.
        // Spreads the ENTIRE message so file fields (msgType, mime, iv, data…) reach receiver.
        else if (type === 'relay-msg') {
            if (!ws.roomId || !rooms[ws.roomId]) return;
            if (roomModes[ws.roomId] !== 'group') return;

            // Forward ALL fields to every other member — server never inspects/decrypts
            broadcastToRoom(ws.roomId, ws, {
                ...data,               // spread sender's fields (payload, msgType, mime, iv, data, index, etc.)
                type: 'relay-msg',     // ensure type stays correct
                from: ws.peerId,
                fromName: ws.peerName
            });
        }

        // ── RELAY-TYPING (Group typing indicator) ─────────────────────────────
        else if (type === 'relay-typing') {
            if (!ws.roomId || !rooms[ws.roomId]) return;
            broadcastToRoom(ws.roomId, ws, {
                type: 'relay-typing',
                from: ws.peerId,
                fromName: ws.peerName,
                isTyping: data.isTyping
            });
        }

        // ── RELAY-P2P-MSG (P2P relay fallback for cross-network) ──────────────
        // When WebRTC/TURN fails between different networks, P2P peers fall back
        // to routing AES-256 encrypted messages through this relay.
        // The server never inspects or decrypts the payload.
        else if (type === 'relay-p2p-msg') {
            if (!ws.roomId || !rooms[ws.roomId]) return;
            if (roomModes[ws.roomId] !== 'p2p') return;
            const msg = JSON.stringify({ type: 'relay-p2p-msg', payload: data.payload });
            rooms[ws.roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    try { client.send(msg); } catch (e) { /* ignore */ }
                }
            });
        }
    });

    // ── DISCONNECT ─────────────────────────────────────────────────────────────
    ws.on('close', () => {
        if (!ws.roomId || !rooms[ws.roomId]) return;

        const roomId = ws.roomId;
        const mode = roomModes[roomId];
        console.log(`WebSocket closed for "${ws.peerName}" in room: ${roomId} [${mode}]`);

        // Remove from room
        rooms[roomId] = rooms[roomId].filter(c => c !== ws);

        if (mode === 'p2p') {
            // Notify remaining peer
            rooms[roomId].forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'peer-left', name: ws.peerName }));
                }
            });

            if (lockedRooms[roomId]) {
                console.log(`Room ${roomId}: starting ${ROOM_GRACE_PERIOD_MS / 1000}s grace period.`);
                roomCleanupTimers[roomId] = setTimeout(() => {
                    console.log(`Room ${roomId}: grace period expired — clearing lock.`);
                    delete lockedRooms[roomId];
                    delete roomCleanupTimers[roomId];
                    if (rooms[roomId] && rooms[roomId].length === 0) {
                        delete rooms[roomId];
                        delete roomModes[roomId];
                    }
                }, ROOM_GRACE_PERIOD_MS);
            } else if (rooms[roomId] && rooms[roomId].length === 0) {
                delete rooms[roomId];
                delete roomModes[roomId];
            }
        } else if (mode === 'group') {
            // Notify all remaining group members
            broadcastToRoom(roomId, null, {
                type: 'participant-left',
                name: ws.peerName,
                id: ws.peerId
            });
            broadcastParticipants(roomId);

            if (rooms[roomId].length === 0) {
                delete rooms[roomId];
                delete roomModes[roomId];
            }
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error for room ${ws.roomId}:`, err.message);
    });
});

process.on('SIGTERM', () => {
    clearInterval(SERVER_PING_INTERVAL);
    server.close();
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stealth Chat Signaling Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready for P2P + Group connections`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`⏰ Started at ${new Date().toISOString()}`);
});
