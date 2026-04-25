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
        this._destroyed = false;    // only true when user explicitly terminates
        this._pingInterval = null;  // WebSocket heartbeat to keep Render alive

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        this.config = {
            // ── ICE Servers ──────────────────────────────────────────────
            // Multiple STUN providers for redundancy + faster candidate gathering.
            // TURN servers provide fallback relay when direct P2P is blocked.
            iceServers: [
                // Google STUN — fastest, most reliable
                { urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302'
                ]},
                // Cloudflare STUN — low-latency global anycast
                { urls: 'stun:stun.cloudflare.com:3478' },
                // Twilio STUN — enterprise-grade
                { urls: 'stun:global.stun.twilio.com:3478' },
                // Open Relay TURN (UDP 80) — least-blocked port
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:80?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                // Open Relay TURN (HTTPS 443) — works through most firewalls
                {
                    urls: [
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            // Pre-gather 15 candidates before signaling even begins → faster connect
            iceCandidatePoolSize: 15,
            // Single multiplexed transport → fewer round-trips, faster setup
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

        // Build wss:// URL from the configured server URL
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

            // Start heartbeat — sends a ping every 25s to keep Render/free-tier alive
            this._startHeartbeat();

            // Only rejoin if P2P is not already live
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
                // Ignore pong responses from our heartbeat
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
        }, 20000); // every 20 seconds — keeps Render/free-tier alive reliably
    }

    _stopHeartbeat() {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Cap at 8s (was 15s) — faster recovery without hammering the server
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
                if (this.p2pConnected) {
                    console.log('Got ready but P2P already connected — ignoring.');
                    break;
                }
                console.log('Received ready — creating offer');
                this._cleanupPeerConnection(); // clean any stale connection
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
                if (this.p2pConnected) {
                    console.log('Got signal but P2P already connected — ignoring.');
                    break;
                }
                if (!this.peerConnection) this.createPeerConnection();
                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                console.log('Peer WebSocket left. Watching P2P state...');
                // Don't wipe — P2P DataChannel may still be alive
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
                // Transient — give 4 seconds for ICE to recover (was 8s → snappier retry)
                console.log('P2P transient disconnect — waiting 4s for ICE recovery...');
                try { this.peerConnection.restartIce(); } catch (e) { /* not always available */ }

                this.disconnectTimer = setTimeout(() => {
                    if (!this.peerConnection) return;
                    const cur = this.peerConnection.connectionState;
                    if (cur === 'disconnected' || cur === 'failed') {
                        console.log('P2P did not recover — disconnecting.');
                        this._triggerDisconnect();
                    }
                }, 4000);

            } else if (state === 'failed') {
                // Failed = truly unrecoverable ICE failure
                console.log('P2P connection failed.');
                if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
                this._triggerDisconnect();

            } else if (state === 'closed') {
                // Only fire if we didn't already handle it
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
        this.p2pConnected = false;
        this._cleanupPeerConnection(); // only tear down P2P — keep WebSocket alive!
        if (this.onPeerDisconnected) this.onPeerDisconnected();
    }

    /** Tears down only the P2P layer (RTCPeerConnection + DataChannel). WebSocket stays alive. */
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
        // negotiated:false lets the browser handle channel setup automatically;
        // maxRetransmits:null + ordered:true = reliable ordered delivery (TCP-like)
        this.dataChannel = this.peerConnection.createDataChannel('chat', {
            ordered: true,
            // Increase buffer threshold for smoother high-volume transfers
            // (actual limit is browser-controlled but this hints preference)
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
            // Let onconnectionstatechange handle the recovery decision
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
            this.ws.onclose = null; // prevent reconnect loop
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
