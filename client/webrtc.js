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
        this._isOfferer = false;
        this._retryTimer = null;
        this._negotiating = false;
        this._peerConnectedFired = false;

        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
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
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 4,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };
    }

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
            console.log('WebSocket connected');

            this.reconnectAttempts = 0;

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            this._startHeartbeat();

            if (!this.p2pConnected) {
                this.ws.send(JSON.stringify({
                    type: 'join',
                    roomId: this.roomId,
                    name: this.myName,
                    mode: 'p2p'
                }));
            }
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code);

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
                } catch (e) {}
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

        if (this.reconnectAttempts < this.maxReconnectAttempts) {

            this.reconnectAttempts++;

            const delay = Math.min(
                800 * Math.pow(1.8, this.reconnectAttempts - 1),
                8000
            );

            console.log(`Reconnect in ${delay}ms`);

            this.reconnectTimer = setTimeout(() => {
                if (!this._destroyed) {
                    this.connectToSignaling(this.roomId);
                }
            }, delay);

        } else {
            if (!this.p2pConnected) {
                alert('Lost connection to server.');
            }
        }
    }

    async handleSignalingMessage(message) {
        if (this._destroyed) return;

        switch (message.type) {

            case 'ready':
                if (this.p2pConnected) break;

                this._isOfferer = true;

                this._cleanupPeerConnection();

                await this._initiateOffer();
                break;

            case 'peer-joined':
                console.log('Peer joined room');
                break;

            case 'signal':
                if (this.p2pConnected) break;

                if (!this.peerConnection) {
                    this.createPeerConnection();
                }

                await this._handleSignalPayload(message.payload);
                break;

            case 'peer-left':
                console.log('Peer left');
                break;

            case 'full':
                alert('Room is full');
                break;

            case 'locked':
                if (this.p2pConnected) break;

                alert('Room locked');
                break;

            case 'error':
                console.error(message.message);
                break;
        }
    }

    async _initiateOffer() {
        if (this._destroyed) return;

        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }

        this.createPeerConnection();
        this.createDataChannel();

        try {
            const offer = await this.peerConnection.createOffer();

            await this.peerConnection.setLocalDescription(offer);

            this.sendSignal({
                sdp: this.peerConnection.localDescription
            });

        } catch (e) {
            console.error('Offer error:', e);
        }
    }

    async _handleSignalPayload(payload) {
        if (!payload || !this.peerConnection) return;

        if (payload.sdp) {

            try {

                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(payload.sdp)
                );

                while (this.iceCandidateQueue.length > 0) {
                    const c = this.iceCandidateQueue.shift();

                    try {
                        await this.peerConnection.addIceCandidate(
                            new RTCIceCandidate(c)
                        );
                    } catch (e) {}
                }

                if (payload.sdp.type === 'offer') {

                    const answer = await this.peerConnection.createAnswer();

                    await this.peerConnection.setLocalDescription(answer);

                    this.sendSignal({
                        sdp: this.peerConnection.localDescription
                    });
                }

            } catch (e) {
                console.error('Remote description error:', e);
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
                console.error('ICE candidate error:', e);
            }
        }
    }
}