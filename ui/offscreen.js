// offscreen.js - Text-to-Speech Engine
import { hashStr } from './utils.js';

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
let voiceRetryCount = 0;
const MAX_VOICE_RETRIES = 20;
let isSpeaking = false;

// Settings are initialized via INIT and UPDATE_SETTINGS messages from the popup

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Ignore direct broadcasts from the popup; only accept commands proxied by the background service worker
    if (msg.type && (msg.type === 'PLAY' || msg.type === 'PAUSE' || msg.type === 'STOP' || msg.type === 'TOGGLE_PLAY' || msg.type === 'NEXT' || msg.type === 'PREV' || msg.type === 'NEXT_PARA' || msg.type === 'PREV_PARA' || msg.type === 'JUMP' || msg.type === 'INIT' || msg.type === 'UPDATE_SETTINGS' || msg.type === 'TEST' || msg.type === 'GET_STATE' || msg.type === 'DETECT_LANG') && !msg._forwarded) {
        return;
    }

    switch (msg.type) {
        case 'INIT':
            console.log("Offscreen: INIT received, text length:", msg.text ? msg.text.length : 0);
            initPlayer(msg.text, msg.index || 0, msg.settings, msg.autoPlay || false, msg.tabId, msg.tabUrl || null);
            sendResponse({ status: 'ok' });
            break;
        case 'PLAY':
            play();
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
            stop();
            sendResponse({ status: 'ok' });
            break;
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
            initPlayer(null, msg.index, null, true);
            sendResponse({ status: 'ok' });
            break;
        case 'UPDATE_SETTINGS':
            updateSettings(msg.settings);
            sendResponse({ status: 'ok' });
            break;
        case 'TEST':
            testVoice();
            sendResponse({ status: 'ok' });
            break;
        case 'DETECT_LANG':
            detectLanguage(msg.text)
                .then(lang => sendResponse({ lang }))
                .catch(err => sendResponse({ error: err.message }));
            return true;
        case 'GET_STATE':
            sendUpdate(sendResponse);
            return true;
    }
});

/**
 * Smart sentence tokenizer that handles abbreviations, decimals, and ellipsis.
 */
function tokenizeSentences(text) {
    if (!text || text.length === 0) return [];

    // Define abbreviations and special patterns
    const abbreviations = new Set([
        // Titles
        'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
        // Street types
        'ave', 'blvd', 'rd', 'ln', 'ct', 'pl',
        // Academic / Latin
        'eg', 'ie', 'vs', 'etc', 'et al', 'fig', 'vol', 'vols',
        // Credentials
        'inc', 'ltd', 'phd', 'md', 'ba', 'ma',
        // Time
        'a.m', 'p.m', 'am', 'pm',
        // Geopolitical
        'u.s.a', 'u.k', 'u.s', 'e.u', 'u.n',
        // Miscellaneous
        'no', 'nos', 'pp',
        // Months
        'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
    ]);

    // Split by line first to preserve paragraph structure
    const lines = text.split(/\n+/);
    const sentences = [];
    const lineBreaks = [];

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) return;

        if (sentences.length > 0) {
            lineBreaks.push(sentences.length);
        }

        // Split by sentence endings, but be smart about abbreviations
        const result = [];
        let current = '';
        let i = 0;

        while (i < trimmedLine.length) {
            current += trimmedLine[i];

            if (trimmedLine[i] === '.' || trimmedLine[i] === '!' || trimmedLine[i] === '?') {
                // Check if this is an ellipsis (...)
                if (trimmedLine.substring(i, i + 3) === '...') {
                    current += trimmedLine[i + 1] || '';
                    current += trimmedLine[i + 2] || '';
                    i += 2;
                }
                // Check if next char is a quote
                const nextChar = trimmedLine[i + 1];
                if (nextChar === '"' || nextChar === "'") {
                    current += nextChar;
                    i++;
                }

                // Look back to see if this period is part of an abbreviation or number
                const beforePeriod = current.slice(0, -1).trim();
                const lastWordMatch = beforePeriod.match(/([a-zA-Z0-9]+)[.!?]?$/);
                const lastWord = lastWordMatch ? lastWordMatch[1].toLowerCase() : '';

                // Check if it's a decimal number (e.g., 3.14)
                const isDecimal = /\d+\.\d+$/.test(beforePeriod);

                // Check if it's an abbreviation
                const isAbbrev = abbreviations.has(lastWord) || abbreviations.has(lastWord + '.');

                // Check if there's more text and it looks like a sentence continuation (lowercase next word)
                const remainder = trimmedLine.substring(i + 1).trim();
                const nextWord = remainder.match(/^([a-zA-Z0-9]+)/);
                const startsWithLowercase = nextWord && /^[a-z]/.test(nextWord[1]);

                // Decision: split here unless it's a decimal, abbreviation, or starts with lowercase
                if (!isDecimal && !isAbbrev && (!startsWithLowercase || trimmedLine[i] !== '.')) {
                    result.push(current.trim());
                    current = '';
                }
            }

            i++;
        }

        // Add any remaining text as the last sentence
        if (current.trim().length > 0) {
            result.push(current.trim());
        }

        sentences.push(...result);
    });

    return { sentences, lineBreaks };
}

