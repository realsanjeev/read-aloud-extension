// content.js - Optimized Content Extraction + Floating Mini-Player for Read Aloud Extension

// Guard against duplicate injection (e.g. popup reopened, extension reloaded)
if (window.__readAloudContentScriptLoaded) {
    console.log("[ReadAloud] Content script already loaded, skipping re-injection.");
} else {
window.__readAloudContentScriptLoaded = true;

console.log("[ReadAloud] Content script loaded.");

let shadowHost = null;
let shadowRoot = null;
let miniPlayer = null;
let playerSentences = [];
let playerLineBreaks = [];
let currentSentenceText = "";
let lastKnownIndex = 0;
let wasEverActive = false;
let closedByUser = false;
let playerEnabled = false;
let currentSettings = { rate: 1.0, pitch: 1.0, volume: 1.0 };

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

/**
 * Safely send a message to the extension runtime.
 * Catches "Extension context invalidated" errors that occur after extension reload.
 */
function safeSendMessage(message, callback) {
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("[ReadAloud] Runtime error:", chrome.runtime.lastError.message);
                return;
            }
            if (callback) callback(response);
        });
    } catch (e) {
        console.warn("[ReadAloud] Extension context invalidated. Please reload the page.");
    }
}

// Listen for messages from the popup / background / offscreen
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EXTRACT_CONTENT') {
        try {
            const content = extractContentFromPage();
            sendResponse({ result: content });
        } catch (err) {
            console.error("[ReadAloud] Extraction failed:", err);
            sendResponse({ error: err.message });
        }
        return true;
    }

    if (msg.type === 'UPDATE_UI') {
        const state = msg.state;
        if (state) {
            updateMiniPlayer(state);
        }
        return;
    }

    if (msg.type === 'TOGGLE_MINI_PLAYER') {
        if (msg.visible) {
            closedByUser = false;
            playerEnabled = true;
            ensureMiniPlayer();
        } else {
            playerEnabled = false;
            hideMiniPlayer();
        }
        safeSendMessage({ type: 'GET_STATE' }, (response) => {
            if (response && response.state) {
                updateMiniPlayer(response.state);
            }
        });
        return;
    }
});

function extractContentFromPage() {
    // 1. Check for user selection first (highest priority)
    const selection = window.getSelection().toString().trim();
    if (selection.length > 0) return selection;

    // 2. Use Readability.js if available
    if (typeof Readability !== 'undefined') {
        try {
            const documentClone = document.cloneNode(true);
            const reader = new Readability(documentClone);
            const article = reader.parse();
            
            if (article && article.content) {
                const doc = new DOMParser().parseFromString(article.content, 'text/html');
                const text = (doc.body.textContent || doc.body.innerText || '').trim();
                if (text.length > 100) return text;
            }
        } catch (e) {
            console.error("[ReadAloud] Readability parsing failed:", e);
        }
    }
    
    // 3. Fallback to basic innerText but try to be smart about common content areas
    const contentAreas = [
        'article', 'main', '.content', '.post', '#content', '#main',
        '.txtnav', '.mybox', '.container',
        '.chapter-content', '#chaptercontent', '.read-content', '.book-content'
    ];
    for (const selector of contentAreas) {
        const el = document.querySelector(selector);
        if (el) {
            const text = el.innerText.trim();
            if (text.length > 200) return text;
        }
    }

    return document.body.innerText.trim();
}

// --- Floating Mini-Player ---

function cycleSpeed(current, direction) {
    const idx = SPEEDS.indexOf(current);
    if (idx === -1) return SPEEDS[Math.floor(SPEEDS.length / 2)];
    const next = idx + direction;
    if (next < 0) return SPEEDS[0];
    if (next >= SPEEDS.length) return SPEEDS[SPEEDS.length - 1];
    return SPEEDS[next];
}

function updateSpeedDisplay() {
    if (!miniPlayer) return;
    const display = miniPlayer.querySelector('.mini-speed-display');
    if (display) display.textContent = currentSettings.rate.toFixed(1) + 'x';
}

