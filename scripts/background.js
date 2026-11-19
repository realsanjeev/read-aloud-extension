// background.js - Orchestrator: page extraction, settings, and routing commands to the TTS player.
// Chrome: the player is an offscreen document. Firefox: an iframe in this background page.
// Both are reached with chrome.runtime.sendMessage, flagged _forwarded.

const PLAYER_URL = chrome.runtime.getURL('ui/offscreen.html');
const isFirefox = !chrome.offscreen;

// Commands from UI / content scripts that are proxied to the player
const PLAYER_COMMANDS = new Set([
    'PAUSE', 'STOP', 'TOGGLE_PLAY', 'NEXT', 'PREV', 'NEXT_PARA', 'PREV_PARA', 'JUMP', 'TEST', 'GET_STATE'
]);
const PLAYER_SETTINGS = ['voiceName', 'rate', 'pitch', 'volume', 'highlightMode'];

const STORE_URL = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org|microsoftedge\.microsoft\.com\/addons)(\/|$)/i;
const isRestrictedUrl = (url) => !url || !/^(https?|file):/i.test(url) || STORE_URL.test(url);

chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

// --- Player lifecycle ---

let playerCreating = null;

async function hasPlayer() {
    if (isFirefox) return !!document.getElementById('player');
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts.length > 0;
}

/**
 * Creates the player if needed. A fresh player (Chrome closed the offscreen document, or
 * Firefox unloaded the background page) is re-loaded from the session, paused at the last index.
 * The in-flight promise covers the existence check, so concurrent callers can't create two.
 */
function ensurePlayer() {
    return (playerCreating ??= (async () => {
        if (await hasPlayer()) return;
        if (isFirefox) {
            const iframe = document.createElement('iframe');
            iframe.id = 'player';
            iframe.src = PLAYER_URL;
            const loaded = new Promise(r => (iframe.onload = r));
            document.body.appendChild(iframe);
            await loaded;
        } else {
            await chrome.offscreen.createDocument({
                url: PLAYER_URL,
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Text-to-Speech playback',
            });
        }
        const { session, sessionIndex = 0 } = await chrome.storage.session.get(['session', 'sessionIndex']);
        if (session) await toPlayer({ type: 'INIT', ...session, index: sessionIndex, settings: await chrome.storage.sync.get(PLAYER_SETTINGS) });
    })().finally(() => {
        playerCreating = null;
    }));
}

function toPlayer(msg) {
    return chrome.runtime.sendMessage({ ...msg, _forwarded: true });
}

async function sendPlayerCommand(msg) {
    await ensurePlayer();
    return toPlayer(msg);
}

async function startReading({ text, index = 0, tabId = null, tabUrl = null, autoPlay = false }) {
    const { session: prev } = await chrome.storage.session.get('session');
    if (prev?.tabId && prev.tabId !== tabId) chrome.tabs.sendMessage(prev.tabId, { type: 'TOGGLE_MINI_PLAYER', visible: false }).catch(() => {});
    // Kept so a fresh player can pick up where this one left off
    await chrome.storage.session.set({ session: { text, tabId, tabUrl }, sessionIndex: index }).catch(() => {});
    return sendPlayerCommand({ type: 'INIT', text, index, tabId, tabUrl, autoPlay, settings: await chrome.storage.sync.get(PLAYER_SETTINGS) });
}

async function stopIfReading(tabId) {
    const { session } = await chrome.storage.session.get('session');
    if (!tabId || session?.tabId !== tabId) return;
    await chrome.storage.session.remove(['session', 'sessionIndex']);
    if (await hasPlayer()) toPlayer({ type: 'UNLOAD' }).catch(() => {});
}

function onPlayerUpdate(state) {
    if (state.wordBoundary) return; // word ticks only matter to the popup / PDF viewer
    const active = state.totalSentences > 0 && (state.isPlaying || state.isPaused);
    chrome.action.setBadgeText({ text: active ? `${Math.round(((state.currentIndex + 1) / state.totalSentences) * 100)}%` : '' });
    if (active) chrome.storage.session.set({ sessionIndex: state.currentIndex });
    // Mini-player sync
    if (state.tabId) chrome.tabs.sendMessage(state.tabId, { type: 'UPDATE_UI', state }).catch(() => {});
}

// --- Settings: UI pages write chrome.storage.sync; the player follows it from here.
// Unset keys keep the player's own defaults. ---

chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;
    const settings = Object.fromEntries(PLAYER_SETTINGS.filter(k => k in changes).map(k => [k, changes[k].newValue]));
    if (Object.keys(settings).length && await hasPlayer()) {
        toPlayer({ type: 'UPDATE_SETTINGS', settings }).catch(() => {});
    }
});

// --- Extraction ---

function openPdfViewer(url) {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/pdf-viewer.html') + '?url=' + encodeURIComponent(url) });
    return { pdf: true };
}

/**
 * Resolves { text } or { pdf: true } (handed to the PDF viewer).
 * Throws with err.restricted for pages extensions can't touch, or err.pdfFallback when the page couldn't be scripted but may be a PDF
 * (Firefox's built-in PDF viewer can't be injected into).
 */
