class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.sharedSecret = null;
        this.sessionKey = null; // AES-GCM key derived from shared secret
    }

    // 1. Generate ECDH Key Pair (P-256)
    async generateKeyPair() {
        this.keyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
        return this.keyPair;
    }

    // 2. Export Public Key to send to peer (JWK format)
    async exportPublicKey() {
        return await window.crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
    }

    // 3. Derive Shared Secret & Session Key from Peer's Public Key (P2P)
    async deriveSessionKey(peerPublicKeyJwk) {
        const peerPublicKey = await window.crypto.subtle.importKey(
            "jwk",
            peerPublicKeyJwk,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );

        this.sessionKey = await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: peerPublicKey },
            this.keyPair.privateKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );

        console.log("Session Key Derived Successfully!");
        return this.sessionKey;
    }

    // 4. Generate Group Session Key from Room ID (PBKDF2-derived, deterministic)
    // All group members with the same roomId derive the same AES-GCM key
    async generateGroupKey(roomId) {
        const encoder = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            encoder.encode(roomId),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        this.sessionKey = await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: encoder.encode("stealth-group-salt-v1"),
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );

        console.log("Group Session Key Derived Successfully!");
        return this.sessionKey;
    }

    // 5. Encrypt Message (AES-GCM)
    async encryptMessage(text) {
        if (!this.sessionKey) throw new Error("No secure session established");

        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.sessionKey,
            data
        );

        return JSON.stringify({
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        });
    }

    // 6. Decrypt Message (AES-GCM)
    async decryptMessage(encryptedJson) {
        if (!this.sessionKey) throw new Error("No secure session established");

        const { iv, data } = JSON.parse(encryptedJson);
        const ivArray = new Uint8Array(iv);
        const dataArray = new Uint8Array(data);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivArray },
            this.sessionKey,
            dataArray
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }

    // 7. Generate tamper-evident 4-emoji session seal
    // Derived from the raw bytes of the session key — same key = same seal on both ends
    async generateSessionSeal() {
        return this.generateSessionSealWithSalt('');
    }

    // 7b. Generate session seal mixed with an extra salt string.
    // All clients using the same sessionKey + same salt will get the same seal.
    // Pass a different salt (e.g. join-counter) to get a new seal on membership change.
    async generateSessionSealWithSalt(salt) {
        if (!this.sessionKey) return "????";

        // Export the raw key bytes
        const rawKey = await window.crypto.subtle.exportKey("raw", this.sessionKey);
        const keyBytes = new Uint8Array(rawKey);

        // Mix key bytes with the salt so different salts produce different seals
        const saltBytes = new TextEncoder().encode(String(salt));
        const combined = new Uint8Array(keyBytes.length + saltBytes.length);
        combined.set(keyBytes, 0);
        combined.set(saltBytes, keyBytes.length);

        // SHA-256 of combined buffer
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", combined);
        const hash = new Uint8Array(hashBuffer);

        // Curated 64-emoji palette (visually distinct, no ambiguous ones)
        const EMOJI_PALETTE = [
            "🐋","🦁","🐬","🦊","🐧","🦋","🐙","🦄",
            "🌙","⭐","☀️","🌈","🌊","🔥","❄️","⚡",
            "🎯","🎪","🎭","🎨","🎸","🎺","🎻","🥁",
            "🍎","🍋","🍇","🍓","🥝","🍑","🍒","🫐",
            "🏔️","🌋","🗻","🏝️","🌵","🌴","🍄","🌺",
            "💎","🔮","🪄","🔭","🧬","⚗️","🧲","🔑",
            "🚀","🛸","⛵","🚁","🛡️","⚔️","🗡️","🏹",
            "🦅","🦉","🦚","🦜","🐲","🦈","🐺","🦝"
        ];

        // Pick 4 emojis from different parts of the hash
        const seal = [
            EMOJI_PALETTE[hash[0] % 64],
            EMOJI_PALETTE[hash[8] % 64],
            EMOJI_PALETTE[hash[16] % 64],
            EMOJI_PALETTE[hash[24] % 64]
        ];

        return seal.join("");
    }
}

// Expose globally
window.CryptoManager = CryptoManager;
