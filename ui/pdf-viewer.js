// pdf-viewer.js - PDF Viewer with integrated TTS controls
import { hashStr, debounce, getSavedPosition } from './utils.js';
import * as shared from './ui-shared.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

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

// --- Global State ---
let uiState = shared.createBaseState();
let voices = [];
let contentReady = false;
let voiceRetryRef = { count: 0 };
let pdfUrl = null;

// --- Utilities ---

function setControlsEnabled(enabled) {
  btnPlay.disabled = !enabled;
  btnStop.disabled = !enabled;
  btnPrev.disabled = !enabled;
  btnNext.disabled = !enabled;
  if (btnPrevPara) btnPrevPara.disabled = !enabled;
  if (btnNextPara) btnNextPara.disabled = !enabled;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setControlsEnabled(false);
  await shared.loadSharedSettings(uiState, {
    rateRange, rateValue, pitchRange, pitchValue, volumeRange, volumeValue,
    highlightModeSelect, chkAutoScroll
  });
  shared.applyTheme(uiState.settings.theme, iconTheme);
  voices = shared.setupVoiceSelection(uiState, { voiceSelect, voiceError }, voiceRetryRef);

  const query = new URLSearchParams(location.search);
  pdfUrl = query.get("url");

  if (!pdfUrl) {
    textContent.innerHTML = '<p class="placeholder-text">No PDF URL provided.</p>';
    return;
  }

  try {
    new URL(pdfUrl);
  } catch {
    textContent.innerHTML = '<p class="placeholder-text">Invalid PDF URL.</p>';
    return;
  }

  try {
    const text = await extractPdfText(pdfUrl);
    if (text) {
      contentReady = true;
      const saved = await getSavedPosition(pdfUrl);
      const index = saved && saved.index > 0 ? saved.index : 0;
      sendCommand('INIT', { text, index, settings: uiState.settings, tabUrl: pdfUrl });
      updatePlayButtonState();
    } else {
      textContent.innerHTML = '<p class="placeholder-text">No text found in PDF.</p>';
    }
  } catch (err) {
    console.error("PDF extraction failed:", err);
    textContent.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
});

async function extractPdfText(url) {
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const pageContent = await page.getTextContent();
    const items = pageContent.items;

    if (items.length === 0) continue;

    // Sort items: Top to Bottom (Y descending), then Left to Right (X ascending)
    // pdf.js Y-coordinates usually start from the bottom.
    // transform[5] is Y, transform[4] is X.
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 5) return yDiff; // Use 5pt tolerance for "same line"
      return a.transform[4] - b.transform[4];
    });

    let pageText = "";
    let lastItem = null;

    for (const item of items) {
      if (!item.str.trim()) continue;

      if (lastItem) {
        const yDiff = Math.abs(item.transform[5] - lastItem.transform[5]);
        const xDiff = item.transform[4] - (lastItem.transform[4] + lastItem.width);
        
        // Determine spacing based on vertical and horizontal gaps
        if (yDiff > 5) {
          // Significant vertical jump - likely a new line or paragraph
          pageText += (yDiff > 15) ? "\n\n" : "\n";
        } else if (xDiff > item.height * 0.5) {
          // Horizontal gap - likely a space or column jump
          pageText += " ";
        }
      }

      pageText += item.str;
      lastItem = item;
    }

    if (pageNum > 1) fullText += "\n\n";
    fullText += pageText;
  }

  return fullText.trim();
}

// --- Communication ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_UI') {
    shared.handleUpdateUI(uiState, msg.state, {
      renderSentences,
      highlightWord,
      highlightCurrentSentence,
      togglePlayIcon: (active) => shared.togglePlayIcon(active, iconPlay, iconPause),
      updateProgress: () => shared.updateProgress(uiState, progressBar),
      updatePlayButtonState
    });
    return false;
  }
  return false;
});

function sendCommand(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload });
}

function updatePlayButtonState() {
  const hasContent = uiState.sentences.length > 0;
  setControlsEnabled(hasContent);
}

// --- UI Rendering ---

function renderSentences() {
  shared.renderSentences(uiState, textContent, (index) => sendCommand('JUMP', { index }));
}

function highlightCurrentSentence() {
  document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
  document.querySelectorAll('.word-highlight').forEach(el => el.classList.remove('word-highlight'));
  const el = document.getElementById(`sentence-${uiState.currentIndex}`);
  if (el) {
    el.classList.add('highlight');
    if (uiState.settings.autoScroll && !shared.isElementInViewport(el, textContent)) {
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
      if (uiState.settings.autoScroll && !shared.isElementInViewport(wspan, textContent)) {
        wspan.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      break;
    }
    charCount += wordLen;
  }
}

// --- Settings & Voices ---

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

btnStop.onclick = () => sendCommand('STOP');
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

btnTheme.onclick = () => {
  const themes = ['auto', 'light', 'dark'];
  const current = uiState.settings.theme || 'auto';
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  uiState.settings.theme = next;
  shared.applyTheme(next, iconTheme);
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
    theme: 'auto'
  };
  await saveSettings();
  await shared.loadSharedSettings(uiState, {
    rateRange, rateValue, pitchRange, pitchValue, volumeRange, volumeValue,
    highlightModeSelect, chkAutoScroll
  });
  shared.applyTheme(uiState.settings.theme, iconTheme);
  sendSettings();
};
