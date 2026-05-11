class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected, myName) {
        this.signalingUrl    = signalingUrl;
        this.myName          = myName || 'Anonymous';
        this.ws              = null;
        this.peerConnection  = null;
        this.dataChannel     = null;
        this.roomId          = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;   // ~3 minutes of retries
        this.reconnectTimer  = null;
        this.iceCandidateQueue = [];
        this.p2pConnected    = false;
        this.disconnectTimer = null;
        this._destroyed      = false;
        this._pingInterval   = null;

        // ── Relay mode (fallback when P2P/TURN fails) ──────────────────────
        // When ICE fails across different networks, we transparently relay
        // messages through the Render WebSocket server. Messages are still
        // AES-256 encrypted end-to-end — the server only sees ciphertext.
        this.relayMode       = false;
        this._iceTimer       = null;     // 25s timer before giving up on P2P

        // Callbacks
        this.onMessageReceived  = onMessageReceived;
        this.onPeerConnected    = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;
        this.onRelayModeActive  = null;  // set by main.js

        this.config = {
            iceServers: [
                // ── STUN (reflexive address discovery) ──────────────────────
                { urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302'
                ]},
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                { urls: 'stun:freestun.net:3478' },
                // ── TURN primary (relay when NAT blocks direct P2P) ─────────
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:80?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: [
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // ── TURN backup ─────────────────────────────────────────────
                {
                    urls: [
                        'turn:freestun.net:3478',
                        'turns:freestun.net:5349'
                    ],
                    username: 'free',
                    credential: 'free'
                }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
    }

    // ─────────────────────────────────────────────
    // WebSocket CONNECTION
    // ─────────────────────────────────────────────

    connectToSignaling(roomId) {
        this.roomId   = roomId;
        this._destroyed = false;

        let wsUrl = this.signalingUrl;
        if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
        else if (wsUrl.startsWith('http://'))  wsUrl = wsUrl.replace('http://', 'ws://');

        console.log('[WS] Connecting to:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Connected to signaling server');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            this._startHeartbeat();

            // Always re-join on (re)connect so server knows we're here
            this.ws.send(JSON.stringify({
                type: 'join', roomId: this.roomId, name: this.myName, mode: 'p2p'
            }));

            // If we were in relay mode and WS dropped, re-activate relay
            if (this.relayMode && this.onRelayModeActive) {
                setTimeout(() => { if (!this._destroyed) this.onRelayModeActive(true); }, 500);
            }
        };

        this.ws.onerror = (err) => console.error('[WS] Error:', err);

        this.ws.onclose = (event) => {
            console.log('[WS] Closed. Code:', event.code);
            this._stopHeartbeat();
            if (!this._destroyed) this._scheduleReconnect();
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'pong') return;
                await this.handleSignalingMessage(message);
            } catch (e) {
                console.error('[WS] Message error:', e);
            }
        };
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
            }
        }, 20000);
    }

    _stopHeartbeat() {
        if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    }

    _scheduleReconnect() {
        if (this._destroyed || this.reconnectTimer) return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Cap at 8s — gives ~3 minutes of retry window at max attempts
            const delay = Math.min(800 * Math.pow(1.5, this.reconnectAttempts - 1), 8000);
            console.log(`[WS] Reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this._destroyed) this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            console.error('[WS] Max reconnection attempts reached.');
            alert('Lost connection to server. Please refresh the page to try again.');
        }
    }

    // ─────────────────────────────────────────────
    // SIGNALING MESSAGE HANDLING
    // ─────────────────────────────────────────────

    async handleSignalingMessage(message) {
        if (this._destroyed) return;

        switch (message.type) {

            case 'ready':
                // If already in relay mode, skip P2P re-attempt silently
                if (this.relayMode) {
                    console.log('[P2P] In relay mode — ignoring ready, staying on relay.');
                    break;
                }
                if (this.p2pConnected) {
                    console.log('[P2P] Already connected — ignoring ready.');
                    break;
                }
                console.log('[P2P] Got ready — creating offer');
                this._cleanupPeerConnection();
                this.createPeerConnection();
                this.createDataChannel();
                this._startIceTimer(); // 25s fallback to relay
                try {
                    const offer = await this.peerConnection.createOffer();
                    await this.peerConnection.setLocalDescription(offer);
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                } catch (e) {
                    console.error('[P2P] Offer error:', e);
                }
                break;

            case 'signal':
                if (this.relayMode) break;   // in relay, ignore P2P signals
                if (this.p2pConnected) break;
                if (!this.peerConnection) {
                    this.createPeerConnection();
                    this._startIceTimer(); // 25s fallback to relay
                }
                await this._handleSignalPayload(message.payload);
                break;

            // ── Relay fallback: server forwards encrypted message between peers
            case 'relay-p2p-msg':
                if (this.onMessageReceived) this.onMessageReceived(message.payload);
                break;

            case 'peer-left':
                console.log('[P2P] Peer WebSocket left — cleaning up P2P...');
                if (this.relayMode) {
                    // In relay mode, peer-left means their WS dropped.
                    // We'll wait for them to reconnect via scheduleReconnect on their end.
                    if (this.onPeerDisconnected) this.onPeerDisconnected();
                } else if (this.peerConnection || this.p2pConnected) {
                    this.p2pConnected = false;
                    this._cleanupPeerConnection();
                    if (this.onPeerDisconnected) this.onPeerDisconnected();
                }
                break;

            case 'full':
                alert('Room is full! This room already has 2 members.');
                window.location.reload();
                break;

            case 'locked':
                if (this.p2pConnected || this.relayMode) {
                    console.log('[P2P] Locked msg but session active — ignoring.');
                    break;
                }
                alert('⚠️ ROOM LOCKED\n\nThis room is already in use. Please create a new room.');
                window.location.reload();
                break;

            case 'error':
                console.error('[Server] Error:', message.message);
                if (!this.p2pConnected && !this.relayMode) {
                    alert('Server error: ' + message.message);
                }
                break;
        }
    }

    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {
            console.log('[P2P] Setting remote description:', payload.sdp.type);
            try {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();
                    try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
                    catch (e) { /* ignore stale */ }
                }

                if (payload.sdp.type === 'offer') {
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                }
            } catch (e) {
                console.error('[P2P] Remote description error:', e);
            }
        } else if (payload.ice) {
            try {
                if (this.peerConnection.remoteDescription) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.ice));
                } else {
                    this.iceCandidateQueue.push(payload.ice);
                }
            } catch (e) {
                console.error('[P2P] ICE candidate error:', e);
            }
        }
    }

    // ─────────────────────────────────────────────
    // ICE TIMEOUT → RELAY FALLBACK
    // ─────────────────────────────────────────────

    /**
     * Start a 25-second timer. If P2P has not reached 'connected' by then,
     * silently switch to WebSocket relay so the session is never stuck.
     */
    _startIceTimer() {
        this._clearIceTimer();
        this._iceTimer = setTimeout(() => {
            if (!this.p2pConnected && !this.relayMode && !this._destroyed) {
                console.log('[P2P] ICE timeout (25s) — switching to WebSocket relay mode.');
                this._switchToRelayMode();
            }
        }, 25000);
    }

    _clearIceTimer() {
        if (this._iceTimer) { clearTimeout(this._iceTimer); this._iceTimer = null; }
    }

    /**
     * Switch transparently to WebSocket relay mode.
     * Called when ICE times out or connection state goes to 'failed'.
     * Messages are still AES-256 encrypted — server only sees ciphertext.
     */
    _switchToRelayMode() {
        if (this.relayMode || this._destroyed) return;
        console.log('[RELAY] Activating WebSocket relay mode (cross-network fallback).');
        this.relayMode = true;
        this._clearIceTimer();
        this._cleanupPeerConnection();
        if (this.onRelayModeActive) this.onRelayModeActive(false);
    }

    // ─────────────────────────────────────────────
    // PEER CONNECTION
    // ─────────────────────────────────────────────

    createPeerConnection() {
        if (this.peerConnection) return;
        this.peerConnection = new RTCPeerConnection(this.config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) this.sendSignal({ ice: event.candidate });
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (!this.peerConnection) return;
            const state = this.peerConnection.connectionState;
            console.log('[P2P] Connection state:', state);

            if (state === 'connected') {
                this.p2pConnected = true;
                this._clearIceTimer();
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }

            } else if (state === 'disconnected') {
                console.log('[P2P] Transient disconnect — waiting 10s for ICE/TURN recovery...');
                try { this.peerConnection.restartIce(); } catch (e) { /* ignore */ }
                this.disconnectTimer = setTimeout(() => {
                    if (!this.peerConnection) return;
                    const cur = this.peerConnection.connectionState;
                    if (cur === 'disconnected' || cur === 'failed') {
                        console.log('[P2P] Did not recover — switching to relay.');
                        this._switchToRelayMode();
                    }
                }, 10000);

            } else if (state === 'failed') {
                console.log('[P2P] ICE failed — switching to WebSocket relay.');
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
                this._switchToRelayMode();

            } else if (state === 'closed') {
                if (this.p2pConnected) {
                    this.p2pConnected = false;
                    if (!this.relayMode && this.onPeerDisconnected) this.onPeerDisconnected();
                }
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    /** Tears down only the P2P layer. WebSocket stays alive for relay. */
    _cleanupPeerConnection() {
        this._clearIceTimer();
        if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
        if (this.dataChannel) {
            this.dataChannel.onclose = null;
            this.dataChannel.onerror = null;
            try { this.dataChannel.close(); } catch (e) { /* ignore */ }
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.onconnectionstatechange = null;
            this.peerConnection.onicecandidate = null;
            this.peerConnection.ondatachannel = null;
            try { this.peerConnection.close(); } catch (e) { /* ignore */ }
            this.peerConnection = null;
        }
        this.p2pConnected = false;
        this.iceCandidateQueue = [];
    }

    createDataChannel() {
        this.dataChannel = this.peerConnection.createDataChannel('chat', { ordered: true });
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.onopen = () => {
            console.log('[P2P] DataChannel OPEN');
            this._clearIceTimer();
            this.relayMode = false;  // P2P succeeded — disable relay
            this.p2pConnected = true;
            if (this.onPeerConnected) this.onPeerConnected();
        };
        this.dataChannel.onclose = () => {
            console.log('[P2P] DataChannel closed');
            this.p2pConnected = false;
        };
        this.dataChannel.onerror = (err) => console.error('[P2P] DataChannel error:', err);
        this.dataChannel.onmessage = (event) => {
            if (this.onMessageReceived) this.onMessageReceived(event.data);
        };
    }

    // ─────────────────────────────────────────────
    // SEND HELPERS
    // ─────────────────────────────────────────────

    sendSignal(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'signal', roomId: this.roomId, payload }));
        } else {
            console.warn('[P2P] Cannot send signal — WebSocket not open');
        }
    }

    sendMessage(data) {
        // Direct P2P DataChannel (fastest, most private)
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
            return true;
        }
        // WebSocket relay fallback (cross-network, still AES-256 encrypted)
        if (this.relayMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'relay-p2p-msg', roomId: this.roomId, payload: data }));
            return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────

    destroy() {
        this._destroyed = true;
        this.relayMode = false;
        this._stopHeartbeat();
        this._cleanupPeerConnection();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
    }

    cleanup() { this.destroy(); }

    getPeerConnection() { return this.peerConnection; }
}

window.WebRTCManager = WebRTCManager;
