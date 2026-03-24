// ═══════════════════════════════════════════════════════════════════════════════
// STEALTH CHAT — Main Controller
// Supports P2P (WebRTC) and Group (WebSocket relay) modes
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

    // ─── Screen Elements ─────────────────────────────────────────────────────
    const typeSelectScreen  = document.getElementById('type-select-screen');
    const loginScreen       = document.getElementById('login-screen');
    const chatScreen        = document.getElementById('chat-screen');
    const panicScreen       = document.getElementById('panic-screen');

    // ─── Type Selection ──────────────────────────────────────────────────────
    const selectP2PBtn      = document.getElementById('select-p2p-btn');
    const selectGroupBtn    = document.getElementById('select-group-btn');
    const backToTypeBtn     = document.getElementById('back-to-type-btn');
    const chatModeBadge     = document.getElementById('chat-mode-badge');
    const loginSubtitle     = document.getElementById('login-subtitle');

    // ─── Login Elements ──────────────────────────────────────────────────────
    const nameInput         = document.getElementById('name-input');
    const roomInput         = document.getElementById('room-input');
    const loginStatus       = document.getElementById('login-status');
    const createModeBtn     = document.getElementById('create-mode-btn');
    const joinModeBtn       = document.getElementById('join-mode-btn');
    const createMode        = document.getElementById('create-mode');
    const joinMode          = document.getElementById('join-mode');
    const generateRoomBtn   = document.getElementById('generate-room-btn');
    const createJoinBtn     = document.getElementById('create-join-btn');
    const joinRoomBtn       = document.getElementById('join-room-btn');
    const generatedRoomId   = document.getElementById('generated-room-id');
    const copyRoomBtn       = document.getElementById('copy-room-btn');
    const leaveBtn          = document.getElementById('leave-btn');

    // ─── Chat Elements ───────────────────────────────────────────────────────
    const messagesContainer = document.getElementById('messages-container');
    const messageInput      = document.getElementById('message-input');
    const sendBtn           = document.getElementById('send-btn');
    const roomDisplay       = document.getElementById('room-display');
    const connectionStatus  = document.getElementById('connection-status');
    const encryptionStatus  = document.getElementById('encryption-status');
    const sessionTimerDisplay = document.getElementById('session-timer-display');
    const securityAlert     = document.getElementById('security-alert');
    const dismissAlertBtn   = document.getElementById('dismiss-alert');
    const typingIndicator   = document.getElementById('typing-indicator');
    const stealthTypingToggle = document.getElementById('stealth-typing');
    const noMetadataToggle  = document.getElementById('no-metadata');
    const decoyBtn          = document.getElementById('decoy-btn');

    // ─── Seal Elements ───────────────────────────────────────────────────────
    const sessionSealContainer = document.getElementById('session-seal-container');
    const sessionSealEl     = document.getElementById('session-seal');

    // ─── Hamburger / Participants Panel ──────────────────────────────────────
    const hamburgerBtn      = document.getElementById('hamburger-btn');
    const participantsPanel = document.getElementById('participants-panel');
    const closePanelBtn     = document.getElementById('close-panel-btn');
    const panelOverlay      = document.getElementById('panel-overlay');
    const participantsList  = document.getElementById('participants-list');
    const participantsCount = document.getElementById('participants-count');

    // ─── State ───────────────────────────────────────────────────────────────
    let chatMode        = null;  // 'p2p' | 'group'
    let myRoomId        = null;
    let myName          = null;
    let currentMode     = 'create';
    let generatedRoom   = null;

    let cryptoManager   = new window.CryptoManager();
    let webrtcManager   = null;
    let groupManager    = null;
    let screenshotDetector = null;
    let mediaCallManager   = null;
    let mediaShareManager  = null;

    let currentSeal     = null;   // Stored seal for comparison (MITM detection)
    let autoDestructTime = 10;
    let sessionTimeLeft  = 600;
    let isDecoyActive    = false;
    let callSeconds      = 0;
    let callTimerInterval = null;

    // ─────────────────────────────────────────────────────────────────────────
    // CHAT TYPE SELECTION
    // ─────────────────────────────────────────────────────────────────────────

    function randomAgentName() {
        return "AGENT-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    selectP2PBtn.addEventListener('click', () => {
        chatMode = 'p2p';
        chatModeBadge.textContent = 'P2P';
        chatModeBadge.className = 'chat-mode-badge p2p';
        loginSubtitle.textContent = 'Military-Grade | P2P | ZERO STORAGE';
        nameInput.value = randomAgentName();
        typeSelectScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    });

    selectGroupBtn.addEventListener('click', () => {
        chatMode = 'group';
        chatModeBadge.textContent = 'GROUP';
        chatModeBadge.className = 'chat-mode-badge group';
        loginSubtitle.textContent = 'Military-Grade | Group Relay | ZERO STORAGE';
        nameInput.value = randomAgentName();
        typeSelectScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    });

    backToTypeBtn.addEventListener('click', () => {
        loginScreen.classList.add('hidden');
        typeSelectScreen.classList.remove('hidden');
        loginStatus.textContent = '';
        chatMode = null;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // MODE SWITCHING (Create / Join)
    // ─────────────────────────────────────────────────────────────────────────

    createModeBtn.addEventListener('click', () => {
        currentMode = 'create';
        createModeBtn.classList.add('active');
        joinModeBtn.classList.remove('active');
        createMode.classList.remove('hidden');
        joinMode.classList.add('hidden');
        loginStatus.textContent = '';
    });

    joinModeBtn.addEventListener('click', () => {
        currentMode = 'join';
        joinModeBtn.classList.add('active');
        createModeBtn.classList.remove('active');
        joinMode.classList.remove('hidden');
        createMode.classList.add('hidden');
        loginStatus.textContent = '';
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ROOM ID GENERATION
    // ─────────────────────────────────────────────────────────────────────────

    function generateSecureRoomId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const segments = [];
        for (let i = 0; i < 3; i++) {
            let seg = '';
            for (let j = 0; j < 4; j++) {
                seg += chars[Math.floor(Math.random() * chars.length)];
            }
            segments.push(seg);
        }
        return segments.join('-');
    }

    generateRoomBtn.addEventListener('click', () => {
        generatedRoom = generateSecureRoomId();
        generatedRoomId.textContent = generatedRoom;
        copyRoomBtn.disabled = false;
        createJoinBtn.style.display = 'block';
        generateRoomBtn.textContent = '🔄 REGENERATE ROOM';
        loginStatus.textContent = '';
    });

    copyRoomBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(generatedRoom);
            copyRoomBtn.textContent = '✓ COPIED!';
            setTimeout(() => { copyRoomBtn.textContent = '📋 COPY'; }, 2000);
        } catch (err) {
            loginStatus.textContent = 'Failed to copy to clipboard';
            loginStatus.classList.add('error');
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // JOIN ROOM
    // ─────────────────────────────────────────────────────────────────────────

    async function joinRoom(roomId) {
        if (!roomId) {
            loginStatus.textContent = 'Please enter a room ID';
            loginStatus.classList.add('error');
            return;
        }

        myName = (nameInput.value.trim() || randomAgentName()).substring(0, 30);
        myRoomId = roomId;

        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');

        const modeLabel = chatMode === 'group' ? 'GROUP' : 'SECURE';
        roomDisplay.textContent = `CHANNEL: ${modeLabel}_${roomId.toUpperCase()}`;

        showSystemAlert(`IDENTIFIED AS: ${myName} | MODE: ${chatMode.toUpperCase()}`);

        await initSecurity();

        if (chatMode === 'group') {
            await initGroupNetworking();
        } else {
            initP2PNetworking();
        }

        startSessionTimer();
    }

    createJoinBtn.addEventListener('click', () => joinRoom(generatedRoom));
    joinRoomBtn.addEventListener('click', () => joinRoom(roomInput.value.trim()));
    roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom(roomInput.value.trim());
    });
    leaveBtn.addEventListener('click', () => terminateSession("SESSION TERMINATED BY USER"));

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY INIT
    // ─────────────────────────────────────────────────────────────────────────

    async function initSecurity() {
        try {
            if (chatMode === 'p2p') {
                await cryptoManager.generateKeyPair();
            }
            // For group mode, key is derived later inside GroupChatManager.connect()

            screenshotDetector = new window.ScreenshotDetector((reason) => {
                handleSecurityBreach(reason);
            });
            screenshotDetector.setOnFocusLost(() => {
                document.body.classList.add('content-obscured');
            });
            screenshotDetector.setOnPanicTriggered(() => {
                triggerPanicMode();
            });

            const timerSelect = document.getElementById('timer-select');
            timerSelect.addEventListener('change', (e) => {
                autoDestructTime = parseInt(e.target.value);
                showSystemAlert(`DESTRUCT TIMER: ${autoDestructTime}s`);
            });

            decoyBtn.addEventListener('click', () => {
                isDecoyActive = !isDecoyActive;
                decoyBtn.textContent = isDecoyActive ? "🎭 STOP DECOY" : "🎭 DECOY";
                if (isDecoyActive) startDecoyMessages();
                else showSystemAlert("DECOY MODE DISABLED");
            });
        } catch (e) {
            console.error("Security Init Fail:", e);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // P2P NETWORKING (WebRTC)
    // ─────────────────────────────────────────────────────────────────────────

    function getSignalingUrl() {
        let url = window.SIGNALING_SERVER_URL;
        if (!url) {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            url = `${protocol}://${window.location.host}`;
            console.warn('⚠️ SIGNALING_SERVER_URL not configured. Using same-host:', url);
        }
        return url;
    }

    function initP2PNetworking() {
        const signalingUrl = getSignalingUrl();

        webrtcManager = new window.WebRTCManager(
            signalingUrl,
            onP2PMessageReceived,
            onP2PPeerConnected,
            onP2PPeerDisconnected,
            myName   // pass name to WebRTC manager for signaling
        );

        webrtcManager.connectToSignaling(myRoomId);
        initMediaManagers();
    }

    async function onP2PPeerConnected() {
        connectionStatus.textContent = "● PEER CONNECTED";
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');

        showSystemAlert("INITIATING SECURE HANDSHAKE...");

        const myPublicKey = await cryptoManager.exportPublicKey();
        webrtcManager.sendMessage(JSON.stringify({
            type: 'KEY_EXCHANGE',
            key: myPublicKey,
            identity: myName
        }));
    }

    function onP2PPeerDisconnected() {
        connectionStatus.textContent = "● PEER DISCONNECTED";
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        encryptionStatus.classList.add('hidden');
        showSystemAlert("⚠ PEER CONNECTION LOST");
    }

    async function onP2PMessageReceived(rawMessage) {
        try {
            const payload = JSON.parse(rawMessage);

            if (payload.type === 'KEY_EXCHANGE') {
                await cryptoManager.deriveSessionKey(payload.key);
                encryptionStatus.classList.remove('hidden');
                showSystemAlert(`✅ CHANNEL SECURED WITH: ${payload.identity}`);

                // Generate and show seal
                const seal = await cryptoManager.generateSessionSeal();
                showSessionSeal(seal);

                // Send our seal to peer for cross-verification
                webrtcManager.sendMessage(JSON.stringify({ type: 'SEAL', seal }));
            }
            else if (payload.type === 'SEAL') {
                // Verify seals match — if not, MITM possible
                verifySeal(payload.seal);
            }
            else if (payload.type === 'CHAT_MSG') {
                const decryptedText = await cryptoManager.decryptMessage(payload.content);
                appendMessage(decryptedText, 'peer', payload.senderName || 'Peer');
            }
            else if (payload.type === 'TYPING') {
                const peerName = payload.senderName || 'Peer';
                typingIndicator.textContent = payload.isTyping ? `${peerName} is typing encrypted data...` : '';
                payload.isTyping
                    ? typingIndicator.classList.remove('hidden')
                    : typingIndicator.classList.add('hidden');
            }
            else if (payload.type === 'SYSTEM_ALERT') {
                triggerSecurityOverlay(payload.content);
            }
            else if (payload.type === 'WIPE_EVERYTHING') {
                wipeMessages();
                triggerSecurityOverlay("PEER BREACH DETECTED - DATA PURGED");
            }
            else if (payload.type === 'CALL_OFFER' && mediaCallManager) {
                showSystemAlert('📞 INCOMING ENCRYPTED CALL...');
                await mediaCallManager.handleCallOffer(payload.sdp, webrtcManager.getPeerConnection());
            }
            else if (payload.type === 'CALL_ANSWER' && mediaCallManager) {
                await mediaCallManager.handleCallAnswer(payload.sdp, webrtcManager.getPeerConnection());
            }
            else if (payload.type === 'CALL_ICE' && mediaCallManager) {
                await mediaCallManager.handleCallIce(payload.candidate, webrtcManager.getPeerConnection());
            }
            else if (payload.type === 'CALL_END' && mediaCallManager) {
                mediaCallManager.endCall(false);
            }
            else if (payload.type === 'MEDIA_META' && mediaShareManager) {
                mediaShareManager.handleMediaMeta(payload);
            }
            else if (payload.type === 'MEDIA_CHUNK' && mediaShareManager) {
                mediaShareManager.handleMediaChunk(payload);
            }
            else if (payload.type === 'MEDIA_END' && mediaShareManager) {
                await mediaShareManager.handleMediaEnd();
            }
        } catch (e) {
            console.error("P2P Payload Error:", e);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP NETWORKING (WebSocket Relay)
    // ─────────────────────────────────────────────────────────────────────────

    async function initGroupNetworking() {
        const signalingUrl = getSignalingUrl();

        groupManager = new window.GroupChatManager(signalingUrl, {
            onMessageReceived: onGroupMessageReceived,
            onParticipantsUpdate: updateParticipantsPanel,
            onParticipantJoined: onGroupParticipantJoined,
            onParticipantLeft: onGroupParticipantLeft,
            onTyping: onGroupTyping,
            onConnectionReady: onGroupReady,
            onDisconnected: onGroupDisconnected
        });

        await groupManager.connect(myRoomId, myName, cryptoManager);
    }

    async function onGroupReady(name) {
        connectionStatus.textContent = "● GROUP CONNECTED";
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        encryptionStatus.classList.remove('hidden');
        showSystemAlert(`✅ GROUP CHANNEL SECURED | ${name}`);

        // Derive and display group seal from the group session key
        const seal = await cryptoManager.generateSessionSeal();
        showSessionSeal(seal);
    }

    async function onGroupMessageReceived(text, fromName, fromId) {
        appendMessage(text, 'peer', fromName);
    }

    function onGroupParticipantJoined(name, id) {
        showSystemAlert(`🟢 ${name} JOINED THE CHANNEL`);
    }

    function onGroupParticipantLeft(name, id) {
        showSystemAlert(`🔴 ${name} LEFT THE CHANNEL`);
    }

    function onGroupTyping(fromName, isTyping) {
        typingIndicator.textContent = isTyping ? `${fromName} is typing encrypted data...` : '';
        isTyping
            ? typingIndicator.classList.remove('hidden')
            : typingIndicator.classList.add('hidden');
    }

    function onGroupDisconnected() {
        connectionStatus.textContent = "● DISCONNECTED";
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        encryptionStatus.classList.add('hidden');
        showSystemAlert("⚠ GROUP CONNECTION LOST — RECONNECTING...");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARTICIPANTS PANEL
    // ─────────────────────────────────────────────────────────────────────────

    hamburgerBtn.addEventListener('click', () => {
        participantsPanel.classList.add('open');
        panelOverlay.classList.remove('hidden');
    });

    closePanelBtn.addEventListener('click', closeSidebar);
    panelOverlay.addEventListener('click', closeSidebar);

    function closeSidebar() {
        participantsPanel.classList.remove('open');
        panelOverlay.classList.add('hidden');
    }

    function updateParticipantsPanel(participants) {
        participantsList.innerHTML = '';
        participants.forEach(p => {
            const item = document.createElement('div');
            item.className = 'participant-item';
            const isMe = p.name === myName;
            item.innerHTML = `
                <span class="participant-dot"></span>
                <span class="participant-name">${escapeHtml(p.name)}${isMe ? ' <em>(you)</em>' : ''}</span>
            `;
            participantsList.appendChild(item);
        });
        participantsCount.textContent = `${participants.length} ONLINE`;

        // Also update for P2P (just show me + peer)
    }

    function addP2PParticipants(peerName) {
        updateParticipantsPanel([
            { name: myName },
            { name: peerName }
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SESSION SEAL
    // ─────────────────────────────────────────────────────────────────────────

    function showSessionSeal(seal) {
        currentSeal = seal;
        sessionSealEl.textContent = seal;
        sessionSealContainer.classList.remove('hidden');
        sessionSealContainer.classList.add('seal-pulse');
        setTimeout(() => sessionSealContainer.classList.remove('seal-pulse'), 2000);
        showSystemAlert(`🔏 SESSION SEAL: ${seal} — Verify with peer!`);
    }

    function verifySeal(peerSeal) {
        if (!currentSeal) return;
        if (peerSeal !== currentSeal) {
            // MITM DETECTED
            sessionSealEl.textContent = '⚠️⚠️⚠️⚠️';
            sessionSealContainer.classList.add('seal-mismatch');
            showSystemAlert(`🚨 SEAL MISMATCH — POSSIBLE MITM ATTACK! YOUR SEAL: ${currentSeal} | PEER: ${peerSeal}`);
            triggerSecurityOverlay("SESSION SEAL MISMATCH — POSSIBLE MAN-IN-THE-MIDDLE ATTACK");
        } else {
            showSystemAlert(`✅ SEAL VERIFIED: ${peerSeal}`);
        }
    }

    // Public helper for console testing
    window.showSealMismatch = () => verifySeal("????");

    // ─────────────────────────────────────────────────────────────────────────
    // MEDIA MANAGERS (P2P only)
    // ─────────────────────────────────────────────────────────────────────────

    function initMediaManagers() {
        const callOverlay   = document.getElementById('call-overlay');
        const callTimerEl   = document.getElementById('call-timer');
        const endCallBtn    = document.getElementById('end-call-btn');
        const callBtn       = document.getElementById('call-btn');
        const attachBtn     = document.getElementById('attach-btn');
        const mediaFileInput = document.getElementById('media-file-input');
        const progressBar   = document.getElementById('media-progress-bar');
        const progressFill  = document.getElementById('media-progress-fill');
        const progressLabel = document.getElementById('media-progress-label');

        mediaCallManager = new window.MediaCallManager(
            () => {
                callOverlay.classList.remove('hidden');
                callBtn.classList.add('active-call');
                callBtn.title = 'Call Active';
                callSeconds = 0;
                callTimerInterval = setInterval(() => {
                    callSeconds++;
                    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
                    const s = String(callSeconds % 60).padStart(2, '0');
                    callTimerEl.textContent = `${m}:${s}`;
                }, 1000);
                showSystemAlert('📞 SECURE CALL STARTED');
            },
            () => {
                callOverlay.classList.add('hidden');
                callBtn.classList.remove('active-call');
                callBtn.title = 'Start Encrypted Audio Call';
                clearInterval(callTimerInterval);
                callTimerInterval = null;
                callTimerEl.textContent = '00:00';
                showSystemAlert('📵 CALL ENDED — NO TRACE');
            },
            (msg) => webrtcManager.sendMessage(msg)
        );

        mediaShareManager = new window.MediaShareManager(
            cryptoManager,
            appendMediaMessage,
            (msg) => webrtcManager.sendMessage(msg),
            () => autoDestructTime
        );

        mediaShareManager.setSendProgressCallback((pct) => {
            if (pct > 0) {
                progressBar.classList.remove('hidden');
                progressFill.style.width = pct + '%';
                progressLabel.textContent = pct < 100 ? `ENCRYPTING... ${pct}%` : 'TRANSMITTING...';
            } else {
                progressBar.classList.add('hidden');
                progressFill.style.width = '0%';
            }
        });

        callBtn.addEventListener('click', () => {
            if (mediaCallManager.isCallActive) {
                mediaCallManager.endCall(true);
            } else {
                if (!cryptoManager || !cryptoManager.sessionKey) {
                    showSystemAlert('⚠ WAIT FOR ENCRYPTION HANDSHAKE');
                    return;
                }
                mediaCallManager.startCall(webrtcManager.getPeerConnection());
            }
        });

        endCallBtn.addEventListener('click', () => mediaCallManager.endCall(true));

        attachBtn.addEventListener('click', () => {
            if (!cryptoManager || !cryptoManager.sessionKey) {
                showSystemAlert('⚠ WAIT FOR ENCRYPTION HANDSHAKE');
                return;
            }
            mediaFileInput.click();
        });

        mediaFileInput.addEventListener('change', async () => {
            const file = mediaFileInput.files[0];
            if (!file) return;
            mediaFileInput.value = '';
            await mediaShareManager.sendFile(file);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MESSAGING — SEND
    // ─────────────────────────────────────────────────────────────────────────

    sendBtn.addEventListener('click', sendMessage);
    sendBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        sendMessage();
    }, { passive: false });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
            messageInput.blur();
        }
    });

    window.addEventListener('resize', () => {
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    let typingTimeout;
    messageInput.addEventListener('input', () => {
        if (!stealthTypingToggle.checked) {
            if (chatMode === 'p2p' && webrtcManager) {
                webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: true, senderName: myName }));
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: false, senderName: myName }));
                }, 1500);
            } else if (chatMode === 'group' && groupManager) {
                groupManager.sendTyping(true);
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => groupManager.sendTyping(false), 1500);
            }
        }
    });

    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !cryptoManager.sessionKey) return;

        appendMessage(text, 'me', myName);
        messageInput.value = '';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        if (chatMode === 'p2p' && webrtcManager) {
            const encryptedData = await cryptoManager.encryptMessage(text);
            webrtcManager.sendMessage(JSON.stringify({
                type: 'CHAT_MSG',
                content: encryptedData,
                senderName: myName
            }));
            webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: false, senderName: myName }));
        } else if (chatMode === 'group' && groupManager) {
            await groupManager.sendMessage(text);
            groupManager.sendTyping(false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MESSAGING — DISPLAY
    // ─────────────────────────────────────────────────────────────────────────

    function appendMessage(text, sender, senderName) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender);

        // Sender name label (shown for group peers / P2P peer)
        if (sender !== 'me' && senderName && chatMode === 'group') {
            const nameLabel = document.createElement('div');
            nameLabel.className = 'message-sender-name';
            nameLabel.textContent = senderName;
            msgDiv.appendChild(nameLabel);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.classList.add('message-content');

        const textSpan = document.createElement('span');
        textSpan.classList.add('message-text');
        textSpan.textContent = text;
        contentWrapper.appendChild(textSpan);

        if (!noMetadataToggle.checked) {
            const timeSpan = document.createElement('span');
            timeSpan.classList.add('message-time');
            const now = new Date();
            timeSpan.textContent = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
            contentWrapper.appendChild(timeSpan);
        }

        msgDiv.appendChild(contentWrapper);

        const timerSpan = document.createElement('div');
        timerSpan.classList.add('destruct-timer');
        msgDiv.appendChild(timerSpan);

        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        let timeLeft = autoDestructTime;
        timerSpan.textContent = `${timeLeft}s`;
        const interval = setInterval(() => {
            timeLeft--;
            timerSpan.textContent = `${timeLeft}s`;
            if (timeLeft <= 0) {
                clearInterval(interval);
                msgDiv.style.opacity = '0';
                setTimeout(() => msgDiv.remove(), 300);
            }
        }, 1000);
    }

    function appendMediaMessage(blobUrl, mimeType, sender, destructSecs) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender, 'media-message');

        let mediaEl;
        if (mimeType.startsWith('video/')) {
            mediaEl = document.createElement('video');
            mediaEl.controls = true;
            mediaEl.playsInline = true;
            mediaEl.muted = false;
        } else {
            mediaEl = document.createElement('img');
            mediaEl.alt = '🔒 Encrypted Media';
        }
        mediaEl.src = blobUrl;

        const label = document.createElement('div');
        label.classList.add('media-label');
        label.textContent = `🔒 ENCRYPTED FILE · ${destructSecs}s`;

        const timerSpan = document.createElement('div');
        timerSpan.classList.add('destruct-timer');

        msgDiv.appendChild(mediaEl);
        msgDiv.appendChild(label);
        msgDiv.appendChild(timerSpan);
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        let timeLeft = destructSecs;
        timerSpan.textContent = `${timeLeft}s`;
        const interval = setInterval(() => {
            timeLeft--;
            timerSpan.textContent = `${timeLeft}s`;
            label.textContent = `🔒 ENCRYPTED FILE · ${timeLeft}s`;
            if (timeLeft <= 0) {
                clearInterval(interval);
                msgDiv.style.opacity = '0';
                setTimeout(() => msgDiv.remove(), 300);
            }
        }, 1000);
    }

    function showSystemAlert(text) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'system');
        msgDiv.textContent = text;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function wipeMessages() {
        messagesContainer.innerHTML = '<div class="message system">SESSION CLEARED - SECURITY PROTOCOL</div>';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY FEATURES
    // ─────────────────────────────────────────────────────────────────────────

    function startSessionTimer() {
        const timer = setInterval(() => {
            sessionTimeLeft--;
            const minutes = Math.floor(sessionTimeLeft / 60);
            const seconds = sessionTimeLeft % 60;
            sessionTimerDisplay.textContent = `SESSION EXPIRES: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (sessionTimeLeft <= 0) {
                clearInterval(timer);
                terminateSession("SESSION EXPIRED - DATA WIPED");
            }
        }, 1000);
    }

    function triggerPanicMode() {
        if (mediaCallManager) mediaCallManager.endCall(false);
        chatScreen.classList.add('hidden');
        loginScreen.classList.add('hidden');
        typeSelectScreen.classList.add('hidden');
        wipeMessages();
        cryptoManager = null;
        panicScreen.classList.add('active');

        if (webrtcManager) webrtcManager.sendMessage(JSON.stringify({ type: 'WIPE_EVERYTHING' }));
        // Group: no need to broadcast, the relay would expose panic mode
        if (groupManager) groupManager.destroy();
        console.log("PANIC MODE ACTIVATED");
    }

    function handleSecurityBreach(reason) {
        document.body.classList.add('content-obscured');
        wipeMessages();

        if (webrtcManager) {
            webrtcManager.sendMessage(JSON.stringify({ type: 'SYSTEM_ALERT', content: `SECURITY BREACH: ${reason}` }));
            webrtcManager.sendMessage(JSON.stringify({ type: 'WIPE_EVERYTHING' }));
        }
        triggerSecurityOverlay(reason);
    }

    function triggerSecurityOverlay(reason) {
        securityAlert.querySelector('p').textContent = `PROTOCOL BREACH: ${reason.toUpperCase()}`;
        securityAlert.classList.remove('hidden');
    }

    function terminateSession(reason) {
        if (mediaCallManager && mediaCallManager.isCallActive) mediaCallManager.endCall(false);
        if (webrtcManager) webrtcManager.destroy();
        if (groupManager) groupManager.destroy();
        alert(reason);
        window.location.reload();
    }

    function startDecoyMessages() {
        const fakes = [
            "Did you finish the assignment?",
            "Yeah, just uploading it now.",
            "Check the mail for the pdf.",
            "System update scheduled for tonight.",
            "I'll be out for lunch.",
            "The server logs look normal.",
            "I think we should use the new API.",
            "Okay, send me the link when ready."
        ];
        if (!isDecoyActive) return;
        const randomMsg = fakes[Math.floor(Math.random() * fakes.length)];
        const sender = Math.random() > 0.5 ? 'me' : 'peer';
        appendMessage(`[DECOY] ${randomMsg}`, sender, sender === 'peer' ? 'Peer' : myName);
        setTimeout(() => { if (isDecoyActive) startDecoyMessages(); }, 4000 + Math.random() * 6000);
    }

    dismissAlertBtn.addEventListener('click', () => {
        securityAlert.classList.add('hidden');
        document.body.classList.remove('content-obscured');
        document.body.classList.remove('hard-obscure');
    });

    window.onbeforeunload = () => {
        myRoomId = null;
        cryptoManager = null;
        messagesContainer.innerHTML = '';
        if (webrtcManager) webrtcManager.destroy();
        if (groupManager) groupManager.destroy();
    };

}); // End DOMContentLoaded
