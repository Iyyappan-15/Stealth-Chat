# Stealth Chat - Serverless Secured P2P Messaging

A secure peer-to-peer messaging application with end-to-end encryption, forward secrecy, and auto-destructing messages.

## Features

- **End-to-End Encryption**: ECDH key exchange + AES-256-GCM encryption
- **Forward Secrecy**: Per-message key ratcheting
- **Replay Protection**: Nonce tracking and message counters
- **Auto-Destruct**: Messages disappear after 10 seconds
- **Screenshot Detection**: Alerts on potential capture attempts
- **No Persistence**: Zero message storage on server or client
- **Serverless Design**: Server only handles peer discovery

## Architecture
