class ScreenshotDetector {
    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.lastEscTime = 0;
        this.escCount = 0;
        this._blurSuppressed = false;  // set true while file-picker is open
        this.initListeners();
    }

    /** Temporarily suppresses the blur/mouseleave breach for 'ms' milliseconds.
     *  Call this immediately before opening a native file dialog or similar. */
    suppressBlur(ms) {
        this._blurSuppressed = true;
        clearTimeout(this._blurSuppressTimer);
        this._blurSuppressTimer = setTimeout(() => {
            this._blurSuppressed = false;
        }, ms || 3000);
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
        // MOBILE FIX: Do NOT trigger on mobile when an input/textarea gains focus
        // (blur fires on window when keyboard opens and focus moves to input)
        window.addEventListener('blur', () => {
            if (this._blurSuppressed) return;  // file-picker grace window

            // Check if an input or textarea just received focus
            const activeEl = document.activeElement;
            const isMobileKeyboard = activeEl &&
                (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

            // Also check if this is a touch device
            const isTouchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

            if (isTouchDevice && isMobileKeyboard) {
                // Mobile virtual keyboard opened — not a breach
                return;
            }

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
        // MOBILE FIX: mouseleave fires unreliably on touch devices — skip it
        const isTouchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
        if (!isTouchDevice) {
            window.addEventListener('mouseleave', () => {
                if (this._blurSuppressed) return;  // file-picker grace window
                this.activateStealthLock("Security Boundary Crossed");
            });
        }

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
        // MOBILE FIX: Virtual keyboard opening changes window HEIGHT only.
        // A real screen-record/split-screen attempt typically changes WIDTH.
        // We use visualViewport if available for accurate detection.
        let lastWindowWidth = window.innerWidth;
        let resizeTimeout;

        const handleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const newWidth = window.innerWidth;

                // Only treat it as a breach if the WIDTH changed
                // (keyboard open only shrinks height, not width)
                if (newWidth !== lastWindowWidth) {
                    lastWindowWidth = newWidth;
                    this.handleBreach("Window Resized");
                } else {
                    // Height changed only — this is the mobile keyboard
                    lastWindowWidth = newWidth; // update reference
                }
            }, 300);
        };

        // Prefer visualViewport for modern mobile — it doesn't resize when keyboard opens
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                // visualViewport.resize fires for BOTH keyboard AND window resize.
                // Only flag if outerWidth changed (real window resize)
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    const newWidth = window.visualViewport.width;
                    if (Math.abs(newWidth - lastWindowWidth) > 50) {
                        lastWindowWidth = newWidth;
                        this.handleBreach("Window Resized");
                    }
                    // else: keyboard height change — ignore
                }, 350);
            });
        } else {
            window.addEventListener('resize', handleResize);
        }

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
