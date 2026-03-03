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
        this.p2pConnected = false;       // track real P2P state separately from WebSocket
        this.disconnectTimer = null;     // delay before treating 'disconnected' as fatal
        this._intentionalClose = false;  // suppress reconnect on deliberate close

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

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
        this._intentionalClose = false;
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
            console.log('Connected to Signaling Server');
            this.reconnectAttempts = 0;
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

            // FIX: Only join if P2P is NOT already connected.
            // If WebSocket dropped and reconnected while P2P was still alive, skip re-join
            // to avoid hitting the room 'locked' / 'full' guard on the server.
            if (!this.p2pConnected) {
                this.ws.send(JSON.stringify({ type: 'join', roomId: this.roomId }));
            } else {
                console.log('WS reconnected but P2P still alive — skipping room re-join.');
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
            if (!this._intentionalClose) {
                this.handleReconnection();
            }
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
            console.log(`WS reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            this.reconnectTimer = setTimeout(() => {
                this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            if (!this.p2pConnected) {
                console.error('Max WS reconnection attempts reached.');
                alert('Lost connection to server. Please refresh the page to try again.');
            }
        }
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'ready':
                // FIX: Don't restart handshake if P2P already connected
                if (this.p2pConnected) {
                    console.log('Got ready signal but P2P already connected — ignoring.');
                    break;
                }
                this.createPeerConnection();
                this.createDataChannel();
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal({ sdp: this.peerConnection.localDescription });
                break;

            case 'signal':
                // FIX: Don't process new signals if P2P already connected
                if (this.p2pConnected) {
                    console.log('Got signal but P2P already connected — ignoring.');
                    break;
                }
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
                            console.error('Error adding queued ICE candidate:', e);
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
                        console.error('Error adding ICE candidate:', e);
                    }
                }
                break;

            case 'peer-left':
                // Signaling WS dropped — but P2P DataChannel may still be alive. Don't wipe.
                console.log('Peer WebSocket left. P2P may still be alive — waiting...');
                break;

            case 'full':
                alert('Room is full! This room already has 2 members.');
                window.location.reload();
                break;

            case 'locked':
                // FIX: If P2P is still alive a locked message during WS reconnect is harmless
                if (this.p2pConnected) {
                    console.log('Room locked msg received during WS reconnect but P2P alive — ignoring.');
                    break;
                }
                alert('⚠️ ROOM LOCKED\n\n' + (message.message || 'This room is already in use. Please create a new room.'));
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
            console.log('P2P Connection State:', state);

            if (state === 'connected') {
                this.p2pConnected = true;
                if (this.disconnectTimer) {
                    clearTimeout(this.disconnectTimer);
                    this.disconnectTimer = null;
                }
            } else if (state === 'disconnected') {
                // FIX: 'disconnected' is TRANSIENT — give it 8 seconds to self-recover via ICE
                // before tearing everything down and wiping messages.
                console.log('P2P transient disconnect — waiting 8s for ICE recovery...');

                // Try ICE restart immediately to speed up recovery
                try {
                    this.peerConnection.restartIce();
                    console.log('ICE restart triggered.');
                } catch (e) {
                    console.warn('ICE restart not available:', e);
                }

                this.disconnectTimer = setTimeout(() => {
                    if (!this.peerConnection) return;
                    const cur = this.peerConnection.connectionState;
                    if (cur === 'disconnected' || cur === 'failed') {
                        console.log('P2P did not recover after 8s — triggering disconnect.');
                        this._triggerDisconnect();
                    }
                }, 8000);
            } else if (state === 'failed' || state === 'closed') {
                // Truly terminal states — fire immediately
                if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
                this._triggerDisconnect();
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    _triggerDisconnect() {
        this.p2pConnected = false;
        this.cleanup();
        if (this.onPeerDisconnected) this.onPeerDisconnected();
    }

    createDataChannel() {
        this.dataChannel = this.peerConnection.createDataChannel('chat', { ordered: true });
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;

        this.dataChannel.onopen = () => {
            console.log('Data Channel OPEN');
            this.p2pConnected = true;
            if (this.onPeerConnected) this.onPeerConnected();
        };

        this.dataChannel.onclose = () => {
            console.log('Data Channel closed');
            // FIX: Let onconnectionstatechange handle recovery logic with its timeout.
            // Just update the flag here — don't fire onPeerDisconnected directly.
            this.p2pConnected = false;
        };

        this.dataChannel.onerror = (err) => {
            console.error('DataChannel error:', err);
        };

        this.dataChannel.onmessage = (event) => {
            if (this.onMessageReceived) this.onMessageReceived(event.data);
        };
    }

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

    cleanup() {
        this._intentionalClose = true;
        if (this.disconnectTimer) { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        if (this.dataChannel) {
            this.dataChannel.onclose = null;  // prevent event re-fire loop during cleanup
            this.dataChannel.close();
        }
        if (this.peerConnection) {
            this.peerConnection.onconnectionstatechange = null;
            this.peerConnection.close();
        }
        this.peerConnection = null;
        this.dataChannel = null;
        this.p2pConnected = false;
        this.iceCandidateQueue = [];
    }

    /** Expose the RTCPeerConnection so MediaCallManager can add audio tracks */
    getPeerConnection() {
        return this.peerConnection;
    }
}

// Expose globally
window.WebRTCManager = WebRTCManager;
