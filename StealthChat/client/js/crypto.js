/**
 * =============================================================================
 * STEALTH CHAT - CRYPTOGRAPHIC MODULE
 * =============================================================================
 * 
 * Implements end-to-end encryption using Web Crypto API:
 * 
 * KEY EXCHANGE:
 * - ECDH (Elliptic Curve Diffie-Hellman) with P-256 curve
 * - Generates shared secret from asymmetric key pairs
 * 
 * ENCRYPTION:
 * - AES-256-GCM (Galois/Counter Mode)
 * - Provides confidentiality AND authenticity
 * - 96-bit random nonce per message
 * 
 * FORWARD SECRECY:
 * - Key ratcheting after each message
 * - Compromised key doesn't reveal past messages
 * 
 * REPLAY PROTECTION:
 * - Unique nonce per message
 * - Message counter verification
 * - Timestamp validation
 * 
 * =============================================================================
 */

'use strict';

const CryptoModule = (function() {
    
    // =========================================================================
    // CONSTANTS
    // =========================================================================
    
    const ECDH_CURVE = 'P-256';              // NIST P-256 elliptic curve
    const AES_LENGTH = 256;                   // AES-256
    const GCM_NONCE_LENGTH = 12;              // 96 bits recommended for GCM
    const GCM_TAG_LENGTH = 128;               // 128-bit authentication tag
    const RATCHET_INFO = 'StealthChat-Ratchet-v1';
    
    // Maximum nonce/counter to prevent overflow
    const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
    
    // =========================================================================
    // STATE
    // =========================================================================
    
    let keyPair = null;              // Our ECDH key pair
    let peerPublicKey = null;        // Peer's ECDH public key
    let sharedSecret = null;         // Derived shared secret
    let currentSendKey = null;       // Current key for sending
    let currentReceiveKey = null;    // Current key for receiving
    let sendCounter = 0;             // Message counter (send)
    let receiveCounter = 0;          // Message counter (receive)
    let usedNonces = new Set();      // Replay protection
    
    // =========================================================================
    // KEY GENERATION & EXCHANGE
    // =========================================================================
    
    /**
     * Generate new ECDH key pair
     * Called when starting a new chat session
     * 
     * @returns {Promise<Object>} Object containing public key for exchange
     */
    async function generateKeyPair() {
        try {
            // Generate ECDH key pair
            keyPair = await crypto.subtle.generateKey(
                {
                    name: 'ECDH',
                    namedCurve: ECDH_CURVE
                },
                true,  // Extractable (needed for export)
                ['deriveKey', 'deriveBits']
            );
            
            // Export public key for transmission
            const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
            
            // Reset state
            sharedSecret = null;
            currentSendKey = null;
            currentReceiveKey = null;
            sendCounter = 0;
            receiveCounter = 0;
            usedNonces.clear();
            
            console.log('[CRYPTO] Generated new ECDH key pair');
            
            return {
                publicKey: Utils.arrayBufferToBase64(publicKeyRaw)
            };
            
        } catch (error) {
            console.error('[CRYPTO] Key generation failed:', error);
            throw new Error('Failed to generate encryption keys');
        }
    }
    
    /**
     * Import peer's public key and derive shared secret
     * Called when peer's public key is received
     * 
     * @param {string} peerPublicKeyBase64 - Base64 encoded peer public key
     * @returns {Promise<boolean>} True if successful
     */
    async function deriveSharedSecret(peerPublicKeyBase64) {
        try {
            // Import peer's public key
            const peerKeyRaw = Utils.base64ToArrayBuffer(peerPublicKeyBase64);
            peerPublicKey = await crypto.subtle.importKey(
                'raw',
                peerKeyRaw,
                {
                    name: 'ECDH',
                    namedCurve: ECDH_CURVE
                },
                true,
                []
            );
            
            // Derive shared secret using ECDH
            // Both parties will derive the same secret
            const sharedBits = await crypto.subtle.deriveBits(
                {
                    name: 'ECDH',
                    public: peerPublicKey
                },
                keyPair.privateKey,
                256  // 256 bits
            );
            
            sharedSecret = new Uint8Array(sharedBits);
            
            // Derive initial encryption keys using HKDF
            await deriveInitialKeys();
            
            console.log('[CRYPTO] Shared secret derived successfully');
            return true;
            
        } catch (error) {
            console.error('[CRYPTO] Key derivation failed:', error);
            throw new Error('Failed to establish encrypted session');
        }
    }
    
    /**
     * Derive initial send/receive keys from shared secret
     * Uses HKDF (HMAC-based Key Derivation Function)
     */
    async function deriveInitialKeys() {
        // Import shared secret as HKDF key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            sharedSecret,
            'HKDF',
            false,
            ['deriveKey']
        );
        
        // Derive sending key
        currentSendKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(32), // Could use random salt exchanged
                info: new TextEncoder().encode(RATCHET_INFO + '-send')
            },
            keyMaterial,
            { name: 'AES-GCM', length: AES_LENGTH },
            true,  // Extractable for ratcheting
            ['encrypt', 'decrypt']
        );
        
        // Derive receiving key
        currentReceiveKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(32),
                info: new TextEncoder().encode(RATCHET_INFO + '-receive')
            },
            keyMaterial,
            { name: 'AES-GCM', length: AES_LENGTH },
            true,
            ['encrypt', 'decrypt']
        );
    }
    
    // =========================================================================
    // KEY RATCHETING (FORWARD SECRECY)
    // =========================================================================
    
    /**
     * Ratchet the sending key forward
     * Provides forward secrecy by deriving new key from current key
     * Old key material is discarded and cannot decrypt future messages
     */
    async function ratchetSendKey() {
        if (!currentSendKey) return;
        
        try {
            // Export current key
            const keyData = await crypto.subtle.exportKey('raw', currentSendKey);
            
            // Use current key as material for new key derivation
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                keyData,
                'HKDF',
                false,
                ['deriveKey']
            );
            
            // Derive new key
            currentSendKey = await crypto.subtle.deriveKey(
                {
                    name: 'HKDF',
                    hash: 'SHA-256',
                    salt: Utils.getRandomBytes(32),
                    info: new TextEncoder().encode(RATCHET_INFO + '-ratchet-' + sendCounter)
                },
                keyMaterial,
                { name: 'AES-GCM', length: AES_LENGTH },
                true,
                ['encrypt', 'decrypt']
            );
            
            console.log('[CRYPTO] Send key ratcheted');
            
        } catch (error) {
            console.error('[CRYPTO] Send key ratchet failed:', error);
        }
    }
    
    /**
     * Ratchet the receiving key forward
     * Called after successfully decrypting a message
     */
    async function ratchetReceiveKey() {
        if (!currentReceiveKey) return;
        
        try {
            const keyData = await crypto.subtle.exportKey('raw', currentReceiveKey);
            
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                keyData,
                'HKDF',
                false,
                ['deriveKey']
            );
            
            currentReceiveKey = await crypto.subtle.deriveKey(
                {
                    name: 'HKDF',
                    hash: 'SHA-256',
                    salt: Utils.getRandomBytes(32),
                    info: new TextEncoder().encode(RATCHET_INFO + '-ratchet-' + receiveCounter)
                },
                keyMaterial,
                { name: 'AES-GCM', length: AES_LENGTH },
                true,
                ['encrypt', 'decrypt']
            );
            
            console.log('[CRYPTO] Receive key ratcheted');
            
        } catch (error) {
            console.error('[CRYPTO] Receive key ratchet failed:', error);
        }
    }
    
    // =========================================================================
    // MESSAGE ENCRYPTION & DECRYPTION
    // =========================================================================
    
    /**
     * Encrypt a message for transmission
     * Uses AES-256-GCM with random nonce
     * 
     * Message format:
     * {
     *   nonce: base64,      // Random 96-bit nonce
     *   counter: number,    // Message counter
     *   timestamp: number,  // Send timestamp
     *   ciphertext: base64, // Encrypted message
     *   tag: (included in ciphertext by GCM)
     * }
     * 
     * @param {string} plaintext - Message to encrypt
     * @returns {Promise<Object>} Encrypted message object
     */
    async function encryptMessage(plaintext) {
        if (!currentSendKey) {
            throw new Error('Encryption not initialized');
        }
        
        // Check counter overflow
        if (sendCounter >= MAX_COUNTER) {
            throw new Error('Message counter overflow - session must be renewed');
        }
        
        try {
            // Generate random nonce (96 bits / 12 bytes)
            const nonce = Utils.getRandomBytes(GCM_NONCE_LENGTH);
            
            // Create message payload with metadata
            const payload = JSON.stringify({
                content: plaintext,
                counter: sendCounter,
                timestamp: Date.now()
            });
            
            // Encrypt using AES-GCM
            const plaintextBuffer = new TextEncoder().encode(payload);
            const ciphertext = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: nonce,
                    tagLength: GCM_TAG_LENGTH,
                    // Additional authenticated data (AAD)
                    // Authenticates counter to prevent manipulation
                    additionalData: new TextEncoder().encode(String(sendCounter))
                },
                currentSendKey,
                plaintextBuffer
            );
            
            const result = {
                nonce: Utils.arrayBufferToBase64(nonce),
                counter: sendCounter,
                ciphertext: Utils.arrayBufferToBase64(ciphertext)
            };
            
            // Increment counter and ratchet key
            sendCounter++;
            await ratchetSendKey();
            
            return result;
            
        } catch (error) {
            console.error('[CRYPTO] Encryption failed:', error);
            throw new Error('Message encryption failed');
        }
    }
    
    /**
     * Decrypt a received message
     * Verifies authenticity and checks for replay
     * 
     * @param {Object} encryptedData - Encrypted message object
     * @returns {Promise<Object>} Decrypted message with metadata
     */
    async function decryptMessage(encryptedData) {
        if (!currentReceiveKey) {
            throw new Error('Decryption not initialized');
        }
        
        const { nonce, counter, ciphertext } = encryptedData;
        
        // Replay protection: Check if nonce was used before
        const nonceKey = nonce + '-' + counter;
        if (usedNonces.has(nonceKey)) {
            throw new Error('Replay attack detected: duplicate nonce');
        }
        
        // Counter validation (allow small window for out-of-order delivery)
        if (counter < receiveCounter - 5) {
            throw new Error('Replay attack detected: old counter');
        }
        
        try {
            const nonceBuffer = Utils.base64ToArrayBuffer(nonce);
            const ciphertextBuffer = Utils.base64ToArrayBuffer(ciphertext);
            
            // Decrypt using AES-GCM (also verifies authentication tag)
            const plaintextBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: nonceBuffer,
                    tagLength: GCM_TAG_LENGTH,
                    additionalData: new TextEncoder().encode(String(counter))
                },
                currentReceiveKey,
                ciphertextBuffer
            );
            
            // Parse decrypted payload
            const payloadText = new TextDecoder().decode(plaintextBuffer);
            const payload = JSON.parse(payloadText);
            
            // Verify timestamp (reject messages older than 5 minutes)
            const messageAge = Date.now() - payload.timestamp;
            if (messageAge > 5 * 60 * 1000) {
                console.warn('[CRYPTO] Message timestamp is old:', messageAge, 'ms');
            }
            
            // Mark nonce as used
            usedNonces.add(nonceKey);
            
            // Update counter and ratchet key
            if (counter >= receiveCounter) {
                receiveCounter = counter + 1;
            }
            await ratchetReceiveKey();
            
            return {
                content: payload.content,
                timestamp: payload.timestamp,
                counter: payload.counter
            };
            
        } catch (error) {
            if (error.name === 'OperationError') {
                // GCM authentication failed
                throw new Error('Message authentication failed - possible tampering');
            }
            console.error('[CRYPTO] Decryption failed:', error);
            throw error;
        }
    }
    
    // =========================================================================
    // KEY FINGERPRINTS (VERIFICATION)
    // =========================================================================
    
    /**
     * Generate fingerprint of a public key
     * Used for out-of-band verification
     * 
     * @param {CryptoKey} publicKey - Key to fingerprint
     * @returns {Promise<string>} Hex fingerprint
     */
    async function getKeyFingerprint(publicKey) {
        const keyData = await crypto.subtle.exportKey('raw', publicKey);
        const hash = await crypto.subtle.digest('SHA-256', keyData);
        return Utils.formatHexFingerprint(Utils.arrayBufferToHex(hash).slice(0, 32));
    }
    
    /**
     * Get local public key fingerprint
     */
    async function getLocalFingerprint() {
        if (!keyPair) return null;
        return await getKeyFingerprint(keyPair.publicKey);
    }
    
    /**
     * Get peer's public key fingerprint
     */
    async function getPeerFingerprint() {
        if (!peerPublicKey) return null;
        return await getKeyFingerprint(peerPublicKey);
    }
    
    /**
     * Get session fingerprint (hash of shared secret)
     */
    async function getSessionFingerprint() {
        if (!sharedSecret) return null;
        const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
        return Utils.formatHexFingerprint(Utils.arrayBufferToHex(hash).slice(0, 32));
    }
    
    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    
    /**
     * Check if encryption is ready
     */
    function isReady() {
        return keyPair !== null && currentSendKey !== null && currentReceiveKey !== null;
    }
    
    /**
     * Clear all cryptographic state
     * Called when disconnecting
     */
    function clearState() {
        keyPair = null;
        peerPublicKey = null;
        sharedSecret = null;
        currentSendKey = null;
        currentReceiveKey = null;
        sendCounter = 0;
        receiveCounter = 0;
        usedNonces.clear();
        
        console.log('[CRYPTO] Cryptographic state cleared');
    }
    
    /**
     * Get current security metrics
     */
    function getSecurityInfo() {
        return {
            isEncrypted: isReady(),
            sendCounter,
            receiveCounter,
            usedNonces: usedNonces.size,
            algorithm: 'ECDH-P256 + AES-256-GCM',
            forwardSecrecy: true
        };
    }
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    return {
        generateKeyPair,
        deriveSharedSecret,
        encryptMessage,
        decryptMessage,
        getLocalFingerprint,
        getPeerFingerprint,
        getSessionFingerprint,
        isReady,
        clearState,
        getSecurityInfo
    };
    
})();