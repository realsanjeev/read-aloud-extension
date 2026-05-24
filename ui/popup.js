// popup.js - UI Controller for Speak Aloud Extension
import { getSavedPosition } from './utils.js';
import * as shared from './ui-shared.js';

// --- DOM Elements ---
const elements = {
  btnPlay: document.getElementById('btnPlay'),
  btnStop: document.getElementById('btnStop'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnPrevPara: document.getElementById('btnPrevPara'),
  btnNextPara: document.getElementById('btnNextPara'),
  btnSettings: document.getElementById('btnSettings'),
  btnTheme: document.getElementById('btnTheme'),
  btnResumeYes: document.getElementById('btnResumeYes'),
  btnResumeNo: document.getElementById('btnResumeNo'),
  textContent: document.getElementById('textArea'),
  progressBar: document.getElementById('progressBar'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  iconTheme: document.getElementById('iconTheme'),
  resumePrompt: document.getElementById('resumePrompt'),
  btnCopy: document.getElementById('btnCopy'),
  btnDownload: document.getElementById('btnDownload'),
  settingsPanel: document.getElementById('settingsPanel'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  btnReset: document.getElementById('btnReset'),
  btnTestVoice: document.getElementById('btnTestVoice'),
  voiceSelect: document.getElementById('voiceSelect'),
  voiceError: document.getElementById('voiceError'),
  rateRange: document.getElementById('rateRange'),
  rateValue: document.getElementById('rateValue'),
  pitchRange: document.getElementById('pitchRange'),
  pitchValue: document.getElementById('pitchValue'),
  volumeRange: document.getElementById('volumeRange'),
  volumeValue: document.getElementById('volumeValue'),
  highlightModeSelect: document.getElementById('highlightModeSelect'),
  chkAutoScroll: document.getElementById('chkAutoScroll'),
  chkMiniPlayer: document.getElementById('chkMiniPlayer'),
};

// --- Global State ---
let uiState = shared.createBaseState();
uiState.settings.miniPlayer = true; // Popup specific default

let voices = [];
let contentReady = false;
let voiceRetryRef = { count: 0 };

// --- Voice Auto-Selection ---
async function autoSelectVoice(text) {
  if (uiState.settings.voiceName || voices.length === 0) return;
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.i18n.detectLanguage(text, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });
    if (result && result.languages && result.languages.length > 0) {
      const langCode = result.languages[0].language;
      const matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
      if (matchingVoice) {
        uiState.settings.voiceName = matchingVoice.name;
        if (elements.voiceSelect) elements.voiceSelect.value = matchingVoice.name;
        chrome.storage.sync.set({ voiceName: matchingVoice.name });
        shared.sendSettings(uiState);
      }
    }
  } catch (e) {
    console.warn("Auto voice selection failed:", e);
  }
}

// --- Mini-Player Toggle ---
async function updateMiniPlayer(show) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;

  if (show) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true });
    } catch (e) {
      try {
        await injectContentScripts(tab.id);
        await new Promise(r => setTimeout(r, 100));
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true });
      } catch (err) {
        console.warn("Popup: Failed to toggle mini-player after injection:", err.message);
      }
    }
  } else {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: false })
      .catch(() => {});
  }
}

// --- Helpers ---

function updatePlayButtonState() {
  const hasContent = uiState.sentences.length > 0;
  shared.setControlsEnabled(elements, hasContent);
  if (elements.btnCopy) elements.btnCopy.disabled = !hasContent;
  if (elements.btnDownload) elements.btnDownload.disabled = !hasContent;
}

function handleUpdateUI(state) {
  shared.handleUpdateUI(uiState, state, shared.createHandleUpdateUICallbacks(uiState, elements, {
    updatePlayButtonState: updatePlayButtonState
  }));
}

// --- Export Functions ---

