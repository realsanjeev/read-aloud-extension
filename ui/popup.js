// popup.js - UI Controller for Speak Aloud Extension
import { hashStr, debounce, getSavedPosition } from './utils.js';

// --- DOM Elements ---
const btnPlay = document.getElementById('btnPlay');
const btnStop = document.getElementById('btnStop');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnPrevPara = document.getElementById('btnPrevPara');
const btnNextPara = document.getElementById('btnNextPara');
const btnSettings = document.getElementById('btnSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnReset = document.getElementById('btnReset');
const btnTestVoice = document.getElementById('btnTestVoice');
const btnTheme = document.getElementById('btnTheme');
const btnResumeYes = document.getElementById('btnResumeYes');
const btnResumeNo = document.getElementById('btnResumeNo');

const textContent = document.getElementById('textArea');
const progressBar = document.getElementById('progressBar');
const iconPlay = document.getElementById('iconPlay');
const iconPause = document.getElementById('iconPause');
const iconTheme = document.getElementById('iconTheme');

const settingsPanel = document.getElementById('settingsPanel');
const voiceSelect = document.getElementById('voiceSelect');
const voiceError = document.getElementById('voiceError');
const rateRange = document.getElementById('rateRange');
const rateValue = document.getElementById('rateValue');
const pitchRange = document.getElementById('pitchRange');
const pitchValue = document.getElementById('pitchValue');
const volumeRange = document.getElementById('volumeRange');
const volumeValue = document.getElementById('volumeValue');
const highlightModeSelect = document.getElementById('highlightModeSelect');
const chkAutoScroll = document.getElementById('chkAutoScroll');
const chkMiniPlayer = document.getElementById('chkMiniPlayer');
const resumePrompt = document.getElementById('resumePrompt');

// --- Global State ---
let uiState = {
  sentences: [],
  lineBreaks: [],
  currentIndex: 0,
  isPlaying: false,
  isPaused: false,
  settings: {
    voiceName: null,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    highlightMode: 'sentence',
    autoScroll: true,
    theme: 'auto',
    miniPlayer: true
  }
};

let voices = [];
let contentReady = false;
let voiceRetryCount = 0;
const MAX_VOICE_RETRIES = 20;
const scriptInjectedTabs = new Set();


function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  const parent = textContent;
  const parentRect = parent.getBoundingClientRect();
  return (
    rect.top >= parentRect.top &&
    rect.bottom <= parentRect.bottom
  );
}

function setControlsEnabled(enabled) {
  btnPlay.disabled = !enabled;
  btnStop.disabled = !enabled;
  btnPrev.disabled = !enabled;
  btnNext.disabled = !enabled;
  if (btnPrevPara) btnPrevPara.disabled = !enabled;
  if (btnNextPara) btnNextPara.disabled = !enabled;
}

function updatePlayButtonState() {
  const hasContent = uiState.sentences.length > 0;
  setControlsEnabled(hasContent);
}

// --- Theme ---
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    iconTheme.innerHTML = `<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>`;
  } else if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
    iconTheme.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
    root.setAttribute('data-theme', 'auto');
    iconTheme.innerHTML = `<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>`;
  }
}

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
        voiceSelect.value = matchingVoice.name;
        chrome.storage.sync.set({ voiceName: matchingVoice.name });
        sendSettings();
      }
    }
  } catch (e) {
    console.warn("Auto voice selection failed:", e);
  }
}

// --- Mini-Player Toggle ---
async function updateMiniPlayer(show) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (show) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true });
    } catch (e) {
      await injectContentScripts(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: true })
        .catch(() => {});
    }
  } else {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: false })
      .catch(() => {});
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setControlsEnabled(false);
  await loadSettings();
  applyTheme(uiState.settings.theme);
  setupVoiceSelection();

  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 1. Check if background already has a state (playback in progress)
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, async (response) => {
    if (chrome.runtime.lastError) { /* Offscreen not running yet — normal on fresh start */ }
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
            sendCommand('INIT', { text, index: 0, settings: uiState.settings, tabId: currentTab.id, tabUrl: currentTab.url, autoPlay });
          }
          if (uiState.settings.miniPlayer) updateMiniPlayer(true);
        } else {
          textContent.innerHTML = '<p class="placeholder-text">No readable text found.</p>';
        }
      } catch (err) {
        console.error("Extraction failed:", err);
        textContent.innerHTML = `<p class="error">Error: ${err.message}</p>`;
      }
    }
  });
});

// --- Communication ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_UI') {
    console.log("Popup: Received UPDATE_UI, sentences:", msg.state.sentences ? msg.state.sentences.length : '(optimized)');
    handleUpdateUI(msg.state);
    return false;
  }
  return false;
});

function sendCommand(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload });
}