async function extractText(tab) {
    if (isRestrictedUrl(tab?.url)) {
        throw Object.assign(new Error("Browser security blocks extensions on internal pages and extension stores. Open any regular webpage to use Read Aloud."), { restricted: true });
    }
    if (new URL(tab.url).pathname.toLowerCase().endsWith('.pdf')) return openPdfViewer(tab.url);

    let result;
    try {
        // Leading '/': Firefox resolves paths from the extension root only with it
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/lib/Readability.js', '/scripts/content.js'] });
        [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.contentType === 'application/pdf' ? { pdf: true } : { text: window.__readAloudExtract() }
        });
    } catch (e) {
        console.warn('Background: injection failed:', e.message);
        if (tab.url.startsWith('file:')) {
            throw new Error('To read local files, enable "Allow access to file URLs" for this extension in your browser\'s extension settings.');
        }
        const err = new Error("This page can't be read directly. If it's a PDF, open it in the PDF reader.");
        err.pdfFallback = true;
        throw err;
    }
    // PDFs served without a .pdf extension (e.g. https://arxiv.org/pdf/2301.00018)
    return result?.pdf ? openPdfViewer(tab.url) : { text: result?.text || null };
}

// Context menu / keyboard shortcut: read a tab from the start without the popup
async function readTab(tab, index = 0) {
    const { text } = await extractText(tab);
    if (!text) return;
    await startReading({ text, index, tabId: tab.id, tabUrl: tab.url, autoPlay: true });
    const { miniPlayer } = await chrome.storage.sync.get('miniPlayer');
    if (miniPlayer !== false) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true }).catch(() => {});
    }
}

// --- Keep reading across pages ---

// The tab being read is navigating away. Carry on with the next page if it was playing or had
// finished; whether this site allows it is checked once the new page has loaded.
// In memory: checked and cleared synchronously, so the two paths below can't both continue.
// The background stays alive for the few seconds a page load takes.
let continueTabId = null;

async function onPageLeft(tabId) {
    const { session } = await chrome.storage.session.get('session');
    if (!tabId || session?.tabId !== tabId) return;
    const { state } = (await hasPlayer() && await toPlayer({ type: 'GET_STATE' })) || {};
    if (!((state?.isPlaying && !state.isPaused) || state?.finished)) return stopIfReading(tabId);
    continueTabId = tabId;
    toPlayer({ type: 'STOP' }).catch(() => {}); // saves the old page's position
    // A fast page may have finished loading before we got here
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === 'complete') continueReading(tab);
}

chrome.tabs.onUpdated.addListener((tabId, { status }, tab) => {
    if (status === 'complete') continueReading(tab);
});

async function continueReading(tab) {
    if (tab.id !== continueTabId) return;
    continueTabId = null;
    // Only with the per-site permission from the popup (tab.url is hidden without access).
    // Pattern without the port, as in ui/utils.js sitePattern(): Firefox never matches ported ones.
    if (!/^https?:/.test(tab.url || '')) return stopIfReading(tab.id);
    const { protocol, hostname } = new URL(tab.url);
    if (!(await chrome.permissions.contains({ origins: [`${protocol}//${hostname}/*`] }))) return stopIfReading(tab.id);
    const key = 'pos_' + tab.url;
    const index = (await chrome.storage.local.get(key))[key]?.index || 0;
    await readTab(tab, index).catch(() => stopIfReading(tab.id));
}

// --- Saved positions ---

async function prunePositions() {
    const all = await chrome.storage.local.get(null);
    const old = Object.keys(all)
        .filter(k => k.startsWith('pos_'))
        .sort((a, b) => all[b].timestamp - all[a].timestamp)
        .slice(200);
    if (old.length) await chrome.storage.local.remove(old);
}

// --- Events ---

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'read-aloud',
        title: 'Read Aloud',
        contexts: ['page', 'selection']
    });
    prunePositions();
});
chrome.runtime.onStartup.addListener(prunePositions);

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'read-aloud') readTab(tab).catch(e => console.warn('Context menu Read Aloud failed:', e.message));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let reply;
    switch (msg.type) {
        case 'UPDATE_UI':
            if (msg.state) onPlayerUpdate(msg.state);
            return;
        case 'PAGE_LEFT':
            onPageLeft(sender.tab?.id);
            return;
        case 'SAVE_POSITION':
            reply = chrome.storage.local.set({ ['pos_' + msg.url]: { url: msg.url, index: msg.index, timestamp: Date.now() } });
            break;
        case 'EXTRACT_TAB':
            reply = extractText(msg.tab).catch(e => ({ error: e.message, restricted: !!e.restricted, pdfFallback: !!e.pdfFallback }));
            break;
        case 'INIT':
            reply = startReading(msg);
            break;
        default:
            if (!PLAYER_COMMANDS.has(msg.type)) return;
            reply = sendPlayerCommand(msg);
    }
    reply.then(sendResponse, (e) => sendResponse({ status: 'error', message: e.message }));
    return true;
});

const COMMANDS = {
    play_stop: 'TOGGLE_PLAY',
    pause_resume: 'PAUSE',
    forward: 'NEXT',
    rewind: 'PREV',
    next_paragraph: 'NEXT_PARA',
    prev_paragraph: 'PREV_PARA'
};

chrome.commands.onCommand.addListener(async (command, tab) => {
    if (!COMMANDS[command]) return;
    try {
        if (command === 'play_stop') {
            // Nothing playing and this tab isn't the loaded one: start reading it
            const { state } = (await sendPlayerCommand({ type: 'GET_STATE' })) || {};
            if (!state?.isPlaying && !state?.isPaused && state?.tabId !== tab?.id) return await readTab(tab);
        }
        await sendPlayerCommand({ type: COMMANDS[command] });
    } catch (e) {
        console.warn('Keyboard command failed:', e.message);
    }
});

chrome.tabs.onRemoved.addListener(stopIfReading);
