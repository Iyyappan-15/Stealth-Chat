# 🕵️ Stealth Chat - Serverless Secured P2P Messaging

## 📜 Abstract
Stealth Chat is a browser-based, peer-to-peer (P2P) messaging application designed for maximum privacy and security. Unlike traditional chat apps that store messages on a central server, Stealth Chat establishes a direct connection between two users using **WebRTC**. Messages are end-to-end encrypted using **AES-GCM** with ephemeral keys generated via **ECDH** (Elliptic Curve Diffie-Hellman), ensuring that even if the signaling server is compromised, the messages remain unreadable. The application also features unique security mechanisms like "Screenshot Detection" and "Auto-Destructing Messages" to prevent data leakage.

---

## 🎯 Objectives
1.  **Eliminate Data Storage**: No database or message history on any server.
2.  **End-to-End Encryption**: Secure key exchange and encryption in the browser.
3.  **Peer-to-Peer Communication**: Direct data transfer between clients.
4.  **Anti-Forensics**: Messages disappear automatically; screenshot attempts trigger alerts.
5.  **Simplicity**: Lightweight implementations suitable for educational demonstration.

---

## 🏗 System Architecture

The system consists of two main parts:

### 1. Signaling Server (Node.js)
*   **Role**: The "Matchmaker".
*   **Why**: WebRTC peers (browsers) don't know each other's IP addresses initially.
*   **How**: It runs a simple WebSocket server. Client A sends its connection info (SDP/ICE Candidates) to the server, which forwards it to Client B. Once the handshake is complete, the server is no longer needed for the chat itself.

### 2. Client (HTML/CSS/JS)
*   **WebRTC Manager**: Handles the complicated logic of connecting to another browser.
*   **Crypto Manager**: Handles generating keys and encrypting/decrypting text.
*   **Screenshot Detector**: Monitors user behavior to detect screen capture attempts.

---

## 🚀 Features & Unique Innovations

### 🔒 1. End-To-End Encryption (E2EE)
*    **Technology**: Web Crypto API (Standard in modern browsers).
*    **Mechanism**:
    1.  When peers connect, they generate **ECDH Key pairs**.
    2.  They exchange **Public Keys** over the data channel.
    3.  Each peer derives a shared **Secret Session Key**.
    4.  All messages are encrypted with **AES-GCM** using this key.

### 📸 2. Screenshot & Intrusion Detection
*   **Concept**: If a user tries to capture proof of the conversation, the system detects it.
*   **Method**:
    *   Listens for `PrintScreen` and `Alt + PrintScreen`.
    *   Detects screenshot shortcuts (Win+Shift+S, Cmd+Shift+3/4).
    *   Monitors `visibilitychange` (tab switching).
    *   **Action**: A black-out overlay appears with the message "⚠ Screenshot or screen capture suspected". A **System Alert** is sent to the peer.

### 💣 3. Auto-Destruct Messages (Configurable)
*   **Concept**: Mission: Impossible style messages with user control.
*   **Method**: Users can choose between 5s, 10s (default), 30s, or 1m timers. When it hits 0, the message is permanently removed from memory and the DOM.

### 🔒 4. Session Lock
*   **Concept**: Prevent unauthorized access if the user steps away.
*   **Action**: If enabled, switching tabs or minimizing the window will trigger an immediate session wipe and logout. If disabled, it only obscures the screen for privacy.

---

## 🛠 Technologies Used
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+).
*   **Backend**: Node.js used ONLY for the signaling WebSocket server.
*   **Protocols**: WebRTC (RTCDataChannel), WebSocket.
*   **Security Library**: Native Web Crypto API (SubtleCrypto).

---

## 📋 Prerequisites

Before running Stealth Chat, ensure you have:

1. **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
2. **npm** (comes with Node.js)
3. **Modern Web Browser** (Chrome, Firefox, Edge, or Safari)
   - Must support WebRTC and Web Crypto API
4. **HTTPS or localhost** - Web Crypto API requires secure context

---

## 🏃‍♂️ How to Run This Project

### Step 1: Install Dependencies

Open a terminal/command prompt and navigate to the project directory:

```bash
cd server
npm install
```

This will install all required dependencies:
- `express` - Web server framework
- `ws` - WebSocket library
- `cors` - Cross-origin resource sharing

### Step 2: Start the Signaling Server

From the `server` directory, run:

```bash
npm start
```

Or directly:

```bash
node server.js
```

You should see:
```
Serving static files from: [path]/client
Server is running on port 8080
```

**✅ Server is now running!** Keep this terminal window open.

### Step 3: Open the Client Application

The server automatically serves the client files. Open your web browser and navigate to:

```
http://localhost:8080
```

### Step 4: Start a Secure Chat Session

**Option A: Same Computer (Two Browser Tabs)**

1. Open `http://localhost:8080` in **two different browser tabs** (or use two different browsers)
2. In **Tab 1**: Enter a Room ID (e.g., "secret123") and click **ENTER SECURE CHANNEL**
3. In **Tab 2**: Enter the **SAME** Room ID ("secret123") and click **ENTER SECURE CHANNEL**
4. Wait for the status to turn **Green: "● Secure Link Established"**
5. Start chatting! Messages are end-to-end encrypted.

**Option B: Two Different Computers (Same Network)**

1. Find the IP address of the computer running the server:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Mac/Linux: `ifconfig` or `ip addr`
   
