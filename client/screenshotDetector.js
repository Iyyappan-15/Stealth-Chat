/**
 * ScreenshotDetector — Stealth Chat Security Module v5
 * =====================================================
 * 12-layer screenshot & screen-capture prevention
 *
 *  1.  Keyboard interception (PrtSc, Win+Shift+S, macOS Cmd+Shift+3/4/5/6)
 *  2.  Screen Capture API override (getDisplayMedia, getUserMedia on prototype)
 *  3.  MediaDevices instance lock (Object.defineProperty — non-writable)
 *  4.  Canvas API poisoning (getImageData, toDataURL, toBlob return blanks)
 *  5.  Clipboard read/write override (Object.defineProperty — non-writable)
 *  6.  MutationObserver (injected iframe / rogue video detection)
 *  7.  Focus Monitor (visibilitychange + window blur/focus events)
 *  8.  Mobile gesture detection (3-finger touch, status-bar double-tap)
 *  9.  Window WIDTH resize detection (split-screen / screen-recorder heuristic)
 * 10.  DevTools detection (debugger timing + outer/inner dimension gap)
 * 11.  Anti-capture CSS overlay (mix-blend-mode degrades screenshot colour)
 * 12.  Drag, copy, cut, print, context-menu block
 *
 * SOFT breach: silent blackout (focus loss, tab switch, mouse leave).
 * HARD breach: blackout + Protocol Breach alert (capture attempt detected).
 */

class ScreenshotDetector {

    constructor(onBreachDetected) {
        this.onBreachDetected = onBreachDetected;
        this.lastEscTime      = 0;
        this.escCount         = 0;
        this._blurSuppressed  = false;
        this._isMobile        = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

        this._injectProtectionCSS();
        this._buildBlackoutLayer();
        this._blockScreenCaptureAPI();
        this._poisonCanvasAPI();
        this._blockClipboardRead();
        this._initFocusListeners();
        this._initListeners();
        this._startMutationObserver();
        this._protectConsole();
        this._startDevToolsDetection();
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    suppressBlur(ms = 3000) {
        this._blurSuppressed = true;
        clearTimeout(this._blurSuppressTimer);
        this._blurSuppressTimer = setTimeout(() => { this._blurSuppressed = false; }, ms);
    }

    setOnFocusLost(callback)      { this.onFocusLost      = callback; }
    setOnPanicTriggered(callback) { this.onPanicTriggered = callback; }

    // ─── Layer 11: Anti-capture CSS + user-select: none ──────────────────────

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

            /* ── Anti-capture overlay ──
               Always rendered on top. mix-blend-mode:multiply degrades
               colour fidelity in any OS screenshot of the browser window.
               The repeating gradient adds visual noise to captured images. */
            #__stealth-anti-capture {
                position: fixed;
                inset: 0;
                z-index: 2147483640;
                pointer-events: none;
                background:
                    repeating-linear-gradient(
                        0deg,
                        rgba(0, 0, 0, 0.04) 0px,
                        rgba(0, 0, 0, 0.01) 1px,
                        transparent 2px,
                        transparent 4px
                    ),
                    repeating-linear-gradient(
                        90deg,
                        rgba(0, 0, 0, 0.02) 0px,
                        transparent 1px,
                        transparent 3px
                    );
                mix-blend-mode: multiply;
                opacity: 1;
            }

