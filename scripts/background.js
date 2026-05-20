// background.js - Orchestrator for Speak Aloud Extension

let offscreenCreating = null;
let offscreenClosePromise = null;
let offscreenClosing = false;
const OFFSCREEN_DOCUMENT_PATH = chrome.runtime.getURL('ui/offscreen.html');

/**
 * Ensures the offscreen document is created and ready to receive messages.
 */
async function ensureOffscreen() {
    if (offscreenClosing) {
        await offscreenClosePromise;
    }
    
    if (offscreenCreating) return offscreenCreating;

    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [OFFSCREEN_DOCUMENT_PATH]
    });

    if (existingContexts.length > 0) return Promise.resolve();

    offscreenCreating = (async () => {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Text-to-Speech playback',
            });
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
            const existingContexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [OFFSCREEN_DOCUMENT_PATH]
            });
            if (existingContexts.length > 0) {
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

    // Forward player commands to offscreen
    if (msg.type && (msg.type === 'PLAY' || msg.type === 'PAUSE' || msg.type === 'STOP' || msg.type === 'TOGGLE_PLAY' || msg.type === 'NEXT' || msg.type === 'PREV' || msg.type === 'NEXT_PARA' || msg.type === 'PREV_PARA' || msg.type === 'JUMP' || msg.type === 'INIT' || msg.type === 'UPDATE_SETTINGS' || msg.type === 'TEST' || msg.type === 'GET_STATE' || msg.type === 'DETECT_LANG')) {
        if (msg._forwarded) return; // Prevent infinite recursion

        console.log("Background: Forwarding command to offscreen:", msg.type);
        ensureOffscreen().then(() => {
            const expectsResponse = ['GET_STATE', 'DETECT_LANG', 'INIT'].includes(msg.type);

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
