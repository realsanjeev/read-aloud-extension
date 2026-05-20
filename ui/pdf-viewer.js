// pdf-viewer.js - PDF Viewer with integrated TTS controls
import { getSavedPosition } from './utils.js';
import * as shared from './ui-shared.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

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
  textContent: document.getElementById('textArea'),
  progressBar: document.getElementById('progressBar'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  iconTheme: document.getElementById('iconTheme'),
};

// --- Global State ---
let uiState = shared.createBaseState();
let voices = [];
let contentReady = false;
let voiceRetryRef = { count: 0 };
let pdfUrl = null;

// --- Helpers ---

function updatePlayButtonState() {
  shared.setControlsEnabled(elements, uiState.sentences.length > 0);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  shared.setControlsEnabled(elements, false);
  await shared.loadSharedSettings(uiState, elements);
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  voices = shared.setupVoiceSelection(uiState, {}, voiceRetryRef);

  if (elements.btnSettings) {
    elements.btnSettings.onclick = () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('ui/options.html'));
      }
    };
  }

  // Wire up theme toggle
  shared.wireSettingsListeners(uiState, elements);
  
  shared.wirePlayerControls(uiState, elements, () => {
    if (!contentReady || uiState.sentences.length === 0) {
      elements.textContent.classList.add('shake');
      setTimeout(() => elements.textContent.classList.remove('shake'), 400);
      return true; // block play
    }
    return false;
  });

  const query = new URLSearchParams(location.search);
  pdfUrl = query.get("url");

  if (!pdfUrl) {
    elements.textContent.innerHTML = '<p class="placeholder-text">No PDF URL provided.</p>';
    return;
  }

  try {
    new URL(pdfUrl);
  } catch {
    elements.textContent.innerHTML = '<p class="placeholder-text">Invalid PDF URL.</p>';
    return;
  }

  try {
    const text = await extractPdfText(pdfUrl);
    if (text) {
      contentReady = true;
      const saved = await getSavedPosition(pdfUrl);
      const index = saved && saved.index > 0 ? saved.index : 0;
      shared.sendCommand('INIT', { text, index, settings: uiState.settings, tabUrl: pdfUrl });
      updatePlayButtonState();
    } else {
      elements.textContent.innerHTML = '<p class="placeholder-text">No text found in PDF.</p>';
    }
  } catch (err) {
    console.error("PDF extraction failed:", err);
    elements.textContent.innerHTML = `<p class="error">Error: ${err.message}</p>`;
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
    shared.handleUpdateUI(uiState, msg.state, shared.createHandleUpdateUICallbacks(uiState, elements));
    return false;
  }
  return false;
});
