class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected, myName) {
        this.signalingUrl = signalingUrl;
        this.myName = myName || 'Anonymous';
        this.ws = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.roomId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 15;
        this.reconnectTimer = null;
        this.iceCandidateQueue = [];
        this.p2pConnected = false;
        this.disconnectTimer = null;
        this._destroyed = false;
        this._pingInterval = null;
        this._wsForceReconnecting = false; // guard against double reconnect

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        this.config = {
            iceServers: [
                // ── STUN servers (discover public IP) ──────────────────────
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
                // ── TURN servers (relay when NAT blocks direct P2P) ─────────
                // Primary: Open Relay (UDP 80 — least-blocked port)
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:80?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // Secondary: Open Relay (HTTPS 443 — passes through most firewalls)
                {
                    urls: [
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // Backup: FreeStuN TURN (independent provider)
                {
                    urls: [
                        'turn:freestun.net:3478',
                        'turns:freestun.net:5349'
                    ],
                    username: 'free',
                    credential: 'free'
                }
            ],
            // Pre-gather 15 candidates before signaling begins → faster connect
            iceCandidatePoolSize: 15,
            iceTransportPolicy: 'all',   // try direct first, fall back to TURN
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
    }

    // ─────────────────────────────────────────────
    // WebSocket CONNECTION
    // ─────────────────────────────────────────────

    connectToSignaling(roomId) {
        this.roomId = roomId;
        this._destroyed = false;
        this._wsForceReconnecting = false;

        let wsUrl = this.signalingUrl;
        if (wsUrl.startsWith('https://')) {
            wsUrl = wsUrl.replace('https://', 'wss://');
        } else if (wsUrl.startsWith('http://')) {
            wsUrl = wsUrl.replace('http://', 'ws://');
        }

        console.log('Connecting WebSocket to:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected to signaling server');
            this.reconnectAttempts = 0;
            this._wsForceReconnecting = false;
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

            this._startHeartbeat();

            // ALWAYS re-join the room on every WS connect/reconnect.
            // The server's grace-period logic handles the case where both
            // peers reconnect after a transient failure.
            this.ws.send(JSON.stringify({
                type: 'join',
                roomId: this.roomId,
                name: this.myName,
                mode: 'p2p'
            }));
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket closed. Code:', event.code, 'Reason:', event.reason);
            this._stopHeartbeat();
            if (!this._destroyed) {
                this._scheduleReconnect();
            }
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'pong') return;
                await this.handleSignalingMessage(message);
            } catch (e) {
                console.error('Error handling WS message:', e);
            }
        };
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                } catch (e) { /* ignore */ }
            }
        }, 20000);
    }

    _stopHeartbeat() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.reconnectTimer) return; // already scheduled
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(800 * Math.pow(1.6, this.reconnectAttempts - 1), 8000);
            console.log(`WS reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this._destroyed) this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            if (!this.p2pConnected) {
                console.error('Max WS reconnection attempts reached.');
                alert('Lost connection to server. Please refresh the page to try again.');
            }
        }
    }

    /**
     * Force-close the WebSocket so the server removes us from the room,
     * then reconnect. This restarts the full signaling flow (re-join → ready →
     * offer/answer) which is the cleanest way to recover a failed P2P connection.
     */
    _forceWsReconnect(delayMs) {
        if (this._destroyed || this._wsForceReconnecting) return;
        this._wsForceReconnecting = true;

        this._stopHeartbeat();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

        // Detach onclose so it doesn't double-schedule via _scheduleReconnect
        if (this.ws) {
            const oldWs = this.ws;
            this.ws = null;
            oldWs.onclose = null;
            oldWs.onerror = null;
            oldWs.onmessage = null;
            try { oldWs.close(); } catch (e) { /* ignore */ }
        }

        const delay = delayMs || 1500;
        console.log(`Forcing WS reconnect in ${delay}ms to restart handshake...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._wsForceReconnecting = false;
            if (!this._destroyed) this.connectToSignaling(this.roomId);
        }, delay);
    }

    // ─────────────────────────────────────────────
    // SIGNALING MESSAGE HANDLING
    // ─────────────────────────────────────────────

    async handleSignalingMessage(message) {
        if (this._destroyed) return;

        switch (message.type) {
            case 'ready':
                // A new peer joined — always start fresh regardless of old p2pConnected state
                console.log('Received ready — creating offer');
                this._cleanupPeerConnection(); // clean any stale connection
                this.p2pConnected = false;
                this.createPeerConnection();
                this.createDataChannel();
                try {
                    const offer = await this.peerConnection.createOffer();
                    await this.peerConnection.setLocalDescription(offer);
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                } catch (e) {
                    console.error('Error creating offer:', e);
                }
                break;

            case 'signal':
                // Guard: if P2P is live and this is a duplicate signal, ignore
                if (this.p2pConnected) {
                    console.log('Got signal but P2P already connected — ignoring.');
                    break;
                }
                if (!this.peerConnection) this.createPeerConnection();
                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                // Peer's WebSocket dropped. Clean up P2P immediately.
                // When they reconnect (within the server grace period), we'll
                // receive a new signal and re-establish the connection.
                console.log('Peer WebSocket left — cleaning up P2P, awaiting re-join...');
                if (this.peerConnection || this.p2pConnected) {
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
                if (this.p2pConnected) {
                    console.log('Room locked msg during WS reconnect but P2P is alive — ignoring.');
                    break;
                }
                alert('⚠️ ROOM LOCKED\n\nThis room is already in use. Please create a new room.');
                window.location.reload();
                break;

            case 'error':
                console.error('Server error:', message.message);
                if (!this.p2pConnected) {
                    alert('Server error: ' + message.message);
                }
                break;
        }
    }

    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {
            console.log('Setting remote description:', payload.sdp.type);
            try {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                // Flush queued ICE candidates
                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();
                    try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
                    catch (e) { console.error('Queued ICE error:', e); }
                }

                if (payload.sdp.type === 'offer') {
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                }
            } catch (e) {
                console.error('Error setting remote description:', e);
            }
        } else if (payload.ice) {
            try {
                if (this.peerConnection.remoteDescription) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.ice));
                } else {
                    this.iceCandidateQueue.push(payload.ice);
                }
            } catch (e) {
                console.error('ICE candidate error:', e);
            }
        }
    }

    // ─────────────────────────────────────────────
    // PEER CONNECTION
    // ─────────────────────────────────────────────

    createPeerConnection() {
        if (this.peerConnection) return;

        this.peerConnection = new RTCPeerConnection(this.config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({ ice: event.candidate });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (!this.peerConnection) return;
            const state = this.peerConnection.connectionState;
            console.log('P2P state:', state);

            if (state === 'connected') {
                this.p2pConnected = true;
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }

            } else if (state === 'disconnected') {
                // Give ICE/TURN enough time to recover across different networks.
                // TURN relay negotiation can take up to 8-10s on different ISPs.
                console.log('P2P transient disconnect — waiting 10s for ICE/TURN recovery...');
                try { this.peerConnection.restartIce(); } catch (e) { /* not always available */ }

                this.disconnectTimer = setTimeout(() => {
                    if (!this.peerConnection) return;
                    const cur = this.peerConnection.connectionState;
                    if (cur === 'disconnected' || cur === 'failed') {
                        console.log('P2P did not recover after 10s — triggering disconnect.');
                        this._triggerDisconnect();
                    }
                }, 10000);

            } else if (state === 'failed') {
                console.log('P2P connection failed.');
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
                this._triggerDisconnect();

            } else if (state === 'closed') {
                if (this.p2pConnected) {
                    this._triggerDisconnect();
                }
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    _triggerDisconnect() {
        if (this._destroyed) return;
        console.log('_triggerDisconnect: cleaning P2P and forcing WS reconnect...');
        this.p2pConnected = false;
        this._cleanupPeerConnection();
        if (this.onPeerDisconnected) this.onPeerDisconnected();

        // Force-close and reconnect the WebSocket so the server removes us
        // from the room and resets the signaling state. When we reconnect,
        // we send 'join' again and the server's grace period restores the room.
        this._forceWsReconnect(1500);
    }

    /** Tears down only the P2P layer. WebSocket managed separately. */
    _cleanupPeerConnection() {
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
        this.dataChannel = this.peerConnection.createDataChannel('chat', {
            ordered: true
        });
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;

        this.dataChannel.onopen = () => {
            console.log('DataChannel OPEN');
            this.p2pConnected = true;
            if (this.onPeerConnected) this.onPeerConnected();
        };

        this.dataChannel.onclose = () => {
            console.log('DataChannel closed');
            // Let onconnectionstatechange drive the recovery decision
            this.p2pConnected = false;
        };

        this.dataChannel.onerror = (err) => {
            console.error('DataChannel error:', err);
        };

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
            console.warn('Cannot send signal — WebSocket not open');
        }
    }

    sendMessage(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
            return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────

    /** Full shutdown — called when the user deliberately terminates the session */
    destroy() {
        this._destroyed = true;
        this._stopHeartbeat();
        this._cleanupPeerConnection();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
    }

    /** Legacy alias used by main.js terminateSession / panic mode */
    cleanup() {
        this.destroy();
    }

    /** Expose RTCPeerConnection so MediaCallManager can add audio tracks */
    getPeerConnection() {
        return this.peerConnection;
    }
}

// Expose globally
window.WebRTCManager = WebRTCManager;
