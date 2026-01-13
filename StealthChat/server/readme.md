# Stealth Chat - Signaling Server

## Overview

This is a minimal WebSocket signaling server that facilitates WebRTC peer discovery.
**The server never sees or stores any message content.**

## Security Model

1. **Signaling Only**: Server handles ICE candidate exchange and SDP offers/answers
2. **No Persistence**: All data exists only in memory
3. **No Message Access**: E2E encryption happens client-side
4. **Ephemeral Rooms**: Automatically destroyed when empty

## Running the Server

```bash
# Install (no dependencies!)
npm install

# Start server
npm start

# Development with auto-reload (Node 18+)
npm run dev