            /* ── Focus-loss content wipe ──
               When the window loses focus (Win+G overlay opens, Snipping Tool
               appears, etc.) ALL sensitive content instantly becomes invisible.
               transition:none ensures it's synchronous — no animation delay. */
            html[data-unfocused] #messages-container,
            html[data-unfocused] .message,
            html[data-unfocused] .input-area {
                visibility: hidden !important;
                transition: none !important;
            }
            html[data-unfocused] #messages-container * {
                color: transparent !important;
                transition: none !important;
            }
            html[data-unfocused] img,
            html[data-unfocused] video {
                opacity: 0 !important;
                transition: none !important;
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

        const overlay = document.createElement('div');
        overlay.id = '__stealth-anti-capture';
        document.body.appendChild(overlay);
    }

    // ─── Blackout Layers ──────────────────────────────────────────────────────

    _buildBlackoutLayer() {
        if (!document.querySelector('.security-blindfold')) {
            const bf = document.createElement('div');
            bf.className = 'security-blindfold';
            document.body.appendChild(bf);
        }
    }

    _softBlackout() {
        document.body.classList.add('hard-obscure');
        if (this.onFocusLost) this.onFocusLost();
    }

    _clearSoftBlackout() {
        document.body.classList.remove('hard-obscure');
    }

    _hardBlackout(reason, durationMs = 800) {
        document.body.classList.add('hard-obscure');
        void document.body.offsetWidth; // force reflow before OS reads framebuffer
        document.body.classList.add('content-obscured');
        if (this.onBreachDetected) this.onBreachDetected(reason);
        clearTimeout(this._hardBlackoutTimer);
        this._hardBlackoutTimer = setTimeout(() => {
            document.body.classList.remove('hard-obscure');
        }, durationMs);
    }

    // ─── Layers 2+3: Screen Capture API Override ─────────────────────────────

    _blockScreenCaptureAPI() {
        const deny = (reason) => {
            this._hardBlackout(reason, 600);
            return Promise.reject(
                new DOMException('Screen capture is disabled in this secure session.', 'NotAllowedError')
            );
        };

        // Override on MediaDevices.prototype (covers ALL instances)
        try {
            const proto = MediaDevices.prototype;
            proto.getDisplayMedia = () => deny('Screen Capture API Blocked');

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
        } catch (_) {}

        // Also lock the instance with Object.defineProperty (non-writable)
        if (navigator.mediaDevices) {
            try {
                Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
                    value: () => deny('Screen Capture API Blocked'),
                    writable: false,
                    configurable: false
                });
            } catch (_) {
                try { navigator.mediaDevices.getDisplayMedia = () => deny('Screen Capture API Blocked'); } catch (_) {}
            }
        }
    }

    // ─── Layer 4: Canvas API Poisoning ───────────────────────────────────────

    _poisonCanvasAPI() {
        try {
            const ctx2d = CanvasRenderingContext2D.prototype;
            const origGetImageData = ctx2d.getImageData;
            ctx2d.getImageData = function(sx, sy, sw, sh, ...rest) {
                if (this.canvas?.__stealthTrusted) {
                    return origGetImageData.call(this, sx, sy, sw, sh, ...rest);
                }
                return new ImageData(sw || 1, sh || 1); // blank pixels
            };

            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(...args) {
                if (this.__stealthTrusted) return origToDataURL.apply(this, args);
                // Return 1×1 blank PNG
                return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            };

            const origToBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
                if (this.__stealthTrusted) {
                    return origToBlob.call(this, callback, ...args); // trusted: pass through
                }
                callback(null); // untrusted: return null blob
            };
        } catch (_) {}
    }

    // ─── Layer 5: Clipboard Read Blocking ────────────────────────────────────

    _blockClipboardRead() {
        if (!navigator.clipboard) return;
        const denied = () => Promise.reject(
            new DOMException('Not allowed in secure session', 'NotAllowedError')
        );
        // Use Object.defineProperty first (most reliable)
        try {
            Object.defineProperty(navigator.clipboard, 'read',     { value: denied, configurable: false });
            Object.defineProperty(navigator.clipboard, 'readText', { value: denied, configurable: false });
        } catch (_) {
            // Fallback: direct assignment
            try {
                navigator.clipboard.read     = denied;
                navigator.clipboard.readText = denied;
            } catch (_) {}
        }
    }

    // ─── Layer 6: MutationObserver — DOM Injection Detection ─────────────────

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

                    // Block rogue video elements with active src
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

    // ─── Layer 7: Focus Monitor (event-driven — replaces heavy RAF loop) ──────

    _initFocusListeners() {
        // Mark document as unfocused via attribute — CSS uses this to hide content
        const markFocused   = () => document.documentElement.removeAttribute('data-unfocused');
        const markUnfocused = () => document.documentElement.setAttribute('data-unfocused', '');

        // Set initial state
        if (!document.hasFocus()) markUnfocused();

        // Tab switch / browser minimize
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                markUnfocused();
                if (!this._blurSuppressed) this._softBlackout();
            } else {
                markFocused();
                this._clearSoftBlackout();
            }
        });

        // Window loses / gains focus
        window.addEventListener('blur', () => {
            markUnfocused();
            if (!this._blurSuppressed) this._softBlackout();
        });
        window.addEventListener('focus', () => {
            markFocused();
            this._clearSoftBlackout();
        });

        // Mouse exits the browser viewport (desktop only)
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
    }

    // ─── Layers 1, 8, 9, 12: Event Listeners ─────────────────────────────────

    _initListeners() {

        // ── Layer 1: Keyboard screenshot shortcuts ────────────────────────────
        document.addEventListener('keydown', (e) => {

            // ── PrintScreen family (all modifier variants) ────────────────────
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                let msg = 'PrtScn Blocked — Clipboard Screenshot Prevented';
                if (e.altKey  && !e.shiftKey && !e.ctrlKey) msg = 'Alt+PrtScn Blocked — Window Screenshot Prevented';
                if (e.shiftKey && !e.altKey  && !e.ctrlKey) msg = 'Shift+PrtScn Blocked — Area Screenshot Prevented';
                if (e.ctrlKey)                               msg = 'Ctrl+PrtScn Blocked — Screenshot Prevented';
                this._hardBlackout(msg, 1000);
                this._tryPoisonClipboard();
                return;
            }

            const isMeta = e.metaKey ||
                           e.getModifierState?.('Meta') ||
                           e.getModifierState?.('OS');

            // ── Windows Key combos ────────────────────────────────────────────

            // Win+PrtScn — saves screenshot to Pictures folder
            // (OS intercepts before browser keydown, but we try anyway)
            if (isMeta && e.key === 'PrintScreen') {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Win+PrtScn Blocked — File Screenshot Prevented', 1000);
                this._tryPoisonClipboard();
                return;
            }

            // Win+Shift+S — Snipping Tool / Snip & Sketch
            if (isMeta && e.shiftKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Win+Shift+S Snipping Tool Blocked', 1000);
                return;
            }

            // Win+G — Xbox Game Bar (overlay)
            if (isMeta && !e.shiftKey && !e.altKey && !e.ctrlKey && (e.key === 'G' || e.key === 'g')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Win+G Xbox Game Bar Blocked', 800);
                return;
            }

            // Win+Alt+R — Xbox Game Bar screen recording
            if (isMeta && e.altKey && !e.shiftKey && (e.key === 'R' || e.key === 'r')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Win+Alt+R Xbox Game Bar Recording Blocked', 800);
                return;
            }

            // Win+Alt+PrtScn — Xbox Game Bar screenshot
            if (isMeta && e.altKey && e.key === 'PrintScreen') {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Win+Alt+PrtScn Game Bar Screenshot Blocked', 1000);
                this._tryPoisonClipboard();
                return;
            }

            // ── macOS combos ──────────────────────────────────────────────────

            // Cmd+Shift+3/4/5/6 (full, area, screen record, touch bar)
            if (e.metaKey && e.shiftKey && !e.ctrlKey && ['3','4','5','6'].includes(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout(`macOS Screenshot (Cmd+Shift+${e.key}) Blocked`, 800);
                return;
            }

            // Cmd+Ctrl+Shift+3/4 — copy to clipboard variant
            if (e.metaKey && e.ctrlKey && e.shiftKey && ['3','4'].includes(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('macOS Clipboard Screenshot Blocked', 800);
                return;
            }

            // ── Linux combos ──────────────────────────────────────────────────

            // Ctrl+Alt+Shift+R — GNOME built-in screen recorder
            if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('GNOME Screen Recorder Blocked (Ctrl+Alt+Shift+R)', 1000);
                return;
            }

            // ── Print ─────────────────────────────────────────────────────────
            if (e.ctrlKey && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Print Attempt Blocked', 500);
                return;
            }

            // ── DevTools shortcuts ────────────────────────────────────────────
            if (e.key === 'F12' ||
                (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c','K','k'].includes(e.key))) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('Developer Tools Attempt Blocked', 500);
                return;
            }

            // Ctrl+U — View Source
            if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
                e.preventDefault(); e.stopImmediatePropagation();
                this._hardBlackout('View Source Blocked', 400);
                return;
            }

            // Ctrl+S — Save Page
            if (e.ctrlKey && !e.shiftKey && !isMeta && (e.key === 's' || e.key === 'S')) {
                e.preventDefault(); e.stopImmediatePropagation();
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

        // Keyup: overwrite clipboard AFTER OS reads it on PrtSc release
        document.addEventListener('keyup', (e) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._tryPoisonClipboard();
            }
        }, { capture: true, passive: false });

        // ── Layer 8: Mobile gesture detection ────────────────────────────────
        if (this._isMobile) {
            // 3+ finger touch = screenshot gesture on most Android phones
            document.addEventListener('touchstart', (e) => {
                if (e.touches.length >= 3) {
                    this._hardBlackout('Multi-Touch Screenshot Gesture Blocked', 800);
                }
            }, { passive: true });

            // Double-tap near top of screen (status bar screenshot prep)
            let lastStatusTap = 0;
            document.addEventListener('touchend', (e) => {
                const touch = e.changedTouches[0];
                if (touch && touch.clientY < 50) {
                    const now = Date.now();
                    if (now - lastStatusTap < 400) this._softBlackout();
                    lastStatusTap = now;
                }
            }, { passive: true });
        }

        // ── Layer 12: Copy / Cut / Drag / Context Menu / Print ───────────────
        document.addEventListener('copy',      (e) => e.preventDefault(), { capture: true });
        document.addEventListener('cut',       (e) => e.preventDefault(), { capture: true });
        document.addEventListener('dragstart', (e) => e.preventDefault(), { capture: true });
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._hardBlackout('Right-Click Blocked', 400);
        }, { capture: true });
        window.addEventListener('beforeprint', () => {
            this._hardBlackout('Print Blocked', 2000);
        });

        // ── Layer 9: Window WIDTH resize (split-screen / recorder heuristic) ──
        // Only triggers on desktop WIDTH changes > 60px (not mobile keyboard = height only)
        let lastWidth = window.innerWidth;
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const newWidth = window.innerWidth;
                if (!this._isMobile && Math.abs(newWidth - lastWidth) > 60) {
                    this._hardBlackout('Window Resized — Possible Screen Recorder', 400);
                }
                lastWidth = newWidth;
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

    // ─── Layer 10: DevTools Detection ────────────────────────────────────────

    _protectConsole() {
        const noop = () => {};
        ['log','warn','error','info','debug','trace','table','dir'].forEach(m => {
            try { console[m] = noop; } catch (_) {}
        });
    }

    _startDevToolsDetection() {
        // Method 1: debugger timing — pauses > 80ms = debugger attached
        setInterval(() => {
            const t = Date.now();
            // eslint-disable-next-line no-debugger
            debugger;
            if (Date.now() - t > 80) {
                this._hardBlackout('Debugger Detected — Session Locked', 1000);
            }
        }, 1500);

        // Method 2: outer vs inner dimension gap (DevTools panel open)
        if (!this._isMobile) {
            setInterval(() => {
                const widthGap  = window.outerWidth  - window.innerWidth;
                const heightGap = window.outerHeight - window.innerHeight;
                if (widthGap > 200 || heightGap > 200) {
                    this._hardBlackout('Developer Tools Panel Detected', 600);
                }
            }, 2000);
        }
    }

    // ─── Legacy-compatible aliases ────────────────────────────────────────────

    activateStealthLock() { this._softBlackout(); }
    handleBreach(reason)  { this._hardBlackout(reason, 600); }
}

window.ScreenshotDetector = ScreenshotDetector;
