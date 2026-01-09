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
    *   Listens for the `PrintScreen` key.
    *   Detects tab switching (`visibilitychange` event).
    *   **Action**: A warning is displayed locally, and a **System Alert** is sent to the peer, warning them that their chat might be compromised.

### 💣 3. Auto-Destruct Messages
*   **Concept**: Mission: Impossible style messages.
*   **Method**: Every message rendered in the DOM has a 10-second timer attached. When it hits 0, the DOM element is removed from the page.

---

## 🛠 Technologies Used
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+).
*   **Backend**: Node.js used ONLY for the signaling WebSocket server.
*   **Protocols**: WebRTC (RTCDataChannel), WebSocket.
*   **Security Library**: Native Web Crypto API (SubtleCrypto).

---

## 🏃‍♂️ Execution Guide

### Prerequisities
*   Node.js installed on your computer.

### Step 1: Start the Signaling Server
1.  Open a terminal/command prompt.
2.  Navigate to the `stealth-chat/server` folder.
3.  Run the server:
    ```bash
    npm start
    ```
    *You should see: "Signaling Server running on port 8080"*

### Step 2: Open the Client
Since this uses Web Crypto and WebRTC, it is best run on a local server or HTTPS. For this demo (localhost), it works fine directly.

**Option A: Same Computer Setup**
1.  Navigate to `stealth-chat/client`.
2.  Open `index.html` in **two different browser tabs** (or one Chrome, one Edge).
3.  In Tab 1: Enter a Room ID (e.g., "room1") and click **ENTER**.
4.  In Tab 2: Enter the **SAME** Room ID and click **ENTER**.
5.  Wait for the status to turn **Green (Secure Link Established)**.
6.  Start Chatting!

**Option B: Two Different Computers (Local Network)**
1.  Find the IP address of the computer running the server (e.g., `192.168.1.5`).
2.  In `client/main.js`, update the `host` variable from `window.location.hostname` to `'192.168.1.5'`.
3.  Serve the `client` folder using a simple HTTP server (e.g., `npx http-server client`).
4.  Access the client page from both computers.

---

## 🧪 How to Verify (For Examiners)

1.  **Verify P2P**: Shut down the Node.js server *after* the chat is connected. You will see connection status might stay (if signaling not needed for keep-alive), but more importantly, **send a message**. It will still go through because the WebRTC pipe is direct peer-to-peer!
2.  **Verify Encryption**: Open Browser Console (`F12`). Look at the network tab or console logs (if enabled). You will notice that "payloads" are sent as JSON objects with `iv` and `cipherText`, not plain text.
3.  **Verify Screenshot**: Press the `PrintScreen` key on your keyboard. Watch the **other peer's screen** receive a giant red security alert.

---

## 🔮 Future Enhancements
*   Video/Audio Calling implementation.
*   File Sharing support via DataChannel.
*   Identity verification using Digital Signatures.