function handleUpdateUI(state) {
  // If sentences are missing (optimized payload), don't overwrite our current list
  const hasSentences = state.sentences && state.sentences.length > 0;
  const needsRerender = hasSentences && (
    uiState.sentences.length !== state.sentences.length ||
    uiState.sentences[0] !== state.sentences[0]
  );
  
  if (hasSentences) {
    uiState.sentences = state.sentences;
  }
  
  // Update other properties
  const { sentences, ...rest } = state;
  uiState = { ...uiState, ...rest };

  if (needsRerender) {
    renderSentences();
  }

  if (state.wordBoundary) {
    highlightWord(state.wordBoundary);
  } else {
    highlightCurrentSentence();
  }

  togglePlayIcon(uiState.isPlaying && !uiState.isPaused);
  updateProgress();
  updatePlayButtonState();
}

// --- UI Rendering ---

function renderSentences() {
  textContent.innerHTML = "";
  uiState.sentences.forEach((sentence, index) => {
    if (uiState.lineBreaks && uiState.lineBreaks.includes(index)) {
      textContent.appendChild(document.createElement('br'));
      textContent.appendChild(document.createElement('br'));
    }

    const span = document.createElement('span');
    if (uiState.settings.highlightMode === 'word') {
      const words = sentence.split(/(\s+)/);
      words.forEach((word, widx) => {
        const wspan = document.createElement('span');
        wspan.textContent = word;
        wspan.className = 'word';
        wspan.dataset.sentenceIndex = index;
        wspan.dataset.wordIndex = widx;
        span.appendChild(wspan);
      });
    } else {
      span.textContent = sentence + " ";
    }
    span.id = `sentence-${index}`;
    span.dataset.index = index;
    span.onclick = () => sendCommand('JUMP', { index });
    textContent.appendChild(span);
  });
}

function highlightCurrentSentence() {
  document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
  document.querySelectorAll('.word-highlight').forEach(el => el.classList.remove('word-highlight'));
  const el = document.getElementById(`sentence-${uiState.currentIndex}`);
  if (el) {
    el.classList.add('highlight');
    if (uiState.settings.autoScroll && !isElementInViewport(el)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function highlightWord(boundary) {
  document.querySelectorAll('.word-highlight').forEach(el => el.classList.remove('word-highlight'));
  const sentenceEl = document.getElementById(`sentence-${boundary.sentenceIndex}`);
  if (!sentenceEl) return;

  sentenceEl.classList.add('highlight');

  let charCount = 0;
  const words = sentenceEl.querySelectorAll('.word');
  for (const wspan of words) {
    const wordLen = wspan.textContent.length;
    if (charCount + wordLen > boundary.charIndex) {
      wspan.classList.add('word-highlight');
      if (uiState.settings.autoScroll && !isElementInViewport(wspan)) {
        wspan.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      break;
    }
    charCount += wordLen;
  }
}

function updateProgress() {
  if (!uiState.sentences || uiState.sentences.length === 0) return;
  const progress = ((uiState.currentIndex + 1) / uiState.sentences.length) * 100;
  progressBar.style.width = `${Math.min(progress, 100)}%`;
}

function togglePlayIcon(active) {
  if (active) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  }
}

// --- Resume Position ---



function showResumePrompt(savedIndex, text, tabId, tabUrl) {
  resumePrompt.classList.remove('hidden');
  btnResumeYes.onclick = () => {
    resumePrompt.classList.add('hidden');
    sendCommand('INIT', { text, index: savedIndex, settings: uiState.settings, tabId, tabUrl });
  };
  btnResumeNo.onclick = () => {
    resumePrompt.classList.add('hidden');
    sendCommand('INIT', { text, index: 0, settings: uiState.settings, tabId, tabUrl });
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

  await injectContentScripts(tab.id);

  const trySendMessage = () => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(response);
      });
    });
  };

  let response;
  let attempts = 0;
  const maxAttempts = 10;
  while ((!response || response.error) && attempts < maxAttempts) {
    response = await trySendMessage();
    if (!response || response.error) {
      await new Promise(r => setTimeout(r, 200));
    }
    attempts++;
  }

  if (response && response.result) {
    return response.result;
  }
  throw new Error(response ? response.error || "Extraction failed." : "Extraction failed.");
}

async function injectContentScripts(tabId) {
  if (scriptInjectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/Readability.js', 'scripts/content.js']
    });
    scriptInjectedTabs.add(tabId);
  } catch (e) {
    console.error("Script injection failed:", e);
  }
}

// --- Settings & Voices ---

