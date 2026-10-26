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
  dropZone: document.getElementById('dropZone'),
  btnBrowse: document.getElementById('btnBrowse'),
  fileInput: document.getElementById('fileInput'),
};

// --- Global State ---
let uiState = shared.createBaseState();
let contentReady = false;

// --- Helpers ---

function updatePlayButtonState() {
  shared.setControlsEnabled(elements, uiState.sentences.length > 0);
}

function showDropZone() {
  elements.textContent.classList.add('hidden');
  elements.dropZone.classList.remove('hidden');
  shared.setControlsEnabled(elements, false);
}

function showTextArea() {
  elements.textContent.classList.remove('hidden');
  elements.dropZone.classList.add('hidden');
}

/**
 * Hands extracted text to the player, resuming from a saved position if any.
 * `positionKey` identifies the document for resume (URL or file_upload://name).
 */
async function startReading(text, positionKey) {
  if (!text) {
    elements.textContent.innerHTML = '<p class="placeholder-text">No text found in PDF.</p>';
    return;
  }
  contentReady = true;
  const saved = await getSavedPosition(positionKey);
  const index = saved && saved.index > 0 ? saved.index : 0;
  shared.sendCommand('INIT', { text, index, settings: uiState.settings, tabUrl: positionKey });
  updatePlayButtonState();
}

async function handleLocalFile(file) {
  try {
    elements.textContent.innerHTML = '<p class="placeholder-text">Reading PDF file and extracting text...</p>';
    showTextArea();
    const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    await startReading(text, `file_upload://${file.name}`);
  } catch (err) {
    console.error("Local PDF extraction failed:", err);
    elements.textContent.innerHTML = '<p class="error">Error extracting PDF: <span class="error-msg"></span></p>';
    const errorMsgEl = elements.textContent.querySelector('.error-msg');
    if (errorMsgEl) errorMsgEl.textContent = err.message || 'Unknown error';
  }
}

async function loadPdfFromSource(sourceUrl) {
  try {
    elements.textContent.innerHTML = '<p class="placeholder-text">Loading PDF and extracting text...</p>';
    showTextArea();

    let pdfData = sourceUrl;
    if (!sourceUrl.startsWith('file://')) {
      const origins = [new URL(sourceUrl).origin + '/*'];
      if (!(await chrome.permissions.contains({ origins }))) {
        // permissions.request() only works inside a user gesture, so ask via a button.
        await new Promise((resolve, reject) => {
          elements.textContent.innerHTML = `
            <div style="padding: 20px; text-align: center;">
              <p class="placeholder-text">Allow access to this site so the PDF can be downloaded.</p>
              <button id="btnGrantAccess" class="retry-btn">Allow access</button>
            </div>`;
          document.getElementById('btnGrantAccess').onclick = () => {
            chrome.permissions.request({ origins }).then((granted) => {
              if (!granted) return reject(new Error('Host permission denied. Please allow access to this site to load the PDF.'));
              elements.textContent.innerHTML = '<p class="placeholder-text">Loading PDF and extracting text...</p>';
              resolve();
            }, reject);
          };
        });
      }
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      pdfData = new Uint8Array(await response.arrayBuffer());
    }
    await startReading(await extractPdfText(pdfData), sourceUrl);
  } catch (err) {
    console.error("PDF load failed:", err);
    elements.textContent.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <p class="error" style="font-weight: bold; margin-bottom: 12px;">Failed to Load PDF</p>
        <p class="error-detail" style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 24px;"></p>
      </div>
    `;
    const errorDetailEl = elements.textContent.querySelector('.error-detail');
    if (errorDetailEl) {
      errorDetailEl.textContent = err.message || "An unknown error occurred while trying to parse the PDF.";
    }
    // Keep the error visible and offer the drop zone below it
    elements.dropZone.classList.remove('hidden');
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  shared.setControlsEnabled(elements, false);
  await shared.loadSharedSettings(uiState, elements);
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  shared.setupVoiceSelection(uiState, { voiceSelect: elements.voiceSelect, voiceError: elements.voiceError });

  // Wire up settings panel event listeners
  shared.wireSettingsListeners(uiState, elements, {
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

  // Set up drag and drop
  if (elements.dropZone && elements.fileInput && elements.btnBrowse) {
    elements.btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.fileInput.click();
    });
    
    elements.dropZone.addEventListener('click', () => {
      elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await handleLocalFile(file);
      }
    });

    elements.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.dropZone.classList.add('dragover');
    });

    elements.dropZone.addEventListener('dragleave', () => {
      elements.dropZone.classList.remove('dragover');
    });

    elements.dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      elements.dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        await handleLocalFile(file);
      } else {
        alert("Please drop a valid PDF file.");
      }
    });
  }

  const pdfUrl = new URLSearchParams(location.search).get("url");

  if (!pdfUrl) {
    showDropZone();
    return;
  }

  try {
    new URL(pdfUrl);
  } catch {
    elements.textContent.innerHTML = '<p class="placeholder-text">Invalid PDF URL.</p>';
    elements.dropZone.classList.remove('hidden');
    return;
  }

  if (pdfUrl.startsWith('file://')) {
    if (typeof chrome.extension !== 'undefined' && chrome.extension.isAllowedFileSchemeAccess) {
      chrome.extension.isAllowedFileSchemeAccess(async (isAllowed) => {
        if (!isAllowed) {
          console.warn("Extension does not have access to file URLs.");
          elements.textContent.innerHTML = `
            <div style="padding: 20px; text-align: center;">
              <p class="error" style="font-weight: bold; margin-bottom: 12px; color: #ef4444;">Local PDF URL Blocked by Chrome</p>
              <p style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.6;">
                Chrome extensions require explicit permission to read local files directly.
              </p>
              <p style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
                Please drag and drop your local PDF below to read it instantly, or go to <strong style="color: var(--primary-color)">chrome://extensions</strong>, find "Read Aloud Extension", and check "Allow access to file URLs".
              </p>
            </div>
          `;
          elements.dropZone.classList.remove('hidden');
        } else {
          await loadPdfFromSource(pdfUrl);
        }
      });
    } else {
      await loadPdfFromSource(pdfUrl);
    }
  } else {
    await loadPdfFromSource(pdfUrl);
  }
});

async function extractPdfText(source) {
  const param = (source instanceof Uint8Array) ? { data: source } : source;
  const loadingTask = pdfjsLib.getDocument(param);
  const pdf = await loadingTask.promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const pageContent = await page.getTextContent();
    const items = pageContent.items;

    if (items.length === 0) continue;

    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    let pageText = "";
    let lastItem = null;

    for (const item of items) {
      if (!item.str.trim()) continue;

      if (lastItem) {
        const yDiff = Math.abs(item.transform[5] - lastItem.transform[5]);
        const xDiff = item.transform[4] - (lastItem.transform[4] + lastItem.width);
        
        if (yDiff > 5) {
          pageText += (yDiff > 15) ? "\n\n" : "\n";
        } else if (xDiff > item.height * 0.5) {
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_UI') {
    shared.handleUpdateUI(uiState, msg.state, shared.createHandleUpdateUICallbacks(uiState, elements));
  }
  return false;
});
