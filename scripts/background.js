// background.js - Orchestrator for Speak Aloud Extension

let offscreenCreating = null;
let offscreenClosePromise = null;
let offscreenClosing = false;
const OFFSCREEN_DOCUMENT_PATH = chrome.runtime.getURL('ui/offscreen.html');

// Firefox fallback state
const isFirefoxBackgroundPage = typeof chrome.offscreen === 'undefined' && typeof document !== 'undefined';
const pendingCallbacks = new Map();
let messageIdCounter = 0;

// Register message listener once for Firefox iframe responses
if (isFirefoxBackgroundPage) {
    window.addEventListener('message', (event) => {
        if (event.data && event.data.responseTo) {
            const callback = pendingCallbacks.get(event.data.responseTo);
            if (callback) {
                pendingCallbacks.delete(event.data.responseTo);
                const _ = chrome.runtime.lastError; // suppress stale lastError from prior chrome.* calls
                callback(event.data.response);
            }
        }
    });
}

function sendToOffscreen(msg, callback) {
    if (isFirefoxBackgroundPage) {
        const iframe = document.getElementById('firefox-offscreen-iframe');
        if (iframe && iframe.contentWindow) {
            const msgId = ++messageIdCounter;
            msg._messageId = msgId;
            if (callback) {
                pendingCallbacks.set(msgId, (response) => {
                    const _ = chrome.runtime.lastError; // suppress stale lastError from prior chrome.* calls
                    callback(response);
                });
            }
            iframe.contentWindow.postMessage(msg, '*');
        } else if (callback) {
            callback({ status: 'error', message: 'Offscreen iframe not found' });
        }
    } else {
        if (callback) {
            chrome.runtime.sendMessage(msg, callback);
        } else {
            chrome.runtime.sendMessage(msg);
        }
    }
}

// --- Context Menu ---
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'read-aloud',
        title: 'Read Aloud',
        contexts: ['page', 'selection']
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'read-aloud') return;
    if (!tab || !tab.id || !tab.url) return;

    const blocked = /^(chrome|about|chrome-extension|moz-extension):/.test(tab.url);
    if (blocked) return;

    try {
        await ensureOffscreen();

        // Inject files sequentially for Firefox compatibility
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['lib/Readability.js']
        });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['scripts/content.js']
        });

        const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (res) => {
                if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
                else resolve(res);
            });
        });

        const text = response ? response.result : null;
        if (!text) return;

        // Load settings
        const data = await chrome.storage.sync.get([
            'voiceName', 'rate', 'pitch', 'volume', 'highlightMode', 'miniPlayer'
        ]);

        const settings = {
            voiceName: data.voiceName || null,
            rate: parseFloat(data.rate) || 1.0,
            pitch: parseFloat(data.pitch) || 1.0,
            volume: parseFloat(data.volume) || 1.0,
            highlightMode: data.highlightMode || 'sentence'
        };

        await new Promise((resolve) => {
            sendToOffscreen({
                type: 'INIT',
                _forwarded: true,
                text,
                index: 0,
                settings,
                tabId: tab.id,
                tabUrl: tab.url,
                autoPlay: true
            }, (res) => resolve(res));
        });

        // Show mini-player
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true });
        } catch (e) {
            // Content script not available
        }
    } catch (e) {
        console.error("Context menu Read Aloud failed:", e);
    }
});

/**
 * Checks if the offscreen document is already created.
 * Uses chrome.runtime.getContexts (Chrome 116+) or self.clients.matchAll() as a fallback (Chrome 109-115).
 */
async function hasOffscreenDocument() {
    if (isFirefoxBackgroundPage) {
        return !!document.getElementById('firefox-offscreen-iframe');
    }

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
            if (isFirefoxBackgroundPage) {
                const iframe = document.createElement('iframe');
                iframe.id = 'firefox-offscreen-iframe';
                iframe.src = OFFSCREEN_DOCUMENT_PATH;
                document.body.appendChild(iframe);
                await new Promise(resolve => {
                    iframe.onload = resolve;
                });
            } else if (chrome['offscreen'] && typeof chrome['offscreen']['createDocument'] === 'function') {
                await chrome['offscreen']['createDocument']({
                    url: OFFSCREEN_DOCUMENT_PATH,
                    reasons: ['AUDIO_PLAYBACK'],
                    justification: 'Text-to-Speech playback',
                });
            }
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
                if (isFirefoxBackgroundPage) {
                    const iframe = document.getElementById('firefox-offscreen-iframe');
                    if (iframe) iframe.remove();
                    pendingCallbacks.clear();
                } else if (chrome['offscreen'] && typeof chrome['offscreen']['closeDocument'] === 'function') {
                    await chrome['offscreen']['closeDocument']();
                }
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


    if (msg.type === 'FETCH_PDF' && msg.url) {
        const origin = new URL(msg.url).origin + '/*';
        chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
            const doFetch = () => {
                fetch(msg.url)
                    .then(async (response) => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const buffer = await response.arrayBuffer();
                        sendResponse({ status: 'success', data: new Uint8Array(buffer) });
                    })
                    .catch((err) => {
                        console.error("Background: FETCH_PDF failed:", err);
                        sendResponse({ status: 'error', message: err.message });
                    });
            };

            if (hasPermission) {
                doFetch();
            } else {
                chrome.permissions.request({ origins: [origin] }, (granted) => {
                    if (granted) {
                        doFetch();
                    } else {
                        sendResponse({ status: 'error', message: 'Host permission denied. Please allow access to this site to load the PDF.' });
                    }
                });
            }
        });
        return true; // Keep channel open for async response
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

    // Forward player commands to offscreen
    if (msg.type && (msg.type === 'PAUSE' || msg.type === 'STOP' || msg.type === 'TOGGLE_PLAY' || msg.type === 'NEXT' || msg.type === 'PREV' || msg.type === 'NEXT_PARA' || msg.type === 'PREV_PARA' || msg.type === 'JUMP' || msg.type === 'INIT' || msg.type === 'UPDATE_SETTINGS' || msg.type === 'TEST' || msg.type === 'GET_STATE')) {
        if (msg._forwarded) return; // Prevent infinite recursion

        console.log("Background: Forwarding command to offscreen:", msg.type);
        ensureOffscreen().then(() => {
            const expectsResponse = ['GET_STATE', 'INIT', 'STOP'].includes(msg.type);

            if (expectsResponse) {
                sendToOffscreen({ ...msg, _forwarded: true }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Proxy error:", chrome.runtime.lastError.message);
                        sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                    } else {
                        sendResponse(response);
                    }
                    if (msg.type === 'STOP') {
                        closeOffscreen();
                    }
                });
            } else {
                sendToOffscreen({ ...msg, _forwarded: true });
                sendResponse({ status: 'ok' });
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
            sendToOffscreen({ type: msgMap[command], _forwarded: true });
        }
    } catch (e) {
        console.error("Keyboard command failed:", e);
    }
});

// Clean up offscreen when extension is suspended or updated
chrome.runtime.onSuspend.addListener(closeOffscreen);
