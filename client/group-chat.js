/**
 * GroupChatManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles Group Chat mode by using the signaling server as an encrypted
 * relay hop (onion-inspired). Messages are AES-GCM encrypted client-side
 * before being sent; the server only sees ciphertext and re-broadcasts it.
 * No direct peer-to-peer connections — all traffic routes through the server
 * relay, so individual IP addresses are never disclosed to other group members.
 */
class GroupChatManager {
    constructor(signalingUrl, {
        onMessageReceived,
        onParticipantsUpdate,
        onParticipantJoined,
        onParticipantLeft,
        onTyping,
        onConnectionReady,
        onDisconnected
    }) {
        this.signalingUrl = signalingUrl;
        this.ws = null;
        this.roomId = null;
        this.myName = null;
        this.myId = null;
        this.cryptoManager = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimer = null;
        this._destroyed = false;
        this._pingInterval = null;
        this._connected = false;

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onParticipantsUpdate = onParticipantsUpdate;
        this.onParticipantJoined = onParticipantJoined;
        this.onParticipantLeft = onParticipantLeft;
        this.onTyping = onTyping;
        this.onConnectionReady = onConnectionReady;
        this.onDisconnected = onDisconnected;
    }

    // ─── Connect ────────────────────────────────────────────────────────────────
    async connect(roomId, myName, cryptoManager) {
        this.roomId = roomId;
        this.myName = myName;
        this.cryptoManager = cryptoManager;
        this._destroyed = false;

        // Derive group session key from room ID (deterministic for all members)
        await cryptoManager.generateGroupKey(roomId);
        console.log('[Group] Group session key derived from room ID.');

        let wsUrl = this.signalingUrl;
        if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
        else if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');

        console.log('[Group] Connecting to signaling server:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[Group] WebSocket connected.');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            this._startHeartbeat();

            // Join group room
            this.ws.send(JSON.stringify({
                type: 'join',
                roomId: this.roomId,
                name: this.myName,
                mode: 'group'
            }));
        };

        this.ws.onerror = (err) => {
            console.error('[Group] WebSocket error:', err);
        };

        this.ws.onclose = (event) => {
            console.log('[Group] WebSocket closed. Code:', event.code);
            this._stopHeartbeat();
            this._connected = false;
            if (!this._destroyed) {
                if (this.onDisconnected) this.onDisconnected();
                this._scheduleReconnect();
            }
        };