async function copyText() {
  if (uiState.sentences.length === 0) return;
  const text = uiState.sentences.join(' ');
  try {
    await navigator.clipboard.writeText(text);
    elements.btnCopy.classList.add('success');
    setTimeout(() => elements.btnCopy.classList.remove('success'), 2000);
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
}

function downloadText() {
  if (uiState.sentences.length === 0) return;
  const text = uiState.sentences.join(' ');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  
  // Try to get a decent filename from the current tab title
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const title = tab?.title || 'extracted-text';
    const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  shared.setControlsEnabled(elements, false);
  if (elements.btnCopy) elements.btnCopy.disabled = true;
  if (elements.btnDownload) elements.btnDownload.disabled = true;

  await shared.loadSharedSettings(uiState, elements);
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  
  // Set up voice selection using UI elements
  voices = shared.setupVoiceSelection(uiState, { voiceSelect: elements.voiceSelect, voiceError: elements.voiceError }, voiceRetryRef);

  if (elements.btnCopy) elements.btnCopy.onclick = copyText;
  if (elements.btnDownload) elements.btnDownload.onclick = downloadText;

  // Wire up settings panel event listeners
  shared.wireSettingsListeners(uiState, elements, {
    onMiniPlayerChange: (checked) => updateMiniPlayer(checked),
    onHighlightModeChange: () => {
      shared.renderSentences(uiState, elements.textContent, (index) => shared.sendCommand('JUMP', { index }));
      shared.highlightCurrentSentence(uiState, elements.textContent);
    }
  });
  
  shared.wirePlayerControls(uiState, elements, () => {
    if (!contentReady || uiState.sentences.length === 0) {
      elements.textContent.classList.add('shake');
      setTimeout(() => elements.textContent.classList.remove('shake'), 400);
      return true; // block play
    }
    return false;
  });

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 1. Check if background already has a state (playback in progress)
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, async (response) => {
    if (chrome.runtime.lastError) { /* Offscreen not running yet */ }
    const isDifferentTab = response && response.state && response.state.tabId && response.state.tabId !== currentTab.id;
    const wasPlaying = response && response.state && response.state.isPlaying;

    if (response && response.state && response.state.sentences.length > 0 && !isDifferentTab) {
      handleUpdateUI(response.state);
      contentReady = true;
      updatePlayButtonState();
      if (uiState.settings.miniPlayer) updateMiniPlayer(true);
    } else {
      // 2. Fresh start: extract content
      try {
        const text = await getPageContent(currentTab);
        if (text) {
          contentReady = true;
          updatePlayButtonState();
          await autoSelectVoice(text);
          const saved = await getSavedPosition(currentTab.url);
          if (saved && saved.index > 0) {
            showResumePrompt(saved.index, text, currentTab.id, currentTab.url);
          } else {
            const autoPlay = isDifferentTab && wasPlaying;
            shared.sendCommand('INIT', { text, index: 0, settings: uiState.settings, tabId: currentTab.id, tabUrl: currentTab.url, autoPlay });
          }
          if (uiState.settings.miniPlayer) updateMiniPlayer(true);
        } else {
          elements.textContent.innerHTML = '<p class="placeholder-text">No readable text found.</p>';
        }
      } catch (err) {
        console.error("Extraction failed:", err);
        const p = document.createElement('p');
        p.className = 'error';
        p.textContent = `Error: ${err.message}`;
        elements.textContent.innerHTML = '';
        elements.textContent.appendChild(p);
      }
    }
  });
});

// --- Communication ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_UI') {
    handleUpdateUI(msg.state);
    return false;
  }
  return false;
});

// --- Resume Position ---

function showResumePrompt(savedIndex, text, tabId, tabUrl) {
  elements.resumePrompt.classList.remove('hidden');
  elements.btnResumeYes.onclick = () => {
    elements.resumePrompt.classList.add('hidden');
    shared.sendCommand('INIT', { text, index: savedIndex, settings: uiState.settings, tabId, tabUrl });
  };
  elements.btnResumeNo.onclick = () => {
    elements.resumePrompt.classList.add('hidden');
    shared.sendCommand('INIT', { text, index: 0, settings: uiState.settings, tabId, tabUrl });
  };
}

// --- Content Extraction ---

async function getPageContent(tab) {
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return null;

  const url = new URL(tab.url);
  const pathname = url.pathname.toLowerCase();

  if (pathname.endsWith('.pdf')) {
    const viewerUrl = chrome.runtime.getURL('ui/pdf-viewer.html') + '?url=' + encodeURIComponent(tab.url);
    chrome.tabs.create({ url: viewerUrl });
    return null;
  }

  if (!pathname.match(/\.\w+$/)) {
    try {
      const headResp = await fetch(tab.url, { method: 'HEAD' });
      const contentType = headResp.headers.get('Content-Type') || '';
      if (contentType.includes('application/pdf')) {
        const viewerUrl = chrome.runtime.getURL('ui/pdf-viewer.html') + '?url=' + encodeURIComponent(tab.url);
        chrome.tabs.create({ url: viewerUrl });
        return null;
      }
    } catch (e) {}
  }

  if (pathname.endsWith('.txt') || pathname.endsWith('.md')) {
    try {
      const resp = await fetch(tab.url);
      const text = await resp.text();
      if (pathname.endsWith('.md')) {
        return text
          .replace(/#+\s+/g, '')
          .replace(/\*\*|__/g, '')
          .replace(/\*|_/g, '')
          .replace(/`{1,3}[^`]*`{1,3}/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
          .replace(/>\s+/g, '')
          .replace(/-{3,}/g, '')
          .trim();
      }
      return text;
    } catch (e) {
      console.error("Failed to fetch text file:", e);
      return null;
    }
  }

  const trySendMessage = () => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(response);
      });
    });
  };

  // 1. Try to send message first
  let response = await trySendMessage();

  // 2. If it failed due to missing content script connection, inject and retry
  if (response && response.error) {
    console.log("Popup: Content script not detected, injecting...");
    try {
      await injectContentScripts(tab.id);
      // Small pause for initialization
      await new Promise(r => setTimeout(r, 100));
      response = await trySendMessage();
    } catch (injectErr) {
      console.error("Popup: Script injection and retry failed:", injectErr);
    }
  }

  if (response && response.result) {
    return response.result;
  }
  throw new Error(response ? response.error || "Extraction failed." : "Extraction failed.");
}

async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/Readability.js', 'scripts/content.js']
    });
  } catch (e) {
    console.error("Popup: Script injection failed:", e);
    throw e;
  }
}
