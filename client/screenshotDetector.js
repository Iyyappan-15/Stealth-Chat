/**
 * ScreenshotDetector — Stealth Chat Security Module v4
 * =====================================================
 *
 * TWO PROTECTION LEVELS:
 *
 *  SOFT (silent blackout only — no alert popup):
 *    • Window loses focus (tab switch, clicked elsewhere)
 *    • Page hidden / minimised
 *    • Mouse leaves the browser window
 *    → Screen goes black to prevent content capture, but no alert is shown.
 *      The blackout disappears automatically when focus returns.
 *
 *  HARD (blackout + Protocol Breach alert):
 *    • PrtSc pressed         → keydown blackout + keyup clipboard-overwrite
 *    • Alt+PrtSc pressed     → same
 *    • Win+Shift+S (snipping tool) → caught via focus-loss timing heuristic
 *    • Ctrl+P (print), F12, Ctrl+Shift+I (DevTools)
 *    • Context menu / right-click
 *    • Screen Capture API (getDisplayMedia)
 *
 *  NOTE: Win+PrtSc is OS-level (focus stolen before browser sees keydown).
 *  We catch it via the RAF focus monitor — when focus is lost AND within
 *  500ms the PrintScreen keyup fires, we know it was Win+PrtSc and trigger
 *  a hard breach. Otherwise a plain focus loss = soft blackout only.
 */

class ScreenshotDetector {

    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.lastEscTime      = 0;
        this.escCount         = 0;
        this._blurSuppressed  = false;
        this._blackoutEl      = null;
        this._wasFocused      = document.hasFocus();
        this._focusLostAt     = 0;  // timestamp — helps detect Win+PrtSc

        this._injectProtectionCSS();
        this._buildBlackoutLayer();
        this._blockScreenCaptureAPI();
        this._startFocusMonitor();
        this._initListeners();
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Call before opening a native file dialog so blur doesn't false-trigger */
    suppressBlur(ms) {
        this._blurSuppressed = true;
        clearTimeout(this._blurSuppressTimer);
        this._blurSuppressTimer = setTimeout(() => { this._blurSuppressed = false; }, ms || 3000);
    }

    setOnFocusLost(callback)      { this.onFocusLost      = callback; }
    setOnPanicTriggered(callback) { this.onPanicTriggered = callback; }

    // ─── CSS Injection ────────────────────────────────────────────────────────

    _injectProtectionCSS() {
        if (document.getElementById('__stealth-css')) return;
        const s = document.createElement('style');
        s.id = '__stealth-css';
        s.textContent = `
            * {
                -webkit-user-select:   none !important;
                -moz-user-select:      none !important;
                user-select:           none !important;
                -webkit-touch-callout: none !important;
            }
            img, video, canvas, svg {
                pointer-events:    none !important;
                -webkit-user-drag: none !important;
            }
            @media print {
                html, body, body * { visibility: hidden !important; }
                body::after {
                    content:    "SECURE SESSION — PRINTING DISABLED" !important;
                    visibility: visible !important;
                    position:   fixed !important;
                    top:        50% !important;
                    left:       50% !important;
                    transform:  translate(-50%, -50%) !important;
                    font-size:  2rem !important;
                    color:      #c00 !important;
                    font-family: monospace !important;
                }
            }
        `;
        document.head.appendChild(s);
    }

    // ─── Blackout Layer ───────────────────────────────────────────────────────

    _buildBlackoutLayer() {
        if (!document.querySelector('.security-blindfold')) {
            const bf = document.createElement('div');
            bf.className = 'security-blindfold';
            document.body.appendChild(bf);
        }
    }

    /**
     * SOFT blackout — blacks the screen silently.
     * Used for focus loss, tab switch, mouse leave.
     * Does NOT call onBreachDetected (no popup, no alert).
     */
    _softBlackout() {
        document.body.classList.add('hard-obscure');
        if (this.onFocusLost) this.onFocusLost();
    }

    _clearSoftBlackout() {
        // Only clear if a hard breach hasn't locked it
        document.body.classList.remove('hard-obscure');
    }

