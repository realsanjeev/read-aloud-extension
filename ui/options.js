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
  ratePresets: document.getElementById('ratePresets'),
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

document.addEventListener('DOMContentLoaded', async () => {
  await shared.loadSharedSettings(uiState, elements);
  shared.applyTheme(uiState.settings.theme, elements.iconTheme);
  shared.setupVoiceSelection(uiState, { voiceSelect: elements.voiceSelect, voiceError: elements.voiceError });

  shared.wireSettingsListeners(uiState, elements);
});
