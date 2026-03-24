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
                try {
                    const decryptedText = await this.cryptoManager.decryptMessage(msg.payload);
                    if (this.onMessageReceived) {
                        this.onMessageReceived(decryptedText, msg.fromName, msg.from);
                    }
                } catch (e) {
                    console.error('[Group] Decryption failed:', e);
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
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
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
