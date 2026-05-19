// content.js - Optimized Content Extraction + Floating Mini-Player for Read Aloud Extension

// Guard against duplicate injection (e.g. popup reopened, extension reloaded)
if (window.__readAloudContentScriptLoaded) {
    console.log("[ReadAloud] Content script already loaded, skipping re-injection.");
} else {
window.__readAloudContentScriptLoaded = true;

console.log("[ReadAloud] Content script loaded.");

let miniPlayer = null;
let miniPlayerVisible = false;
let currentSentenceText = "";

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
            ensureMiniPlayer();
        } else {
            hideMiniPlayer();
        }
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
                const div = document.createElement('div');
                div.innerHTML = article.content;
                const text = div.innerText.trim();
                if (text.length > 100) return text; // Use it if it seems substantial
            }
        } catch (e) {
            console.error("[ReadAloud] Readability parsing failed:", e);
        }
    }
    
    // 3. Fallback to basic innerText but try to be smart about common content areas
    const contentAreas = ['article', 'main', '.content', '.post', '#content', '#main'];
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

function ensureMiniPlayer() {
    if (miniPlayer) {
        miniPlayer.classList.remove('hidden');
        miniPlayerVisible = true;
        return;
    }

    const container = document.createElement('div');
    container.className = 'read-aloud-mini-player';
    container.id = 'readAloudMiniPlayer';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Read aloud mini player');

    container.innerHTML = `
        <button class="mini-btn mini-toggle" aria-label="Play or pause">
            <svg class="mini-icon-play" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <svg class="mini-icon-pause hidden" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
        </button>
        <div class="mini-sentence" aria-live="polite" aria-atomic="true"></div>
        <button class="mini-btn mini-next" aria-label="Next sentence">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 4 15 12 5 20 5 4"></polygon>
                <line x1="19" y1="5" x2="19" y2="19"></line>
            </svg>
        </button>
        <button class="mini-btn mini-stop" aria-label="Stop">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            </svg>
        </button>
        <button class="mini-close" aria-label="Close mini player">&times;</button>
    `;

    // Inject styles if not already present
    if (!document.getElementById('readAloudMiniPlayerStyles')) {
        const style = document.createElement('style');
        style.id = 'readAloudMiniPlayerStyles';
        style.textContent = `
            .read-aloud-mini-player {
                position: fixed;
                bottom: 32px;
                right: 32px;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                gap: 12px;
                background: rgba(30, 41, 59, 0.95);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 10px 16px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 0.85rem;
                color: #f1f5f9;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
                max-width: 320px;
                line-height: 1.4;
            }
            .read-aloud-mini-player.hidden {
                transform: translateY(30px) scale(0.95);
                opacity: 0;
                pointer-events: none;
            }
            .read-aloud-mini-player .mini-sentence {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: 500;
                max-width: 140px;
                color: #f1f5f9;
            }
            .read-aloud-mini-player .mini-btn {
                background: none;
                border: none;
                cursor: pointer;
                color: #10b981;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 6px;
                border-radius: 10px;
                transition: all 0.2s;
                opacity: 0.9;
            }
            .read-aloud-mini-player .mini-btn:hover:not(:disabled) {
                background: rgba(16, 185, 129, 0.15);
                color: #34d399;
                transform: translateY(-1px);
                opacity: 1;
            }
            .read-aloud-mini-player .mini-btn:disabled {
                color: #64748b;
                cursor: not-allowed;
                opacity: 0.4;
            }
            .read-aloud-mini-player .mini-btn.active {
                color: #34d399;
                filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.4));
            }
            .read-aloud-mini-player .mini-close {
                position: absolute;
                top: -6px;
                right: -6px;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: #475569;
                color: white;
                font-size: 16px;
                font-weight: bold;
                line-height: 1;
                text-align: center;
                cursor: pointer;
                border: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                transition: all 0.2s;
            }
            .read-aloud-mini-player .mini-close:hover {
                background: #ef4444;
                transform: scale(1.1);
            }
            .read-aloud-mini-player .hidden {
                display: none;
            }
            @media (prefers-reduced-motion: reduce) {
                .read-aloud-mini-player {
                    transition: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(container);
    miniPlayer = container;
    miniPlayerVisible = true;

    // Request current state now that miniPlayer is in the DOM,
    // so re-entrancy via updateMiniPlayer → ensureMiniPlayer is safe.
    safeSendMessage({ type: 'GET_STATE' }, (response) => {
        if (response && response.state) {
            updateMiniPlayer(response.state);
        }
    });

    // Event listeners
    container.querySelector('.mini-toggle').addEventListener('click', () => {
        safeSendMessage({ type: 'TOGGLE_PLAY' });
    });
    container.querySelector('.mini-next').addEventListener('click', () => {
        safeSendMessage({ type: 'NEXT' });
    });
    container.querySelector('.mini-stop').addEventListener('click', () => {
        safeSendMessage({ type: 'STOP' });
        hideMiniPlayer();
    });
    container.querySelector('.mini-close').addEventListener('click', () => {
        hideMiniPlayer();
    });
}

function hideMiniPlayer() {
    if (miniPlayer) {
        miniPlayer.classList.add('hidden');
        miniPlayerVisible = false;
    }
}

function updateMiniPlayer(state) {
    if (!state) return;

    const isPlaying = state.isPlaying && !state.isPaused;
    const hasContent = state.sentences && state.sentences.length > 0;

    if (!hasContent) {
        hideMiniPlayer();
        return;
    }

    // Show mini-player when playing or paused with content
    ensureMiniPlayer();

    const sentence = state.sentences[state.currentIndex] || '';
    const sentenceEl = miniPlayer.querySelector('.mini-sentence');
    if (sentenceEl && sentence !== currentSentenceText) {
        sentenceEl.textContent = sentence;
        currentSentenceText = sentence;
    }

    // Toggle play/pause icon and active state
    const toggleBtn = miniPlayer.querySelector('.mini-toggle');
    const playIcon = miniPlayer.querySelector('.mini-icon-play');
    const pauseIcon = miniPlayer.querySelector('.mini-icon-pause');
    
    if (isPlaying) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        toggleBtn.classList.add('active');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        toggleBtn.classList.remove('active');
    }

    // Handle next button disabled state
    const nextBtn = miniPlayer.querySelector('.mini-next');
    if (nextBtn) {
        nextBtn.disabled = state.currentIndex >= (state.totalSentences - 1);
    }
}

} // end guard: window.__readAloudContentScriptLoaded
