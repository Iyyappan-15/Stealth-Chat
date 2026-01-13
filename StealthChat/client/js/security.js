/**
 * =============================================================================
 * STEALTH CHAT - SECURITY MODULE
 * =============================================================================
 * 
 * Implements client-side security hardening:
 * 
 * 1. Screenshot Detection
 *    - PrintScreen key detection
 *    - Visibility change monitoring
 *    - Screen recording API detection
 * 
 * 2. DevTools Detection
 *    - Window size monitoring
 *    - Console timing analysis
 * 
 * 3. UI Hardening
 *    - Disable right-click context menu
 *    - Disable text selection on messages
 *    - Disable drag operations
 *    - Clear clipboard on sensitive actions
 * 
 * 4. Memory Protection
 *    - Clear sensitive data when tab loses focus
 *    - Auto-lock on inactivity
 * 
 * IMPORTANT: These are deterrents, not foolproof protections.
 * A determined attacker with physical access can bypass these.
 * 
 * =============================================================================
 */

'use strict';

const SecurityModule = (function() {
    
    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    
    const CONFIG = {
        // Time to show security overlay after detection (ms)
        OVERLAY_DURATION: 3000,
        
        // Inactivity timeout before auto-lock (ms)
        INACTIVITY_TIMEOUT: 5 * 60 * 1000, // 5 minutes
        
        // DevTools detection threshold (px)
        DEVTOOLS_THRESHOLD: 160,
        
        // Enable/disable specific protections
        PROTECTIONS: {
            screenshot: false,
            devtools: false,
            contextMenu: false,
            selection: false,
            dragDrop: false,
            clipboard: false,
            visibility: false
        }
    };
    
    // =========================================================================
    // STATE
    // =========================================================================
    
    let isInitialized = false;
    let lastActivityTime = Date.now();
    let inactivityTimer = null;
    let onSecurityEvent = null;
    let overlayTimeout = null;
    
    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    
    /**
     * Initialize security module
     * 
     * @param {Function} callback - Called on security events
     */
    function initialize(callback) {
        if (isInitialized) return;
        
        onSecurityEvent = callback;
        
        // Set up all protections
        setupScreenshotDetection();
        setupDevToolsDetection();
        setupUIHardening();
        setupVisibilityDetection();
        setupInactivityMonitor();
        
        isInitialized = true;
        console.log('[SECURITY] Security module initialized');
    }
    
    // =========================================================================
    // SCREENSHOT DETECTION
    // =========================================================================
    
    /**
     * Set up screenshot detection mechanisms
     * Note: Cannot prevent all screenshot methods, but provides deterrent
     */
    function setupScreenshotDetection() {
        if (!CONFIG.PROTECTIONS.screenshot) return;
        
        // Detect PrintScreen key
        document.addEventListener('keydown', (e) => {
            // PrintScreen key
            if (e.key === 'PrintScreen') {
                triggerSecurityAlert('Screenshot attempt detected (PrintScreen)');
                e.preventDefault();
            }
            
            // Windows Snipping Tool shortcuts
            if (e.shiftKey && e.key === 'S' && (e.metaKey || e.ctrlKey)) {
                triggerSecurityAlert('Screenshot attempt detected (Snipping Tool)');
            }
            
            // macOS screenshot shortcuts
            if (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) {
                triggerSecurityAlert('Screenshot attempt detected (macOS)');
            }
        }, true);
        
        // Detect screen capture API
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getDisplayMedia = async function(...args) {
                triggerSecurityAlert('Screen capture API accessed');
                // Still allow it to proceed (user might have legitimate use)
                return originalGetDisplayMedia(...args);
            };
        }
    }
    
    // =========================================================================
    // DEVTOOLS DETECTION
    // =========================================================================
    
    /**
     * Set up DevTools detection
     * Uses multiple heuristics as no single method is reliable
     */
    function setupDevToolsDetection() {
        if (!CONFIG.PROTECTIONS.devtools) return;
        
        let devtoolsOpen = false;
        
        // Method 1: Window size difference (dock mode)
        const checkWindowSize = () => {
            const widthThreshold = window.outerWidth - window.innerWidth > CONFIG.DEVTOOLS_THRESHOLD;
            const heightThreshold = window.outerHeight - window.innerHeight > CONFIG.DEVTOOLS_THRESHOLD;
            
            if (widthThreshold || heightThreshold) {
                if (!devtoolsOpen) {
                    devtoolsOpen = true;
                    triggerSecurityAlert('Developer tools may be open');
                }
            } else {
                devtoolsOpen = false;
            }
        };
        
        // Check periodically
        setInterval(checkWindowSize, 1000);
        window.addEventListener('resize', checkWindowSize);
        
        // Method 2: Console timing (debugger causes delay)
        const checkConsoleTiming = () => {
            const start = performance.now();
            debugger; // This line causes delay when DevTools is open
            const end = performance.now();
            
            if (end - start > 100) {
                triggerSecurityAlert('Debugger detected');
            }
        };
        
        // Only enable this in production - it's intrusive
        // Uncomment to enable:
        // setInterval(checkConsoleTiming, 5000);
    }
    
    // =========================================================================
    // UI HARDENING
    // =========================================================================
    
    /**
     * Set up UI hardening measures
     */
    function setupUIHardening() {
        // Disable right-click context menu
        if (CONFIG.PROTECTIONS.contextMenu) {
            document.addEventListener('contextmenu', (e) => {
                // Allow on input fields
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    return;
                }
                e.preventDefault();
            });
        }
        
        // Disable text selection on message elements
       if (CONFIG.PROTECTIONS.selection) {
    document.addEventListener('selectstart', (e) => {
        // Allow inputs, buttons, labels
        if (
            ['INPUT', 'TEXTAREA', 'BUTTON', 'LABEL'].includes(e.target.tagName)
        ) {
            return;
        }

        if (e.target.closest('.message')) {
            e.preventDefault();
        }
    });
}

        
        // Disable drag operations
        if (CONFIG.PROTECTIONS.dragDrop) {
            document.addEventListener('dragstart', (e) => {
                if (e.target.closest('.messages-container')) {
                    e.preventDefault();
                }
            });
        }
        
        // Monitor clipboard operations
        if (CONFIG.PROTECTIONS.clipboard) {
            document.addEventListener('copy', (e) => {
                // Check if copying from messages
                const selection = window.getSelection();
                if (selection && selection.anchorNode) {
                    const container = selection.anchorNode.parentElement;
                    if (container && container.closest('.messages-container')) {
                        e.preventDefault();
                        triggerSecurityAlert('Copy operation blocked');
                    }
                }
            });
        }
        
        // Disable F12 key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F12') {
                e.preventDefault();
            }
            
            // Disable Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
            if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'i' || e.key === 'j')) {
                e.preventDefault();
            }
            if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
                e.preventDefault();
            }
        });
    }
    
    // =========================================================================
    // VISIBILITY DETECTION
    // =========================================================================
    
    /**
     * Monitor page visibility changes
     * Can indicate screenshot tools, screen recording, or tab switching
     */
    function setupVisibilityDetection() {
        if (!CONFIG.PROTECTIONS.visibility) return;
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page is hidden - could be screenshot, recording, or just tab switch
                console.log('[SECURITY] Page visibility changed to hidden');
                
                // Optionally clear sensitive content when hidden
                // This is aggressive but provides better security
                // clearSensitiveContent();
            } else {
                console.log('[SECURITY] Page visibility restored');
            }
        });
        
        // Window blur event
        window.addEventListener('blur', () => {
            console.log('[SECURITY] Window lost focus');
        });
    }
    
    // =========================================================================
    // INACTIVITY MONITOR
    // =========================================================================
    
    /**
     * Set up inactivity monitoring
     * Auto-locks after period of inactivity
     */
    function setupInactivityMonitor() {
        const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
        
        const resetTimer = () => {
            lastActivityTime = Date.now();
        };
        
        activityEvents.forEach(event => {
            document.addEventListener(event, resetTimer, true);
        });
        
        // Check inactivity periodically
        inactivityTimer = setInterval(() => {
            const inactiveTime = Date.now() - lastActivityTime;
            
            if (inactiveTime > CONFIG.INACTIVITY_TIMEOUT) {
                triggerSecurityAlert('Session locked due to inactivity');
                // Could trigger auto-disconnect here
                if (onSecurityEvent) {
                    onSecurityEvent('inactivity_timeout');
                }
            }
        }, 30000); // Check every 30 seconds
    }
    
    // =========================================================================
    // SECURITY ALERT HANDLING
    // =========================================================================
    
    /**
     * Trigger security alert and show overlay
     * 
     * @param {string} reason - Reason for alert
     */
    function triggerSecurityAlert(reason) {
        console.warn('[SECURITY] Alert:', reason);
        
        // Show security overlay
        showSecurityOverlay(reason);
        
        // Notify callback
        if (onSecurityEvent) {
            onSecurityEvent('alert', reason);
        }
    }
    
    /**
     * Show security overlay
     * Hides messages temporarily
     */
    function showSecurityOverlay(message) {
        const overlay = Utils.$('security-overlay');
        const messageEl = Utils.$('security-message');
        
        if (overlay && messageEl) {
            messageEl.textContent = message;
            overlay.classList.remove('hidden');
            
            // Clear any existing timeout
            if (overlayTimeout) {
                clearTimeout(overlayTimeout);
            }
            
            // Hide after duration
            overlayTimeout = setTimeout(() => {
                overlay.classList.add('hidden');
            }, CONFIG.OVERLAY_DURATION);
        }
    }
    
    /**
     * Hide security overlay immediately
     */
    function hideSecurityOverlay() {
        const overlay = Utils.$('security-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
        if (overlayTimeout) {
            clearTimeout(overlayTimeout);
            overlayTimeout = null;
        }
    }
    
    // =========================================================================
    // MEMORY PROTECTION
    // =========================================================================
    
    /**
     * Clear sensitive content from DOM
     * Called when security event detected
     */
    function clearSensitiveContent() {
        const messagesContainer = Utils.$('messages-container');
        if (messagesContainer) {
            // Remove all messages except placeholder
            const messages = messagesContainer.querySelectorAll('.message');
            messages.forEach(msg => msg.remove());
        }
        
        // Clear input
        const input = Utils.$('message-input');
        if (input) {
            input.value = '';
        }
        
        console.log('[SECURITY] Sensitive content cleared');
    }
    
    /**
     * Attempt to clear clipboard
     * Note: Requires user interaction in most browsers
     */
    async function clearClipboard() {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText('');
                console.log('[SECURITY] Clipboard cleared');
            }
        } catch (error) {
            // Clipboard API requires user gesture in most browsers
            console.log('[SECURITY] Could not clear clipboard:', error.message);
        }
    }
    
    // =========================================================================
    // CLEANUP
    // =========================================================================
    
    /**
     * Clean up security module
     */
    function cleanup() {
        if (inactivityTimer) {
            clearInterval(inactivityTimer);
            inactivityTimer = null;
        }
        if (overlayTimeout) {
            clearTimeout(overlayTimeout);
            overlayTimeout = null;
        }
        isInitialized = false;
    }
    sele
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    
    return {
        initialize,
        triggerSecurityAlert,
        showSecurityOverlay,
        hideSecurityOverlay,
        clearSensitiveContent,
        clearClipboard,
        cleanup
    };
    
})();