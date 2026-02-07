class ScreenshotDetector {
    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.lastEscTime = 0;
        this.escCount = 0;
        this.initListeners();
    }

    initListeners() {
        // Create Security Blindfold if not exists
        if (!document.querySelector('.security-blindfold')) {
            const blindfold = document.createElement('div');
            blindfold.className = 'security-blindfold';
            document.body.appendChild(blindfold);
        }

        // 1. KEYDOWN (Enhanced detection)
        window.addEventListener('keydown', (e) => {
            // PrintScreen Detection
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                this.handleBreach(e.altKey ? "Alt + PrintScreen Attempted" : "PrintScreen Key Pressed");
            }

            // Print Attempt (Ctrl+P)
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                this.handleBreach("Printing Attempted");
            }

            // DevTools Detection (F12, Ctrl+Shift+I, Ctrl+Shift+J)
            if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J'))) {
                this.handleBreach("Developer Tools Opened");
            }

            // Screenshots shortcuts (Windows/Mac)
            if (e.key === 'S' && e.shiftKey && (e.metaKey || e.getModifierState('Meta'))) {
                this.handleBreach("Snipping Tool Shortcut (Win+Shift+S)");
            }
            if ((e.key === '3' || e.key === '4') && e.shiftKey && (e.metaKey || e.getModifierState('Meta'))) {
                this.handleBreach("Mac Screenshot Shortcut");
            }

            // Panic Mode Detection (3x ESC)
            if (e.key === 'Escape') {
                const now = Date.now();
                if (now - this.lastEscTime < 1000) {
                    this.escCount++;
                } else {
                    this.escCount = 1;
                }
                this.lastEscTime = now;

                if (this.escCount >= 3) {
                    if (this.onPanicTriggered) this.onPanicTriggered();
                }
            }
        });

        // 2. BLUR (Window Focus Lost / Tab Switch)
        // CRITICAL: Snipping tool causes a blur event IMMEDIATELY.
        window.addEventListener('blur', () => {
            this.activateStealthLock("Window Focus Lost (Possible Screenshot)");
            if (this.onFocusLost) this.onFocusLost();
        });

        // 3. Page Visibility (Direct Detection)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.activateStealthLock("Page Minimized or Hidden");
            }
        });

        // 4. Mouse Leave (Detecting movement to taskbar or other apps)
        window.addEventListener('mouseleave', () => {
            this.activateStealthLock("Security Boundary Crossed");
        });

        // 5. Clipboard Protection (Block Copy/Cut)
        window.addEventListener('copy', (e) => {
            e.preventDefault();
            this.handleBreach("Clipboard Copy Blocked");
        });
        window.addEventListener('cut', (e) => {
            e.preventDefault();
            this.handleBreach("Clipboard Cut Blocked");
        });

        // 6. Context Menu Blocking (Right Click)
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleBreach("Right-Click / Context Menu Blocked");
        });

        // 7. Window Resize Detection (Possible Screen Capture)
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleBreach("Window Resized");
            }, 100);
        });

        // Start DevTools Protection
        this.protectConsole();
    }

    protectConsole() {
        // Hijack console to prevent inspection
        const noop = () => { };
        console.log = noop;
        console.warn = noop;
        console.error = noop;
        console.info = noop;
        console.debug = noop;

        // Debugger Loop (Freezes app if DevTools opened)
        setInterval(() => {
            (function () {
                const start = new Date();
                debugger;
                const end = new Date();
                if (end - start > 100) {
                    // DevTools likely open
                    window.location.reload();
                }
            })();
        }, 1000);
    }

    activateStealthLock(reason) {
        // This is the CORE function requested by user
        // It immediately blinds the screen before OS can capture it
        document.body.classList.add('hard-obscure');

        // Wipe Clipboard
        this.clearClipboard();

        // Callback
        if (this.onBreachDetected) {
            this.onBreachDetected(reason || "Stealth Lock Activated");
        }
    }

    setOnFocusLost(callback) {
        this.onFocusLost = callback;
    }

    setOnPanicTriggered(callback) {
        this.onPanicTriggered = callback;
    }

    async clearClipboard() {
        try {
            await navigator.clipboard.writeText(' --- SECURE SESSION: CLIPBOARD WIPED --- ');
        } catch (err) { }
    }

    handleBreach(reason) {
        // Obscure UI visually
        document.body.classList.add('content-obscured');

        // Wipe Clipboard
        this.clearClipboard();

        // Callback
        if (this.onBreachDetected) {
            this.onBreachDetected(reason);
        }
    }
}

// Expose
window.ScreenshotDetector = ScreenshotDetector;
