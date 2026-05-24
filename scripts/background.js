// background.js - Orchestrator for Speak Aloud Extension

let offscreenCreating = null;
let offscreenClosePromise = null;
let offscreenClosing = false;
const OFFSCREEN_DOCUMENT_PATH = chrome.runtime.getURL('ui/offscreen.html');

/**
 * Checks if the offscreen document is already created.
 * Uses chrome.runtime.getContexts (Chrome 116+) or self.clients.matchAll() as a fallback (Chrome 109-115).
 */
async function hasOffscreenDocument() {
    if (chrome.runtime.getContexts) {
        try {
            const existingContexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [OFFSCREEN_DOCUMENT_PATH]
            });
            return existingContexts.length > 0;
        } catch (e) {
            console.warn("Background: getContexts failed:", e);
        }
    }
    // Fallback for Chrome 109-115 using Service Worker clients
    try {
        const clients = await self.clients.matchAll();
        return clients.some(client => client.url === OFFSCREEN_DOCUMENT_PATH);
    } catch (e) {
        console.warn("Background: self.clients.matchAll failed:", e);
        return false;
    }
}

/**
 * Pings the offscreen document to ensure its scripts are loaded and message listeners active.
 * Retries with backoff if a temporary connection error occurs.
 */
async function pingOffscreen() {
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'PING', _forwarded: true }, (res) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(res);
                    }
                });
            });
            if (response && response.status === 'pong') {
                console.log("Background: Offscreen ready (PING successful)");
                return true;
            }
        } catch (err) {
            console.debug(`Background: Ping attempt ${i + 1} failed, retrying:`, err.message);
            if (i === maxAttempts - 1) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    throw new Error("Background: Offscreen document ping timed out");
}

/**
 * Ensures the offscreen document is created and ready to receive messages.
 */
async function ensureOffscreen() {
    if (offscreenClosing) {
        await offscreenClosePromise;
    }
    
    if (offscreenCreating) return offscreenCreating;

    const hasDoc = await hasOffscreenDocument();
    if (hasDoc) return Promise.resolve();

    offscreenCreating = (async () => {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Text-to-Speech playback',
            });
            // Guarantee that the offscreen scripts are loaded and listeners are active
            await pingOffscreen();
        } catch (e) {
            console.error("Background: Error creating offscreen document:", e);
            throw e;
        } finally {
            offscreenCreating = null;
        }
    })();

    return offscreenCreating;
}

async function closeOffscreen() {
    if (offscreenClosing) return;
    offscreenClosing = true;
    offscreenClosePromise = (async () => {
        try {
            const hasDoc = await hasOffscreenDocument();
            if (hasDoc) {
                await chrome.offscreen.closeDocument();
            }
        } catch (e) {
            console.warn("Failed to close offscreen:", e);
        } finally {
            offscreenClosing = false;
            offscreenClosePromise = null;
        }
    })();
    return offscreenClosePromise;
}

// Proxy messages to offscreen
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Security: Validate sender origin if present
    if (sender.id && sender.id !== chrome.runtime.id) {
        console.warn("Unauthorized message origin:", sender.id);
        return;
    }

    // Internal background commands
    if (msg.type === 'ENSURE_OFFSCREEN') {
        ensureOffscreen()
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error', message: err.message }));
        return true;
    }

    if (msg.type === 'UPDATE_UI' && msg.state) {
        const { sentences, currentIndex, isPlaying, isPaused, tabId } = msg.state;
        if (sentences && sentences.length > 0 && (isPlaying || isPaused)) {
            const progress = Math.round(((currentIndex + 1) / sentences.length) * 100);
            chrome.action.setBadgeText({ text: `${progress}%` });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // Green progress
        } else {
            chrome.action.setBadgeText({ text: '' });
        }

        // Forward state update to the specific tab content script for mini-player sync
        if (tabId) {
            chrome.tabs.sendMessage(tabId, msg, () => {
                if (chrome.runtime.lastError) {
                    // Ignore errors if the tab was closed or content script is not listening yet
                }
            });
        }
        return false;
    }

    if (msg.type === 'STOP_COMPLETE') {
        chrome.action.setBadgeText({ text: '' });
        return false;
    }

    // Forward player commands to offscreen
    if (msg.type && (msg.type === 'PLAY' || msg.type === 'PAUSE' || msg.type === 'STOP' || msg.type === 'TOGGLE_PLAY' || msg.type === 'NEXT' || msg.type === 'PREV' || msg.type === 'NEXT_PARA' || msg.type === 'PREV_PARA' || msg.type === 'JUMP' || msg.type === 'INIT' || msg.type === 'UPDATE_SETTINGS' || msg.type === 'TEST' || msg.type === 'GET_STATE' || msg.type === 'DETECT_LANG' || msg.type === 'PING')) {
        if (msg._forwarded) return; // Prevent infinite recursion

        console.log("Background: Forwarding command to offscreen:", msg.type);
        ensureOffscreen().then(() => {
            const expectsResponse = ['GET_STATE', 'DETECT_LANG', 'INIT', 'PING'].includes(msg.type);

            if (expectsResponse) {
                chrome.runtime.sendMessage({ ...msg, _forwarded: true }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Proxy error:", chrome.runtime.lastError.message);
                        sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                    } else {
                        sendResponse(response);
                    }
                });
            } else {
                chrome.runtime.sendMessage({ ...msg, _forwarded: true });
                sendResponse({ status: 'ok' });
            }

            if (msg.type === 'STOP') {
                // Wait for STOP_COMPLETE from offscreen (savePosition done),
                // with a safety timeout so we never leave the doc open forever.
                const safetyTimeout = setTimeout(closeOffscreen, 5000);
                const onComplete = (completeMsg) => {
                    if (completeMsg && completeMsg.type === 'STOP_COMPLETE') {
                        chrome.runtime.onMessage.removeListener(onComplete);
                        clearTimeout(safetyTimeout);
                        closeOffscreen();
                    }
                };
                chrome.runtime.onMessage.addListener(onComplete);
            }
        }).catch(err => {
            console.error("Background: Failed to ensure offscreen:", err);
            sendResponse({ status: 'error', message: err.message });
        });
        return true;
    }
});

// Listen for keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
    try {
        await ensureOffscreen();
        const msgMap = {
            'play_stop': 'TOGGLE_PLAY',
            'pause_resume': 'PAUSE',
            'forward': 'NEXT',
            'rewind': 'PREV',
            'next_paragraph': 'NEXT_PARA',
            'prev_paragraph': 'PREV_PARA'
        };
        if (msgMap[command]) {
            chrome.runtime.sendMessage({ type: msgMap[command], _forwarded: true });
        }
    } catch (e) {
        console.error("Keyboard command failed:", e);
    }
});

// Clean up offscreen when extension is suspended or updated
chrome.runtime.onSuspend.addListener(closeOffscreen);
