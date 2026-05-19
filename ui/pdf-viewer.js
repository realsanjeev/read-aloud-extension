// pdf-viewer.js - PDF Viewer with integrated TTS controls
import { hashStr, debounce, getSavedPosition } from './utils.js';

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
    theme: 'auto'
  }

let voices = [];
let contentReady = false;
let voiceRetryCount = 0;
const MAX_VOICE_RETRIES = 20;
let pdfUrl = null;

// --- Utilities ---

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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setControlsEnabled(false);
  await loadSettings();
  applyTheme(uiState.settings.theme);
  setupVoiceSelection();

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
    let lastY = -1;
    let pageText = "";

    for (const item of pageContent.items) {
      if (lastY !== item.transform[5] && pageText.length > 0) {
        pageText += "\n";
      }
      pageText += item.str;
      lastY = item.transform[5];
    }

    if (pageNum > 1) fullText += "\n\n";
    fullText += pageText;
  }

  return fullText.trim();
}

// --- Communication ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_UI') {
    handleUpdateUI(msg.state);
    return false;
  }
  return false;
});

function sendCommand(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload });
}

function handleUpdateUI(state) {
  const hasSentences = state.sentences && state.sentences.length > 0;
  const needsRerender = hasSentences && (
    uiState.sentences.length !== state.sentences.length ||
    uiState.sentences[0] !== state.sentences[0]
  );

  if (hasSentences) {
    uiState.sentences = state.sentences;
  }

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

function updatePlayButtonState() {
  const hasContent = uiState.sentences.length > 0;
  setControlsEnabled(hasContent);
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
  if (uiState.sentences.length === 0) return;
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



// --- Settings & Voices ---

async function loadSettings() {
  const data = await chrome.storage.sync.get([
    'voiceName', 'rate', 'pitch', 'volume', 'highlightMode', 'autoScroll', 'theme'
  ]);
  uiState.settings = {
    voiceName: data.voiceName || null,
    rate: parseFloat(data.rate) || 1.0,
    pitch: parseFloat(data.pitch) || 1.0,
    volume: parseFloat(data.volume) || 1.0,
    highlightMode: data.highlightMode || 'sentence',
    autoScroll: data.autoScroll !== undefined ? data.autoScroll : true,
    theme: data.theme || 'auto'
  };

  rateRange.value = uiState.settings.rate;
  rateValue.textContent = uiState.settings.rate + "x";
  pitchRange.value = uiState.settings.pitch;
  pitchValue.textContent = uiState.settings.pitch;
  volumeRange.value = uiState.settings.volume;
  volumeValue.textContent = uiState.settings.volume;
  highlightModeSelect.value = uiState.settings.highlightMode;
  chkAutoScroll.checked = uiState.settings.autoScroll;
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

rateRange.onchange = (e) => {
  saveSettings();
  sendSettings();

pitchRange.oninput = (e) => {
  uiState.settings.pitch = parseFloat(e.target.value);
  pitchValue.textContent = e.target.value;
  debouncedSaveSettings();

pitchRange.onchange = (e) => {
  saveSettings();
  sendSettings();

volumeRange.oninput = (e) => {
  uiState.settings.volume = parseFloat(e.target.value);
  volumeValue.textContent = e.target.value;
  debouncedSaveSettings();

volumeRange.onchange = (e) => {
  saveSettings();
  sendSettings();

voiceSelect.onchange = (e) => {
  uiState.settings.voiceName = e.target.value;
  saveSettings();
  sendSettings();

highlightModeSelect.onchange = (e) => {
  uiState.settings.highlightMode = e.target.value;
  saveSettings();
  sendSettings();
  renderSentences();
  highlightCurrentSentence();

chkAutoScroll.onchange = (e) => {
  uiState.settings.autoScroll = e.target.checked;
  saveSettings();
  sendSettings();

btnTheme.onclick = () => {
  const themes = ['auto', 'light', 'dark'];
  const current = uiState.settings.theme || 'auto';
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  uiState.settings.theme = next;
  applyTheme(next);
  saveSettings();
  sendSettings();

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
  await saveSettings();     // Persist defaults to storage first
  await loadSettings();     // Reload UI from the freshly saved defaults
  applyTheme(uiState.settings.theme);
  sendSettings();
