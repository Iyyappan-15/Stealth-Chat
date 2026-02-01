// DOM Elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const roomDisplay = document.getElementById('room-display');
const connectionStatus = document.getElementById('connection-status');
const securityAlert = document.getElementById('security-alert');
const dismissAlertBtn = document.getElementById('dismiss-alert');

// State
let myRoomId = null;
let cryptoManager = new window.CryptoManager();
let webrtcManager = null;
let screenshotDetector = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Audio for alerts (Base64 for simplicity if needed, or just visual)

// ----------------------
// INITIALIZATION
// ----------------------

joinBtn.addEventListener('click', async () => {
    const roomId = roomInput.value.trim();
    if (!roomId) return alert("Please enter a room ID");

    myRoomId = roomId;

    // UI Update
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    roomDisplay.textContent = `Room: ${roomId}`;

    // Initialize Security
    await initSecurity();

    // Initialize WebRTC
    initNetworking();
});

const leaveBtn = document.getElementById('leave-btn');
leaveBtn.addEventListener('click', () => {
    // Reloading is the cleanest way to reset P2P and key state
    window.location.reload();
});

async function initSecurity() {
    try {
        // 1. Generate local keys
        await cryptoManager.generateKeyPair();
        console.log('Cryptographic keys generated successfully');

        // 2. Start Detector
        screenshotDetector = new window.ScreenshotDetector((reason) => {
            // When WE do something suspicious:

            // 0. VISUAL BLOCK - IMMEDIATE PRIORITY
            document.body.classList.add('content-obscured');

            // 1. Wipe our own screen IMMEDIATELY
            wipeMessages();

            // 2. Warn us
            showSystemAlert(`⚠ SECURITY BREACH: ${reason}`);
            showSystemAlert(`⛔ ALL DATA WIPED LOCALLY`);

            triggerSecurityOverlay();

            // 3. Send alert AND WIPE COMMAND to peer
            if (webrtcManager && webrtcManager.dataChannel) {
                try {
                    // Send Alert
                    webrtcManager.sendMessage(JSON.stringify({
                        type: 'SYSTEM_ALERT',
                        content: `Peer triggered security event: ${reason}`
                    }));

                    // Send Wipe Command
                    webrtcManager.sendMessage(JSON.stringify({
                        type: 'WIPE_EVERYTHING'
                    }));
                } catch (err) {
                    console.error('Failed to send security alert:', err);
                }
            }
        });
    } catch (e) {
        console.error("Security Init Fail:", e);
        showSystemAlert(`❌ SECURITY ERROR: ${e.message}. Please ensure you're using HTTPS or localhost.`);
    }
}

function initNetworking() {
    // Determine WebSocket URL relative to the page origin
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host; // includes port if present
    const signalingUrl = `${protocol}://${host}`;

    webrtcManager = new window.WebRTCManager(
        signalingUrl,
        onMessageReceived,
        onOpenerConnected,
        onPeerDisconnected
    );

    webrtcManager.connectToSignaling(myRoomId);
}

// ----------------------
// CALLBACKS
// ----------------------

async function onOpenerConnected() {
    connectionStatus.textContent = "● Secure Link Established";
    connectionStatus.classList.remove('disconnected');
    connectionStatus.classList.add('connected');

    // Exchange Keys
    const myPublicKey = await cryptoManager.exportPublicKey();
    showSystemAlert("Sending my public key...");
    webrtcManager.sendMessage(JSON.stringify({
        type: 'KEY_EXCHANGE',
        key: myPublicKey
    }));
}

function onPeerDisconnected() {
    connectionStatus.textContent = "● Peer Disconnected";
    connectionStatus.classList.remove('connected');
    connectionStatus.classList.add('disconnected');
    showSystemAlert("Peer has left the secure channel.");
}

async function onMessageReceived(rawMessage) {
    try {
        const payload = JSON.parse(rawMessage);

        if (payload.type === 'KEY_EXCHANGE') {
            // Received Peer's Public Key -> Derive Session Key
            try {
                await cryptoManager.deriveSessionKey(payload.key);
                showSystemAlert("✅ Encryption Handshake Complete. Channel is Secure.");
                reconnectAttempts = 0; // Reset on successful connection
            } catch (err) {
                console.error('Key exchange failed:', err);
                showSystemAlert(`❌ Key exchange failed: ${err.message}`);
            }
        }
        else if (payload.type === 'CHAT_MSG') {
            // Decrypt Message
            try {
                const decryptedText = await cryptoManager.decryptMessage(payload.content);
                appendMessage(decryptedText, 'peer');
            } catch (err) {
                console.error('Decryption failed:', err);
                showSystemAlert(`❌ Failed to decrypt message`);
            }
        }
        else if (payload.type === 'SYSTEM_ALERT') {
            // Security Alert from Peer
            triggerSecurityOverlay();
        }
        else if (payload.type === 'WIPE_EVERYTHING') {
            wipeMessages();
            showSystemAlert("⛔ PEER SECURITY BREACH - CHAT WIPED");
            triggerSecurityOverlay();
        }
    } catch (e) {
        console.error("Error processing message:", e);
        showSystemAlert(`❌ Message processing error: ${e.message}`);
    }
}

// ----------------------
// MESSAGING USER INTERFACE
// ----------------------

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!cryptoManager.sessionKey) {
        return alert("Waiting for secure handshake...");
    }

    // 1. Display Locally
    appendMessage(text, 'me');

    // 2. Encrypt & Send
    const encryptedData = await cryptoManager.encryptMessage(text);
    webrtcManager.sendMessage(JSON.stringify({
        type: 'CHAT_MSG',
        content: encryptedData
    }));

    messageInput.value = '';
}

function appendMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    msgDiv.appendChild(textSpan);

    const timeSpan = document.createElement('span');
    timeSpan.classList.add('timestamp');
    const now = new Date();
    timeSpan.textContent = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    msgDiv.appendChild(timeSpan);

    // Auto-Destruct Timer
    const timerSpan = document.createElement('div');
    timerSpan.classList.add('destruct-timer');
    timerSpan.textContent = '10s';
    msgDiv.appendChild(timerSpan);

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Countdown Logic
    let timeLeft = 10;
    const interval = setInterval(() => {
        timeLeft--;
        timerSpan.textContent = `${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(interval);
            msgDiv.remove(); // POOF!
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
    // Nuke everything immediately
    messagesContainer.innerHTML = '';

    // Add a placeholder indicating what happened
    const placeholder = document.createElement('div');
    placeholder.classList.add('message-deleted-placeholder');
    placeholder.textContent = "-- CRITICAL SECURITY EVENT: DATA PURGED --";
    messagesContainer.appendChild(placeholder);
}

// ----------------------
// SECURITY OVERLAY
// ----------------------

function triggerSecurityOverlay() {
    securityAlert.classList.remove('hidden');
    // Play alert sound if possible
}

dismissAlertBtn.addEventListener('click', () => {
    securityAlert.classList.add('hidden');
    // Remove the blur when dismissed
    document.body.classList.remove('content-obscured');
});
