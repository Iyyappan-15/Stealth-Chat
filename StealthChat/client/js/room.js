/**
 * =============================================================================
 * STEALTH CHAT - ROOM CODE MODULE
 * =============================================================================
 * 
 * Handles room code generation, validation, and management.
 * 
 * Room codes are:
 * - 6 characters long
 * - Alphanumeric (A-Z, 0-9)
 * - Cryptographically random
 * - Case insensitive
 * 
 * =============================================================================
 */

'use strict';

const RoomModule = (function() {
    
    // =========================================================================
    // CONSTANTS
    // =========================================================================
    
    const ROOM_CODE_LENGTH = 6;
    const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
    
    // Characters that look similar and could cause confusion
    const AMBIGUOUS_CHARS = ['0', 'O', '1', 'I', 'L'];
    
    // =========================================================================
    // STATE
    // =========================================================================
    
    let currentRoomCode = null;
    
    // =========================================================================
    // ROOM CODE GENERATION
    // =========================================================================
    
    /**
     * Generate a new cryptographically random room code
     * 
     * @returns {string} 6-character room code
     */
    function generateRoomCode() {
        const bytes = Utils.getRandomBytes(ROOM_CODE_LENGTH);
        let code = '';
        
        for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
            // Use modulo to map random byte to character set
            // Note: Slight bias exists but acceptable for room codes
            const index = bytes[i] % ROOM_CODE_CHARS.length;
            code += ROOM_CODE_CHARS[index];
        }
        
        console.log('[ROOM] Generated room code:', code);
        return code;
    }
    
    /**
     * Generate room code avoiding ambiguous characters
     * Better for verbal communication
     * 
     * @returns {string} 6-character room code (unambiguous)
     */
    function generateUnambiguousRoomCode() {
        const unambiguousChars = ROOM_CODE_CHARS.split('')
            .filter(c => !AMBIGUOUS_CHARS.includes(c))
            .join('');
        
        const bytes = Utils.getRandomBytes(ROOM_CODE_LENGTH);
        let code = '';
        
        for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
            const index = bytes[i] % unambiguousChars.length;
            code += unambiguousChars[index];
        }
        
        return code;
    }
    
    // =========================================================================
    // VALIDATION
    // =========================================================================
    
    /**
     * Validate room code format
     * 
     * @param {string} code - Room code to validate
     * @returns {boolean} True if valid
     */
    function isValidRoomCode(code) {
        if (typeof code !== 'string') return false;
        return ROOM_CODE_PATTERN.test(code.toUpperCase());
    }
    
    /**
     * Normalize room code to uppercase
     * 
     * @param {string} code - Room code
     * @returns {string} Normalized room code
     */
    function normalizeRoomCode(code) {
        return code.toUpperCase().trim();
    }
    
    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    
    /**
     * Set the current room code
     * 
     * @param {string} code - Room code
     */
    function setCurrentRoom(code) {
        currentRoomCode = normalizeRoomCode(code);
    }
    
    /**
     * Get the current room code
     * 
     * @returns {string|null} Current room code or null
     */
    function getCurrentRoom() {
        return currentRoomCode;
    }
    
    /**
     * Clear the current room
     */
    function clearCurrentRoom() {
        currentRoomCode = null;
    }
    
    // =========================================================================
    // DISPLAY FORMATTING
    // =========================================================================
    
    /**
     * Format room code for display (with spacing)
     * Example: "ABC123" -> "ABC 123"
     * 
     * @param {string} code - Room code
     * @returns {string} Formatted room code
     */
    function formatForDisplay(code) {
        const normalized = normalizeRoomCode(code);
        // Split into two groups of 3
        return normalized.slice(0, 3) + ' ' + normalized.slice(3);
    }
    
    // =========================================================================
    // CLIPBOARD OPERATIONS
    // =========================================================================
    
    /**
     * Copy room code to clipboard
     * 
     * @param {string} code - Room code to copy
     * @returns {Promise<boolean>} True if successful
     */
    async function copyToClipboard(code) {
        try {
            await navigator.clipboard.writeText(normalizeRoomCode(code));
            console.log('[ROOM] Room code copied to clipboard');
            return true;
        } catch (error) {
            console.error('[ROOM] Failed to copy to clipboard:', error);
            return false;
        }
    }
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    return {
        generateRoomCode,
        generateUnambiguousRoomCode,
        isValidRoomCode,
        normalizeRoomCode,
        setCurrentRoom,
        getCurrentRoom,
        clearCurrentRoom,
        formatForDisplay,
        copyToClipboard
    };
    
})();