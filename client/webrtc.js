class WebRTCManager {
    constructor(signalingUrl, onMessageReceived, onPeerConnected, onPeerDisconnected) {
        this.signalingUrl = signalingUrl;
        this.ws = null;
        this.peerConnection = null;
        this.dataChannel = null;
        this.roomId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectTimer = null;

        // Callbacks
        this.onMessageReceived = onMessageReceived;
        this.onPeerConnected = onPeerConnected;
        this.onPeerDisconnected = onPeerDisconnected;

        // ICE Servers
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    connectToSignaling(roomId) {
        this.roomId = roomId;
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
            console.log('Connected to Signaling Server');
            this.reconnectAttempts = 0; // Reset counter on success
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.ws.send(JSON.stringify({ type: 'join', roomId: this.roomId }));
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
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
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000); // Exponential backoff max 10s
            console.log(`Attempting to reconnect in ${delay}ms (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

            this.reconnectTimer = setTimeout(() => {
                console.log("Reconnecting...");
                this.connectToSignaling(this.roomId);
            }, delay);
        } else {
            console.error("Max reconnection attempts reached. giving up.");
            alert("Lost connection to server. Please refresh the page to try again.");
        }
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'ready': // Second peer joined, start WebRTC offer
                this.createPeerConnection();
                this.createDataChannel();
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal({ sdp: this.peerConnection.localDescription });
                break;

            case 'signal': // Forwarded from peer
                if (!this.peerConnection) this.createPeerConnection(); // If receiving offer
                const payload = message.payload;

                if (payload.sdp) {
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                    if (payload.sdp.type === 'offer') {
                        const answer = await this.peerConnection.createAnswer();
                        await this.peerConnection.setLocalDescription(answer);
                        this.sendSignal({ sdp: this.peerConnection.localDescription });
                    }
                } else if (payload.ice) {
                    try {
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.ice));
                    } catch (e) {
                        console.error('Error adding received ice candidate', e);
                    }
                }
                break;

            case 'peer-left':
                // Do NOT close the P2P connection just because signaling dropped.
                // The browser might close the WebSocket on minimize, but WebRTC can survive.
                console.log("Signaling peer disconnected (WebSocket). P2P should continue.");
                break;

            case 'full':
                alert('Room is full!');
                this.ws.close();
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
            console.log('Connection State:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'disconnected' ||
                this.peerConnection.connectionState === 'failed' ||
                this.peerConnection.connectionState === 'closed') {
                this.cleanup();
                if (this.onPeerDisconnected) this.onPeerDisconnected();
            }
        };

        // Handle receiving Data Channel (Answerer side)
        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };
    }

    createDataChannel() {
        // Create Data Channel (Offerer side)
        this.dataChannel = this.peerConnection.createDataChannel("chat");
        this.setupDataChannel(this.dataChannel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.onopen = () => {
            console.log("Data Channel OPEN");
            if (this.onPeerConnected) this.onPeerConnected();
        };
        this.dataChannel.onmessage = (event) => {
            if (this.onMessageReceived) this.onMessageReceived(event.data);
        };
    }

    sendSignal(payload) {
        this.ws.send(JSON.stringify({ type: 'signal', roomId: this.roomId, payload }));
    }

    sendMessage(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
            return true;
        }
        return false;
    }

    cleanup() {
        if (this.peerConnection) this.peerConnection.close();
        if (this.dataChannel) this.dataChannel.close();
        this.peerConnection = null;
        this.dataChannel = null;
    }
}

// Expose globally
window.WebRTCManager = WebRTCManager;
