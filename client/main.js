// Wait for DOM to be fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginScreen = document.getElementById('login-screen');
    const chatScreen = document.getElementById('chat-screen');
    const panicScreen = document.getElementById('panic-screen');
    const roomInput = document.getElementById('room-input');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const roomDisplay = document.getElementById('room-display');
    const connectionStatus = document.getElementById('connection-status');
    const encryptionStatus = document.getElementById('encryption-status');
    const sessionTimerDisplay = document.getElementById('session-timer-display');
    const securityAlert = document.getElementById('security-alert');
    const dismissAlertBtn = document.getElementById('dismiss-alert');
    const typingIndicator = document.getElementById('typing-indicator');
    const stealthTypingToggle = document.getElementById('stealth-typing');
    const noMetadataToggle = document.getElementById('no-metadata');
    const decoyBtn = document.getElementById('decoy-btn');

    // New UI Elements
    const createModeBtn = document.getElementById('create-mode-btn');
    const joinModeBtn = document.getElementById('join-mode-btn');
    const createMode = document.getElementById('create-mode');
    const joinMode = document.getElementById('join-mode');
    const generateRoomBtn = document.getElementById('generate-room-btn');
    const createJoinBtn = document.getElementById('create-join-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const generatedRoomId = document.getElementById('generated-room-id');
    const copyRoomBtn = document.getElementById('copy-room-btn');
    const loginStatus = document.getElementById('login-status');
    const leaveBtn = document.getElementById('leave-btn');

    // State
    let myRoomId = null;
    let cryptoManager = new window.CryptoManager();
    let webrtcManager = null;
    let screenshotDetector = null;
    let currentMode = 'create'; // 'create' or 'join'
    let generatedRoom = null;

    // Privacy Settings
    let autoDestructTime = 10;
    let sessionTimeLeft = 600; // 10 minutes session
    let anonymousIdentity = "Agent-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    let isDecoyActive = false;

    // ----------------------
    // MODE SWITCHING
    // ----------------------

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

    // ----------------------
    // ROOM GENERATION
    // ----------------------

    function generateSecureRoomId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
        const segments = [];
        for (let i = 0; i < 3; i++) {
            let segment = '';
            for (let j = 0; j < 4; j++) {
                segment += chars[Math.floor(Math.random() * chars.length)];
            }
            segments.push(segment);
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
            setTimeout(() => {
                copyRoomBtn.textContent = '📋 COPY';
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
            loginStatus.textContent = 'Failed to copy to clipboard';
            loginStatus.classList.add('error');
        }
    });

    // ----------------------
    // JOIN ROOM
    // ----------------------

    async function joinRoom(roomId) {
        if (!roomId) {
            loginStatus.textContent = 'Please enter a room ID';
            loginStatus.classList.add('error');
            return;
        }

        loginStatus.textContent = 'Checking room availability...';
        loginStatus.classList.remove('error');

        myRoomId = roomId;

        // UI Update
        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        roomDisplay.textContent = `CHANNEL: SECURE_${roomId.toUpperCase()}`;

        // Set Anonymous Identity
        showSystemAlert(`IDENTIFIED AS: ${anonymousIdentity}`);

        await initSecurity();
        initNetworking();
        startSessionTimer();
    }

    createJoinBtn.addEventListener('click', () => {
        joinRoom(generatedRoom);
    });

    joinRoomBtn.addEventListener('click', () => {
        const roomId = roomInput.value.trim();
        joinRoom(roomId);
    });

    roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const roomId = roomInput.value.trim();
            joinRoom(roomId);
        }
    });


    leaveBtn.addEventListener('click', () => {
        terminateSession("SESSION TERMINATED BY USER");
    });

    async function initSecurity() {
        try {
            await cryptoManager.generateKeyPair();

            screenshotDetector = new window.ScreenshotDetector((reason) => {
                // Breach detected
                handleSecurityBreach(reason);
            });

            // Focus Lost Callback
            screenshotDetector.setOnFocusLost(() => {
                document.body.classList.add('content-obscured');
            });

            // Panic Mode (3x ESC)
            screenshotDetector.setOnPanicTriggered(() => {
                triggerPanicMode();
            });

            // UI Settings
            const timerSelect = document.getElementById('timer-select');
            timerSelect.addEventListener('change', (e) => {
                autoDestructTime = parseInt(e.target.value);
                showSystemAlert(`DESTRUCT TIMER: ${autoDestructTime}s`);
            });

            // Decoy Mode
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
        appendMessage(`[DECOY] ${randomMsg}`, sender);

        setTimeout(() => {
            if (isDecoyActive) startDecoyMessages();
        }, 4000 + Math.random() * 6000);
    }

    function initNetworking() {
        // Use configured signaling server URL from config.js
        let signalingUrl = window.SIGNALING_SERVER_URL;

        // Fallback to same-host if not configured (for local development)
        if (!signalingUrl) {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const host = window.location.host;
            signalingUrl = `${protocol}://${host}`;
            console.warn('⚠️ SIGNALING_SERVER_URL not configured in config.js. Using same-host:', signalingUrl);
        } else {
            console.log('🔗 Connecting to signaling server:', signalingUrl);
        }

        webrtcManager = new window.WebRTCManager(
            signalingUrl,
            onMessageReceived,
            onPeerConnected,
            onPeerDisconnected
        );

        webrtcManager.connectToSignaling(myRoomId);
    }

    // ----------------------
    // CALLBACKS
    // ----------------------

    async function onPeerConnected() {
        connectionStatus.textContent = "● PEER CONNECTED";
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');

        // Start Handshake Visualization
        showSystemAlert("INITIATING SECURE HANDSHAKE...");

        const myPublicKey = await cryptoManager.exportPublicKey();
        webrtcManager.sendMessage(JSON.stringify({
            type: 'KEY_EXCHANGE',
            key: myPublicKey,
            identity: anonymousIdentity
        }));
    }

    function onPeerDisconnected() {
        connectionStatus.textContent = "● PEER DISCONNECTED";
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        encryptionStatus.classList.add('hidden');

        // Advanced Self-Destruct: Wipe on disconnect
        wipeMessages();
        showSystemAlert("PEER DISCONNECTED - LOCAL DATA PURGED");
    }

    async function onMessageReceived(rawMessage) {
        try {
            const payload = JSON.parse(rawMessage);

            if (payload.type === 'KEY_EXCHANGE') {
                await cryptoManager.deriveSessionKey(payload.key);
                encryptionStatus.classList.remove('hidden');
                showSystemAlert(`✅ CHANNEL SECURED WITH: ${payload.identity}`);
            }
            else if (payload.type === 'CHAT_MSG') {
                const decryptedText = await cryptoManager.decryptMessage(payload.content);
                appendMessage(decryptedText, 'peer');
            }
            else if (payload.type === 'TYPING') {
                if (payload.isTyping) {
                    typingIndicator.classList.remove('hidden');
                } else {
                    typingIndicator.classList.add('hidden');
                }
            }
            else if (payload.type === 'SYSTEM_ALERT') {
                triggerSecurityOverlay(payload.content);
            }
            else if (payload.type === 'WIPE_EVERYTHING') {
                wipeMessages();
                triggerSecurityOverlay("PEER BRACH DETECTED - DATA PURGED");
            }
        } catch (e) {
            console.error("Payload Error:", e);
        }
    }

    // ----------------------
    // CORE FEATURES
    // ----------------------

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
        // 1. Hide actual UI
        chatScreen.classList.add('hidden');
        loginScreen.classList.add('hidden');

        // 2. Clear sensitive data
        wipeMessages();
        cryptoManager = null; // Destroy keys

        // 3. Show decoy
        panicScreen.classList.add('active');

        // 4. Send wipe to peer
        if (webrtcManager) {
            webrtcManager.sendMessage(JSON.stringify({ type: 'WIPE_EVERYTHING' }));
        }

        console.log("PANIC MODE ACTIVATED");
    }

    function handleSecurityBreach(reason) {
        // Visual alert
        document.body.classList.add('content-obscured');

        // Wipe local
        wipeMessages();

        // Notify Peer
        if (webrtcManager) {
            webrtcManager.sendMessage(JSON.stringify({
                type: 'SYSTEM_ALERT',
                content: `SECURITY BREACH DETECTED: ${reason}`
            }));
            webrtcManager.sendMessage(JSON.stringify({ type: 'WIPE_EVERYTHING' }));
        }

        triggerSecurityOverlay(reason);
    }

    function triggerSecurityOverlay(reason) {
        securityAlert.querySelector('p').textContent = `PROTOCOL BREACH: ${reason.toUpperCase()}`;
        securityAlert.classList.remove('hidden');
    }

    function terminateSession(reason) {
        alert(reason);
        window.location.reload(); // Hard reset
    }

    // ----------------------
    // MESSAGING
    // ----------------------

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Typing indicator logic
    let typingTimeout;
    messageInput.addEventListener('input', () => {
        if (webrtcManager && !stealthTypingToggle.checked) {
            webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: true }));
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: false }));
            }, 1500);
        }
    });

    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !cryptoManager.sessionKey) return;

        appendMessage(text, 'me');

        const encryptedData = await cryptoManager.encryptMessage(text);
        webrtcManager.sendMessage(JSON.stringify({
            type: 'CHAT_MSG',
            content: encryptedData
        }));

        messageInput.value = '';
        if (webrtcManager) webrtcManager.sendMessage(JSON.stringify({ type: 'TYPING', isTyping: false }));
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender);

        // Message content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.classList.add('message-content');

        const textSpan = document.createElement('span');
        textSpan.classList.add('message-text');
        textSpan.textContent = text;
        contentWrapper.appendChild(textSpan);

        // Timestamp shown below message text in small font
        if (!noMetadataToggle.checked) {
            const timeSpan = document.createElement('span');
            timeSpan.classList.add('message-time');
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            timeSpan.textContent = `${hours}:${minutes}`;
            contentWrapper.appendChild(timeSpan);
        }

        msgDiv.appendChild(contentWrapper);

        const timerSpan = document.createElement('div');
        timerSpan.classList.add('destruct-timer');
        msgDiv.appendChild(timerSpan);

        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Countdown
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

    dismissAlertBtn.addEventListener('click', () => {
        securityAlert.classList.add('hidden');
        document.body.classList.remove('content-obscured');
        document.body.classList.remove('hard-obscure');
    });

    // Memory Wipe on Close
    window.onbeforeunload = () => {
        // Clear variables
        myRoomId = null;
        cryptoManager = null;
        messagesContainer.innerHTML = '';
    };

}); // End of DOMContentLoaded