    /**
     * HARD blackout — blacks screen AND fires the breach alert.
     * Used only for actual screenshot key presses.
     */
    _hardBlackout(reason, durationMs) {
        // Show the hard-obscure immediately (synchronous reflow)
        document.body.classList.add('hard-obscure');
        void document.body.offsetWidth; // force reflow before OS reads screen buffer

        // Also blur the content layer
        document.body.classList.add('content-obscured');

        // Fire the breach callback (shows Protocol Breach popup in main.js)
        if (this.onBreachDetected) this.onBreachDetected(reason);

        // Auto-clear after a short period so the user can still use the app
        clearTimeout(this._hardBlackoutTimer);
        this._hardBlackoutTimer = setTimeout(() => {
            document.body.classList.remove('hard-obscure');
            // NOTE: content-obscured is cleared by the "Acknowledge" button in main.js
        }, durationMs || 800);
    }

    // ─── Focus Monitor (RAF loop) ────────────────────────────────────────────

    /**
     * Polls document.hasFocus() at ~60fps.
     * On focus loss: soft blackout only.
     * On focus return: clear soft blackout.
     *
     * Win+PrtSc heuristic: if focus was lost AND within 500ms a PrintScreen
     * keyup fires (caught in _initListeners), we upgrade to a hard breach.
     */
    _startFocusMonitor() {
        const tick = () => {
            const isFocused = document.hasFocus();

            if (this._wasFocused && !isFocused) {
                // Focus just lost
                if (!this._blurSuppressed) {
                    this._focusLostAt = Date.now();
                    this._softBlackout();
                }
            } else if (!this._wasFocused && isFocused) {
                // Focus returned — clear soft blackout
                this._focusLostAt = 0;
                this._clearSoftBlackout();
            }

            this._wasFocused = isFocused;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ─── Screen Capture API Override ─────────────────────────────────────────

    _blockScreenCaptureAPI() {
        if (!navigator.mediaDevices) return;

        const deny = (reason) => {
            this._hardBlackout(reason, 600);
            return Promise.reject(new DOMException('Screen capture is disabled.', 'NotAllowedError'));
        };

        if (navigator.mediaDevices.getDisplayMedia) {
            navigator.mediaDevices.getDisplayMedia = () => deny('Screen Capture API Blocked');
        }

        const origGUM = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
        if (origGUM) {
            navigator.mediaDevices.getUserMedia = (constraints, ...rest) => {
                if (constraints?.video?.displaySurface || constraints?.video?.mediaSource === 'screen') {
                    return deny('Screen Recording via getUserMedia Blocked');
                }
                return origGUM(constraints, ...rest);
            };
        }
    }

    // ─── Event Listeners ─────────────────────────────────────────────────────

    _initListeners() {
        const isTouchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

        // ── KEYDOWN — intercept screenshot shortcuts ───────────────────────────
        document.addEventListener('keydown', (e) => {

            // PrtSc / Alt+PrtSc — hard breach
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout(
                    e.altKey ? 'Alt+PrtSc Blocked — Window Screenshot Prevented'
                             : 'PrtSc Blocked — Clipboard Screenshot Prevented',
                    1000
                );
                // Try to overwrite clipboard (may silently fail — no permission popup since we catch errors)
                this._tryPoisonClipboard();
                return;
            }

            // Win+Shift+S — Snipping Tool — hard breach
            const isWinKey = e.metaKey ||
                             e.getModifierState?.('Meta') ||
                             e.getModifierState?.('OS');
            if (e.shiftKey && isWinKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Win+Shift+S Snipping Tool Blocked', 1000);
                return;
            }

            // macOS: Cmd+Shift+3/4/5/6 — hard breach
            if (e.metaKey && e.shiftKey && ['3','4','5','6'].includes(e.key)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout(`macOS Screenshot (Cmd+Shift+${e.key}) Blocked`, 800);
                return;
            }

            // Ctrl+P — print — hard breach
            if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Print Attempt Blocked', 500);
                return;
            }

            // F12 / DevTools — hard breach
            if (e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c','K','k'].includes(e.key))) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Developer Tools Attempt Blocked', 500);
                return;
            }

            // Ctrl+U — View Source — hard breach
            if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('View Source Blocked', 400);
                return;
            }

            // Ctrl+S — Save Page — hard breach
            if (e.ctrlKey && !e.shiftKey && !isWinKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Page Save Attempt Blocked', 400);
                return;
            }

            // Triple-ESC — Panic Mode
            if (e.key === 'Escape') {
                const now = Date.now();
                this.escCount = (now - this.lastEscTime < 1000) ? this.escCount + 1 : 1;
                this.lastEscTime = now;
                if (this.escCount >= 3 && this.onPanicTriggered) this.onPanicTriggered();
            }

        }, { capture: true, passive: false });

        // ── KEYUP — overwrite clipboard after OS reads it on PrtSc release ────
        // Also detects Win+PrtSc: if focus was recently lost AND PrintScreen fires within 500ms,
        // it was likely Win+PrtSc (OS grabbed file screenshot).
        document.addEventListener('keyup', (e) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._tryPoisonClipboard();

                // Win+PrtSc heuristic: focus was lost recently
                if (this._focusLostAt && (Date.now() - this._focusLostAt) < 600) {
                    this._hardBlackout('Win+PrtSc Detected — File Screenshot Blocked', 800);
                }
            }
        }, { capture: true, passive: false });

        // ── visibilitychange — SOFT blackout only ────────────────────────────
        // Page hidden = tab switch / minimise. Just black out silently.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (!this._blurSuppressed) this._softBlackout();
            } else {
                this._clearSoftBlackout();
            }
        });

        // ── Mouse leave — SOFT blackout (desktop only) ───────────────────────
        if (!isTouchDevice) {
            document.addEventListener('mouseleave', (e) => {
                if (this._blurSuppressed) return;
                if (e.clientY <= 0 || e.clientX <= 0 ||
                    e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                    this._softBlackout();
                }
            });
            document.addEventListener('mouseenter', () => {
                if (document.hasFocus()) this._clearSoftBlackout();
            });
        }

        // ── Mobile: 3-finger touch (screenshot gesture on Samsung/Android) ────
        if (isTouchDevice) {
            document.addEventListener('touchstart', (e) => {
                if (e.touches.length >= 3) {
                    this._hardBlackout('3-Finger Screenshot Gesture Blocked', 800);
                }
            }, { passive: true });
        }

        // ── Copy / Cut — block silently (no breach popup, just block action) ─
        document.addEventListener('copy', (e) => e.preventDefault(), { capture: true });
        document.addEventListener('cut',  (e) => e.preventDefault(), { capture: true });

        // ── Context menu — HARD breach ────────────────────────────────────────
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._hardBlackout('Right-Click Blocked', 400);
        }, { capture: true });

        // ── Print ─────────────────────────────────────────────────────────────
        window.addEventListener('beforeprint', () => {
            this._hardBlackout('Print Blocked', 2000);
        });

        // ── Window resize (screen recorder / split-screen) ────────────────────
        let lastW = window.innerWidth, rTimer;
        const onResize = () => {
            clearTimeout(rTimer);
            rTimer = setTimeout(() => {
                const nw = window.innerWidth;
                if (Math.abs(nw - lastW) > 60) {
                    lastW = nw;
                    this._hardBlackout('Window Resized — Possible Screen Recorder', 400);
                } else { lastW = nw; }
            }, 400);
        };
        (window.visualViewport || window).addEventListener('resize', onResize);

        // ── DevTools protection ───────────────────────────────────────────────
        this._protectConsole();
    }

    // ─── Clipboard Poison (used only on PrtSc events) ────────────────────────

    _tryPoisonClipboard() {
        // Use execCommand which doesn't require clipboard permission
        try {
            const ta = document.createElement('textarea');
            ta.value = '\u26D4 SECURE SESSION \u26D4';
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (_) {
            // If execCommand fails, try the async API silently (no permission prompt if granted)
            navigator.clipboard?.writeText('\u26D4').catch(() => {});
        }
    }

    // ─── DevTools Protection ──────────────────────────────────────────────────

    _protectConsole() {
        const noop = () => {};
        try {
            ['log','warn','error','info','debug','trace'].forEach(m => {
                try { console[m] = noop; } catch(_) {}
            });
        } catch(_) {}

        setInterval(() => {
            const t = Date.now();
            debugger; // eslint-disable-line no-debugger
            if (Date.now() - t > 80) window.location.reload();
        }, 1000);
    }

    // ─── Legacy-compatible methods (called from old code paths) ──────────────

    activateStealthLock(reason) {
        // Legacy: just do a soft blackout
        this._softBlackout();
    }

    handleBreach(reason) {
        // Legacy: hard breach
        this._hardBlackout(reason, 600);
    }
}

window.ScreenshotDetector = ScreenshotDetector;
