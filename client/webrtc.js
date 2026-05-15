class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected, myName) {
        this.signalingUrl         = signalingUrl;
        this.myName               = myName || 'Anonymous';
        this.ws                   = null;
        this.peerConnection       = null;
        this.dataChannel          = null;
        this.roomId               = null;
        this.reconnectAttempts    = 0;
        this.maxReconnectAttempts = 20;
        this.reconnectTimer       = null;
        this.iceCandidateQueue    = [];
        this.p2pConnected         = false;
        this.disconnectTimer      = null;
        this._destroyed           = false;
        this._pingInterval        = null;
        this._isOfferer           = false;
        this._retryTimer          = null;
        this._negotiating         = false;
        this._peerConnectedFired  = false;
        this._iceRestartAttempts  = 0;

        // ── Relay fallback (used when WebRTC/TURN fails across networks) ──────
        // Set by the caller (main.js) before connectToSignaling() is called.
        this.relayMode         = false;
        this.onRelayModeActive = null;   // callback: (isReconnect) => void

        this.onMessageReceived  = onMessageReceived;
        this.onPeerConnected    = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        this.config = {
            iceTransportPolicy: 'all',
            iceServers: [
                // ── STUN — public servers for NAT traversal ──────────────────
                {
                    urls: [
                        'stun:stun.l.google.com:19302',
                        'stun:stun1.l.google.com:19302',
                        'stun:stun2.l.google.com:19302',
                        'stun:stun3.l.google.com:19302',
                        'stun:stun4.l.google.com:19302'
                    ]
                },
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                { urls: 'stun:stun.stunprotocol.org:3478' },
                // ── TURN — relay for symmetric NAT (mobile data, corporate) ──
                // Port 80 UDP/TCP — less blocked than 3478
                // Port 443 TLS   — passes through almost all firewalls
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:80?transport=tcp',
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username:   'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            // Larger pool pre-gathers more candidates before offer is sent,
            // significantly reducing connection time on different networks.
            iceCandidatePoolSize: 10,
            bundlePolicy:  'max-bundle',
            rtcpMuxPolicy: 'require'
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIGNALING CONNECTION
    // ─────────────────────────────────────────────────────────────────────────

    connectToSignaling(roomId) {
        this.roomId     = roomId;
        this._destroyed = false;

        let wsUrl = this.signalingUrl;
        if      (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
        else if (wsUrl.startsWith('http://'))  wsUrl = wsUrl.replace('http://',  'ws://');

        console.log('[WS] Connecting to:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

            this._startHeartbeat();

            // Always re-join so the server can restore room state / grace period
            this.ws.send(JSON.stringify({
                type:   'join',
                roomId: this.roomId,
                name:   this.myName,
                mode:   'p2p'
            }));
        };

        this.ws.onerror = (err) => console.error('[WS] Error:', err);

        this.ws.onclose = (event) => {
            console.log('[WS] Closed:', event.code);
            this._stopHeartbeat();
            if (!this._destroyed) this._scheduleReconnect();
        };

        this.ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);

                // Server keep-alive messages — ignore both variants
                if (msg.type === 'pong' || msg.type === 'server-ping') return;

                // ── Relay-P2P fallback message ──────────────────────────────────
                // When WebRTC fails, the server routes encrypted payloads through
                // relay-p2p-msg. Pass directly to the application message handler.
                if (msg.type === 'relay-p2p-msg') {
                    if (this.relayMode && this.onMessageReceived && msg.payload) {
                        this.onMessageReceived(msg.payload);
                    }
                    return;
                }

                await this.handleSignalingMessage(msg);
            } catch (e) {
                console.error('[WS] Message parse error:', e);
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HEARTBEAT
    // ─────────────────────────────────────────────────────────────────────────

    _startHeartbeat() {
        this._stopHeartbeat();
        this._pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
            }
        }, 20000);
    }

    _stopHeartbeat() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECONNECT
    // ─────────────────────────────────────────────────────────────────────────

    _scheduleReconnect() {
        if (this._destroyed) return;

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(800 * Math.pow(1.8, this.reconnectAttempts - 1), 8000);

            // After 3 failed attempts the server is likely cold-starting on Render
            // Notify the application layer so it can show a helpful UI hint.
            if (this.reconnectAttempts === 3 && this.onServerWakingUp) {
                this.onServerWakingUp();
            }

            console.log(`[WS] Reconnect #${this.reconnectAttempts} in ${Math.round(delay)}ms`);
            this.reconnectTimer = setTimeout(() => {
                if (!this._destroyed) this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            if (!this.p2pConnected) alert('Lost connection to server. Please refresh.');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIGNALING MESSAGE HANDLER
    // ─────────────────────────────────────────────────────────────────────────

    async handleSignalingMessage(message) {
        if (this._destroyed) return;

        switch (message.type) {

            case 'ready':
                // We are the offerer — peer is already in the room
                console.log('[RTC] Received ready — initiating offer');
                this._isOfferer = true;
                this.relayMode  = false;
                this._cleanupPeerConnection();
                await this._initiateOffer();
                break;

            case 'peer-joined':
                // Answerer side: peer entered, wait for their offer
                console.log('[RTC] Peer joined room — waiting for offer');
                this.relayMode = false;
                if (!this.peerConnection) this.createPeerConnection();
                break;

            case 'signal':
                // Accept signals even if p2pConnected (ICE restart renegotiation)
                if (!this.peerConnection) this.createPeerConnection();
                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                console.log('[RTC] Peer left');
                this.p2pConnected        = false;
                this._peerConnectedFired = false;
                this.relayMode           = false;
                if (this.onPeerDisconnected) this.onPeerDisconnected();
                break;

            case 'peer-reconnected':
                // Server notifies first peer that its partner reconnected
                console.log('[RTC] Peer reconnected — resetting for new handshake');
                this._isOfferer = false;
                this.relayMode  = false;
                this._cleanupPeerConnection();
                this.createPeerConnection();
                break;

            case 'full':
                alert('Room is full. Please try a different room.');
                break;

            case 'locked':
                if (!this.p2pConnected) alert('Room is locked.');
                break;

            case 'error':
                console.error('[Server]', message.message);
                break;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PEER CONNECTION SETUP
    // ─────────────────────────────────────────────────────────────────────────

    createPeerConnection() {
        this._cleanupPeerConnection();

        this.peerConnection    = new RTCPeerConnection(this.config);
        this.iceCandidateQueue = [];
        this._iceRestartAttempts = 0;

        // ── Trickle ICE — send each candidate immediately ─────────────────────
        this.peerConnection.onicecandidate = ({ candidate }) => {
            if (candidate) this.sendSignal({ ice: candidate });
        };

        // ── ICE gathering state (debug) ────────────────────────────────────────
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('[ICE] Gathering:', this.peerConnection?.iceGatheringState);
        };

        // ── ICE connection state — fast failure detection + restart ───────────
        this.peerConnection.oniceconnectionstatechange = () => {
            const s = this.peerConnection?.iceConnectionState;
            console.log('[ICE] Connection state:', s);

            if (s === 'failed') {
                if (this._iceRestartAttempts < 2) {
                    // Attempt an in-place ICE restart before falling back
                    this._iceRestartAttempts++;
                    console.log(`[ICE] Restart attempt ${this._iceRestartAttempts}`);
                    this._attemptIceRestart();
                } else {
                    // ICE restart exhausted — activate relay fallback
                    console.warn('[ICE] All restarts failed — activating relay fallback');
                    this._activateRelayFallback();
                }
            } else if (s === 'connected' || s === 'completed') {
                this._iceRestartAttempts = 0;
            }
        };

        // ── Overall connection state ───────────────────────────────────────────
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log('[RTC] Connection state:', state);

            if (state === 'connected') {
                if (this.disconnectTimer) {
                    clearTimeout(this.disconnectTimer);
                    this.disconnectTimer = null;
                }

            } else if (state === 'disconnected') {
                // Short grace — transient network hiccup, wait before declaring failed
                if (!this.disconnectTimer) {
                    this.disconnectTimer = setTimeout(() => {
                        this.disconnectTimer = null;
                        const cur = this.peerConnection?.connectionState;
                        if (!this._destroyed && (cur === 'disconnected' || cur === 'failed')) {
                            console.warn('[RTC] Disconnect grace expired — connection still lost');
                            if (!this.relayMode) this._activateRelayFallback();
                        }
                    }, 5000);
                }

            } else if (state === 'failed') {
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
                if (!this._destroyed && !this.relayMode) this._activateRelayFallback();

            } else if (state === 'closed') {
                if (!this._destroyed && this.p2pConnected) {
                    this.p2pConnected        = false;
                    this._peerConnectedFired = false;
                    if (this.onPeerDisconnected) this.onPeerDisconnected();
                }
            }
        };

        // ── Answerer receives the DataChannel created by the offerer ──────────
        this.peerConnection.ondatachannel = (event) => {
            console.log('[RTC] DataChannel received from offerer');
            this._setupDataChannel(event.channel);
        };

        return this.peerConnection;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ICE RESTART
    // ─────────────────────────────────────────────────────────────────────────

    async _attemptIceRestart() {
        if (!this.peerConnection || this._destroyed) return;

        try {
            if (this._isOfferer) {
                // Offerer creates a new offer with iceRestart: true
                const offer = await this.peerConnection.createOffer({ iceRestart: true });
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal({ sdp: this.peerConnection.localDescription });
                console.log('[ICE] Restart offer sent');
            }
            // Answerer side: will receive the new offer via 'signal' and answer it
        } catch (e) {
            console.error('[ICE] Restart failed:', e);
            this._activateRelayFallback();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RELAY FALLBACK
    // ─────────────────────────────────────────────────────────────────────────

    _activateRelayFallback() {
        if (this.relayMode || this._destroyed) return;

        const wasConnected = this.p2pConnected;
        this.relayMode           = true;
        this.p2pConnected        = false;
        this._peerConnectedFired = false;

        console.log('[RELAY] Activating WebSocket relay fallback');

        if (this.onRelayModeActive) {
            this.onRelayModeActive(wasConnected);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATA CHANNEL
    // ─────────────────────────────────────────────────────────────────────────

    createDataChannel() {
        if (!this.peerConnection) return;
        const dc = this.peerConnection.createDataChannel('chat', { ordered: true });
        this._setupDataChannel(dc);
    }

    _setupDataChannel(channel) {
        this.dataChannel            = channel;
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            console.log('[DC] Open');
            if (!this._peerConnectedFired) {
                this._peerConnectedFired = true;
                this.p2pConnected        = true;
                this.relayMode           = false;
                if (this.disconnectTimer) {
                    clearTimeout(this.disconnectTimer);
                    this.disconnectTimer = null;
                }
                if (this.onPeerConnected) this.onPeerConnected();
            }
        };

        this.dataChannel.onclose = () => {
            console.log('[DC] Closed');
            if (!this._destroyed && this.p2pConnected) {
                this.p2pConnected        = false;
                this._peerConnectedFired = false;
                if (this.onPeerDisconnected) this.onPeerDisconnected();
            }
        };

        this.dataChannel.onerror = (e) => console.error('[DC] Error:', e);

        this.dataChannel.onmessage = (event) => {
            if (this.onMessageReceived) this.onMessageReceived(event.data);
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OFFER / ANSWER
    // ─────────────────────────────────────────────────────────────────────────

    async _initiateOffer() {
        if (this._destroyed) return;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }

        this.createPeerConnection();
        this.createDataChannel();

        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            console.log('[RTC] Offer created and sent');
            this.sendSignal({ sdp: this.peerConnection.localDescription });
        } catch (e) {
            console.error('[RTC] Offer error:', e);
        }
    }

    // ── FIX: single clean setRemoteDescription, correct else-if for ICE ──────
    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {
            try {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload.sdp)
                );

                console.log('[RTC] Remote description set:', payload.sdp.type);

                // Drain any ICE candidates that arrived before remote desc was ready
                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();
                    try {
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
                    } catch (e) {
                        console.warn('[ICE] Queued candidate error:', e.message);
                    }
                }

                // If we received an offer, create and send an answer
                if (payload.sdp.type === 'offer') {
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    console.log('[RTC] Answer created and sent');
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                }

            } catch (e) {
                console.error('[RTC] Remote description error:', e);
            }

        } else if (payload.ice) {
            try {
                if (this.peerConnection.remoteDescription) {
                    await this.peerConnection.addIceCandidate(
                        new RTCIceCandidate(payload.ice)
                    );
                } else {
                    // Queue until remote description is set
                    this.iceCandidateQueue.push(payload.ice);
                }
            } catch (e) {
                console.error('[ICE] Candidate error:', e);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /** Send a WebRTC signaling payload through the WebSocket */
    sendSignal(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type:   'signal',
                    roomId: this.roomId,
                    payload
                }));
            } catch (e) {
                console.error('[WS] sendSignal error:', e);
            }
        }
    }

    /**
     * Send a message (string or binary) over the DataChannel.
     * Falls back to WebSocket relay if relayMode is active.
     * Returns true if the message was sent, false otherwise.
     */
    sendMessage(data) {
        // ── Direct P2P via DataChannel ────────────────────────────────────────
        if (!this.relayMode && this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(data);
                return true;
            } catch (e) {
                console.error('[DC] sendMessage error:', e);
                return false;
            }
        }

        // ── Relay fallback via WebSocket ──────────────────────────────────────
        if (this.relayMode && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type:    'relay-p2p-msg',
                    roomId:  this.roomId,
                    payload: typeof data === 'string' ? data : null
                }));
                return true;
            } catch (e) {
                console.error('[RELAY] sendMessage error:', e);
                return false;
            }
        }

        return false;
    }

    /** Returns the RTCPeerConnection (used by audio/media call manager) */
    getPeerConnection() {
        return this.peerConnection;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────

    _cleanupPeerConnection() {
        if (this.dataChannel) {
            try { this.dataChannel.close(); } catch (e) {}
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.onicecandidate           = null;
            this.peerConnection.oniceconnectionstatechange = null;
            this.peerConnection.onconnectionstatechange  = null;
            this.peerConnection.onicegatheringstatechange = null;
            this.peerConnection.ondatachannel            = null;
            try { this.peerConnection.close(); } catch (e) {}
            this.peerConnection = null;
        }
        this.iceCandidateQueue   = [];
        this._peerConnectedFired = false;
    }

    destroy() {
        this._destroyed   = true;
        this.p2pConnected = false;
        this.relayMode    = false;

        this._stopHeartbeat();

        if (this.reconnectTimer)  { clearTimeout(this.reconnectTimer);  this.reconnectTimer  = null; }
        if (this._retryTimer)     { clearTimeout(this._retryTimer);     this._retryTimer     = null; }
        if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }

        this._cleanupPeerConnection();

        if (this.ws) {
            try { this.ws.close(); } catch (e) {}
            this.ws = null;
        }
    }
}