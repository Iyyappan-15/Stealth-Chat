class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected, myName) {
        this.signalingUrl = signalingUrl;
        this.myName = myName || 'Anonymous';
        this.ws = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.roomId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 12;
        this.reconnectTimer = null;
        this.iceCandidateQueue = [];
        this.p2pConnected = false;
        this.disconnectTimer = null;
        this._destroyed = false;
        this._pingInterval = null;
        this._isOfferer = false;   // true when this peer sent the original offer
        this._retryTimer = null;   // used to schedule ICE-failure retry
        this._negotiating = false; // guard against concurrent renegotiations

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        this.config = {
            iceServers: [
                { urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302'
                ]},
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:80?transport=tcp',
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 4,
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
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
            this._startHeartbeat();
            if (!this.p2pConnected) {
                this.ws.send(JSON.stringify({ type: 'join', roomId: this.roomId, name: this.myName, mode: 'p2p' }));
            } else {
                console.log('WS reconnected but P2P still alive — skipping room re-join.');
            }
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
                try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
            }
        }, 20000);
    }

    _stopHeartbeat() {
        if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    }

    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(800 * Math.pow(1.8, this.reconnectAttempts - 1), 8000);
            console.log(`WS reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => {
                if (!this._destroyed) this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            if (!this.p2pConnected) {
                console.error('Max WS reconnection attempts reached.');
                alert('Lost connection to server. Please refresh the page to try again.');
            }
        }
    }

    // ─────────────────────────────────────────────
    // SIGNALING MESSAGE HANDLING
    // ─────────────────────────────────────────────

    async handleSignalingMessage(message) {
        if (this._destroyed) return;

        switch (message.type) {

            case 'ready':
                // Server tells the SECOND peer (joiner) to start the offer.
                if (this.p2pConnected) {
                    console.log('Got ready but P2P already connected — ignoring.');
                    break;
                }
                console.log('Received ready — I am the offerer.');
                this._isOfferer = true;
                this._cleanupPeerConnection();
                await this._initiateOffer();
                break;

            case 'peer-joined':
                // Server tells the FIRST peer (host) that a second peer joined.
                // Peer B will send the offer; Peer A just waits for it via 'signal'.
                console.log(`Peer "${message.name}" joined the room — awaiting their offer.`);
                break;

            case 'signal':
                if (this.p2pConnected) {
                    console.log('Got signal but P2P already connected — ignoring.');
                    break;
                }
                // Answerer creates peer connection on first incoming signal
                if (!this.peerConnection) this.createPeerConnection();
                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                console.log('Peer WebSocket left. Watching P2P state...');
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
                if (!this.p2pConnected) alert('Server error: ' + message.message);
                break;
        }
    }

    // ─────────────────────────────────────────────
    // OFFER CREATION (offerer only)
    // ─────────────────────────────────────────────

    async _initiateOffer() {
        if (this._destroyed) return;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        this.createPeerConnection();
        this.createDataChannel();
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.sendSignal({ sdp: this.peerConnection.localDescription });
            console.log('Offer sent.');
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    }

    // ─────────────────────────────────────────────
    // SIGNAL PAYLOAD HANDLING
    // ─────────────────────────────────────────────

    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {
            console.log('Setting remote description:', payload.sdp.type);
            try {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                // Flush any ICE candidates that arrived before remote description
                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();
                    try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); }
                    catch (e) { console.error('Queued ICE error:', e); }
                }

                if (payload.sdp.type === 'offer') {
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    this.sendSignal({ sdp: this.peerConnection.localDescription });
                    console.log('Answer sent.');
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

        // Send each ICE candidate to the remote peer immediately
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({ ice: event.candidate });
            }
        };

        // onnegotiationneeded fires when restartIce() is called on an active connection.
        // We only handle it for ICE restart (not initial offer — that goes via _initiateOffer).
        this.peerConnection.onnegotiationneeded = async () => {
            // Only the offerer renegotiates; only act if connection was already established
            if (!this._isOfferer || !this.p2pConnected || this._negotiating) return;
            this._negotiating = true;
            try {
                const offer = await this.peerConnection.createOffer({ iceRestart: true });
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal({ sdp: this.peerConnection.localDescription });
                console.log('ICE restart offer sent.');
            } catch (e) {
                console.error('ICE restart offer error:', e);
            } finally {
                this._negotiating = false;
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (!this.peerConnection) return;
            const state = this.peerConnection.connectionState;
            console.log('P2P connection state:', state);

            if (state === 'connected') {
                this.p2pConnected = true;
                this._negotiating = false;
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
                if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }

            } else if (state === 'disconnected') {
                // Transient — give 4 s for ICE to auto-recover before giving up
                console.log('P2P transient disconnect — waiting 4s for ICE recovery...');
                try { this.peerConnection.restartIce(); } catch (e) { /* not always available */ }

                this.disconnectTimer = setTimeout(() => {
                    if (!this.peerConnection) return;
                    const cur = this.peerConnection.connectionState;
                    if (cur === 'disconnected' || cur === 'failed') {
                        console.log('P2P did not recover — triggering disconnect.');
                        this._triggerDisconnect();
                    }
                }, 4000);

            } else if (state === 'failed') {
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }

                if (this.p2pConnected) {
                    // Had a working connection before — treat as real disconnect
                    console.log('P2P failed after being connected — disconnecting.');
                    this._triggerDisconnect();
                } else {
                    // Failed during INITIAL negotiation — no UI error, just retry
                    console.log('Initial ICE negotiation failed.',
                        this._isOfferer ? 'Retrying offer in 2 s...' : 'Waiting for new offer...');
                    this._cleanupPeerConnection();

                    if (this._isOfferer) {
                        // Offerer automatically re-initiates after a brief pause.
                        // Answerer will createPeerConnection() when the new offer arrives via 'signal'.
                        this._retryTimer = setTimeout(() => {
                            if (!this._destroyed) {
                                console.log('Retrying offer...');
                                this._initiateOffer();
                            }
                        }, 2000);
                    }
                }

            } else if (state === 'closed') {
                if (this.p2pConnected) this._triggerDisconnect();
            }
        };

        // Answerer receives the data channel created by the offerer
        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    _triggerDisconnect() {
        if (this._destroyed) return;
        this.p2pConnected = false;
        this._cleanupPeerConnection();
        if (this.onPeerDisconnected) this.onPeerDisconnected();
    }

    /** Tears down only the P2P layer. WebSocket stays alive for re-pairing. */
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
            this.peerConnection.onnegotiationneeded = null;
            try { this.peerConnection.close(); } catch (e) { /* ignore */ }
            this.peerConnection = null;
        }
        this.p2pConnected = false;
        this._negotiating = false;
        this.iceCandidateQueue = [];
    }

    createDataChannel() {
        this.dataChannel = this.peerConnection.createDataChannel('chat', { ordered: true });
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            console.log('DataChannel OPEN — P2P connection established.');
            this.p2pConnected = true;
            if (this.onPeerConnected) this.onPeerConnected();
        };

        // If the channel was already open when ondatachannel fired (rare but possible),
        // call the open logic inline — don't invoke onopen directly as a function.
        if (this.dataChannel.readyState === 'open') {
            console.log('DataChannel was already OPEN on setup.');
            this.p2pConnected = true;
            if (this.onPeerConnected) this.onPeerConnected();
        }

        this.dataChannel.onclose = () => {
            console.log('DataChannel closed.');
            this.p2pConnected = false;
            // Let onconnectionstatechange decide whether to show disconnect UI
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
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        this._cleanupPeerConnection();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
    }

    /** Alias for compatibility */
    cleanup() { this.destroy(); }

    /** Expose RTCPeerConnection for MediaCallManager (audio tracks) */
    getPeerConnection() { return this.peerConnection; }
}

window.WebRTCManager = WebRTCManager;
