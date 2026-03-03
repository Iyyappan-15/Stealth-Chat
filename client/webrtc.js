class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected) {
        this.signalingUrl = signalingUrl;
        this.ws = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.roomId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimer = null;
        this.iceCandidateQueue = [];
        this._disconnectTimer = null; // grace-period before declaring peer gone
        this._pingInterval = null;    // WebSocket keepalive

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        // ICE Servers
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 10
        };
    }

    connectToSignaling(roomId) {
        this.roomId = roomId;
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
            console.log('Connected to Signaling Server');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.ws.send(JSON.stringify({ type: 'join', roomId: this.roomId }));

            // Keepalive ping every 25s — prevents idle proxy/Render WebSocket drops
            if (this._pingInterval) clearInterval(this._pingInterval);
            this._pingInterval = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 25000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed — signaling only, P2P lives on');
            if (this._pingInterval) {
                clearInterval(this._pingInterval);
                this._pingInterval = null;
            }
            // Reconnect signaling ONLY. Do NOT touch the P2P connection.
            this.handleReconnection();
        };

        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            this.handleSignalingMessage(message);
        };
    }

    handleReconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
            console.log(`Signaling reconnect in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            this.reconnectTimer = setTimeout(() => {
                this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            console.error('Max signaling reconnection attempts reached.');
            alert('Lost connection to the signaling server. Please refresh the page.');
        }
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'ready':
                this.createPeerConnection();
                this.createDataChannel();
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal({ sdp: this.peerConnection.localDescription });
                break;

            case 'signal':
                if (!this.peerConnection) this.createPeerConnection();
                const payload = message.payload;

                if (payload.sdp) {
                    console.log('Setting remote description:', payload.sdp.type);
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                    while (this.iceCandidateQueue.length > 0) {
                        const candidate = this.iceCandidateQueue.shift();
                        try {
                            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (e) {
                            console.error('Error adding queued ice candidate', e);
                        }
                    }

                    if (payload.sdp.type === 'offer') {
                        const answer = await this.peerConnection.createAnswer();
                        await this.peerConnection.setLocalDescription(answer);
                        this.sendSignal({ sdp: this.peerConnection.localDescription });
                    }
                } else if (payload.ice) {
                    try {
                        if (this.peerConnection.remoteDescription) {
                            await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.ice));
                        } else {
                            this.iceCandidateQueue.push(payload.ice);
                        }
                    } catch (e) {
                        console.error('Error adding received ice candidate', e);
                    }
                }
                break;

            case 'peer-left':
                // WebSocket signaling dropped — P2P DataChannel survives independently
                console.log('Signaling: peer WebSocket left. P2P connection continues.');
                break;

            case 'pong':
                // Keepalive acknowledged
                break;

            case 'full':
                alert('Room is full! This room already has 2 members.');
                window.location.reload();
                break;

            case 'locked':
                alert('⚠️ ROOM LOCKED\n\n' + (message.message || 'This room is already in use. Please create a new room.'));
                window.location.reload();
                break;

            case 'error':
                console.error('Server error:', message.message);
                break;
        }
    }

    createPeerConnection() {
        if (this.peerConnection) return;

        this.peerConnection = new RTCPeerConnection(this.config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({ ice: event.candidate });
            }
        };

        // ── CORE FIX: 'disconnected' is TEMPORARY and self-recoverable ──
        // WebRTC state machine: new → connecting → connected ↔ disconnected → failed/closed
        // 'disconnected' fires on: brief network blip, screen lock, mobile Wi-Fi switch.
        // It can recover back to 'connected' AUTOMATICALLY — we must NOT call onPeerDisconnected here.
        // Only 'failed' and 'closed' are terminal. For 'disconnected' we wait 8s grace period.
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection ? this.peerConnection.connectionState : 'unknown';
            console.log('P2P Connection State:', state);

            if (state === 'connected') {
                // Cancel any pending grace-period timer — connection recovered
                if (this._disconnectTimer) {
                    clearTimeout(this._disconnectTimer);
                    this._disconnectTimer = null;
                    console.log('P2P recovered from temporary disconnect.');
                }
            } else if (state === 'disconnected') {
                // Temporary — wait 8 seconds before giving up
                console.log('P2P temporarily disconnected — waiting 8s for auto-recovery...');
                if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
                this._disconnectTimer = setTimeout(() => {
                    const s = this.peerConnection ? this.peerConnection.connectionState : 'closed';
                    if (s !== 'connected') {
                        console.log('No recovery after 8s (state: ' + s + ') — peer is gone.');
                        this._triggerPeerDisconnected();
                    }
                }, 8000);
            } else if (state === 'failed' || state === 'closed') {
                // Terminal states — fire immediately
                if (this._disconnectTimer) {
                    clearTimeout(this._disconnectTimer);
                    this._disconnectTimer = null;
                }
                this._triggerPeerDisconnected();
            }
        };

        // ICE restart on failure as a last resort before giving up
        this.peerConnection.oniceconnectionstatechange = () => {
            const iceState = this.peerConnection ? this.peerConnection.iceConnectionState : 'unknown';
            console.log('ICE State:', iceState);
            if (iceState === 'failed' && this.peerConnection) {
                console.log('ICE failed — attempting ICE restart...');
                this.peerConnection.restartIce();
            }
        };

        // Handle receiving Data Channel (Answerer side)
        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    _triggerPeerDisconnected() {
        // Guard against double-trigger
        if (!this.peerConnection && !this.dataChannel) return;
        this.cleanup();
        if (this.onPeerDisconnected) this.onPeerDisconnected();
    }

    createDataChannel() {
        this.dataChannel = this.peerConnection.createDataChannel('chat', {
            ordered: true,
            maxRetransmits: 10
        });
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.onopen = () => {
            console.log('Data Channel OPEN');
            if (this.onPeerConnected) this.onPeerConnected();
        };
        this.dataChannel.onmessage = (event) => {
            if (this.onMessageReceived) this.onMessageReceived(event.data);
        };
        this.dataChannel.onerror = (err) => {
            console.error('DataChannel error:', err);
        };
    }

    sendSignal(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'signal', roomId: this.roomId, payload }));
        } else {
            console.warn('sendSignal skipped — WebSocket not open');
        }
    }

    sendMessage(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
            return true;
        }
        return false;
    }

    cleanup() {
        if (this._disconnectTimer) {
            clearTimeout(this._disconnectTimer);
            this._disconnectTimer = null;
        }
        try { if (this.peerConnection) this.peerConnection.close(); } catch (e) { }
        try { if (this.dataChannel) this.dataChannel.close(); } catch (e) { }
        this.peerConnection = null;
        this.dataChannel = null;
    }

    /** Expose RTCPeerConnection to MediaCallManager for audio track addition */
    getPeerConnection() {
        return this.peerConnection;
    }
}

// Expose globally
window.WebRTCManager = WebRTCManager;
