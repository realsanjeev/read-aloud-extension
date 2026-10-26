// offscreen.js - Text-to-Speech Engine

let playerState = {
    sentences: [],
    lineBreaks: [],
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,
    tabId: null,
    tabUrl: null,  // stored at INIT so savePosition() doesn't need chrome.tabs (unavailable in offscreen)
    settings: {
        voiceName: null,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        highlightMode: 'sentence', // 'sentence' | 'word'
    },
    utterance: null
};

let errorRetryCount = 0;
let speakTimer = null; // pending deferred speak (Firefox gaps, error retries); cleared by cancelSpeech()

// Firefox detection: in Firefox the offscreen page runs as an iframe inside
// the background page (window.parent !== window). On Chrome it's standalone.
const isFirefox = (window.parent !== window);

// Firefox-specific timing constants (ms)
const FIREFOX_POST_CANCEL_DELAY = 50;     // delay after cancel() before speak()
const FIREFOX_INTER_UTTERANCE_DELAY = 80;  // gap between consecutive sentences
const FIREFOX_ERROR_RETRY_DELAY = 350;     // retry delay after TTS error

// getVoices() is empty until the engine has loaded; wait once for voiceschanged
// (capped, since some engines never fire it) so the selected voice is applied.
let voicesLoaded = false;
const voicesReady = new Promise((resolve) => {
    if (window.speechSynthesis.getVoices().length > 0) return resolve();
    window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });
    setTimeout(resolve, 3000);
}).then(() => { voicesLoaded = true; });

function findVoice(name) {
    return window.speechSynthesis.getVoices().find(v => v.name === name);
}

function speakLater(delay) {
    clearTimeout(speakTimer);
    speakTimer = setTimeout(speakCurrentSentence, delay);
}

/**
 * Safely cancels any active SpeechSynthesis utterance and any pending deferred speak.
 * Clears callbacks to prevent recursive event firing during cancellation.
 */
function cancelSpeech() {
    clearTimeout(speakTimer);
    if (playerState.utterance) {
        playerState.utterance.onstart = null;
        playerState.utterance.onend = null;
        playerState.utterance.onerror = null;
        playerState.utterance.onboundary = null;
    }
    window.speechSynthesis.cancel();
}

// Settings are initialized via INIT and UPDATE_SETTINGS messages from the popup

function handleMessage(msg, sender, sendResponse) {
    // Ignore direct broadcasts from the popup; only accept commands proxied by the background service worker
    if (!msg._forwarded) return;

    switch (msg.type) {

        case 'INIT':
            console.log("Offscreen: INIT received, text length:", msg.text ? msg.text.length : 0);
            initPlayer(msg.text, msg.index || 0, msg.settings, msg.autoPlay || false, msg.tabId, msg.tabUrl || null);
            sendResponse({ status: 'ok' });
            break;
        case 'TOGGLE_PLAY':
            togglePlay();
            sendResponse({ status: 'ok' });
            break;
        case 'PAUSE':
            togglePause();
            sendResponse({ status: 'ok' });
            break;
        case 'STOP':
            stop().then(() => sendResponse({ status: 'ok' }));
            return true;
        case 'NEXT':
            next();
            sendResponse({ status: 'ok' });
            break;
        case 'PREV':
            prev();
            sendResponse({ status: 'ok' });
            break;
        case 'NEXT_PARA':
            nextParagraph();
            sendResponse({ status: 'ok' });
            break;
        case 'PREV_PARA':
            prevParagraph();
            sendResponse({ status: 'ok' });
            break;
        case 'JUMP':
            if (playerState.sentences.length === 0) {
                console.warn("Offscreen: JUMP ignored — no sentences loaded.");
                sendResponse({ status: 'ok' });
                break;
            }
            initPlayer(null, msg.index, null, true);
            sendResponse({ status: 'ok' });
            break;
        case 'UPDATE_SETTINGS':
            updateSettings(msg.settings);
            sendResponse({ status: 'ok' });
            break;
        case 'TEST':
            testVoice(msg);
            sendResponse({ status: 'ok' });
            break;
        case 'STOP_IF_TAB':
            if (playerState.tabId && playerState.tabId === msg.tabId) {
                stop().then(() => {
                    playerState.tabId = null;
                    playerState.tabUrl = null;
                    playerState.sentences = [];
                    sendUpdate(null, { fullPayload: true });
                    sendResponse({ status: 'ok' });
                });
                return true;
            }
            sendResponse({ status: 'ignored' });
            break;
        case 'GET_STATE':
            sendUpdate(sendResponse);
            return true;
    }
}

chrome.runtime.onMessage.addListener(handleMessage);

// Firefox compatibility: listen to window messages from the parent background script
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type) {
        const sendResponse = (response) => {
            if (msg._messageId) {
                window.parent.postMessage({
                    responseTo: msg._messageId,
                    response: response
                }, '*');
            }
        };
        handleMessage(msg, {}, sendResponse);
    }
});

/**
 * Smart sentence tokenizer that handles abbreviations, decimals, and ellipsis.
 */
