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

---

## 🆘 Troubleshooting

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
