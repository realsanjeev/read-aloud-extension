import * as shared from './ui-shared.js';

const elements = {
  btnTheme: document.getElementById('btnTheme'),
  btnTestVoice: document.getElementById('btnTestVoice'),
  btnReset: document.getElementById('btnReset'),
  iconTheme: document.getElementById('iconTheme'),
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

let uiState = shared.createBaseState();
uiState.settings.miniPlayer = true;

let voiceRetryRef = { count: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  await shared.loadSharedSettings(uiState, elements);
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  shared.setupVoiceSelection(uiState, { voiceSelect: elements.voiceSelect, voiceError: elements.voiceError }, voiceRetryRef);

  shared.wireSettingsListeners(uiState, elements, {
    onMiniPlayerChange: async (checked) => {
      // Toggle mini player on the active tab if it's currently injected
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
           chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_PLAYER', visible: checked }).catch(() => {});
        }
      } catch (e) {
        console.warn("Could not message active tab", e);
      }
    }
  });
});