function ensureMiniPlayer() {
    if (miniPlayer) {
        if (closedByUser) return;
        miniPlayer.classList.remove('is-hidden');
        return;
    }

    // 1. Create Shadow Host
    shadowHost = document.createElement('div');
    shadowHost.id = 'read-aloud-mini-player-host';
    shadowHost.style.cssText = 'all: initial; position: fixed; bottom: 0; right: 0; z-index: 2147483647;';
    
    // 2. Attach Shadow Root
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    // 3. Create Container inside Shadow DOM
    const container = document.createElement('div');
    container.className = 'read-aloud-mini-player';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Read aloud mini player');

    container.innerHTML = `
        <div class="mini-progress-container">
            <div class="mini-progress-bar"></div>
            <span class="mini-progress-text"></span>
        </div>
        <div class="mini-body">
            <div class="mini-controls">
                <button class="mini-btn mini-prev" aria-label="Previous sentence">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="19 20 9 12 19 4 19 20"></polygon>
                        <line x1="5" y1="19" x2="5" y2="5"></line>
                    </svg>
                </button>
                <button class="mini-btn mini-toggle" aria-label="Play or pause">
                    <svg class="mini-icon-play" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <svg class="mini-icon-pause hidden" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                </button>
                <button class="mini-btn mini-next" aria-label="Next sentence">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 4 15 12 5 20 5 4"></polygon>
                        <line x1="19" y1="5" x2="19" y2="19"></line>
                    </svg>
                </button>
                <button class="mini-btn mini-stop" aria-label="Stop">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                    </svg>
                </button>
            </div>
            <div class="mini-sentence" aria-live="polite" aria-atomic="true"></div>
            <div class="mini-speed">
                <button class="mini-btn mini-speed-down" aria-label="Decrease speed">−</button>
                <span class="mini-speed-display">1.0x</span>
                <button class="mini-btn mini-speed-up" aria-label="Increase speed">+</button>
            </div>
            <button class="mini-close" aria-label="Close mini player">&times;</button>
        </div>
    `;

    // 4. Inject Isolated Styles
    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial;
            pointer-events: none;
        }
        .read-aloud-mini-player {
            pointer-events: auto;
            position: fixed;
            bottom: 32px;
            right: 32px;
            background: rgba(30, 41, 59, 0.95);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 10px 16px 12px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            color: #f1f5f9;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
            max-width: 380px;
            min-width: 280px;
            line-height: 1.4;
            box-sizing: border-box;
            z-index: 2147483647;
        }
        .read-aloud-mini-player * {
            box-sizing: border-box;
        }
        .read-aloud-mini-player.is-hidden {
            transform: translateY(30px) scale(0.95);
            opacity: 0;
            pointer-events: none;
        }
        .mini-progress-container {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .mini-progress-bar {
            flex: 1;
            height: 3px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 100px;
            overflow: hidden;
        }
        .mini-progress-bar::after {
            content: '';
            display: block;
            height: 100%;
            width: var(--mini-progress, 0%);
            background: linear-gradient(135deg, #10b981, #0891b2);
            border-radius: 100px;
            transition: width 0.3s ease;
        }
        .mini-progress-text {
            font-size: 10px;
            color: #94a3b8;
            min-width: 32px;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        .mini-body {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mini-controls {
            display: flex;
            align-items: center;
            gap: 2px;
        }
        .mini-sentence {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 500;
            max-width: 120px;
            color: #f1f5f9;
            font-size: 13px;
        }
        .mini-speed {
            display: flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
        }
        .mini-speed-display {
            font-size: 11px;
            color: #94a3b8;
            font-variant-numeric: tabular-nums;
            min-width: 32px;
            text-align: center;
        }
        .mini-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 5px;
            border-radius: 8px;
            transition: all 0.2s;
            opacity: 0.85;
            flex-shrink: 0;
        }
        .mini-btn:hover:not(:disabled) {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            opacity: 1;
        }
        .mini-btn:disabled {
            color: #64748b;
            cursor: not-allowed;
            opacity: 0.4;
        }
        .mini-btn.active {
            color: #34d399;
            filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.4));
        }
        .mini-speed-down, .mini-speed-up {
            padding: 2px 4px;
            font-size: 14px;
            font-weight: 700;
            color: #94a3b8;
            line-height: 1;
        }
        .mini-speed-down:hover:not(:disabled), .mini-speed-up:hover:not(:disabled) {
            color: #10b981;
            background: rgba(16, 185, 129, 0.15);
        }
        .mini-close {
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #475569;
            color: white;
            font-size: 14px;
            font-weight: bold;
            line-height: 1;
            text-align: center;
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: all 0.2s;
            margin-left: 2px;
        }
        .mini-close:hover {
            background: #ef4444;
            transform: scale(1.1);
        }
        .hidden {
            display: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
            .read-aloud-mini-player {
                transition: none;
            }
            .mini-progress-bar::after {
                transition: none;
            }
        }
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(container);
    document.body.appendChild(shadowHost);
    
    miniPlayer = container;

    // --- Dragging Logic ---
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    // Restore position if saved
    chrome.storage.local.get(['miniPlayerPos'], (result) => {
        if (result.miniPlayerPos) {
            const { left, top } = result.miniPlayerPos;
            container.style.bottom = 'auto';
            container.style.right = 'auto';
            container.style.left = left;
            container.style.top = top;
        }
    });

    const startDrag = (e) => {
        // Prevent dragging if clicking a button or progress bar
        if (e.target.closest && (e.target.closest('button') || e.target.closest('.mini-progress-container'))) {
            return;
        }
        
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        isDragging = true;
        dragStartX = clientX;
        dragStartY = clientY;
        
        const rect = container.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        // Remove bottom/right constraints so left/top take over seamlessly
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.left = `${initialLeft}px`;
        container.style.top = `${initialTop}px`;
        container.style.transition = 'none'; // Disable transition for instant drag
    };

    const doDrag = (e) => {
        if (!isDragging) return;
        if (e.type === 'touchmove') {
            e.preventDefault(); // Prevent scrolling while dragging
        }
        
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        const deltaX = clientX - dragStartX;
        const deltaY = clientY - dragStartY;
        
        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;
        
        // Keep inside viewport bounds
        const rect = container.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;
        
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));
        
        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
    };

    const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        container.style.transition = ''; // Restore transition
        
        // Save new position
        chrome.storage.local.set({
            miniPlayerPos: {
                left: container.style.left,
                top: container.style.top
            }
        });
    };

    container.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);

    container.addEventListener('touchstart', startDrag, { passive: false });
    window.addEventListener('touchmove', doDrag, { passive: false });
    window.addEventListener('touchend', stopDrag);
    // --- End Dragging Logic ---

    // Request current state
    safeSendMessage({ type: 'GET_STATE' }, (response) => {
        if (response && response.state) {
            updateMiniPlayer(response.state);
        }
    });

    // Event listeners inside Shadow Root
    container.querySelector('.mini-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'TOGGLE_PLAY' });
    });
    container.querySelector('.mini-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'PREV' });
    });
    container.querySelector('.mini-next').addEventListener('click', (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'NEXT' });
    });
    container.querySelector('.mini-stop').addEventListener('click', (e) => {
        e.stopPropagation();
        safeSendMessage({ type: 'STOP' });
    });
    container.querySelector('.mini-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closedByUser = true;
        safeSendMessage({ type: 'STOP' });
        hideMiniPlayer();
    });
    container.querySelector('.mini-speed-down').addEventListener('click', (e) => {
        e.stopPropagation();
        const newRate = cycleSpeed(currentSettings.rate, -1);
        if (newRate !== currentSettings.rate) {
            currentSettings.rate = newRate;
            updateSpeedDisplay();
            safeSendMessage({ type: 'UPDATE_SETTINGS', settings: { rate: newRate } });
        }
    });
    container.querySelector('.mini-speed-up').addEventListener('click', (e) => {
        e.stopPropagation();
        const newRate = cycleSpeed(currentSettings.rate, 1);
        if (newRate !== currentSettings.rate) {
            currentSettings.rate = newRate;
            updateSpeedDisplay();
            safeSendMessage({ type: 'UPDATE_SETTINGS', settings: { rate: newRate } });
        }
    });
}