/**
 * Initializes the player with new text.
 */
function initPlayer(text, startIndex, settings = null, autoPlay = false, tabId = null, tabUrl = null) {
    window.speechSynthesis.cancel();

    if (tabId !== null) {
        playerState.tabId = tabId;
    }
    if (tabUrl !== null) {
        playerState.tabUrl = tabUrl;
    }

    if (settings) {
        playerState.settings = { ...playerState.settings, ...settings };
    }

    if (text) {
        const tokenized = tokenizeSentences(text);
        playerState.sentences = tokenized.sentences;
        playerState.lineBreaks = tokenized.lineBreaks;
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
    speakCurrentSentence();
}

function pause() {
    playerState.isPlaying = false;
    playerState.isPaused = true;
    window.speechSynthesis.cancel();
    savePosition();
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

function stop() {
    playerState.isPlaying = false;
    playerState.isPaused = false;
    playerState.currentIndex = 0;
    window.speechSynthesis.cancel();
    savePosition();
    sendUpdate();
}

function next() {
    if (playerState.currentIndex < playerState.sentences.length - 1) {
        playerState.currentIndex++;
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
    }
}

function prev() {
    if (playerState.currentIndex > 0) {
        playerState.currentIndex--;
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
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
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
    } else {
        // Jump to last sentence
        playerState.currentIndex = playerState.sentences.length - 1;
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
    }
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
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
    } else {
        playerState.currentIndex = 0;
        if (playerState.isPlaying) speakCurrentSentence();
        else sendUpdate();
    }
}

function speakCurrentSentence() {
    if (isSpeaking) return;
    isSpeaking = true;

    if (playerState.utterance) {
        playerState.utterance.onend = null;
        playerState.utterance.onerror = null;
        playerState.utterance.onboundary = null;
    }

    window.speechSynthesis.cancel();
    
    if (playerState.sentences.length === 0 || playerState.currentIndex >= playerState.sentences.length) {
        playerState.isPlaying = false;
        isSpeaking = false;
        sendUpdate();
        return;
    }

    const text = playerState.sentences[playerState.currentIndex];
    const utter = new SpeechSynthesisUtterance(text);
    playerState.utterance = utter;

    utter.rate = playerState.settings.rate;
    utter.pitch = playerState.settings.pitch;
    utter.volume = playerState.settings.volume;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
        if (voiceRetryCount >= MAX_VOICE_RETRIES) {
            isSpeaking = false;
            console.error("Offscreen: Max voice retries reached, aborting speech.");
            return;
        }
        console.warn("Offscreen: Voices not loaded yet, waiting for voiceschanged...");
        const onVoicesChanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            voiceRetryCount = 0;
            isSpeaking = false;
            speakCurrentSentence();
        };
        window.speechSynthesis.onvoiceschanged = onVoicesChanged;
        setTimeout(() => {
            if (window.speechSynthesis.onvoiceschanged === onVoicesChanged) {
                window.speechSynthesis.onvoiceschanged = null;
                voiceRetryCount++;
                isSpeaking = false;
                speakCurrentSentence();
            }
        }, 1000);
        return;
    }
    voiceRetryCount = 0;

    if (playerState.settings.voiceName) {
        const v = voices.find(voice => voice.name === playerState.settings.voiceName);
        if (v) utter.voice = v;
    }

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
        isSpeaking = false;
        sendUpdate();
    };

    utter.onend = () => {
        isSpeaking = false;
        if (playerState.isPlaying && !playerState.isPaused) {
            playerState.currentIndex++;
            if (playerState.currentIndex < playerState.sentences.length) {
                speakCurrentSentence();
            } else {
                stop();
            }
        }
    };

    utter.onerror = (e) => {
        isSpeaking = false;
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.error("TTS Error:", e.error);
            if (playerState.isPlaying) {
                errorRetryCount++;
                if (errorRetryCount > 3) {
                    playerState.currentIndex++;
                    errorRetryCount = 0;
                }
                setTimeout(speakCurrentSentence, 100);
            }
        }
    };

    window.speechSynthesis.speak(utter);
}