async function loadSettings() {
  const data = await chrome.storage.sync.get([
    'voiceName', 'rate', 'pitch', 'volume', 'highlightMode', 'autoScroll', 'theme', 'miniPlayer'
  ]);
  uiState.settings = {
    voiceName: data.voiceName || null,
    rate: parseFloat(data.rate) || 1.0,
    pitch: parseFloat(data.pitch) || 1.0,
    volume: parseFloat(data.volume) || 1.0,
    highlightMode: data.highlightMode || 'sentence',
    autoScroll: data.autoScroll !== undefined ? data.autoScroll : true,
    theme: data.theme || 'auto',
    miniPlayer: data.miniPlayer !== undefined ? data.miniPlayer : true
  };

  rateRange.value = uiState.settings.rate;
  rateValue.textContent = uiState.settings.rate + "x";
  pitchRange.value = uiState.settings.pitch;
  pitchValue.textContent = uiState.settings.pitch;
  volumeRange.value = uiState.settings.volume;
  volumeValue.textContent = uiState.settings.volume;
  highlightModeSelect.value = uiState.settings.highlightMode;
  chkAutoScroll.checked = uiState.settings.autoScroll;
  if (chkMiniPlayer) chkMiniPlayer.checked = uiState.settings.miniPlayer;
}

function setupVoiceSelection() {
  const updateVoices = () => {
    voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      if (voiceRetryCount < MAX_VOICE_RETRIES) {
        voiceRetryCount++;
        setTimeout(updateVoices, 200);
      } else {
        voiceError.classList.remove('hidden');
        voiceSelect.innerHTML = '<option value="">No voices available</option>';
      }
      return;
    }
    voiceError.classList.add('hidden');
    voiceSelect.innerHTML = '';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });
    if (uiState.settings.voiceName) {
      voiceSelect.value = uiState.settings.voiceName;
    }
  };

  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = updateVoices;
  }
  updateVoices();
}

function saveSettings() {
  chrome.storage.sync.set(uiState.settings);
}

function sendSettings() {
  sendCommand('UPDATE_SETTINGS', { settings: uiState.settings });
}

const debouncedSaveSettings = debounce(saveSettings, 300);

// --- Event Listeners ---

btnPlay.onclick = () => {
  if (!contentReady || uiState.sentences.length === 0) {
    textContent.classList.add('shake');
    setTimeout(() => textContent.classList.remove('shake'), 400);
    return;
  }
  sendCommand('TOGGLE_PLAY');
  };

  btnStop.onclick = () => {
  sendCommand('STOP');
  };

  btnNext.onclick = () => sendCommand('NEXT');
  btnPrev.onclick = () => sendCommand('PREV');
  if (btnNextPara) btnNextPara.onclick = () => sendCommand('NEXT_PARA');
  if (btnPrevPara) btnPrevPara.onclick = () => sendCommand('PREV_PARA');

btnSettings.onclick = () => settingsPanel.classList.remove('hidden');
btnCloseSettings.onclick = () => settingsPanel.classList.add('hidden');

rateRange.oninput = (e) => {
  uiState.settings.rate = parseFloat(e.target.value);
  rateValue.textContent = e.target.value + "x";
  debouncedSaveSettings();
};

rateRange.onchange = (e) => {
  saveSettings();
  sendSettings();
};

pitchRange.oninput = (e) => {
  uiState.settings.pitch = parseFloat(e.target.value);
  pitchValue.textContent = e.target.value;
  debouncedSaveSettings();
};

pitchRange.onchange = (e) => {
  saveSettings();
  sendSettings();
};

volumeRange.oninput = (e) => {
  uiState.settings.volume = parseFloat(e.target.value);
  volumeValue.textContent = e.target.value;
  debouncedSaveSettings();
};

volumeRange.onchange = (e) => {
  saveSettings();
  sendSettings();
};

voiceSelect.onchange = (e) => {
  uiState.settings.voiceName = e.target.value;
  saveSettings();
  sendSettings();
};

highlightModeSelect.onchange = (e) => {
  uiState.settings.highlightMode = e.target.value;
  saveSettings();
  sendSettings();
  renderSentences();
  highlightCurrentSentence();
};

chkAutoScroll.onchange = (e) => {
  uiState.settings.autoScroll = e.target.checked;
  saveSettings();
  sendSettings();
};

if (chkMiniPlayer) {
  chkMiniPlayer.onchange = (e) => {
    uiState.settings.miniPlayer = e.target.checked;
    saveSettings();
    sendSettings();
    updateMiniPlayer(e.target.checked);
  };
}

btnTheme.onclick = () => {
  const themes = ['auto', 'light', 'dark'];
  const current = uiState.settings.theme || 'auto';
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  uiState.settings.theme = next;
  applyTheme(next);
  saveSettings();
  sendSettings();
};

btnTestVoice.onclick = () => sendCommand('TEST');

btnReset.onclick = async () => {
  uiState.settings = {
    voiceName: null,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    highlightMode: 'sentence',
    autoScroll: true,
    theme: 'auto',
    miniPlayer: true
  };
  await saveSettings();     // Persist defaults to storage first
  await loadSettings();     // Reload UI from the freshly saved defaults
  applyTheme(uiState.settings.theme);
  sendSettings();
};
