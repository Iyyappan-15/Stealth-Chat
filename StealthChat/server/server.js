/**
 * STEALTH CHAT – SIGNALING SERVER
 * Serves client files + WebSocket signaling
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '../client');

/* ---------------- HTTP SERVER (SERVE CLIENT) ---------------- */

const server = http.createServer((req, res) => {
    let filePath = req.url === '/'
        ? path.join(CLIENT_DIR, 'index.html')
        : path.join(CLIENT_DIR, req.url);

    const ext = path.extname(filePath);
    const contentTypeMap = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css'
    };

    const contentType = contentTypeMap[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

/* ---------------- WEBSOCKET SIGNALING ---------------- */

const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        const { type, room } = msg;

        if (type === 'join') {
            if (!rooms.has(room)) rooms.set(room, []);
            rooms.get(room).push(ws);
            ws.room = room;
        }

        if (room && rooms.has(room)) {
            rooms.get(room).forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(msg));
                }
            });
        }
    });

    ws.on('close', () => {
        if (ws.room && rooms.has(ws.room)) {
            rooms.set(
                ws.room,
                rooms.get(ws.room).filter(c => c !== ws)
            );
        }
    });
});

/* ---------------- START SERVER ---------------- */

server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
