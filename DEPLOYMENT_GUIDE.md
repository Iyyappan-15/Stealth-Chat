# Stealth Chat - Deployment Guide

This guide will help you deploy your Stealth Chat application so it works across different networks.

## 🏗️ Architecture Overview

Stealth Chat has **two parts** that must be deployed separately:

1. **Signaling Server** (Node.js) - Handles WebSocket connections for WebRTC signaling
2. **Client Application** (Static Files) - The HTML/CSS/JavaScript frontend

```
┌──────────────────┐         ┌─────────────────────┐
│  Netlify/Vercel  │         │  Render/Railway     │
│  (Static Client) │────────▶│  (Node.js Server)   │
│  HTML/CSS/JS     │  wss:// │  WebSocket Server   │
└──────────────────┘         └─────────────────────┘
```

---

## 📝 Step 1: Deploy the Signaling Server

The server **MUST** be deployed first because you'll need its URL for the client configuration.

### Option A: Deploy to Render (Recommended - Free Tier Available)

1. **Create a Render account** at [render.com](https://render.com)

2. **Create a new Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository OR upload your code
   - Configure the service:
     - **Name:** `stealth-chat-server` (or your choice)
     - **Region:** Choose closest to your users
     - **Branch:** `main` (or your branch)
     - **Root Directory:** `server`
     - **Runtime:** Node
     - **Build Command:** `npm install`
     - **Start Command:** `node server.js`
     - **Plan:** Free

3. **Add Environment Variables (Optional):**
   - `PORT` - Render sets this automatically
   - `ALLOWED_ORIGINS` - Your Netlify URL (e.g., `https://your-app.netlify.app`)

4. **Deploy!** Render will provide you with a URL like:
   ```
   https://stealth-chat-server.onrender.com
   ```

5. **Verify the deployment:**
   - Visit `https://your-server-url.onrender.com/health`
   - You should see JSON with `"status": "ok"`

### Option B: Deploy to Railway

1. **Create account** at [railway.app](https://railway.app)
2. **New Project** → **Deploy from GitHub repo**
3. Configure:
   - **Root Directory:** `server`
   - **Start Command:** `node server.js`
4. Railway will auto-detect Node.js and deploy
5. Get your URL: `https://your-app.up.railway.app`

### Option C: Deploy to Heroku

1. Install [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)
2. Commands:
   ```bash
   cd server
   heroku create stealth-chat-server
   git push heroku main
   heroku open
   ```

---

## 🎨 Step 2: Configure the Client

After deploying the server, you need to tell the client where to find it.

1. **Open** `client/config.js`

2. **Replace the placeholder URL** with your deployed server URL:

   ```javascript
   // Change this line:
   window.SIGNALING_SERVER_URL = 'http://localhost:8080';
   
   // To your production server URL (use wss:// for https):
   window.SIGNALING_SERVER_URL = 'https://stealth-chat-server.onrender.com';
   ```

   > **Important:** 
   > - Use `wss://` for HTTPS servers (recommended)
   > - Use `ws://` only for HTTP (not recommended for production)

3. **Save the file**

---

## 🚀 Step 3: Deploy the Client

Now deploy the static client files to any static hosting service.

### Option A: Deploy to Netlify (Recommended)

#### Method 1: Drag & Drop (Easiest)

1. Go to [netlify.com](https://netlify.com) and sign in
2. Drag the **entire `client/` folder** onto the Netlify drop zone
3. Wait for deployment
4. You'll get a URL like: `https://random-name.netlify.app`

#### Method 2: GitHub Integration

1. Push your code to GitHub
2. In Netlify: **New site from Git**
3. Choose your repository
4. Configure:
   - **Base directory:** `client`
   - **Build command:** (leave empty)
   - **Publish directory:** `.` or `client`
5. Deploy!

### Option B: Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Navigate to client folder:
   ```bash
   cd client
   vercel
   ```
3. Follow prompts

### Option C: GitHub Pages

1. Go to your repo Settings → Pages
2. Set source to your branch
3. Set folder to `/client`
4. Save and wait for deployment

---

## ✅ Step 4: Test the Deployment

### Test 1: Server Health Check

Visit your server's health endpoint:
```
https://your-server.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T12:30:00.000Z",
  "activeRooms": 0,
  "totalConnections": 0
}
```

### Test 2: Client Connection

1. Open your client URL in a browser
2. Open **Browser Console** (F12 → Console tab)
3. Look for: `🔗 Connecting to signaling server: https://...`
4. Enter a room ID and click "ESTABLISH SECURE LINK"
5. Check console for "Connected to Signaling Server"

### Test 3: Cross-Network P2P Connection

1. **On your computer:**
   - Open your Netlify URL
   - Enter room ID: `test-room-123`
   - Click connect

2. **On your friend's computer (different network):**
   - Open the same Netlify URL
   - Enter the same room ID: `test-room-123`
   - Click connect

3. **Verify:**
   - Both should see "● PEER CONNECTED"
   - Send a message from one device
   - See it appear on the other device

---

## 🔧 Troubleshooting

### Issue: "WebSocket connection failed"

**Solution:**
- Verify `config.js` has the correct server URL
- Check if server is running: visit `/health` endpoint
- Ensure you're using `wss://` for HTTPS servers

### Issue: "Peer never connects"

**Possible causes:**
1. **Firewall/NAT issues** - WebRTC might be blocked
2. **Different room IDs** - Both users must enter the EXACT same room ID
3. **Server offline** - Check server health endpoint

**Solutions:**
- Try using a different network (mobile hotspot)
- Check browser console for errors
- Ensure both users entered the same room ID (case-sensitive!)

### Issue: "Mixed content" error

**Problem:** Client is HTTPS but server is HTTP

**Solution:** 
- Deploy server with HTTPS (Render/Railway provide this free)
- Use `wss://` in config.js

### Issue: Room is full

- The app only allows 2 peers per room (P2P limitation)
- Choose a different room ID

---

## 🔒 Security Best Practices

1. **Use HTTPS/WSS:** Always use secure connections in production
2. **Restrict CORS:** Set `ALLOWED_ORIGINS` environment variable on server:
   ```
   ALLOWED_ORIGINS=https://your-app.netlify.app
   ```
3. **Don't commit secrets:** Never commit API keys or passwords
4. **Update dependencies:** Regularly run `npm update` in the server folder

---

## 📊 Monitoring

### Check Active Rooms

Visit: `https://your-server.onrender.com/health`

This shows:
- Active rooms count
- Total connections
- Server uptime

### Check Specific Room

Visit: `https://your-server.onrender.com/api/room/YOUR_ROOM_ID`

Returns:
```json
{
  "roomId": "test-room",
  "exists": true,
  "peerCount": 2,
  "full": true
}
```

---

## 📱 Local Development

For testing locally before deployment:

1. **Run the server:**
   ```bash
   cd server
   npm install
   node server.js
   ```

2. **Configure client** in `config.js`:
   ```javascript
   window.SIGNALING_SERVER_URL = 'http://localhost:8080';
   ```

3. **Open client:**
   - Just open `client/index.html` in your browser
   - Or use a local server: `python -m http.server 3000` in client folder

---

## 🆘 Still Having Issues?

**Check browser console (F12)** for error messages. Common errors:

- `ERR_CONNECTION_REFUSED` → Server is down or URL is wrong
- `Mixed Content` → Using HTTP instead of HTTPS
- `CORS error` → Server CORS not configured correctly

**Server logs:** Check your Render/Railway dashboard for server logs

---

## 📚 Summary

**Quick checklist:**
- [x] Deploy server to Render/Railway/Heroku
- [x] Get server URL
- [x] Update `client/config.js` with server URL
- [x] Deploy client to Netlify/Vercel
- [x] Test with `/health` endpoint
- [x] Test P2P connection between two devices

**Your URLs should be:**
- Server: `https://stealth-chat-server.onrender.com`
- Client: `https://your-app.netlify.app`

Both you and your friend use the **client URL**, but it connects to the **server URL** behind the scenes!

🎉 **You're all set!** Share your client URL with friends and start chatting securely!
