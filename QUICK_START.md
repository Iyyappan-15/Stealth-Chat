# 🚀 Quick Start - Stealth Chat Deployment

## For Users Who Just Want It Working

### 1️⃣ Deploy Server (5 minutes)

1. Go to **[render.com](https://render.com)** and sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo
4. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Click **"Create Web Service"**
6. **Copy your server URL** (looks like: `https://stealth-chat-xxx.onrender.com`)

### 2️⃣ Configure Client (30 seconds)

1. Open **`client/config.js`**
2. Change this line:
   ```javascript
   window.SIGNALING_SERVER_URL = 'http://localhost:8080';
   ```
   To:
   ```javascript
   window.SIGNALING_SERVER_URL = 'https://YOUR-SERVER-URL.onrender.com';
   ```
3. Save the file

### 3️⃣ Deploy Client (2 minutes)

1. Go to **[netlify.com](https://netlify.com)** and sign up (free)
2. **Drag and drop** the **entire `client` folder** onto Netlify
3. Wait 30 seconds
4. **Copy your app URL** (looks like: `https://stealth-chat-xxx.netlify.app`)

### 4️⃣ Share & Test (1 minute)

1. Send your Netlify URL to your friend
2. Both of you open the URL
3. Both enter the **same room ID** (e.g., "secret123")
4. Click "ESTABLISH SECURE LINK"
5. You should see **"● PEER CONNECTED"**
6. Start chatting! 🎉

---

## ✅ Verify It's Working

**Test server:** Visit `https://your-server.onrender.com/health`
- Should show: `{"status": "ok", ...}`

**Test client:** Open browser console (F12)
- Should show: `🔗 Connecting to signaling server: ...`


## � Verify New Features (Audio Call + Encrypted Media)

> You need **two browser tabs/windows** open to the same app URL for P2P testing.

### Setup (do this first)
1. Open your app in **Tab A** → Click **CREATE ROOM** → Generate a room ID → Click **ESTABLISH SECURE LINK**
2. Open your app in **Tab B** → Click **JOIN ROOM** → Paste the same room ID → Click **ESTABLISH SECURE LINK**
3. Wait until both tabs show **`✅ CHANNEL SECURED WITH: Agent-XXXX`** in the message area
4. The header should now show **`● PEER CONNECTED`** in green

---

### 📞 Test Audio Call
1. In **Tab A**, click the **📞 button** (left of the text box)
   - ✅ Browser should prompt: *"Allow microphone access?"* — click **Allow**
   - ✅ **Tab A** shows the **SECURE CALL ACTIVE** overlay with a running timer
2. In **Tab B**, the call auto-connects (browser also prompts for mic — click Allow)
   - ✅ **Tab B** also shows the **SECURE CALL ACTIVE** overlay
3. Speak into one microphone — you should hear audio in the other tab
4. Click **⛔ END CALL** on either tab
   - ✅ Overlay disappears on **both** tabs
   - ✅ Both tabs show system message: `📵 CALL ENDED — NO TRACE`

**Verify zero trace (DevTools → Network tab):**
- No audio files uploaded anywhere — the Network tab should show **zero audio/media requests**

---

### 📎 Test Encrypted Media Sharing
1. In **Tab A**, click the **📎 button** (left of the text box)
   - ✅ Your OS file picker opens — select any **image** (JPG/PNG) or **short video** (MP4)
2. Watch the progress bar appear: `ENCRYPTING... XX%` → `TRANSMITTING...`
   - ✅ In **Tab A**: the image/video appears in your message area with a destruct timer
   - ✅ In **Tab B**: the image/video appears decrypted inline automatically
3. Wait for the destruct timer (e.g. 10s) to count down to 0
   - ✅ The media bubble fades out and disappears on **both** tabs

**Verify zero trace (DevTools → Application tab):**
- Open **Application → Local Storage** → should be **empty**
- Open **Application → IndexedDB** → should be **empty**
- Open **Network tab** → no HTTP file upload requests — data went through WebRTC DataChannel only

---

### Troubleshooting New Features

| Problem | Solution |
|---------|----------|
| 📞 Call button does nothing | Wait for `✅ CHANNEL SECURED` first — encryption must complete |
| Mic permission denied | Click the 🔒 icon in browser address bar → allow microphone |
| Can't hear audio in other tab | Make sure both tabs allowed mic; check OS audio output |
| 📎 Attach button does nothing | Same as call — wait for `✅ CHANNEL SECURED` message first |
| File takes long to send | Large files (~50 MB) take ~10–30s to encrypt and chunk |
| Media not showing on receiver | Check browser console (F12) for decryption errors |

---


| Problem | Solution |
|---------|----------|
| Can't connect to server | Check `config.js` has correct URL with `https://` |
| Peer doesn't connect | Both users must enter **exact same room ID** |
| "Mixed content" error | Make sure you're using `https://` not `http://` |
| Room is full | Only 2 people per room - use different room ID |

---

## 📖 Full Guide

For detailed instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

## 💡 How It Works

```
You (Computer A)                    Friend (Computer B)
      ↓                                    ↓
Both open: https://your-app.netlify.app
      ↓                                    ↓
Both connect to: wss://your-server.onrender.com
      ↓                                    ↓
Server coordinates WebRTC connection (signaling only)
      ↓                                    ↓
🔒 Direct encrypted P2P connection established!
```

**The server only helps you find each other. Messages go directly peer-to-peer, fully encrypted!**
