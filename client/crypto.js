class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.sharedSecret = null;
        this.sessionKey = null; // AES-GCM key derived from shared secret
    }

    // 1. Generate ECDH Key Pair (P-256)
    async generateKeyPair() {
        this.keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256"
            },
            true,
            ["deriveKey"]
        );
        return this.keyPair;
    }

    // 2. Export Public Key to send to peer (JWK format)
    async exportPublicKey() {
        return await window.crypto.subtle.exportKey(
            "jwk",
            this.keyPair.publicKey
        );
    }

    // 3. Derive Shared Secret & Session Key from Peer's Public Key
    async deriveSessionKey(peerPublicKeyJwk) {
        // Import peer's public key
        const peerPublicKey = await window.crypto.subtle.importKey(
            "jwk",
            peerPublicKeyJwk,
            {
                name: "ECDH",
                namedCurve: "P-256"
            },
            true,
            []
        );

        // Derive AES-GCM key
        this.sessionKey = await window.crypto.subtle.deriveKey(
            {
                name: "ECDH",
                public: peerPublicKey
            },
            this.keyPair.privateKey,
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );

        console.log("Session Key Derived Successfully!");
        return this.sessionKey;
    }

    // 4. Encrypt Message (AES-GCM)
    async encryptMessage(text) {
        if (!this.sessionKey) throw new Error("No secure session established");

        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

        const encrypted = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            this.sessionKey,
            data
        );

        // Return IV + Ciphertext as JSON string
        return JSON.stringify({
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        });
    }

    // 5. Decrypt Message (AES-GCM)
    async decryptMessage(encryptedJson) {
        if (!this.sessionKey) throw new Error("No secure session established");

        const { iv, data } = JSON.parse(encryptedJson);
        const ivArray = new Uint8Array(iv);
        const dataArray = new Uint8Array(data);

        const decrypted = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: ivArray
            },
            this.sessionKey,
            dataArray
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
}

// Expose globally
window.CryptoManager = CryptoManager;
