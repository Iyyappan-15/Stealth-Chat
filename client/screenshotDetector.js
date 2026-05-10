/**
 * ScreenshotDetector — Stealth Chat Security Module v5
 * =====================================================
 * ADVANCED MULTI-LAYER SCREENSHOT & SCREEN CAPTURE PREVENTION
 *
 * Protection Layers:
 *  1.  Keyboard interception (PrtSc, Win+Shift+S, macOS Cmd+Shift+3/4/5/6)
 *  2.  Screen Capture API override (getDisplayMedia, getUserMedia on prototype)
 *  3.  MediaStream interception (display-surface track blocking)
 *  4.  Canvas API poisoning (getImageData, toDataURL, toBlob return blanks)
 *  5.  Clipboard read/write override (block clipboard.read + clipboard.readText)
 *  6.  MutationObserver (detects injected iframes / rogue video elements)
 *  7.  RAF Focus Monitor (~60fps poll — soft blackout on focus loss)
 *  8.  Mobile gesture detection (3-finger touch, status-bar double-tap)
 *  9.  Window RESIZE detection — WIDTH only, ignores height (= keyboard open)
 * 10.  DevTools detection (debugger timing + outer/inner dimension heuristic)
 * 11.  Anti-capture CSS overlay (mix-blend-mode degrades screenshot colour)
 * 12.  Drag prevention, copy/cut block, print block, context-menu block
 *
 * SOFT breach (silent blackout, no popup):
 *   Focus loss, tab switch, mouse leave, page hidden.
 *
 * HARD breach (blackout + Protocol Breach popup):
 *   Any actual capture attempt (keys, API calls, devtools, resize, gestures).
 */

class ScreenshotDetector {

    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.lastEscTime      = 0;
        this.escCount         = 0;
        this._blurSuppressed  = false;
        this._wasFocused      = document.hasFocus();
        this._focusLostAt     = 0;
        this._isMobile        = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

        this._injectProtectionCSS();
        this._buildBlackoutLayer();
        this._blockScreenCaptureAPI();
        this._poisonCanvasAPI();
        this._blockClipboardRead();
        this._startFocusMonitor();
        this._initListeners();
        this._startMutationObserver();
        this._protectConsole();
        this._startDevToolsDetection();
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Suppress blur detection while a native file dialog is open */
    suppressBlur(ms) {
        this._blurSuppressed = true;
        clearTimeout(this._blurSuppressTimer);
        this._blurSuppressTimer = setTimeout(() => {
            this._blurSuppressed = false;
        }, ms || 3000);
    }

    setOnFocusLost(callback)      { this.onFocusLost      = callback; }
    setOnPanicTriggered(callback) { this.onPanicTriggered = callback; }