function tokenizeSentences(text) {
    if (!text || text.length === 0) return { sentences: [], lineBreaks: [] };

    let segmenter = null;
    try {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
        }
    } catch (e) {
        console.warn("Intl.Segmenter not supported or failed to initialize, using regex fallback:", e);
    }

    const sentences = [];
    const lineBreaks = [];
    const lines = text.split(/\n+/);

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) return;

        if (sentences.length > 0) {
            lineBreaks.push(sentences.length);
        }

        if (segmenter) {
            for (const segment of segmenter.segment(trimmedLine)) {
                const s = segment.segment.trim();
                if (s.length > 0) {
                    sentences.push(s);
                }
            }
        } else {
            // Regex fallback for older browsers (Firefox < 125)
            // Splitting by typical sentence boundaries (. ! ?) followed by whitespace
            const segments = trimmedLine.split(/(?<=[.!?])\s+/);
            segments.forEach(segment => {
                const s = segment.trim();
                if (s.length > 0) {
                    sentences.push(s);
                }
            });
        }
    });

    return { sentences, lineBreaks };
}

/**
 * Initializes the player with new text.
 */
function initPlayer(text, startIndex, settings = null, autoPlay = false, tabId = null, tabUrl = null) {
    cancelSpeech();

    if (text) {
        playerState.tabId = tabId;
        playerState.tabUrl = tabUrl;
        const tokenized = tokenizeSentences(text);
        playerState.sentences = tokenized.sentences;
        playerState.lineBreaks = tokenized.lineBreaks;
    }

    if (settings) {
        playerState.settings = { ...playerState.settings, ...settings };
    }

    playerState.currentIndex = Math.min(startIndex, playerState.sentences.length - 1);
    if (playerState.currentIndex < 0) playerState.currentIndex = 0;
    
    playerState.isPlaying = autoPlay;
    playerState.isPaused = false;

    if (autoPlay) {
        speakCurrentSentence();
    } else {
        sendUpdate(null, { fullPayload: true });
    }
}

function updateSettings(newSettings) {
    const oldRate = playerState.settings.rate;
    const oldVoice = playerState.settings.voiceName;
    playerState.settings = { ...playerState.settings, ...newSettings };

    if (playerState.isPlaying && !playerState.isPaused) {
        if (oldRate !== playerState.settings.rate || oldVoice !== playerState.settings.voiceName) {
            speakCurrentSentence();
        }
    }
}

function play() {
    if (playerState.sentences.length === 0) return;
    
    playerState.isPlaying = true;
    playerState.isPaused = false;
    sendUpdate();
    speakCurrentSentence();
}

function pause() {
    savePosition();
    playerState.isPlaying = false;
    playerState.isPaused = true;
    cancelSpeech();
    sendUpdate();
}

function togglePlay() {
    if (playerState.isPlaying && !playerState.isPaused) {
        pause();
    } else {
        play();
    }
}

function togglePause() {
    if (playerState.isPlaying && !playerState.isPaused) {
        pause();
    } else if (!playerState.isPlaying && playerState.isPaused) {
        play();
    }
}

async function stop() {
    const posPromise = savePosition();
    playerState.isPlaying = false;
    playerState.isPaused = false;
    playerState.currentIndex = 0;
    cancelSpeech();
    sendUpdate();
    await posPromise;
}

function next() {
    if (playerState.currentIndex < playerState.sentences.length - 1) {
        playerState.currentIndex++;
        sendUpdate();
        if (playerState.isPlaying) speakCurrentSentence();
    }
}

function prev() {
    if (playerState.currentIndex > 0) {
        playerState.currentIndex--;
        sendUpdate();
        if (playerState.isPlaying) speakCurrentSentence();
    }
}

// Note: JUMP is handled via initPlayer(null, msg.index, null, true) in the message handler.

function nextParagraph() {
    if (playerState.lineBreaks.length === 0) {
        next();
        return;
    }
    // Find the next line break after current index
    const nextBreak = playerState.lineBreaks.find(b => b > playerState.currentIndex);
    if (nextBreak !== undefined) {
        playerState.currentIndex = nextBreak;
    } else {
        // Jump to last sentence
        playerState.currentIndex = playerState.sentences.length - 1;
    }
    sendUpdate();
    if (playerState.isPlaying) speakCurrentSentence();
}

function prevParagraph() {
    if (playerState.lineBreaks.length === 0) {
        prev();
        return;
    }
    // Find the last line break before or at current index
    const prevBreaks = playerState.lineBreaks.filter(b => b < playerState.currentIndex);
    if (prevBreaks.length > 0) {
        playerState.currentIndex = prevBreaks[prevBreaks.length - 1];
    } else {
        playerState.currentIndex = 0;
    }
    sendUpdate();
    if (playerState.isPlaying) speakCurrentSentence();
}

