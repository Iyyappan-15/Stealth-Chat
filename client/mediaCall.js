/**
 * MediaCallManager — Traceless P2P Audio Calls
 *
 * All audio stays in-memory via WebRTC MediaStreamTracks.
 * No MediaRecorder, no blob storage, no history, no server upload.
 * Call state is ephemeral — ends on disconnect, panic, or session terminate.
 */
class MediaCallManager {
    constructor(onCallStarted, onCallEnded, sendDataChannelMessage) {
        this.localStream = null;
        this.remoteStream = null;
        this.remoteAudio = null;
        this.isCallActive = false;
        this.isInitiator = false;
        this.pendingIceCandidates = [];

        // Callbacks
        this.onCallStarted = onCallStarted;   // () => void — show call UI
        this.onCallEnded = onCallEnded;       // () => void — hide call UI
        this.sendDataChannelMessage = sendDataChannelMessage; // (jsonStr) => void
    }

    // ─────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────

    /**
     * Called by the LOCAL user pressing the "Call" button.
     * Requests mic, adds track to existing PeerConnection, then triggers renegotiation.
     */
    async startCall(peerConnection) {
        if (this.isCallActive) return;
        if (!peerConnection) {
            console.warn('[Call] No peer connection available');
            return;
        }

        try {
            // Request microphone only — no video, no history
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000
                },
                video: false
            });

            // Add audio track to the existing RTCPeerConnection
            this.localStream.getAudioTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });

            // Listen for remote audio track
            this._setupRemoteAudio(peerConnection);

            this.isInitiator = true;
            this.isCallActive = true;

            // Trigger re-negotiation via DataChannel (not signaling server)
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.sendDataChannelMessage(JSON.stringify({
                type: 'CALL_OFFER',
                sdp: peerConnection.localDescription
            }));

            if (this.onCallStarted) this.onCallStarted();
        } catch (err) {
            console.error('[Call] Failed to start call:', err);
            if (err.name === 'NotAllowedError') {
                alert('Microphone access denied. Please allow microphone access and try again.');
            } else {
                alert('Could not start call: ' + err.message);
            }
        }
    }

    /**
     * Called when we receive a CALL_OFFER from the peer via DataChannel.
     */
    async handleCallOffer(offerSdp, peerConnection) {
        if (!peerConnection) return;

        try {
            // Request mic on receiving side too
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000
                },
                video: false
            });

            this.localStream.getAudioTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });

            this._setupRemoteAudio(peerConnection);

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));

            // Flush queued ICE candidates
            for (const candidate of this.pendingIceCandidates) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            this.pendingIceCandidates = [];

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.sendDataChannelMessage(JSON.stringify({
                type: 'CALL_ANSWER',
                sdp: peerConnection.localDescription
            }));

            this.isCallActive = true;
            if (this.onCallStarted) this.onCallStarted();
        } catch (err) {
            console.error('[Call] Failed to handle offer:', err);
        }
    }

    /**
     * Called when we receive a CALL_ANSWER from the peer.
     */
    async handleCallAnswer(answerSdp, peerConnection) {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
            // Flush queued ICE candidates
            for (const candidate of this.pendingIceCandidates) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            this.pendingIceCandidates = [];
        } catch (err) {
            console.error('[Call] Failed to handle answer:', err);
        }
    }

    /**
     * Queue or add an ICE candidate for the call renegotiation.
     */
    async handleCallIce(candidate, peerConnection) {
        if (!peerConnection || !candidate) return;
        try {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                this.pendingIceCandidates.push(candidate);
            }
        } catch (err) {
            console.error('[Call] ICE candidate error:', err);
        }
    }

    /**
     * End the call — stop all local tracks, silence remote audio, notify peer.
     */
    endCall(notifyPeer = true) {
        if (!this.isCallActive) return;

        // Stop local mic tracks — frees hardware immediately
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        // Silence and remove remote audio element
        if (this.remoteAudio) {
            this.remoteAudio.srcObject = null;
            this.remoteAudio.remove();
            this.remoteAudio = null;
        }

        this.remoteStream = null;
        this.isCallActive = false;
        this.isInitiator = false;
        this.pendingIceCandidates = [];

        if (notifyPeer) {
            this.sendDataChannelMessage(JSON.stringify({ type: 'CALL_END' }));
        }

        if (this.onCallEnded) this.onCallEnded();
    }

    // ─────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────

    _setupRemoteAudio(peerConnection) {
        // Avoid duplicate listeners
        if (this._ontrackHandler) {
            peerConnection.removeEventListener('track', this._ontrackHandler);
        }

        this._ontrackHandler = (event) => {
            if (event.track.kind !== 'audio') return;

            this.remoteStream = event.streams[0] || new MediaStream([event.track]);

            // Create a hidden <audio> element — no controls, no UI trace
            if (!this.remoteAudio) {
                this.remoteAudio = document.createElement('audio');
                this.remoteAudio.autoplay = true;
                this.remoteAudio.style.display = 'none';
                document.body.appendChild(this.remoteAudio);
            }
            this.remoteAudio.srcObject = this.remoteStream;
        };

        peerConnection.addEventListener('track', this._ontrackHandler);
    }
}

// Expose globally
window.MediaCallManager = MediaCallManager;