    // ─── Layer 1: CSS Injection ───────────────────────────────────────────────

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
            /* Anti-capture overlay: a transparent layer with mix-blend-mode
               that degrades screenshot colour rendering significantly */
            #__stealth-anti-capture {
                position: fixed;
                inset: 0;
                z-index: 2147483640;
                pointer-events: none;
                background: repeating-linear-gradient(
                    0deg,
                    rgba(0,0,0,0.015) 0px,
                    transparent 2px
                );
                mix-blend-mode: multiply;
                will-change: opacity;
            }
            @media print {
                html, body, body * { visibility: hidden !important; }
                body::after {
                    content:     "SECURE SESSION — PRINTING DISABLED" !important;
                    visibility:  visible !important;
                    position:    fixed !important;
                    top:         50% !important;
                    left:        50% !important;
                    transform:   translate(-50%, -50%) !important;
                    font-size:   2rem !important;
                    color:       #c00 !important;
                    font-family: monospace !important;
                }
            }
        `;
        document.head.appendChild(s);

        // Inject the anti-capture overlay div
        const overlay = document.createElement('div');
        overlay.id = '__stealth-anti-capture';
        document.body.appendChild(overlay);
    }

    // ─── Layer 2: Blackout Layers ─────────────────────────────────────────────

    _buildBlackoutLayer() {
        if (!document.querySelector('.security-blindfold')) {
            const bf = document.createElement('div');
            bf.className = 'security-blindfold';
            document.body.appendChild(bf);
        }
    }

    /** SOFT — silent screen blackout, no popup */
    _softBlackout() {
        document.body.classList.add('hard-obscure');
        if (this.onFocusLost) this.onFocusLost();
    }

    _clearSoftBlackout() {
        document.body.classList.remove('hard-obscure');
    }

    /** HARD — blackout + Protocol Breach popup */
    _hardBlackout(reason, durationMs) {
        // Force synchronous reflow so blackout renders BEFORE the OS reads the buffer
        document.body.classList.add('hard-obscure');
        void document.body.offsetWidth;

        document.body.classList.add('content-obscured');

        if (this.onBreachDetected) this.onBreachDetected(reason);

        clearTimeout(this._hardBlackoutTimer);
        this._hardBlackoutTimer = setTimeout(() => {
            document.body.classList.remove('hard-obscure');
        }, durationMs || 800);
    }

    // ─── Layer 3: Screen Capture API Override ────────────────────────────────

    _blockScreenCaptureAPI() {
        const deny = (reason) => {
            this._hardBlackout(reason, 600);
            return Promise.reject(
                new DOMException('Screen capture is disabled in this secure session.', 'NotAllowedError')
            );
        };

        // Override on MediaDevices.prototype (covers ALL instances, not just navigator.mediaDevices)
        try {
            const proto = MediaDevices.prototype;

            // Block getDisplayMedia entirely
            proto.getDisplayMedia = () => deny('Screen Capture API Blocked');

            // Block getUserMedia only if requesting screen/display surface
            const origGUM = proto.getUserMedia;
            if (origGUM) {
                proto.getUserMedia = function(constraints, ...rest) {
                    if (
                        constraints?.video?.displaySurface ||
                        constraints?.video?.mediaSource === 'screen' ||
                        constraints?.video?.mediaSource === 'window' ||
                        constraints?.video?.mediaSource === 'application'
                    ) {
                        return deny('Screen Recording via getUserMedia Blocked');
                    }
                    return origGUM.call(this, constraints, ...rest);
                };
            }
        } catch (e) { /* Silently fail in restricted environments */ }

        // Belt-and-suspenders: also override the instance
        if (navigator.mediaDevices) {
            try {
                navigator.mediaDevices.getDisplayMedia = () => deny('Screen Capture API Blocked');
            } catch (e) {}
        }

        // Intercept MediaStream creation to catch display-capture tracks
        try {
            const OrigMediaStream = window.MediaStream;
            window.MediaStream = function(...args) {
                const stream = new OrigMediaStream(...args);
                const displayTracks = stream.getTracks().filter(t =>
                    t.kind === 'video' && (
                        t.label.toLowerCase().includes('screen') ||
                        t.label.toLowerCase().includes('display') ||
                        t.label.toLowerCase().includes('window')
                    )
                );
                if (displayTracks.length > 0) {
                    stream.getTracks().forEach(t => t.stop());
                    deny('Display MediaStream Intercepted');
                    throw new DOMException('Not allowed', 'NotAllowedError');
                }
                return stream;
            };
            try { Object.setPrototypeOf(window.MediaStream, OrigMediaStream); } catch(e) {}
        } catch (e) {}
    }

    // ─── Layer 4: Canvas API Poisoning ───────────────────────────────────────
    // Any in-page script that tries to read pixel data gets blank data back,
    // preventing javascript-based screen-grab attacks.

    _poisonCanvasAPI() {
        try {
            // Poison getImageData — returns blank (black) pixels
            const ctx = CanvasRenderingContext2D.prototype;
            const origGetImageData = ctx.getImageData;
            ctx.getImageData = function(sx, sy, sw, sh, ...rest) {
                // Allow legitimate uses within our own secure canvas (by checking a flag)
                if (this.canvas && this.canvas.__stealthTrusted) {
                    return origGetImageData.call(this, sx, sy, sw, sh, ...rest);
                }
                return new ImageData(sw || 1, sh || 1); // blank
            };

            // Poison toDataURL — returns a 1×1 blank PNG
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(...args) {
                if (this.__stealthTrusted) return origToDataURL.apply(this, args);
                return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            };

            // Poison toBlob — returns null blob
            HTMLCanvasElement.prototype.toBlob = function(callback) {
                if (this.__stealthTrusted) {
                    // Allow trusted canvas (set flag before calling)
                    HTMLCanvasElement.prototype.toBlob = function(cb, ...a) { cb(new Blob()); };
                }
                callback(null);
            };
        } catch (e) {}
    }

    // ─── Layer 5: Clipboard Read Blocking ────────────────────────────────────

    _blockClipboardRead() {
        try {
            if (navigator.clipboard) {
                navigator.clipboard.read = () =>
                    Promise.reject(new DOMException('Not allowed in secure session', 'NotAllowedError'));
                navigator.clipboard.readText = () =>
                    Promise.reject(new DOMException('Not allowed in secure session', 'NotAllowedError'));
            }
        } catch (e) {}
    }

    // ─── Layer 6: MutationObserver — Injection Detection ─────────────────────

    _startMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const tag = node.tagName?.toLowerCase();

                    // Block injected iframes (XSS screenshot relay vector)
                    if (tag === 'iframe') {
                        node.remove();
                        this._hardBlackout('Unauthorized iframe Injection Detected', 600);
                        return;
                    }

                    // Block rogue video elements that could relay a capture stream
                    if (tag === 'video') {
                        const allowedIds = ['local-video', 'remote-video'];
                        if (!allowedIds.includes(node.id) && (node.src || node.srcObject)) {
                            node.srcObject = null;
                            node.src = '';
                            node.remove();
                            this._hardBlackout('Unauthorized Video Element Detected', 600);
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
        this._mutationObserver = observer;
    }

    // ─── Layer 7: Focus Monitor (RAF loop ~60fps) ─────────────────────────────

    _startFocusMonitor() {
        const tick = () => {
            const isFocused = document.hasFocus();

            if (this._wasFocused && !isFocused) {
                if (!this._blurSuppressed) {
                    this._focusLostAt = Date.now();
                    this._softBlackout();
                }
            } else if (!this._wasFocused && isFocused) {
                this._focusLostAt = 0;
                this._clearSoftBlackout();
            }

            this._wasFocused = isFocused;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ─── Layer 8–12: Event Listeners ─────────────────────────────────────────

    _initListeners() {

        // ── Keyboard: screenshot shortcuts ────────────────────────────────────
        document.addEventListener('keydown', (e) => {

            // PrtSc / Alt+PrtSc
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout(
                    e.altKey ? 'Alt+PrtSc Blocked — Window Screenshot Prevented'
                             : 'PrtSc Blocked — Clipboard Screenshot Prevented',
                    1000
                );
                this._tryPoisonClipboard();
                return;
            }

            const isMetaKey = e.metaKey ||
                              e.getModifierState?.('Meta') ||
                              e.getModifierState?.('OS');

            // Win+Shift+S — Snipping Tool
            if (e.shiftKey && isMetaKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Win+Shift+S Snipping Tool Blocked', 1000);
                return;
            }

            // macOS: Cmd+Shift+3/4/5/6 (full, area, screen record, touch bar)
            if (e.metaKey && e.shiftKey && ['3','4','5','6'].includes(e.key)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout(`macOS Screenshot (Cmd+Shift+${e.key}) Blocked`, 800);
                return;
            }

            // macOS: Cmd+Ctrl+Shift+3/4 (clipboard screenshot)
            if (e.metaKey && e.ctrlKey && e.shiftKey && ['3','4'].includes(e.key)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('macOS Clipboard Screenshot Blocked', 800);
                return;
            }

            // Ctrl+P — Print
            if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Print Attempt Blocked', 500);
                return;
            }

            // F12 / DevTools keyboard shortcuts
            if (e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c','K','k'].includes(e.key))) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Developer Tools Attempt Blocked', 500);
                return;
            }

            // Ctrl+U — View Source
            if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('View Source Blocked', 400);
                return;
            }

            // Ctrl+S — Save Page
            if (e.ctrlKey && !e.shiftKey && !isMetaKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hardBlackout('Page Save Attempt Blocked', 400);
                return;
            }

            // Triple-ESC → Panic Mode
            if (e.key === 'Escape') {
                const now = Date.now();
                this.escCount = (now - this.lastEscTime < 1000) ? this.escCount + 1 : 1;
                this.lastEscTime = now;
                if (this.escCount >= 3 && this.onPanicTriggered) this.onPanicTriggered();
            }

        }, { capture: true, passive: false });

        // ── Keyup: overwrite clipboard AFTER OS reads it on PrtSc release ─────
        document.addEventListener('keyup', (e) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._tryPoisonClipboard();
                // Win+PrtSc heuristic: focus was lost right before keyup
                if (this._focusLostAt && (Date.now() - this._focusLostAt) < 600) {
                    this._hardBlackout('Win+PrtSc Detected — File Screenshot Blocked', 800);
                }
            }
        }, { capture: true, passive: false });

        // ── visibilitychange — SOFT (desktop) / already handled in main.js (mobile) ──
        if (!this._isMobile) {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    if (!this._blurSuppressed) this._softBlackout();
                } else {
                    this._clearSoftBlackout();
                }
            });
        }

        // ── Mouse leave / enter (desktop only) ───────────────────────────────
        if (!this._isMobile) {
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

        // ── Mobile gesture detection ──────────────────────────────────────────
        if (this._isMobile) {
            // 3+ finger touch = screenshot gesture on most Android phones
            document.addEventListener('touchstart', (e) => {
                if (e.touches.length >= 3) {
                    this._hardBlackout('Multi-Touch Screenshot Gesture Blocked', 800);
                }
            }, { passive: true });

            // Double-tap near top of screen = status bar tap (swipe-down screenshot prep)
            let lastStatusTap = 0;
            document.addEventListener('touchend', (e) => {
                const touch = e.changedTouches[0];
                if (touch && touch.clientY < 50) {
                    const now = Date.now();
                    if (now - lastStatusTap < 400) {
                        this._softBlackout();
                    }
                    lastStatusTap = now;
                }
            }, { passive: true });
        }

        // ── Copy / Cut — block ────────────────────────────────────────────────
        document.addEventListener('copy', (e) => e.preventDefault(), { capture: true });
        document.addEventListener('cut',  (e) => e.preventDefault(), { capture: true });

        // ── Drag — block ──────────────────────────────────────────────────────
        document.addEventListener('dragstart', (e) => e.preventDefault(), { capture: true });

        // ── Context menu — HARD breach ────────────────────────────────────────
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._hardBlackout('Right-Click Blocked', 400);
        }, { capture: true });

        // ── Print ─────────────────────────────────────────────────────────────
        window.addEventListener('beforeprint', () => {
            this._hardBlackout('Print Blocked', 2000);
        });

        // ── Window resize: WIDTH changes only ─────────────────────────────────
        // IMPORTANT: We only watch innerWidth (not height) because on mobile,
        // the keyboard opening causes a HEIGHT resize — that is NOT a capture attempt.
        // A WIDTH change > 60px indicates split-screen or a screen-recorder resizing.
        let lastInnerWidth = window.innerWidth;
        let resizeDebounce;
        window.addEventListener('resize', () => {
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => {
                const newWidth = window.innerWidth;
                if (Math.abs(newWidth - lastInnerWidth) > 60) {
                    lastInnerWidth = newWidth;
                    if (!this._isMobile) {
                        this._hardBlackout('Window Resized — Possible Screen Recorder', 400);
                    }
                } else {
                    lastInnerWidth = newWidth;
                }
            }, 400);
        });
    }

    // ─── Clipboard Poison ─────────────────────────────────────────────────────

    _tryPoisonClipboard() {
        try {
            const ta = document.createElement('textarea');
            ta.value = '\u26D4 SECURE SESSION — CAPTURE BLOCKED \u26D4';
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (_) {
            navigator.clipboard?.writeText('\u26D4').catch(() => {});
        }
    }

    // ─── DevTools Protection ──────────────────────────────────────────────────

    _protectConsole() {
        const noop = () => {};
        try {
            ['log','warn','error','info','debug','trace','table','dir'].forEach(m => {
                try { console[m] = noop; } catch (_) {}
            });
        } catch (_) {}
    }

    _startDevToolsDetection() {
        // Method 1: debugger statement timing — pauses > 80ms = debugger attached
        setInterval(() => {
            const t = Date.now();
            // eslint-disable-next-line no-debugger
            debugger;
            if (Date.now() - t > 80) {
                this._hardBlackout('Debugger Detected — Session Locked', 1000);
            }
        }, 1500);

        // Method 2: outer vs inner dimension gap — DevTools panel changes window dimensions
        if (!this._isMobile) {
            setInterval(() => {
                const widthGap  = window.outerWidth  - window.innerWidth;
                const heightGap = window.outerHeight - window.innerHeight;
                // A gap > 200px strongly suggests a DevTools panel is open
                if (widthGap > 200 || heightGap > 200) {
                    this._hardBlackout('Developer Tools Panel Detected', 600);
                }
            }, 2000);
        }
    }

    // ─── Legacy-compatible methods ────────────────────────────────────────────

    activateStealthLock(reason) { this._softBlackout(); }
    handleBreach(reason)        { this._hardBlackout(reason, 600); }
}

window.ScreenshotDetector = ScreenshotDetector;
