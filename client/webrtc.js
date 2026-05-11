class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected, myName) {
        this.signalingUrl         = signalingUrl;
        this.myName               = myName || 'Anonymous';
        this.ws                   = null;
        this.peerConnection       = null;
        this.dataChannel          = null;
        this.roomId               = null;
        this.reconnectAttempts    = 0;
        this.maxReconnectAttempts = 12;
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

        this.onMessageReceived  = onMessageReceived;
        this.onPeerConnected    = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        this.config = {
            iceServers: [
                {
                    urls: [
                        'stun:stun.l.google.com:19302',
                        'stun:stun1.l.google.com:19302',
                        'stun:stun2.l.google.com:19302'
                    ]
                },
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:global.stun.twilio.com:3478' },
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
            iceCandidatePoolSize: 4,
            bundlePolicy:   'max-bundle',
            rtcpMuxPolicy:  'require'
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIGNALING CONNECTION
    // ─────────────────────────────────────────────────────────────────────────

    connectToSignaling(roomId) {
        this.roomId   = roomId;
        this._destroyed = false;

        let wsUrl = this.signalingUrl;
        if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
        else if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');

        console.log('[WS] Connecting to:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

            this._startHeartbeat();

            if (!this.p2pConnected) {
                this.ws.send(JSON.stringify({
                    type:   'join',
                    roomId: this.roomId,
                    name:   this.myName,
                    mode:   'p2p'
                }));
            }
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
                if (msg.type === 'pong') return;
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
            console.log(`[WS] Reconnect #${this.reconnectAttempts} in ${Math.round(delay)}ms`);
            this.reconnectTimer = setTimeout(() => {
                if (!this._destroyed) {
                    this.connectToSignaling(this.roomId);
                }
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
                if (this.p2pConnected) break;
                this._isOfferer = true;

                this._cleanupPeerConnection();

                await this._initiateOffer();
                break;

            case 'peer-joined':
                // Answerer side: peer entered, offerer will get 'ready'
                console.log('[RTC] Peer joined room');
                break;

            case 'signal':
                if (this.p2pConnected) break;
                if (!this.peerConnection) this.createPeerConnection();
                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                console.log('[RTC] Peer left');
                if (this.p2pConnected) {
                    this.p2pConnected        = false;
                    this._peerConnectedFired = false;
                    if (this.onPeerDisconnected) this.onPeerDisconnected();
                }
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

        // Trickle ICE — send each candidate to peer as it arrives
        this.peerConnection.onicecandidate = ({ candidate }) => {
            if (candidate) this.sendSignal({ ice: candidate });
        };

        // ICE gathering state (debug)
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('[ICE] Gathering:', this.peerConnection?.iceGatheringState);
        };

        // Connection state machine
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log('[RTC] Connection state:', state);

            if (state === 'connected') {
                // Cancel any pending disconnect timer
                if (this.disconnectTimer) {
                    clearTimeout(this.disconnectTimer);
                    this.disconnectTimer = null;
                }

            } else if (state === 'disconnected' || state === 'failed') {
                // Grace period — transient drops shouldn't immediately disconnect
                if (!this.disconnectTimer) {
                    this.disconnectTimer = setTimeout(() => {
                        this.disconnectTimer = null;
                        if (!this._destroyed && this.p2pConnected) {
                            this.p2pConnected        = false;
                            this._peerConnectedFired = false;
                            if (this.onPeerDisconnected) this.onPeerDisconnected();
                        }
                    }, 4000);
                }

            } else if (state === 'closed') {
                if (!this._destroyed && this.p2pConnected) {
                    this.p2pConnected        = false;
                    this._peerConnectedFired = false;
                    if (this.onPeerDisconnected) this.onPeerDisconnected();
                }
            }
        };

        // Answerer receives the DataChannel that the offerer created
        this.peerConnection.ondatachannel = (event) => {
            console.log('[RTC] DataChannel received from offerer');
            this._setupDataChannel(event.channel);
        };

        return this.peerConnection;
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
        this.dataChannel           = channel;
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            console.log('[DC] Open');
            if (!this._peerConnectedFired) {
                this._peerConnectedFired = true;
                this.p2pConnected        = true;
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
            this.sendSignal({ sdp: this.peerConnection.localDescription });
        } catch (e) {
            console.error('[RTC] Offer error:', e);
        }
    }

    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {
            try {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload.sdp)
                );

            try {

                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload.sdp)
                );

                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();
                    try { await this.peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
                }

                if (payload.sdp.type === 'offer') {

                    const answer = await this.peerConnection.createAnswer();

                    await this.peerConnection.setLocalDescription(answer);
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
                    this.iceCandidateQueue.push(payload.ice);
                }

            } catch (e) {
                console.error('[RTC] ICE candidate error:', e);
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
                    type:    'signal',
                    roomId:  this.roomId,
                    payload
                }));
            } catch (e) {
                console.error('[WS] sendSignal error:', e);
            }
        }
    }

    /** Send a message (string or binary) over the DataChannel */
    sendMessage(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(data);
            } catch (e) {
                console.error('[DC] sendMessage error:', e);
            }
        }
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
            this.peerConnection.onicecandidate      = null;
            this.peerConnection.onconnectionstatechange = null;
            this.peerConnection.ondatachannel       = null;
            try { this.peerConnection.close(); } catch (e) {}
            this.peerConnection = null;
        }
        this.iceCandidateQueue   = [];
        this._peerConnectedFired = false;
    }

    destroy() {
        this._destroyed   = true;
        this.p2pConnected = false;

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