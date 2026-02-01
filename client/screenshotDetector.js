class ScreenshotDetector {
    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.initListeners();
    }

    initListeners() {
        // 1. KEYDOWN (Fastest)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                this.handleBreach("PrintScreen Key Pressed (Down)");
            }
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                this.handleBreach("Printing Attempted");
            }
            // Shortcuts
            if (e.key === 'S' && e.shiftKey && (e.metaKey || e.getModifierState('Meta'))) {
                this.handleBreach("Snipping Tool Shortcut");
            }
            if ((e.key === '3' || e.key === '4') && e.shiftKey && (e.metaKey || e.getModifierState('Meta'))) {
                this.handleBreach("Mac Shortcut");
            }
        });

        // 2. KEYUP (Reliability fallback)
        window.addEventListener('keyup', (e) => {
            if (e.key === 'PrintScreen') {
                this.handleBreach("PrintScreen Key Pressed (Up)");
            }
        });

        // 3. BLUR (Window Focus Lost) - Critical for Snipping Tool
        window.addEventListener('blur', () => {
            // Immediately hide content when window loses focus
            document.body.classList.add('content-obscured');
            // We don't trigger a full "Breach" (data wipe) just for alt-tab,
            // but we ensure the screen is unreadable.
        });

        // 4. FOCUS - Restore if no breach, otherwise keep blocked
        window.addEventListener('focus', () => {
            // Only remove if we haven't triggered a permanent breach
            const alert = document.getElementById('security-alert');
            // Check if logic deems it safe (if alert is hidden)
            if (alert && alert.classList.contains('hidden')) {
                document.body.classList.remove('content-obscured');
            }
        });

        // 5. Page Visibility
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                document.body.classList.add('content-obscured');
            }
        });
    }

    async clearClipboard() {
        try {
            // This only works if the document has focus
            await navigator.clipboard.writeText(' --- SCREENSHOT BLOCKED BY SECURITY PROTOCOL --- ');
        } catch (err) {
            // Ignore clipboard errors
        }
    }

    handleBreach(reason) {
        // 1. Direct DOM manipulation for 0-latency response
        document.body.classList.add('content-obscured');

        // 2. Clear clipboard
        this.clearClipboard();

        // 3. Callback
        if (this.onBreachDetected) {
            this.onBreachDetected(reason);
        }
    }
}

// Expose
window.ScreenshotDetector = ScreenshotDetector;
