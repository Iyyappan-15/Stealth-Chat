/**
 * =============================================================================
 * STEALTH CHAT - UTILITY FUNCTIONS
 * =============================================================================
 * 
 * General-purpose utility functions used throughout the application.
 * Provides encoding, DOM manipulation, and helper functions.
 * 
 * =============================================================================
 */

'use strict';

const Utils = (function() {
    
    // =========================================================================
    // ENCODING UTILITIES
    // =========================================================================
    
    /**
     * Convert ArrayBuffer to Base64 string
     * Used for transmitting binary data over JSON
     * 
     * @param {ArrayBuffer} buffer - Binary data to encode
     * @returns {string} Base64 encoded string
     */
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    /**
     * Convert Base64 string to ArrayBuffer
     * Used for receiving binary data from JSON
     * 
     * @param {string} base64 - Base64 encoded string
     * @returns {ArrayBuffer} Decoded binary data
     */
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    /**
     * Convert ArrayBuffer to hexadecimal string
     * Used for displaying fingerprints
     * 
     * @param {ArrayBuffer} buffer - Binary data to encode
     * @returns {string} Hex string (lowercase)
     */
    function arrayBufferToHex(buffer) {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    /**
     * Format hex string with separators for readability
     * Example: "abcd1234" -> "AB:CD:12:34"
     * 
     * @param {string} hex - Hex string
     * @param {number} groupSize - Characters per group
     * @returns {string} Formatted hex string
     */
    function formatHexFingerprint(hex, groupSize = 4) {
        const upper = hex.toUpperCase();
        const groups = [];
        for (let i = 0; i < upper.length; i += groupSize) {
            groups.push(upper.slice(i, i + groupSize));
        }
        return groups.join(':');
    }
    
    /**
     * Encode string to UTF-8 ArrayBuffer
     * 
     * @param {string} str - String to encode
     * @returns {ArrayBuffer} UTF-8 encoded bytes
     */
    function stringToArrayBuffer(str) {
        return new TextEncoder().encode(str).buffer;
    }
    
    /**
     * Decode UTF-8 ArrayBuffer to string
     * 
     * @param {ArrayBuffer} buffer - UTF-8 encoded bytes
     * @returns {string} Decoded string
     */
    function arrayBufferToString(buffer) {
        return new TextDecoder().decode(buffer);
    }
    
    // =========================================================================
    // DOM UTILITIES
    // =========================================================================
    
    /**
     * Shorthand for document.getElementById
     * 
     * @param {string} id - Element ID
     * @returns {HTMLElement|null} Element or null
     */
    function $(id) {
        return document.getElementById(id);
    }
    
    /**
     * Shorthand for document.querySelector
     * 
     * @param {string} selector - CSS selector
     * @returns {Element|null} First matching element or null
     */
    function $$(selector) {
        return document.querySelector(selector);
    }
    
    /**
     * Create HTML element with attributes and content
     * 
     * @param {string} tag - HTML tag name
     * @param {Object} attrs - Attributes to set
     * @param {string|HTMLElement|Array} content - Inner content
     * @returns {HTMLElement} Created element
     */
    function createElement(tag, attrs = {}, content = null) {
        const el = document.createElement(tag);
        
        // Set attributes
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'className') {
                el.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else if (key.startsWith('data')) {
                el.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
            } else {
                el[key] = value;
            }
        }
        
        // Set content
        if (content !== null) {
            if (typeof content === 'string') {
                el.textContent = content;
            } else if (content instanceof HTMLElement) {
                el.appendChild(content);
            } else if (Array.isArray(content)) {
                content.forEach(child => {
                    if (typeof child === 'string') {
                        el.appendChild(document.createTextNode(child));
                    } else if (child instanceof HTMLElement) {
                        el.appendChild(child);
                    }
                });
            }
        }
        
        return el;
    }
    
    /**
     * Show toast notification
     * 
     * @param {string} message - Message to display
     * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Display duration in ms
     */
    function showToast(message, type = 'info', duration = 3000) {
        const container = $('toast-container');
        if (!container) return;
        
        const toast = createElement('div', {
            className: `toast ${type}`
        }, message);
        
        container.appendChild(toast);
        
        // Auto-remove
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    /**
     * Switch visible screen
     * 
     * @param {string} screenId - ID of screen to show
     */
    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        const target = $(screenId);
        if (target) {
            target.classList.add('active');
        }
    }
    
    /**
     * Update connection step indicator
     * 
     * @param {string} stepId - Step element ID
     * @param {string} status - 'pending', 'active', 'complete', 'error'
     */
    function updateStep(stepId, status) {
        const step = $(stepId);
        if (!step) return;
        
        step.className = 'step';
        const icon = step.querySelector('.step-icon');
        
        switch (status) {
            case 'pending':
                if (icon) icon.textContent = '⏳';
                break;
            case 'active':
                step.classList.add('active');
                if (icon) icon.textContent = '⏳';
                break;
            case 'complete':
                step.classList.add('complete');
                if (icon) icon.textContent = '✓';
                break;
            case 'error':
                step.classList.add('error');
                if (icon) icon.textContent = '✗';
                break;
        }
    }
    
    // =========================================================================
    // TIME & DATE UTILITIES
    // =========================================================================
    
    /**
     * Format timestamp for message display
     * 
     * @param {Date|number} date - Date object or timestamp
     * @returns {string} Formatted time string
     */
    function formatTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    /**
     * Generate timestamp for message ordering
     * Uses high-resolution time if available
     * 
     * @returns {number} Timestamp in milliseconds
     */
    function getTimestamp() {
        return Date.now();
    }
    
    // =========================================================================
    // SECURITY UTILITIES
    // =========================================================================
    
    /**
     * Generate cryptographically secure random bytes
     * 
     * @param {number} length - Number of bytes
     * @returns {Uint8Array} Random bytes
     */
    function getRandomBytes(length) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    }
    
    /**
     * Generate random alphanumeric string
     * 
     * @param {number} length - String length
     * @returns {string} Random string
     */
    function generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const bytes = getRandomBytes(length);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[bytes[i] % chars.length];
        }
        return result;
    }
    
    /**
     * Sanitize string for safe display (prevent XSS)
     * 
     * @param {string} str - String to sanitize
     * @returns {string} Sanitized string
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Constant-time string comparison
     * Prevents timing attacks on secret comparison
     * 
     * @param {string} a - First string
     * @param {string} b - Second string
     * @returns {boolean} True if equal
     */
    function secureCompare(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }
    
    // =========================================================================
    // DEBOUNCE & THROTTLE
    // =========================================================================
    
    /**
     * Debounce function execution
     * 
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {Function} Debounced function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    /**
     * Throttle function execution
     * 
     * @param {Function} func - Function to throttle
     * @param {number} limit - Minimum time between calls in ms
     * @returns {Function} Throttled function
     */
    function throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    return {
        // Encoding
        arrayBufferToBase64,
        base64ToArrayBuffer,
        arrayBufferToHex,
        formatHexFingerprint,
        stringToArrayBuffer,
        arrayBufferToString,
        
        // DOM
        $,
        $$,
        createElement,
        showToast,
        showScreen,
        updateStep,
        
        // Time
        formatTime,
        getTimestamp,
        
        // Security
        getRandomBytes,
        generateRandomString,
        escapeHtml,
        secureCompare,
        
        // Flow control
        debounce,
        throttle
    };
    
})();