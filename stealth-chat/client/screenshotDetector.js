class ScreenshotDetector {
    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.initListeners();
    }

    initListeners() {
        // 1. Detect "PrintScreen" Key
        window.addEventListener('keyup', (e) => {
            if (e.key === 'PrintScreen') {
                this.triggerBreach("PrintScreen Key Pressed");
            }
        });

        // 2. Detect "Alt" + Any Key (often used for snipping tools or Alt+PrntScrn)
        // This is aggressive but fits the "Stealth" theme.
        // We only trigger if Alt is held down for a screenshot
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Alt') {
                // Just logging, hard to distinguish context switching from snipping without false positives
                // But checking specifically for PrintScreen combos:
            }
        });

        // 3. Page Visibility Change (Tab Switching/Minimizing)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // User switched tabs or minimized
                this.triggerBreach("Tab Switched / App Minimized");
            }
        });

        // 4. Blur/Focus window (clicking outside)
        window.addEventListener('blur', () => {
            this.triggerBreach("Window Lost Focus");
        });
    }

    triggerBreach(reason) {
        console.warn(`Security Breach: ${reason}`);
        if (this.onBreachDetected) {
            this.onBreachDetected(reason);
        }
    }
}

// Expose
window.ScreenshotDetector = ScreenshotDetector;
