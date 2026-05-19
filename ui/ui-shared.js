// ui-shared.js - Shared UI logic for popup and pdf-viewer
import { debounce } from './utils.js';

export const MAX_VOICE_RETRIES = 20;

export function createBaseState() {
  return {
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
  };
}

export function isElementInViewport(el, parent) {
  const rect = el.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return (
    rect.top >= parentRect.top &&
    rect.bottom <= parentRect.bottom
  );
}

export function applyTheme(theme, iconTheme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    if (iconTheme) iconTheme.innerHTML = `<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>`;
  } else if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
    if (iconTheme) iconTheme.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
    root.setAttribute('data-theme', 'auto');
    if (iconTheme) iconTheme.innerHTML = `<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>`;
  }
}

export async function loadSharedSettings(uiState, elements) {
  const data = await chrome.storage.sync.get([
    'voiceName', 'rate', 'pitch', 'volume', 'highlightMode', 'autoScroll', 'theme', 'miniPlayer'
  ]);
  
  Object.assign(uiState.settings, {
    voiceName: data.voiceName || null,
    rate: parseFloat(data.rate) || 1.0,
    pitch: parseFloat(data.pitch) || 1.0,
    volume: parseFloat(data.volume) || 1.0,
    highlightMode: data.highlightMode || 'sentence',
    autoScroll: data.autoScroll !== undefined ? data.autoScroll : true,
    theme: data.theme || 'auto'
  });

  if (data.miniPlayer !== undefined) uiState.settings.miniPlayer = data.miniPlayer;

  if (elements.rateRange) elements.rateRange.value = uiState.settings.rate;
  if (elements.rateValue) elements.rateValue.textContent = uiState.settings.rate + "x";
  if (elements.pitchRange) elements.pitchRange.value = uiState.settings.pitch;
  if (elements.pitchValue) elements.pitchValue.textContent = uiState.settings.pitch;
  if (elements.volumeRange) elements.volumeRange.value = uiState.settings.volume;
  if (elements.volumeValue) elements.volumeValue.textContent = uiState.settings.volume;
  if (elements.highlightModeSelect) elements.highlightModeSelect.value = uiState.settings.highlightMode;
  if (elements.chkAutoScroll) elements.chkAutoScroll.checked = uiState.settings.autoScroll;
  if (elements.chkMiniPlayer) elements.chkMiniPlayer.checked = uiState.settings.miniPlayer;
}

export function setupVoiceSelection(uiState, elements, voiceRetryRef) {
  const updateVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      if (voiceRetryRef.count < MAX_VOICE_RETRIES) {
        voiceRetryRef.count++;
        setTimeout(updateVoices, 200);
      } else {
        if (elements.voiceError) elements.voiceError.classList.remove('hidden');
        if (elements.voiceSelect) elements.voiceSelect.innerHTML = '<option value="">No voices available</option>';
      }
      return voices;
    }
    if (elements.voiceError) elements.voiceError.classList.add('hidden');
    if (elements.voiceSelect) {
      elements.voiceSelect.innerHTML = '';
      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        elements.voiceSelect.appendChild(opt);
      });
      if (uiState.settings.voiceName) {
        elements.voiceSelect.value = uiState.settings.voiceName;
      }
    }
    return voices;
  };

  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = updateVoices;
  }
  return updateVoices();
}

export function handleUpdateUI(uiState, state, callbacks) {
  const hasSentences = state.sentences && state.sentences.length > 0;
  const needsRerender = hasSentences && (
    uiState.sentences.length !== state.sentences.length ||
    uiState.sentences[0] !== state.sentences[0]
  );

  if (hasSentences) {
    uiState.sentences = state.sentences;
  }

  const { sentences, ...rest } = state;
  Object.assign(uiState, rest);

  if (needsRerender && callbacks.renderSentences) {
    callbacks.renderSentences();
  }

  if (state.wordBoundary) {
    if (callbacks.highlightWord) callbacks.highlightWord(state.wordBoundary);
  } else {
    if (callbacks.highlightCurrentSentence) callbacks.highlightCurrentSentence();
  }

  if (callbacks.togglePlayIcon) callbacks.togglePlayIcon(uiState.isPlaying && !uiState.isPaused);
  if (callbacks.updateProgress) callbacks.updateProgress();
  if (callbacks.updatePlayButtonState) callbacks.updatePlayButtonState();
}

export function renderSentences(uiState, container, sendJumpCommand) {
  container.innerHTML = "";
  uiState.sentences.forEach((sentence, index) => {
    if (uiState.lineBreaks && uiState.lineBreaks.includes(index)) {
      container.appendChild(document.createElement('br'));
      container.appendChild(document.createElement('br'));
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
    span.onclick = () => sendJumpCommand(index);
    container.appendChild(span);
  });
}

export function updateProgress(uiState, progressBar) {
  if (!uiState.sentences || uiState.sentences.length === 0) return;
  const progress = ((uiState.currentIndex + 1) / uiState.sentences.length) * 100;
  progressBar.style.width = `${Math.min(progress, 100)}%`;
}

export function togglePlayIcon(active, iconPlay, iconPause) {
  if (active) {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
  } else {
    iconPlay.classList.remove('hidden');
    iconPause.classList.add('hidden');
  }
}
