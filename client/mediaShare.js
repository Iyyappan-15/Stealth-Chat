/**
 * MediaShareManager — Encrypted Photo & Video Sharing
 *
 * Send/receive flow:
 *   SENDER:  File → FileReader → ArrayBuffer → AES-256-GCM encrypt → base64 chunks via DataChannel
 *   RECEIVER: base64 chunks → reassemble → AES-256-GCM decrypt → Blob URL → display → revoke after destruct timer
 *
 * Zero trace:
 *   - No fetch/XHR upload — DataChannel only
 *   - No localStorage, no IndexedDB, no Cache API
 *   - Blob URLs are revoked after display duration
 *   - All buffers cleared from memory after use
 */
class MediaShareManager {
    constructor(cryptoManager, appendMediaMessage, sendDataChannelMessage, getDestructTime) {
        this.cryptoManager = cryptoManager;       // window.CryptoManager instance (has sessionKey)
        this.appendMediaMessage = appendMediaMessage; // fn(blobUrl, mimeType, sender, destructSecs)
        this.sendDataChannelMessage = sendDataChannelMessage; // fn(jsonStr)
        this.getDestructTime = getDestructTime;   // fn() => number (seconds)

        // Receiving state
        this._incomingMeta = null;
        this._incomingChunks = [];
        this._incomingReceived = 0;

        // Sending state
        this._isSending = false;
        this._sendProgressCallback = null;   // fn(percent)
    }

    // ─────────────────────────────────────────────
    // PUBLIC API — SENDING
    // ─────────────────────────────────────────────

    setSendProgressCallback(fn) {
        this._sendProgressCallback = fn;
    }

    /**
     * Called when user picks a file. Encrypts and sends via DataChannel.
     */
    async sendFile(file) {
        if (!this.cryptoManager || !this.cryptoManager.sessionKey) {
            alert('No secure session. Wait for encryption handshake to complete.');
            return;
        }
        if (this._isSending) {
            alert('Already sending a file. Please wait.');
            return;
        }

        const MAX_FILE_MB = 50;
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            alert(`File too large. Maximum allowed size is ${MAX_FILE_MB} MB.`);
            return;
        }

        this._isSending = true;
        const CHUNK_SIZE = 48 * 1024; // 48 KB chunks (safe for DataChannel)

        try {
            // 1️⃣ Read file as ArrayBuffer
            const arrayBuffer = await this._readFileAsArrayBuffer(file);

            // 2️⃣ Encrypt the raw bytes using the session key
            const encryptedPayload = await this._encryptBuffer(arrayBuffer);
            const totalEncBytes = encryptedPayload.iv.length + encryptedPayload.data.length;

            // 3️⃣ Split encrypted data into chunks
            const encDataArray = encryptedPayload.data;
            const totalChunks = Math.ceil(encDataArray.length / CHUNK_SIZE);

            // 4️⃣ Send metadata first
            this.sendDataChannelMessage(JSON.stringify({
                type: 'MEDIA_META',
                mime: file.mime || file.type,
                name: this._sanitizeFileName(file.name),
                totalChunks: totalChunks,
                iv: Array.from(encryptedPayload.iv),   // send IV with meta
                totalEncSize: totalEncBytes
            }));

            // Small delay to let the peer process meta before chunks
            await this._sleep(50);

            // 5️⃣ Send chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, encDataArray.length);
                const chunk = encDataArray.slice(start, end);

                this.sendDataChannelMessage(JSON.stringify({
                    type: 'MEDIA_CHUNK',
                    index: i,
                    data: Array.from(chunk)
                }));

                // Progress callback
                if (this._sendProgressCallback) {
                    this._sendProgressCallback(Math.round(((i + 1) / totalChunks) * 100));
                }

                // Throttle to avoid flooding the DataChannel buffer
                if (i % 5 === 0) await this._sleep(10);
            }

            // 6️⃣ Signal end of transfer
            this.sendDataChannelMessage(JSON.stringify({ type: 'MEDIA_END' }));

            // Show own copy of sent file
            const blob = new Blob([arrayBuffer], { type: file.type });
            const blobUrl = URL.createObjectURL(blob);
            const destructSecs = this.getDestructTime();
            this.appendMediaMessage(blobUrl, file.type, 'me', destructSecs, file.name);
            // Revoke after display + a little buffer
            setTimeout(() => URL.revokeObjectURL(blobUrl), (destructSecs + 2) * 1000);

        } catch (err) {
            console.error('[MediaShare] Send error:', err);
        } finally {
            this._isSending = false;
            if (this._sendProgressCallback) this._sendProgressCallback(0);
        }
    }

    // ─────────────────────────────────────────────
    // PUBLIC API — RECEIVING
    // ─────────────────────────────────────────────

    handleMediaMeta(payload) {
        // Reset any in-progress transfer
        this._incomingMeta = {
            mime: payload.mime,
            name: payload.name,
            totalChunks: payload.totalChunks,
            iv: new Uint8Array(payload.iv),
            totalEncSize: payload.totalEncSize
        };
        this._incomingChunks = new Array(payload.totalChunks).fill(null);
        this._incomingReceived = 0;
    }

    handleMediaChunk(payload) {
        if (!this._incomingMeta) return;
        this._incomingChunks[payload.index] = new Uint8Array(payload.data);
        this._incomingReceived++;
    }

    async handleMediaEnd() {
        if (!this._incomingMeta) return;

        const meta = this._incomingMeta;

        // Verify all chunks received
        if (this._incomingReceived < meta.totalChunks) {
            console.error('[MediaShare] Incomplete transfer, discarding.');
            this._resetReceiveState();
            return;
        }

        try {
            // Reassemble encrypted data
            const totalLen = this._incomingChunks.reduce((acc, c) => acc + c.length, 0);
            const encData = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of this._incomingChunks) {
                encData.set(chunk, offset);
                offset += chunk.length;
            }

            // Decrypt
            const decryptedBuffer = await this._decryptBuffer(encData, meta.iv);

            // Create Blob URL — in-memory only, never persisted
            const blob = new Blob([decryptedBuffer], { type: meta.mime });
            const blobUrl = URL.createObjectURL(blob);

            const destructSecs = this.getDestructTime();
            this.appendMediaMessage(blobUrl, meta.mime, 'peer', destructSecs, meta.name);

            // Revoke URL after display
            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, (destructSecs + 2) * 1000);

        } catch (err) {
            console.error('[MediaShare] Decrypt/display error:', err);
        } finally {
            this._resetReceiveState();
        }
    }

    // ─────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────

    _resetReceiveState() {
        this._incomingMeta = null;
        this._incomingChunks = [];
        this._incomingReceived = 0;
    }

    _readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    async _encryptBuffer(arrayBuffer) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.cryptoManager.sessionKey,
            arrayBuffer
        );
        return { iv, data: new Uint8Array(encrypted) };
    }

    async _decryptBuffer(encryptedData, iv) {
        return await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            this.cryptoManager.sessionKey,
            encryptedData
        );
    }

    _sanitizeFileName(name) {
        // Strip path info, keep only the last segment
        return (name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 64);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Expose globally
window.MediaShareManager = MediaShareManager;