function speakCurrentSentence() {
    cancelSpeech();
    if (!playerState.isPlaying) return;

    if (playerState.currentIndex >= playerState.sentences.length) {
        playerState.isPlaying = false;
        sendUpdate();
        return;
    }

    if (!voicesLoaded) return voicesReady.then(speakCurrentSentence);

    const text = playerState.sentences[playerState.currentIndex];
    const utter = new SpeechSynthesisUtterance(text);
    playerState.utterance = utter;

    utter.rate = playerState.settings.rate;
    utter.pitch = playerState.settings.pitch;
    utter.volume = playerState.settings.volume;

    const voice = findVoice(playerState.settings.voiceName);
    if (voice) utter.voice = voice;

    if (playerState.settings.highlightMode === 'word') {
        utter.onboundary = (event) => {
            if (event.name === 'word' || event.name === 'sentence') {
                sendUpdate(null, {
                    wordBoundary: {
                        charIndex: event.charIndex,
                        charLength: event.charLength || 0,
                        sentenceIndex: playerState.currentIndex
                    }
                });
            }
        };
    }

    utter.onstart = () => {
        errorRetryCount = 0;
        sendUpdate();
    };

    utter.onend = () => {
        if (playerState.isPlaying && !playerState.isPaused) {
            playerState.currentIndex++;
            if (playerState.currentIndex < playerState.sentences.length) {
                savePosition();
                // Firefox needs a brief gap between utterances to avoid
                // clipped beginnings, audio pops, and skipped sentences
                if (isFirefox) {
                    speakLater(FIREFOX_INTER_UTTERANCE_DELAY);
                } else {
                    speakCurrentSentence();
                }
            } else {
                // Finished: save index 0 so the popup doesn't offer to resume past the end
                playerState.currentIndex = 0;
                stop();
            }
        }
    };

    utter.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.error("TTS Error:", e.error);
            if (playerState.isPlaying) {
                errorRetryCount++;
                if (errorRetryCount > 3) {
                    playerState.currentIndex++;
                    errorRetryCount = 0;
                }
                // Firefox's speech engine needs longer recovery time
                speakLater(isFirefox ? FIREFOX_ERROR_RETRY_DELAY : 100);
            }
        }
    };

    // On Firefox, delay speak() after cancel() to prevent overlapping/garbled audio.
    // Uses speakTimer so a pause/stop/skip in the gap cancels it.
    if (isFirefox) {
        speakTimer = setTimeout(() => window.speechSynthesis.speak(utter), FIREFOX_POST_CANCEL_DELAY);
    } else {
        window.speechSynthesis.speak(utter);
    }
}
function sendUpdate(sendResponse = null, extra = {}) {
    const state = {
        isPlaying: playerState.isPlaying,
        isPaused: playerState.isPaused,
        currentIndex: playerState.currentIndex,
        totalSentences: playerState.sentences.length,
        lineBreaks: playerState.lineBreaks,
        tabId: playerState.tabId,
        tabUrl: playerState.tabUrl,
        settings: {
            rate: playerState.settings.rate,
            pitch: playerState.settings.pitch,
            volume: playerState.settings.volume
        },
        ...extra
    };

    // If we're responding to GET_STATE or INIT, we MUST send sentences
    if (sendResponse || extra.fullPayload) {
        state.sentences = playerState.sentences;
    }

    if (sendResponse) {
        sendResponse({ type: 'UPDATE_UI', state });
    } else {
        chrome.runtime.sendMessage({ type: 'UPDATE_UI', state }, () => {
            if (chrome.runtime.lastError) {
                console.debug("Offscreen: UPDATE_UI broadcast had no receivers:", chrome.runtime.lastError.message);
            }
        });
    }
}


function savePosition() {
    if (!playerState.tabUrl || playerState.sentences.length === 0) return Promise.resolve();
    // Guard against extension context being torn down during auto-persist
    if (!chrome.storage) return Promise.resolve();
    const key = 'pos_' + playerState.tabUrl;
    return new Promise((resolve) => {
        chrome.storage.local.set({
            [key]: {
                url: playerState.tabUrl,
                index: playerState.currentIndex,
                timestamp: Date.now()
            }
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn("Offscreen: savePosition failed:", chrome.runtime.lastError.message);
            }
            resolve();
        });
    });
}

function testVoice(msg = {}) {
    if (!voicesLoaded) return voicesReady.then(() => testVoice(msg));

    const wasPlaying = playerState.isPlaying && !playerState.isPaused;
    cancelSpeech();

    const utter = new SpeechSynthesisUtterance("This is a test of your selected voice.");
    playerState.utterance = utter;
    utter.rate = msg.rate ?? playerState.settings.rate;
    utter.pitch = msg.pitch ?? playerState.settings.pitch;
    utter.volume = msg.volume ?? playerState.settings.volume;

    const voice = findVoice(msg.voiceName || playerState.settings.voiceName);
    if (voice) utter.voice = voice;

    // Any pause/skip/stop during the test calls cancelSpeech(), which detaches these handlers.
    utter.onend = utter.onerror = () => {
        if (wasPlaying) speakCurrentSentence();
        else sendUpdate();
    };
    isFirefox ? (speakTimer = setTimeout(() => speechSynthesis.speak(utter), FIREFOX_POST_CANCEL_DELAY)) : speechSynthesis.speak(utter);
}
