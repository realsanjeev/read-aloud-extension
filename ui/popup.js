// popup.js - UI Controller for Speak Aloud Extension
import { getSavedPosition, sitePattern } from './utils.js';
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
  btnStartOver: document.getElementById('btnStartOver'),
  keepReadingItem: document.getElementById('keepReadingItem'),
  chkKeepReading: document.getElementById('chkKeepReading'),
  keepReadingSite: document.getElementById('keepReadingSite'),
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
  ratePresets: document.getElementById('ratePresets'),
  chkAutoScroll: document.getElementById('chkAutoScroll'),
  chkMiniPlayer: document.getElementById('chkMiniPlayer'),
};

// --- Global State ---
let uiState = shared.createBaseState();
uiState.settings.miniPlayer = true; // Popup specific default

let voices = [];
let contentReady = false;

// --- Voice Auto-Selection ---
async function autoSelectVoice(text) {
  if (voices.length === 0) return;
  try {
    const result = await chrome.i18n.detectLanguage(text.slice(0, 5000));
    const langCode = result?.languages?.[0]?.language;
    if (!langCode) return;
    const matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    if (matchingVoice) {
      uiState.settings.voiceName = matchingVoice.name;
      if (elements.voiceSelect) elements.voiceSelect.value = matchingVoice.name;
      await chrome.storage.sync.set({ voiceName: matchingVoice.name }); // background forwards it to the player
    }
  } catch (e) {
    console.warn("Auto voice selection failed:", e);
  }
}

// --- Mini-Player Toggle ---
// The background injects the content script during extraction, so it's already there.
async function updateMiniPlayer(show) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: show }).catch(() => {});
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

function buildText() {
  if (uiState.sentences.length === 0) return '';
  if (!uiState.lineBreaks || uiState.lineBreaks.length === 0) {
    return uiState.sentences.join(' ');
  }
  const parts = [];
  let paraStart = 0;
  const breaks = [...uiState.lineBreaks, uiState.sentences.length];
  for (const breakIdx of breaks) {
    parts.push(uiState.sentences.slice(paraStart, breakIdx).join(' '));
    paraStart = breakIdx;
  }
  return parts.join('\n\n');
}

async function copyText() {
  const text = buildText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    elements.btnCopy.classList.add('success');
    setTimeout(() => elements.btnCopy.classList.remove('success'), 2000);
  } catch (err) {
    console.error('Failed to copy text:', err);
    elements.btnCopy.classList.add('copy-error');
    setTimeout(() => elements.btnCopy.classList.remove('copy-error'), 2000);
  }
}

function downloadText() {
  const text = buildText();
  if (!text) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));

  // Try to get a decent filename from the current tab title
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    const title = tab?.title || 'extracted-text';
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    a.click();
    // Revoking synchronously can cancel the download in Firefox
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  shared.setControlsEnabled(elements, false);
  if (elements.btnCopy) elements.btnCopy.disabled = true;
  if (elements.btnDownload) elements.btnDownload.disabled = true;

  await shared.loadSharedSettings(uiState, elements);
  const hadSavedVoice = !!uiState.settings.voiceName;
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  
  // Set up voice selection using UI elements
  voices = shared.setupVoiceSelection(uiState, { voiceSelect: elements.voiceSelect, voiceError: elements.voiceError }, (v) => {
    voices = v;
  });

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

  // Issue #4: Seekable progress bar
  const progressContainer = document.getElementById('progressContainer');
  if (progressContainer) {
    progressContainer.addEventListener('click', (e) => {
      if (uiState.sentences.length === 0) return;
      const rect = progressContainer.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const index = Math.round(pct * (uiState.sentences.length - 1));
      shared.sendCommand('JUMP', { index });
    });
  }

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  setupKeepReading(currentTab);
  const state = (await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null))?.state;
  // The PDF viewer tab's URL differs from the PDF's, so for extension pages the tab id decides
  const isLoadedHere = state?.sentences?.length > 0 && state.tabId === currentTab.id &&
    (state.tabUrl === currentTab.url || !/^(https?|file):/.test(currentTab.url || ''));

  if (isLoadedHere) {
    handleUpdateUI(state);
    contentReady = true;
    updatePlayButtonState();
    if (uiState.settings.miniPlayer) updateMiniPlayer(true);
  } else {
    // Clicking the icon on a new page means "read this page", even if another tab is playing
    loadPage(currentTab, hadSavedVoice);
  }
});