        this.ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'pong') return;
                await this._handleMessage(msg);
            } catch (e) {
                console.error('[Group] Error handling message:', e);
            }
        };
    }

    // ─── Message Handler ────────────────────────────────────────────────────────
    async _handleMessage(msg) {
        switch (msg.type) {

            case 'group-joined':
                // Server confirmed we joined; stores our peerId
                this.myId = msg.peerId;
                this._connected = true;
                console.log(`[Group] Joined as "${msg.name}" (${msg.peerId})`);
                if (this.onConnectionReady) this.onConnectionReady(msg.name);
                break;

            case 'participants-list':
                if (this.onParticipantsUpdate) this.onParticipantsUpdate(msg.participants);
                break;

            case 'participant-joined':
                if (this.onParticipantJoined) this.onParticipantJoined(msg.name, msg.id);
                break;

            case 'participant-left':
                if (this.onParticipantLeft) this.onParticipantLeft(msg.name, msg.id);
                break;

            case 'relay-msg':
                // Decrypt incoming relayed message
                if (msg.payload && msg.payload.startsWith && msg.payload.startsWith('{')) {
                    // Try as text chat message
                    try {
                        const decryptedText = await this.cryptoManager.decryptMessage(msg.payload);
                        if (this.onMessageReceived) {
                            this.onMessageReceived(decryptedText, msg.fromName, msg.from);
                        }
                    } catch (e) {
                        // might be a file meta/chunk relayed as special type-tagged string
                    }
                } else if (msg.msgType === 'MEDIA_META') {
                    this._incomingFileMeta = {
                        mime: msg.mime, name: msg.name,
                        totalChunks: msg.totalChunks, iv: new Uint8Array(msg.iv)
                    };
                    this._incomingFileChunks = new Array(msg.totalChunks).fill(null);
                    this._incomingFileReceived = 0;
                } else if (msg.msgType === 'MEDIA_CHUNK') {
                    if (this._incomingFileChunks)
                        this._incomingFileChunks[msg.index] = new Uint8Array(msg.data);
                    this._incomingFileReceived = (this._incomingFileReceived || 0) + 1;
                } else if (msg.msgType === 'MEDIA_END') {
                    await this._handleFileEnd();
                } else {
                    // Plain text chat relay
                    try {
                        const decryptedText = await this.cryptoManager.decryptMessage(msg.payload);
                        if (this.onMessageReceived) {
                            this.onMessageReceived(decryptedText, msg.fromName, msg.from);
                        }
                    } catch (e) {
                        console.error('[Group] Decryption failed:', e);
                    }
                }
                break;

            case 'relay-typing':
                if (this.onTyping) this.onTyping(msg.fromName, msg.isTyping);
                break;

            case 'error':
                console.error('[Group] Server error:', msg.message);
                break;

            default:
                console.log('[Group] Unknown message type:', msg.type);
        }
    }

    // ─── Send Message ───────────────────────────────────────────────────────────
    async sendMessage(text) {
        if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[Group] Cannot send — not connected.');
            return false;
        }
        try {
            const encryptedPayload = await this.cryptoManager.encryptMessage(text);
            this.ws.send(JSON.stringify({
                type: 'relay-msg',
                payload: encryptedPayload
            }));
            return true;
        } catch (e) {
            console.error('[Group] Encrypt/send failed:', e);
            return false;
        }
    }

    // ─── Send File (via relay) ─────────────────────────────────────────────────────
    async sendFile(file, onProgress, appendMediaMessage, getDestructTime) {
        if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        if (!this.cryptoManager || !this.cryptoManager.sessionKey) return false;

        const MAX_FILE_MB = 20;
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            alert(`File too large. Maximum size is ${MAX_FILE_MB} MB for group relay.`);
            return false;
        }

        const CHUNK_SIZE = 32 * 1024; // 32 KB — conservative for WebSocket relay

        try {
            // Read as ArrayBuffer
            const arrayBuffer = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });

            // Encrypt the whole buffer
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                this.cryptoManager.sessionKey,
                arrayBuffer
            );
            const encData = new Uint8Array(encrypted);
            const totalChunks = Math.ceil(encData.length / CHUNK_SIZE);

            // Send META via relay (no payload key, use msgType)
            this._relaySend({ msgType: 'MEDIA_META', mime: file.type,
                name: file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 64),
                totalChunks, iv: Array.from(iv) });

            await new Promise(r => setTimeout(r, 50));

            // Send CHUNKs
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const chunk = encData.slice(start, Math.min(start + CHUNK_SIZE, encData.length));
                this._relaySend({ msgType: 'MEDIA_CHUNK', index: i, data: Array.from(chunk) });
                if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
                if (i % 3 === 0) await new Promise(r => setTimeout(r, 15)); // throttle
            }

            // Send END
            this._relaySend({ msgType: 'MEDIA_END' });

            // Show own copy (with filename)
            if (appendMediaMessage && getDestructTime) {
                const blob = new Blob([arrayBuffer], { type: file.type });
                const blobUrl = URL.createObjectURL(blob);
                const secs = getDestructTime();
                appendMediaMessage(blobUrl, file.type, 'me', secs, file.name);
                setTimeout(() => URL.revokeObjectURL(blobUrl), (secs + 2) * 1000);
            }

            return true;
        } catch (e) {
            console.error('[Group] sendFile error:', e);
            return false;
        }
    }

    /** Send a raw object through relay-msg (non-encrypted, structural messages) */
    _relaySend(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try { this.ws.send(JSON.stringify({ type: 'relay-msg', ...obj })); } catch (e) { /* ignore */ }
    }

    /** Reassemble and decrypt a completed incoming group file */
    async _handleFileEnd() {
        const meta = this._incomingFileMeta;
        const chunks = this._incomingFileChunks;
        this._incomingFileMeta = null;
        this._incomingFileChunks = null;
        this._incomingFileReceived = 0;
        if (!meta || !chunks) return;

        try {
            const totalLen = chunks.reduce((a, c) => a + (c ? c.length : 0), 0);
            const encData = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) { if (chunk) { encData.set(chunk, offset); offset += chunk.length; } }

            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: meta.iv },
                this.cryptoManager.sessionKey,
                encData
            );

            const blob = new Blob([decrypted], { type: meta.mime });
            const blobUrl = URL.createObjectURL(blob);

            if (this.onFileReceived) {
                this.onFileReceived(blobUrl, meta.mime, meta.name);
            }
        } catch (e) {
            console.error('[Group] file decrypt error:', e);
        }
    }


    // ─── Send Typing Indicator ──────────────────────────────────────────────────
    sendTyping(isTyping) {
        if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            this.ws.send(JSON.stringify({ type: 'relay-typing', isTyping }));
        } catch (e) { /* ignore */ }
    }

    // ─── Heartbeat ──────────────────────────────────────────────────────────────
    _startHeartbeat() {
        this._stopHeartbeat();
        this._pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
            }
        }, 25000);
    }

    _stopHeartbeat() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    // ─── Reconnect ──────────────────────────────────────────────────────────────
    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Start at 500ms, cap at 8s — same tuning as P2P side for consistency
            const delay = Math.min(500 * Math.pow(1.8, this.reconnectAttempts - 1), 8000);
            console.log(`[Group] WS reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimer = setTimeout(async () => {
                if (!this._destroyed) await this.connect(this.roomId, this.myName, this.cryptoManager);
            }, delay);
        } else {
            console.error('[Group] Max reconnection attempts reached.');
            alert('Lost connection to group server. Please refresh the page.');
        }
    }

    // ─── Destroy ────────────────────────────────────────────────────────────────
    destroy() {
        this._destroyed = true;
        this._connected = false;
        this._stopHeartbeat();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
    }
}

window.GroupChatManager = GroupChatManager;
