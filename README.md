# 🕵️‍♂️ Stealth Chat - Secure & Ephemeral P2P Messenger

## 📜 What is Stealth Chat?
Stealth Chat is a modern, minimal, browser-based peer-to-peer (P2P) messaging application designed for absolute privacy. Instead of routing your messages and files through a central server, Stealth Chat connects you directly to other users using **WebRTC**.

Everything you send—text, audio, video, and files—is **end-to-end encrypted** using AES-GCM. Once your chat is over or a timer expires, everything is permanently wiped from memory. No database. No message history. Pure privacy.

---

## ✨ Key Features & Updates

### 🔒 1. True End-To-End Encryption
*   Uses the **Web Crypto API**. Keys are generated securely in your browser using **ECDH** (Elliptic Curve Diffie-Hellman).
*   Messages and media are encrypted with **AES-GCM** before they ever leave your device.

### 👥 2. Group Chats with Dynamic Security Seals
*   Support for both 1-on-1 and Group discussions.
*   **Dynamic Group Seals**: A unique security "seal" emoji changes randomly whenever a new member joins or leaves the group. This instantly visually alerts all users to a change in the room's composition, ensuring no invisible lurkers.

### 📁 3. In-Memory Media Sharing & Calling
*   **Media Sharing**: Share files securely directly between peers. Files are stored entirely in memory (ephemeral) with safe "View" and "Download" options.
*   **Audio/Video Calls**: Start encrypted real-time video or voice calls seamlessly within your chat session.

### 📸 4. Smart Screenshot & Intrusion Detection
*   **Soft Focus-Loss**: If you switch tabs or minimize the window, the screen instantly blacks out to protect privacy from over-the-shoulder snooping.
*   **Hard Breaches**: If the app detects a screenshot attempt (via keyboard shortcuts or system tools), it immediately alerts the other peers and can wipe the session.

### ⏳ 5. Auto-Destructing Messages
*   Take control of your data with configurable timers (e.g., 5s, 10s, 30s, 1m).
*   Messages automatically self-destruct from the screen and memory when the timer hits zero.

### 🎨 6. Clean, Minimalist Design
*   A newly refined, professional UI with clean SVG icons, responsive mobile layouts, and a focus on usability without unnecessary visual clutter.

---

## 🏗 How It Works
1.  **Signaling Server (Node.js)**: Acts purely as a "Matchmaker". It helps browsers find each other using Room IDs.
2.  **Client (HTML/JS)**: Once a WebRTC connection is established, the signaling server steps back. All data (chat, video, files) flows *directly* from Browser A to Browser B.

---

## 📋 Prerequisites
*   **Node.js** (v14 or higher)
*   **Modern Web Browser** (Chrome, Firefox, Edge, Safari)
*   **Localhost or HTTPS** (Required for the Web Crypto API to function)

---

## 🏃‍♂️ How to Run This Project

### Step 1: Install Dependencies
Open a terminal and navigate to the `server` directory:
```bash
cd server
npm install
```

### Step 2: Start the Signaling Server
```bash
npm start
```
*The server will start running on port 8080.*

### Step 3: Open the Client
Open your browser and navigate to `http://localhost:8080`.

### Step 4: Start Chatting
1. Open the URL in multiple tabs or devices on the same network.
2. Enter the **same Room ID**.
3. Wait for the secure link to establish, and start communicating securely!

📚 **See our deployment guides:**
- [🚀 QUICK_START.md](./QUICK_START.md) - Fast 5-minute deployment guide
- [📖 DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Comprehensive deployment documentation

---

## 🧪 How to Verify the Security
*   **Kill the Server**: Once connected, stop the Node.js server. Your chat and video calls will continue working because they are peer-to-peer!
*   **Try a Screenshot**: Press `PrintScreen` or `Alt+Tab` and watch the privacy overlay activate instantly.
*   **Check Network Traffic**: Open Developer Tools (F12) -> Network. You won't see your messages being sent to the server.

---

## ❓ FAQ

**Q: Do my messages or files get stored on a server?**  
A: No. Absolutely nothing is stored on the server. Data lives briefly in browser memory and vanishes when the tab is closed or the timer expires.

**Q: Can more than 2 people join a room?**  
A: Yes! The latest updates support multi-peer Group Chats with dynamic security seals to verify who is in the room.

**Q: Can I share files?**  
A: Yes! In-memory, ephemeral file sharing is supported.

**Q: Is this production-ready?**  
A: While it features robust security concepts, this remains an educational project. Use established tools like Signal for real-world life-critical communications.

---

**Made with ❤️ for privacy, security, and clean design.**