2. On the server computer, the server should already be running on port 8080

3. On **both computers**, open a browser and navigate to:
   ```
   http://[SERVER_IP]:8080
   ```
   Example: `http://192.168.1.100:8080`

4. Enter the same Room ID on both computers
5. Wait for connection and start chatting!

---

## 🧪 How to Verify (Testing)

### 1. Verify P2P Connection
- After establishing the chat connection, **stop the Node.js server** (Ctrl+C in the terminal)
- Try sending a message in the chat
- **It will still work!** This proves the connection is truly peer-to-peer

### 2. Verify Encryption
- Open Browser Console (Press `F12`)
- Go to the **Console** tab
- Look for log messages showing encrypted payloads with `iv` and `data` fields
- Messages are NOT sent as plain text

### 3. Verify Screenshot Detection
- Press `PrintScreen` or `Alt + PrintScreen`.
- Watch the **black security overlay** appear with the alert message.
- Verify the **other peer** receives a security notification.

### 4. Verify Auto-Destruct Configuration
- Change the timer in the header (e.g., to 5s).
- Send a message and verify it lasts only 5 seconds.

### 5. Verify Session Lock
- Toggle the **Session Lock** switch to "ON".
- Switch browser tabs and then come back.
- Verify the chat has been reset and you are back at the login screen.

---

## 🔧 Troubleshooting

### Server won't start
**Error**: `Cannot find module 'express'` or similar
- **Solution**: Run `npm install` in the `server` directory

**Error**: `Port 8080 is already in use`
- **Solution**: Change the port in `server/server.js` (line 10) or stop the process using port 8080

### Client won't connect
**Error**: "Failed to connect to signaling server"
- **Solution**: Make sure the server is running (`npm start` in server directory)
- Check that you're accessing `http://localhost:8080` (not `file://`)

### Encryption errors
**Error**: "SECURITY ERROR: The operation is insecure"
- **Solution**: Web Crypto API requires HTTPS or localhost. Make sure you're using `http://localhost:8080`, not opening the HTML file directly

### WebRTC connection fails
**Problem**: Status stays "Disconnected"
- **Solution**: 
  - Check browser console for errors (F12)
  - Make sure both peers entered the **exact same** Room ID
  - Try refreshing both browser tabs
  - Check firewall settings (may block WebRTC)

### Screenshot detection too sensitive
- The detection has been tuned to avoid false positives
- Only triggers on actual screenshot keys, not normal tab switching
- If needed, you can disable it by commenting out the detector in `client/main.js`

---

## 🌐 Browser Compatibility

| Browser | Supported | Notes |
|---------|-----------|-------|
| Chrome  | ✅ Yes    | Recommended |
| Firefox | ✅ Yes    | Fully supported |
| Edge    | ✅ Yes    | Chromium-based |
| Safari  | ✅ Yes    | macOS/iOS 11+ |
| Opera   | ✅ Yes    | Chromium-based |

**Note**: All browsers must support WebRTC and Web Crypto API (all modern browsers do).

---

## 🔒 Security Considerations

### What is Encrypted
✅ All chat messages (end-to-end)  
✅ Message content never touches the server  
✅ Encryption keys generated locally in browser  

### What is NOT Encrypted
⚠️ Room IDs (sent to signaling server)  
⚠️ Connection metadata (IP addresses visible to STUN servers)  
⚠️ The fact that two peers are communicating  

### Important Notes
- This is a **demonstration project** for educational purposes
- Not audited for production security use
- Messages auto-destruct but may remain in browser memory
- Screenshot detection can be bypassed by external cameras
- Use at your own risk for sensitive communications

---

## 📁 Project Structure

```
Stealth-Chat/
├── server/
│   ├── server.js          # WebSocket signaling server
│   ├── package.json       # Server dependencies
│   └── node_modules/      # Installed packages
├── client/
│   ├── index.html         # Main UI
│   ├── style.css          # Styling
│   ├── main.js            # Application logic
│   ├── webrtc.js          # WebRTC connection manager
│   ├── crypto.js          # Encryption/decryption
│   └── screenshotDetector.js  # Security monitoring
└── README.md              # This file
```

---

## ❓ FAQ

**Q: Do messages get stored anywhere?**  
A: No. Messages only exist in browser memory and auto-destruct based on your timer setting. There is NO database, `localStorage`, or `sessionStorage` used for chat content.

**Q: Can the server read my messages?**  
A: No. Messages are encrypted end-to-end. The server only helps establish the connection.

**Q: What happens if I refresh the page?**  
A: All messages are lost (by design). You'll need to reconnect.

**Q: Can more than 2 people join a room?**  
A: No. This is a P2P demo limited to 2 peers per room.

**Q: Does this work over the internet?**  
A: Yes, but you'll need to expose port 8080 or deploy the server to a public host.

**Q: Is this production-ready?**  
A: No. This is an educational demonstration. Use established solutions like Signal for real secure messaging.

---

## 🔮 Future Enhancements
*   Video/Audio Calling implementation.
*   File Sharing support via DataChannel.
*   Identity verification using Digital Signatures.
*   Group chat support (multi-peer).
*   Message persistence with local encryption.

---

## 📄 License

This project is open source and available for educational purposes.

---

## 👨‍💻 Contributing

Feel free to fork, improve, and submit pull requests!

---

**Made with ❤️ for privacy and security education**