function hideMiniPlayer() {
    if (miniPlayer && !miniPlayer.classList.contains('is-hidden')) {
        miniPlayer.classList.add('is-hidden');
    }
}

function updateMiniPlayer(state) {
    if (!state) return;

    if (state.sentences && state.sentences.length > 0) {
        playerSentences = state.sentences;
    }
    if (state.lineBreaks) {
        playerLineBreaks = state.lineBreaks;
    }
    if (state.settings) {
        currentSettings = { ...currentSettings, ...state.settings };
        updateSpeedDisplay();
    }

    const hasContent = playerSentences.length > 0;
    const isActive = state.isPlaying || state.isPaused;

    if (!hasContent) return;
    if (closedByUser) return;
    if (!playerEnabled) return;

    if (isActive) {
        wasEverActive = true;
        lastKnownIndex = state.currentIndex;
    }

    ensureMiniPlayer();

    const displayIndex = isActive ? state.currentIndex : (wasEverActive ? lastKnownIndex : state.currentIndex);
    const sentence = playerSentences[displayIndex] || '';
    const totalSentences = state.totalSentences || playerSentences.length;

    // Update sentence text
    const sentenceEl = miniPlayer.querySelector('.mini-sentence');
    if (sentenceEl && sentence !== currentSentenceText) {
        sentenceEl.textContent = sentence;
        sentenceEl.title = sentence;
        currentSentenceText = sentence;
    }

    // Update progress bar
    const progressBar = miniPlayer.querySelector('.mini-progress-bar');
    const progressText = miniPlayer.querySelector('.mini-progress-text');
    if (progressBar && totalSentences > 0) {
        const pct = Math.min(((displayIndex + 1) / totalSentences) * 100, 100);
        progressBar.style.setProperty('--mini-progress', pct + '%');
    }
    if (progressText && totalSentences > 0) {
        progressText.textContent = `${displayIndex + 1}/${totalSentences}`;
    }

    // Update play/pause icon
    const toggleBtn = miniPlayer.querySelector('.mini-toggle');
    const playIcon = miniPlayer.querySelector('.mini-icon-play');
    const pauseIcon = miniPlayer.querySelector('.mini-icon-pause');

    if (state.isPlaying && !state.isPaused) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        toggleBtn.classList.add('active');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        toggleBtn.classList.remove('active');
    }

    // Update prev/next buttons
    const prevBtn = miniPlayer.querySelector('.mini-prev');
    const nextBtn = miniPlayer.querySelector('.mini-next');
    if (prevBtn) prevBtn.disabled = displayIndex <= 0;
    if (nextBtn) nextBtn.disabled = displayIndex >= (playerSentences.length - 1);

    // Update speed display
    updateSpeedDisplay();
}

} // end guard: window.__readAloudContentScriptLoaded

// Explicit undefined return so Firefox scripting.executeScript can
// serialize the result (non-structured-clonable values cause an error).
void 0;