function sendUpdate(sendResponse = null, extra = {}) {
    const state = {
        isPlaying: playerState.isPlaying,
        isPaused: playerState.isPaused,
        currentIndex: playerState.currentIndex,
        totalSentences: playerState.sentences.length,
        // Only send sentences if it's a direct response to a state request or specifically requested
        lineBreaks: playerState.lineBreaks,
        tabId: playerState.tabId,
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
    if (!playerState.tabUrl || playerState.sentences.length === 0) return;
    // offscreen documents HAVE access to chrome.storage
    const key = 'pos_' + hashStr(playerState.tabUrl);
    chrome.storage.local.set({
        [key]: {
            url: playerState.tabUrl,
            index: playerState.currentIndex,
            timestamp: Date.now()
        }
    });
}

let testVoiceRetryCount = 0;
const MAX_TEST_VOICE_RETRIES = 20;

function testVoice() {
    const wasPlaying = playerState.isPlaying;
    const wasPaused = playerState.isPaused;
    const savedIndex = playerState.currentIndex;
    
    window.speechSynthesis.cancel();
    
    const text = "This is a test of your selected voice.";
    const utter = new SpeechSynthesisUtterance(text);
    playerState.utterance = utter;

    utter.rate = playerState.settings.rate;
    utter.pitch = playerState.settings.pitch;
    utter.volume = playerState.settings.volume;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
        if (testVoiceRetryCount >= MAX_TEST_VOICE_RETRIES) {
            testVoiceRetryCount = 0;
            console.error("Offscreen: Max test voice retries reached.");
            return;
        }
        console.warn("Offscreen: Voices not loaded for test, waiting...");
        testVoiceRetryCount++;
        setTimeout(testVoice, 100);
        return;
    }
    testVoiceRetryCount = 0;

    if (playerState.settings.voiceName) {
        const v = voices.find(voice => voice.name === playerState.settings.voiceName);
        if (v) utter.voice = v;
    }

    const restoreState = () => {
        if (wasPlaying && !wasPaused) {
            playerState.currentIndex = savedIndex;
            playerState.isPlaying = true;
            playerState.isPaused = false;
            speakCurrentSentence();
        } else {
            sendUpdate();
        }
    };

    utter.onend = restoreState;
    utter.onerror = restoreState;
    window.speechSynthesis.speak(utter);
}

// --- Language Detection ---

function detectLanguage(text) {
    return new Promise((resolve, reject) => {
        chrome.i18n.detectLanguage(text, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (result && result.languages && result.languages.length > 0) {
                resolve(result.languages[0].language);
            } else {
                reject(new Error("Language could not be detected"));
            }
        });
    });
}

// Auto-persist position periodically while playing
setInterval(() => {
    if (playerState.isPlaying && !playerState.isPaused) {
        savePosition();
    }
}, 5000);
