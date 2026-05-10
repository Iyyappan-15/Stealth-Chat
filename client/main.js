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

    // ─── DOM refs for seal popup ────────────────────────────────────────────
    const sealPopup         = document.getElementById('seal-popup');
    const sealPopupEmoji    = document.getElementById('seal-popup-emoji');
    const sealPopupClose    = document.getElementById('seal-popup-close');
    sealPopupClose.addEventListener('click', () => sealPopup.classList.add('hidden'));

    const sessionSealContainer = document.getElementById('session-seal-container');
    const sessionSealEl     = document.getElementById('session-seal');

    // ─── Hamburger / Participants Panel ──────────────────────────────────────
    const hamburgerBtn      = document.getElementById('hamburger-btn');
    const participantsPanel = document.getElementById('participants-panel');
    const closePanelBtn     = document.getElementById('close-panel-btn');
    const panelOverlay      = document.getElementById('panel-overlay');
    const participantsList  = document.getElementById('participants-list');
    const participantsCount = document.getElementById('participants-count');
    const sessionDurationCreate = document.getElementById('session-duration-create');
    const sessionDurationJoin   = document.getElementById('session-duration-join');

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

    let currentSeal          = null;  // Stored seal for comparison (MITM detection)
    let groupSealSalt        = 0;     // Salt changes on every membership change
    let groupParticipantCount = 0;    // Last known participant count
    let groupSealReady       = false; // Whether initial group seal has been shown
    let autoDestructTime = 10;
    let sessionTimeLeft  = 600;       // seconds — overwritten from user input in joinRoom()
    let sessionTimerRef  = null;      // interval handle so we can cancel it on clear
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
        generateRoomBtn.innerHTML = Icons.html('refresh', 'icon-sm') + ' REGENERATE ROOM';
        loginStatus.textContent = '';
    });

    copyRoomBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(generatedRoom);
            copyRoomBtn.innerHTML = Icons.html('check', 'icon-sm') + ' COPIED!';
            setTimeout(() => { copyRoomBtn.innerHTML = Icons.html('clipboard', 'icon-sm') + ' COPY'; }, 2000);
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

        showSystemAlert(`IDENTIFIED AS: ${escapeHtml(myName)} | MODE: ${chatMode.toUpperCase()}`);

        await initSecurity();

        if (chatMode === 'group') {
            await initGroupNetworking();
        } else {
            initP2PNetworking();
        }

        // Read user-entered session duration (minutes), clamp 1–480, convert to seconds
        const durationInput = currentMode === 'create' ? sessionDurationCreate : sessionDurationJoin;
        const chosenMins = Math.min(480, Math.max(1, parseInt(durationInput.value) || 10));
        sessionTimeLeft = chosenMins * 60;

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
            // onFocusLost: soft blackout is handled inside the detector silently.
            // We only do additional work here if needed (currently nothing extra).
            screenshotDetector.setOnFocusLost(() => {
                // Soft blackout — screen goes black but no alert is shown.
                // content-obscured is NOT set here so the breach overlay doesn't appear.
            });
            screenshotDetector.setOnPanicTriggered(() => {
                triggerPanicMode();
            });

            // ── MOBILE: Tab switch / app background → immediate panic ──────────
            // On touch devices, leaving the app (home button, task switcher,
            // notification drawer, tab switch) fires visibilitychange with
            // document.hidden = true. On mobile there is no "soft" option —
            // the screen is fully exposed to the OS, so we treat it as a
            // hard security breach and enter panic mode immediately.
            const isMobile = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
            if (isMobile) {
                document.addEventListener('visibilitychange', () => {
                    // Only act if a secure session is active (chatScreen visible)
                    if (document.hidden && !chatScreen.classList.contains('hidden')) {
                        // Show a brief panic warning in the chat before wiping
                        showSystemAlert(
                            Icons.html('warning', 'icon-xs') +
                            ' SECURITY BREACH — SCREEN LEFT VISIBLE. PANIC MODE ACTIVATED.'
                        );
                        // Small delay (one animation frame) so the alert renders,
                        // then trigger full panic
                        requestAnimationFrame(() => {
                            triggerPanicMode();
                        });
                    }
                }, { capture: true });

                // Also handle page hide (iOS Safari uses pagehide instead of visibilitychange)
                window.addEventListener('pagehide', () => {
                    if (!chatScreen.classList.contains('hidden')) {
                        triggerPanicMode();
                    }
                }, { capture: true });
            }

            const timerSelect = document.getElementById('timer-select');
            timerSelect.addEventListener('change', (e) => {
                autoDestructTime = parseInt(e.target.value);
                showSystemAlert(`DESTRUCT TIMER: ${autoDestructTime}s`);
            });

            decoyBtn.addEventListener('click', () => {
                isDecoyActive = !isDecoyActive;
                decoyBtn.innerHTML = isDecoyActive
                    ? (Icons.html('mask', 'icon-sm') + ' STOP DECOY')
                    : (Icons.html('mask', 'icon-sm') + ' DECOY');
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

    // ── Status helper: show amber 'connecting' spinner ────────────────────────
    function setStatusConnecting(label) {
        connectionStatus.innerHTML =
            `<span class="spin-ring"></span>${label || 'CONNECTING...'}`;
        connectionStatus.classList.remove('connected', 'disconnected');
        connectionStatus.classList.add('connecting');
    }

    function initP2PNetworking() {
        const signalingUrl = getSignalingUrl();
        setStatusConnecting('AWAITING PEER...');

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
        connectionStatus.innerHTML = '● PEER CONNECTED';
        connectionStatus.classList.remove('disconnected', 'connecting');
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
        connectionStatus.innerHTML = '● PEER DISCONNECTED';
        connectionStatus.classList.remove('connected', 'connecting');
        connectionStatus.classList.add('disconnected');
        encryptionStatus.classList.add('hidden');
        showSystemAlert(Icons.html('warning', 'icon-xs') + " PEER CONNECTION LOST — RETRYING...");

        // Vanish the session seal — it is no longer valid without a live peer
        clearSessionSeal();

        // Show connecting state after a moment (WebRTC will attempt re-pairing)
        setTimeout(() => {
            if (!webrtcManager || !webrtcManager.p2pConnected) {
                setStatusConnecting('AWAITING PEER...');
            }
        }, 2000);
    }

    async function onP2PMessageReceived(rawMessage) {
        try {
            const payload = JSON.parse(rawMessage);

            if (payload.type === 'KEY_EXCHANGE') {
                await cryptoManager.deriveSessionKey(payload.key);
                encryptionStatus.classList.remove('hidden');
                showSystemAlert(Icons.html('shieldCheck', 'icon-xs') + ` CHANNEL SECURED WITH: ${escapeHtml(payload.identity)}`);

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
                showSystemAlert(Icons.html('phone', 'icon-xs') + ' INCOMING ENCRYPTED CALL...');
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
        setStatusConnecting('JOINING GROUP...');

        const progressBar   = document.getElementById('media-progress-bar');
        const progressFill  = document.getElementById('media-progress-fill');
        const progressLabel = document.getElementById('media-progress-label');
        const attachBtn     = document.getElementById('attach-btn');
        const mediaFileInput = document.getElementById('media-file-input');
        const callBtn       = document.getElementById('call-btn');

        groupManager = new window.GroupChatManager(signalingUrl, {
            onMessageReceived: onGroupMessageReceived,
            onParticipantsUpdate: updateParticipantsPanel,
            onParticipantJoined: onGroupParticipantJoined,
            onParticipantLeft: onGroupParticipantLeft,
            onTyping: onGroupTyping,
            onConnectionReady: onGroupReady,
            onDisconnected: onGroupDisconnected
        });

        // Handle incoming files relayed through server
        groupManager.onFileReceived = (blobUrl, mimeType, fileName) => {
            appendMediaMessage(blobUrl, mimeType, 'peer', autoDestructTime, fileName);
            setTimeout(() => URL.revokeObjectURL(blobUrl), (autoDestructTime + 2) * 1000);
        };

        // Wire up attach button for group mode
        attachBtn.addEventListener('click', () => {
            if (!cryptoManager || !cryptoManager.sessionKey) {
                showSystemAlert(Icons.html('warning', 'icon-xs') + ' WAIT FOR GROUP ENCRYPTION TO ESTABLISH');
                return;
            }
            if (screenshotDetector) screenshotDetector.suppressBlur(4000);
            mediaFileInput.click();
        });

        // File selected — send via relay
        mediaFileInput.addEventListener('change', async () => {
            const file = mediaFileInput.files[0];
            if (!file) return;
            mediaFileInput.value = '';

            progressBar.classList.remove('hidden');
            progressFill.style.width = '0%';
            progressLabel.textContent = 'ENCRYPTING...';

            const success = await groupManager.sendFile(
                file,
                (pct) => {
                    progressFill.style.width = pct + '%';
                    progressLabel.textContent = pct < 100 ? `ENCRYPTING... ${pct}%` : 'RELAYING...';
                },
                appendMediaMessage,
                () => autoDestructTime
            );

            setTimeout(() => {
                progressBar.classList.add('hidden');
                progressFill.style.width = '0%';
            }, 800);

            if (!success) showSystemAlert(Icons.html('warning', 'icon-xs') + ' FILE SEND FAILED');
        });

        // Calls not supported in group relay mode — show clear message
        callBtn.addEventListener('click', () => {
            showSystemAlert(Icons.html('warning', 'icon-xs') + ' AUDIO CALLS ARE P2P ONLY — NOT AVAILABLE IN GROUP MODE');
        });

        await groupManager.connect(myRoomId, myName, cryptoManager);
    }

    async function onGroupReady(name) {
        connectionStatus.innerHTML = '● GROUP CONNECTED';
        connectionStatus.classList.remove('disconnected', 'connecting');
        connectionStatus.classList.add('connected');
        encryptionStatus.classList.remove('hidden');
        showSystemAlert(Icons.html('shieldCheck', 'icon-xs') + ` GROUP CHANNEL SECURED | ${escapeHtml(name)}`);

        // Reset seal state — seal will be shown when participants-list arrives
        groupSealReady = false;
        groupParticipantCount = 0;
    }

    async function onGroupMessageReceived(text, fromName, fromId) {
        appendMessage(text, 'peer', fromName);
    }

    function onGroupParticipantJoined(name, id) {
        showSystemAlert(Icons.html('userPlus', 'icon-xs') + ` ${escapeHtml(name)} JOINED THE CHANNEL`);
        // Seal refresh is handled in updateParticipantsPanel when participants-list arrives
    }

    function onGroupParticipantLeft(name, id) {
        showSystemAlert(Icons.html('userMinus', 'icon-xs') + ` ${escapeHtml(name)} LEFT THE CHANNEL`);
        // Seal refresh is handled in updateParticipantsPanel when participants-list arrives
    }

    function onGroupTyping(fromName, isTyping) {
        typingIndicator.textContent = isTyping ? `${fromName} is typing encrypted data...` : '';
        isTyping
            ? typingIndicator.classList.remove('hidden')
            : typingIndicator.classList.add('hidden');
    }

    function onGroupDisconnected() {
        connectionStatus.innerHTML = '● DISCONNECTED';
        connectionStatus.classList.remove('connected', 'connecting');
        connectionStatus.classList.add('disconnected');
        encryptionStatus.classList.add('hidden');
        showSystemAlert(Icons.html('warning', 'icon-xs') + " GROUP CONNECTION LOST — RECONNECTING...");

        // Vanish the session seal — it is no longer valid without an active channel
        clearSessionSeal();

        // Transition back to connecting state after a moment
        setTimeout(() => setStatusConnecting('RECONNECTING...'), 1500);
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

    // ── Mobile: inject header expand/collapse toggle ──────────────────────────
    // On mobile we show a slim single-row header. A small chevron button
    // toggles the settings row open/closed so users can access controls
    // without the header permanently eating screen space.
    (function injectHeaderExpandToggle() {
        const isMobile = () => window.innerWidth <= 768;
        if (!isMobile()) return;

        const chatHeader = document.querySelector('#chat-screen header');
        if (!chatHeader) return;

        const btn = document.createElement('button');
        btn.className = 'header-expand-btn';
        btn.title = 'Toggle settings';
        btn.setAttribute('aria-label', 'Toggle header settings');
        btn.innerHTML = '&#8964;'; // ⌤ chevron down

        btn.addEventListener('click', () => {
            chatHeader.classList.toggle('header-expanded');
            // Scroll messages to bottom after layout shift
            if (messagesContainer) {
                setTimeout(() => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }, 300);
            }
        });

        // Insert before #leave-btn so it appears in the right order
        const leaveBtn = document.getElementById('leave-btn');
        if (leaveBtn) {
            chatHeader.insertBefore(btn, leaveBtn);
        } else {
            chatHeader.appendChild(btn);
        }
    })();

    async function updateParticipantsPanel(participants) {
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

        // Group seal: recompute whenever membership changes.
        // All clients use participants.length as a shared deterministic salt,
        // so every member (including a new joiner) derives the same new seal.
        if (chatMode === 'group' && cryptoManager && cryptoManager.sessionKey) {
            const newCount = participants.length;
            if (!groupSealReady) {
                // First participants-list after connecting — establish initial seal
                groupSealSalt = newCount;
                const seal = await cryptoManager.generateSessionSealWithSalt(String(groupSealSalt));
                showSessionSeal(seal);
                groupSealReady = true;
            } else if (newCount !== groupParticipantCount) {
                // Membership changed — refresh seal and show popup to everyone
                groupSealSalt = newCount;
                const seal = await cryptoManager.generateSessionSealWithSalt(String(groupSealSalt));
                refreshGroupSeal(seal, newCount > groupParticipantCount);
            }
            groupParticipantCount = newCount;
        }
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

    // ── Shared emoji palette (for cryptographic seal fingerprints shown in popup) ──
    // NOTE: These emoji are kept intentionally — they are the cryptographic visual
    // fingerprint that peers compare verbally to detect MITM attacks. They are DATA,
    // not decorative UI elements, so they are NOT replaced with SVG icons.
    const SEAL_EMOJI_PALETTE = [
        "🐋","🦁","🐬","🦊","🐧","🦋","🐙","🦄",
        "🌙","⭐","☀️","🌈","🌊","🔥","❄️","⚡",
        "🎯","🎪","🎭","🎨","🎸","🎺","🎻","🥁",
        "🍎","🍋","🍇","🍓","🥝","🍑","🍒","🫐",
        "🏔️","🌋","🗻","🏝️","🌵","🌴","🍄","🌺",
        "💎","🔮","🪄","🔭","🧬","⚗️","🧲","🔑",
        "🚀","🛸","⛵","🚁","🛡️","⚔️","🗡️","🏹",
        "🦅","🦉","🦚","🦜","🐲","🦈","🐺","🦝"
    ];

    function showSessionSeal(seal) {
        currentSeal = seal;

        // Header mini-display: show shield icon (always consistent)
        sessionSealEl.innerHTML = Icons.html('shield', 'icon-md seal-icon');
        sessionSealContainer.classList.remove('hidden', 'seal-mismatch');
        sessionSealContainer.classList.add('seal-pulse');
        setTimeout(() => sessionSealContainer.classList.remove('seal-pulse'), 2000);

        // Popup shows the full cryptographic emoji fingerprint so users can verify
        sealPopupEmoji.textContent = seal;
        sealPopup.classList.remove('hidden');

        showSystemAlert(Icons.html('shield', 'icon-xs') + ' SESSION SEAL ESTABLISHED — Compare the code with your peer!');
    }

    /**
     * Called when a group member joins or leaves mid-conversation.
     * Regenerates the seal (using the new participant count as salt) and
     * re-opens the popup so every user sees the updated fingerprint.
     */
    function refreshGroupSeal(seal, memberJoined) {
        currentSeal = seal;

        // Update header badge icon
        sessionSealEl.innerHTML = Icons.html('shield', 'icon-md seal-icon');
        sessionSealContainer.classList.remove('hidden', 'seal-mismatch');
        sessionSealContainer.classList.add('seal-pulse');
        setTimeout(() => sessionSealContainer.classList.remove('seal-pulse'), 2000);

        // Re-open the seal popup so all present users verify the new fingerprint
        sealPopupEmoji.textContent = seal;
        sealPopup.classList.remove('hidden');

        const action = memberJoined
            ? 'NEW MEMBER JOINED — SEAL REFRESHED & VERIFIED'
            : 'MEMBER DEPARTED — SEAL REFRESHED';
        showSystemAlert(Icons.html('refresh', 'icon-xs') + ' ' + action);
    }

    function verifySeal(peerSeal) {
        if (!currentSeal) return;
        if (peerSeal !== currentSeal) {
            // MITM DETECTED — Change seal icon to warning sign
            sessionSealEl.innerHTML = Icons.html('warning', 'icon-md seal-warning');
            sessionSealContainer.classList.add('seal-mismatch');
            showSystemAlert(Icons.html('alertOctagon', 'icon-xs') + ' SEAL MISMATCH — POSSIBLE MAN-IN-THE-MIDDLE ATTACK DETECTED!');
            triggerSecurityOverlay("SESSION SEAL MISMATCH — POSSIBLE MAN-IN-THE-MIDDLE ATTACK");
        } else {
            // Seals match — restore shield icon and confirm
            sessionSealEl.innerHTML = Icons.html('shield', 'icon-md seal-icon');
            sessionSealContainer.classList.remove('seal-mismatch');
            showSystemAlert(Icons.html('shieldCheck', 'icon-xs') + ' SEAL VERIFIED — Connection is secure.');
        }
    }

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
                showSystemAlert(Icons.html('phone', 'icon-xs') + ' SECURE CALL STARTED');
            },
            () => {
                callOverlay.classList.add('hidden');
                callBtn.classList.remove('active-call');
                callBtn.title = 'Start Encrypted Audio Call';
                clearInterval(callTimerInterval);
                callTimerInterval = null;
                callTimerEl.textContent = '00:00';
                showSystemAlert(Icons.html('phoneOff', 'icon-xs') + ' CALL ENDED — NO TRACE');
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
                    showSystemAlert(Icons.html('warning', 'icon-xs') + ' WAIT FOR ENCRYPTION HANDSHAKE');
                    return;
                }
                mediaCallManager.startCall(webrtcManager.getPeerConnection());
            }
        });

        endCallBtn.addEventListener('click', () => mediaCallManager.endCall(true));

        attachBtn.addEventListener('click', () => {
            if (!cryptoManager || !cryptoManager.sessionKey) {
                showSystemAlert(Icons.html('warning', 'icon-xs') + ' WAIT FOR ENCRYPTION HANDSHAKE');
                return;
            }
            // Suppress the stealth blur detector while the OS file dialog is open
            if (screenshotDetector) screenshotDetector.suppressBlur(4000);
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

    // ── Visual Viewport API: mobile keyboard resize fallback ──────────────────
    // dvh + interactive-widget handles this on modern browsers. This is the
    // fallback for older Android/iOS that overlay the keyboard without shrinking.
    if (window.visualViewport) {
        const onViewportChange = () => {
            // Only clamp chat screen — login/type-select handle their own scrolling
            if (!chatScreen.classList.contains('hidden')) {
                chatScreen.style.height = window.visualViewport.height + 'px';
                // Scroll messages to keep latest visible
                if (messagesContainer) {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            } else {
                // Reset when returning to login/type-select
                chatScreen.style.height = '';
            }
        };
        window.visualViewport.addEventListener('resize', onViewportChange);
    }

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

    function appendMediaMessage(blobUrl, mimeType, sender, destructSecs, fileName) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender, 'media-message');

        const isVideo = mimeType && mimeType.startsWith('video/');
        const isAudio = mimeType && mimeType.startsWith('audio/');
        const isImage = mimeType && mimeType.startsWith('image/');
        const isPDF   = mimeType === 'application/pdf';
        const typeIcon  = isVideo ? 'video' : isAudio ? 'music' : isImage ? 'image' : isPDF ? 'file' : 'paperclip';
        const typeLabel = isVideo ? 'VIDEO' : isAudio ? 'AUDIO' : isImage ? 'IMAGE' : isPDF ? 'PDF' : 'FILE';
        const displayName = fileName || ('secure_' + typeLabel.toLowerCase());

        // Inline preview element (hidden by default)
        let previewEl = null;
        if (isImage) {
            previewEl = document.createElement('img');
            previewEl.src = blobUrl;
            previewEl.alt = 'Encrypted Image';
            previewEl.className = 'media-preview-inline';
            previewEl.style.display = 'none';
        } else if (isVideo) {
            previewEl = document.createElement('video');
            previewEl.src = blobUrl;
            previewEl.controls = true;
            previewEl.playsInline = true;
            previewEl.className = 'media-preview-inline';
            previewEl.style.display = 'none';
        } else if (isAudio) {
            previewEl = document.createElement('audio');
            previewEl.src = blobUrl;
            previewEl.controls = true;
            previewEl.className = 'media-preview-inline';
            previewEl.style.display = 'none';
        }

        // File card
        const card = document.createElement('div');
        card.className = 'secure-file-card';

        const cardTop = document.createElement('div');
        cardTop.className = 'secure-file-top';
        cardTop.innerHTML = `
            <div class="secure-file-icon">${Icons.html(typeIcon, 'icon-lg')}</div>
            <div class="secure-file-info">
                <div class="secure-file-name">${escapeHtml(displayName.length > 26 ? displayName.substring(0,23)+'...' : displayName)}</div>
                <div class="secure-file-meta">${Icons.html('lockSmall', 'icon-xs')} AES-256-GCM &middot; ${typeLabel} &middot; In-Memory Only</div>
            </div>`;

        const btnRow = document.createElement('div');
        btnRow.className = 'secure-file-btns';

        // VIEW / HIDE button
        const viewBtn = document.createElement('button');
        viewBtn.className = 'secure-file-btn view';
        viewBtn.innerHTML = Icons.html('eye', 'icon-sm') + ' VIEW';
        let shown = false;
        viewBtn.addEventListener('click', () => {
            if (!previewEl) {
                window.open(blobUrl, '_blank', 'noopener,noreferrer');
                return;
            }
            shown = !shown;
            previewEl.style.display = shown ? 'block' : 'none';
            viewBtn.innerHTML = shown ? (Icons.html('eyeOff', 'icon-sm') + ' HIDE') : (Icons.html('eye', 'icon-sm') + ' VIEW');
        });

        // SAVE / DOWNLOAD button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'secure-file-btn save';
        dlBtn.innerHTML = Icons.html('download', 'icon-sm') + ' SAVE';
        dlBtn.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = displayName;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        btnRow.appendChild(viewBtn);
        btnRow.appendChild(dlBtn);
        card.appendChild(cardTop);
        if (previewEl) card.appendChild(previewEl);
        card.appendChild(btnRow);

        // Timer bar
        const timerWrap = document.createElement('div');
        timerWrap.className = 'secure-file-timer-wrap';
        const timerBar = document.createElement('div');
        timerBar.className = 'secure-file-timer-bar';
        const timerFill = document.createElement('div');
        timerFill.className = 'secure-file-timer-fill';
        timerFill.style.width = '100%';
        const timerLbl = document.createElement('div');
        timerLbl.className = 'secure-file-timer-lbl';
        timerLbl.textContent = 'AUTO-DESTRUCT: ' + destructSecs + 's';
        timerBar.appendChild(timerFill);
        timerWrap.appendChild(timerBar);
        timerWrap.appendChild(timerLbl);

        msgDiv.appendChild(card);
        msgDiv.appendChild(timerWrap);
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        let timeLeft = destructSecs;
        const total = destructSecs;
        const iv = setInterval(() => {
            timeLeft--;
            timerFill.style.width = Math.max(0, (timeLeft / total) * 100) + '%';
            timerLbl.textContent = 'AUTO-DESTRUCT: ' + timeLeft + 's';
            if (timeLeft <= 3) {
                timerFill.style.background = 'var(--danger-color)';
                timerLbl.style.color = 'var(--danger-color)';
            }
            if (timeLeft <= 0) {
                clearInterval(iv);
                msgDiv.style.transition = 'opacity 0.5s ease';
                msgDiv.style.opacity = '0';
                setTimeout(() => { msgDiv.remove(); URL.revokeObjectURL(blobUrl); }, 500);
            }
        }, 1000);
    }

    function showSystemAlert(html) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'system');
        // Use innerHTML so SVG icon spans (from Icons.html()) render correctly.
        // All dynamic content passed here is either a fixed string literal or
        // an Icons.html() call — no user-controlled data is inserted unsanitized.
        msgDiv.innerHTML = html;
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

    /** Hides and resets the session seal display. Call on disconnect or terminate. */
    function clearSessionSeal() {
        sessionSealEl.innerHTML = '';
        sessionSealContainer.classList.add('hidden');
        sessionSealContainer.classList.remove('seal-mismatch', 'seal-pulse');
        currentSeal = null;
    }

    function startSessionTimer() {
        // sessionTimeLeft is already set (in seconds) by joinRoom() from user input
        const totalSeconds = sessionTimeLeft;

        // Update the display label immediately so user sees the chosen time
        const initMins = Math.floor(totalSeconds / 60);
        const initSecs = totalSeconds % 60;
        sessionTimerDisplay.textContent =
            `SESSION EXPIRES: ${initMins}:${initSecs.toString().padStart(2, '0')}`;

        if (sessionTimerRef) clearInterval(sessionTimerRef); // cancel any previous timer

        sessionTimerRef = setInterval(() => {
            sessionTimeLeft--;
            const minutes = Math.floor(sessionTimeLeft / 60);
            const seconds = sessionTimeLeft % 60;
            sessionTimerDisplay.textContent =
                `SESSION EXPIRES: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (sessionTimeLeft <= 0) {
                clearInterval(sessionTimerRef);
                sessionTimerRef = null;
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

        // Clear and hide the session seal immediately
        clearSessionSeal();

        if (webrtcManager) webrtcManager.sendMessage(JSON.stringify({ type: 'WIPE_EVERYTHING' }));
        // Group: no need to broadcast, the relay would expose panic mode
        if (groupManager) groupManager.destroy();
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

        // Stop timer and clear seal before leaving
        if (sessionTimerRef) { clearInterval(sessionTimerRef); sessionTimerRef = null; }
        clearSessionSeal();

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