// Per-site permission lets the background keep reading after this tab navigates.
// Firefox may close the popup while asking; the grant still applies.
async function setupKeepReading(tab) {
  if (!/^https?:/.test(tab?.url || '')) return;
  const origins = [sitePattern(tab.url)];
  elements.keepReadingSite.textContent = new URL(tab.url).hostname;
  elements.chkKeepReading.checked = await chrome.permissions.contains({ origins });
  elements.keepReadingItem.classList.remove('hidden');
  elements.chkKeepReading.onchange = async (e) => {
    if (e.target.checked) e.target.checked = await chrome.permissions.request({ origins });
    else await chrome.permissions.remove({ origins });
  };
}

async function loadPage(tab, hadSavedVoice) {
  elements.textContent.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Extracting content…</p></div>';
  const res = await chrome.runtime.sendMessage({ type: 'EXTRACT_TAB', tab: { id: tab.id, url: tab.url } })
    .catch(e => ({ error: e.message }));

  if (res?.pdf) {
    elements.textContent.innerHTML = '<p class="placeholder-text">Opened in the PDF reader.</p>';
    return;
  }
  if (res?.error) return showError(res, tab);

  const text = res?.text;
  if (!text) {
    elements.textContent.innerHTML = `
      <div class="error-state" style="opacity: 0.8; padding-top: 60px;">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); margin-bottom: 8px;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>
        <p style="font-size: 1rem; color: var(--text-secondary); font-style: italic;">No readable text found on this page.</p>
      </div>`;
    return;
  }

  contentReady = true;
  updatePlayButtonState();
  if (!hadSavedVoice) await autoSelectVoice(text);
  const index = (await getSavedPosition(tab.url))?.index || 0;
  await shared.sendCommand('INIT', { text, index, tabId: tab.id, tabUrl: tab.url, autoPlay: true });
  if (index > 0) showResumedNotice();
  if (uiState.settings.miniPlayer) updateMiniPlayer(true);
}

function showError({ error, restricted: isRestricted, pdfFallback }, tab) {
  elements.textContent.innerHTML = `
      <div class="error-state">
        <svg class="error-icon" viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p><span class="error-title"></span><br><small class="error-detail"></small></p>
        <button id="open-pdf-btn" class="retry-btn">Open in PDF reader</button>
        <button id="retry-extract-btn" class="retry-btn">Try Again</button>
      </div>`;
  elements.textContent.querySelector('.error-title').textContent = isRestricted ? 'Cannot read this page.' : 'Could not extract content.';
  elements.textContent.querySelector('.error-detail').textContent = error || 'Extraction failed';
  document.getElementById('open-pdf-btn').hidden = !pdfFallback;
  document.getElementById('retry-extract-btn').hidden = isRestricted;
  document.getElementById('retry-extract-btn').addEventListener('click', () => location.reload());
  document.getElementById('open-pdf-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/pdf-viewer.html') + '?url=' + encodeURIComponent(tab.url) });
  });
}

// --- Communication ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_UI') {
    handleUpdateUI(msg.state);
  }
  return false;
});

// --- Resume Position ---

function showResumedNotice() {
  const hide = () => elements.resumePrompt.classList.add('hidden');
  const timer = setTimeout(hide, 8000);
  elements.resumePrompt.classList.remove('hidden');
  elements.btnStartOver.onclick = () => {
    clearTimeout(timer);
    hide();
    shared.sendCommand('JUMP', { index: 0 });
  };
}
