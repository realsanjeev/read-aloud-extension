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
  if (elements.ratePresets) {
    elements.ratePresets.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === uiState.settings.rate);
    });
  }
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

      const voicesByLang = {};
      const userLang = navigator.language || 'en';
      const langDN = window.Intl && window.Intl.DisplayNames ? new Intl.DisplayNames([userLang], { type: 'language' }) : null;
      const regionDN = window.Intl && window.Intl.DisplayNames ? new Intl.DisplayNames([userLang], { type: 'region' }) : null;
      const scriptDN = window.Intl && window.Intl.DisplayNames ? new Intl.DisplayNames([userLang], { type: 'script' }) : null;

      voices.forEach(v => {
        let label = v.lang || 'Unknown';
        if (langDN && v.lang) {
          try {
            // Replace underscores with dashes for Intl compatibility (e.g. zh_CN -> zh-CN)
            const normalizedLang = v.lang.replace('_', '-');
            if (window.Intl && window.Intl.Locale) {
              const loc = new Intl.Locale(normalizedLang);
              let base = langDN.of(loc.language);
              let suffixes = [];
              if (loc.script && scriptDN) suffixes.push(scriptDN.of(loc.script));
              if (loc.region && regionDN) suffixes.push(regionDN.of(loc.region));
              
              if (suffixes.length > 0) {
                label = `${base} (${suffixes.join(', ')})`;
              } else {
                label = base;
              }
            } else {
              label = langDN.of(normalizedLang);
            }
          } catch (e) {
            // Fallback to lang code if Intl fails
          }
        }
        if (!voicesByLang[label]) {
          voicesByLang[label] = [];
        }
        voicesByLang[label].push(v);
      });

      const sortedLangs = Object.keys(voicesByLang).sort();
      sortedLangs.forEach(label => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = label;
        voicesByLang[label].forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = v.name;
          optgroup.appendChild(opt);
        });
        elements.voiceSelect.appendChild(optgroup);
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

// --- Shared controller functions (eliminates popup/pdf-viewer duplication) ---

/**
 * Enable or disable all player control buttons.
 */
export function setControlsEnabled(elements, enabled) {
  if (elements.btnPlay) elements.btnPlay.disabled = !enabled;
  if (elements.btnStop) elements.btnStop.disabled = !enabled;
  if (elements.btnPrev) elements.btnPrev.disabled = !enabled;
  if (elements.btnNext) elements.btnNext.disabled = !enabled;
  if (elements.btnPrevPara) elements.btnPrevPara.disabled = !enabled;
  if (elements.btnNextPara) elements.btnNextPara.disabled = !enabled;
}

/**
 * Highlight the current sentence in the text area and optionally auto-scroll.
 */
export function highlightCurrentSentence(uiState, textContent) {
  document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
  document.querySelectorAll('.word-highlight').forEach(el => el.classList.remove('word-highlight'));
  const el = document.getElementById(`sentence-${uiState.currentIndex}`);
  if (el) {
    el.classList.add('highlight');
    if (uiState.settings.autoScroll && !isElementInViewport(el, textContent)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

/**
 * Highlight a specific word within a sentence (word-level highlight mode).
 */
export function highlightWord(uiState, textContent, boundary) {
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
      if (uiState.settings.autoScroll && !isElementInViewport(wspan, textContent)) {
        wspan.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      break;
    }
    charCount += wordLen;
  }
}

/**
 * Send a command message to the background service worker.
 */
export function sendCommand(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload });
}

/**
 * Persist current settings to chrome.storage.sync.
 */
export function saveSettings(uiState) {
  chrome.storage.sync.set(uiState.settings);
}

/**
 * Push current settings to the offscreen player via UPDATE_SETTINGS.
 */
export function sendSettings(uiState) {
  sendCommand('UPDATE_SETTINGS', { settings: uiState.settings });
}

/**
 * Wire up all settings panel event listeners (sliders, selects, checkboxes, buttons).
 * `extraHandlers` can include:
 *   - onMiniPlayerChange(checked): called when the mini-player checkbox toggles
 *   - onHighlightModeChange(): called after highlight mode changes (to re-render)
 */
export function wireSettingsListeners(uiState, elements, extraHandlers = {}) {
  const debouncedSave = debounce(() => saveSettings(uiState), 300);

  if (elements.rateRange) {
    elements.rateRange.oninput = (e) => {
      uiState.settings.rate = parseFloat(e.target.value);
      if (elements.rateValue) elements.rateValue.textContent = e.target.value + "x";
      if (elements.ratePresets) {
        elements.ratePresets.querySelectorAll('.preset-btn').forEach(btn => {
          btn.classList.toggle('active', parseFloat(btn.dataset.rate) === uiState.settings.rate);
        });
      }
      debouncedSave();
    };
    elements.rateRange.onchange = () => {
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.ratePresets) {
    elements.ratePresets.onclick = (e) => {
      const btn = e.target.closest('.preset-btn');
      if (btn) {
        const rate = parseFloat(btn.dataset.rate);
        uiState.settings.rate = rate;
        if (elements.rateRange) elements.rateRange.value = rate;
        if (elements.rateValue) elements.rateValue.textContent = rate + "x";
        
        elements.ratePresets.querySelectorAll('.preset-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        
        saveSettings(uiState);
        sendSettings(uiState);
      }
    };
  }

  if (elements.pitchRange) {
    elements.pitchRange.oninput = (e) => {
      uiState.settings.pitch = parseFloat(e.target.value);
      if (elements.pitchValue) elements.pitchValue.textContent = e.target.value;
      debouncedSave();
    };
    elements.pitchRange.onchange = () => {
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.volumeRange) {
    elements.volumeRange.oninput = (e) => {
      uiState.settings.volume = parseFloat(e.target.value);
      if (elements.volumeValue) elements.volumeValue.textContent = e.target.value;
      debouncedSave();
    };
    elements.volumeRange.onchange = () => {
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.voiceSelect) {
    elements.voiceSelect.onchange = (e) => {
      uiState.settings.voiceName = e.target.value;
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.highlightModeSelect) {
    elements.highlightModeSelect.onchange = (e) => {
      uiState.settings.highlightMode = e.target.value;
      saveSettings(uiState);
      sendSettings(uiState);
      if (extraHandlers.onHighlightModeChange) extraHandlers.onHighlightModeChange();
    };
  }

  if (elements.chkAutoScroll) {
    elements.chkAutoScroll.onchange = (e) => {
      uiState.settings.autoScroll = e.target.checked;
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.chkMiniPlayer) {
    elements.chkMiniPlayer.onchange = (e) => {
      uiState.settings.miniPlayer = e.target.checked;
      saveSettings(uiState);
      sendSettings(uiState);
      if (extraHandlers.onMiniPlayerChange) extraHandlers.onMiniPlayerChange(e.target.checked);
    };
  }

  if (elements.btnSettings && elements.settingsPanel) {
    elements.btnSettings.onclick = () => elements.settingsPanel.classList.remove('hidden');
  }
  if (elements.btnCloseSettings && elements.settingsPanel) {
    elements.btnCloseSettings.onclick = () => elements.settingsPanel.classList.add('hidden');
  }

  if (elements.btnTheme) {
    elements.btnTheme.onclick = () => {
      const themes = ['auto', 'light', 'dark'];
      const current = uiState.settings.theme || 'auto';
      const next = themes[(themes.indexOf(current) + 1) % themes.length];
      uiState.settings.theme = next;
      applyTheme(next, elements.iconTheme || null);
      saveSettings(uiState);
      sendSettings(uiState);
    };
  }

  if (elements.btnTestVoice) {
    elements.btnTestVoice.onclick = () => sendCommand('TEST');
  }

  if (elements.btnReset) {
    elements.btnReset.onclick = async () => {
      const defaultSettings = {
        voiceName: null,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        highlightMode: 'sentence',
        autoScroll: true,
        theme: 'auto'
      };
      // Preserve miniPlayer if the element exists (popup-specific)
      if (elements.chkMiniPlayer) defaultSettings.miniPlayer = true;

      uiState.settings = defaultSettings;
      await saveSettings(uiState);
      await loadSharedSettings(uiState, elements);
      applyTheme(uiState.settings.theme, elements.iconTheme || null);
      sendSettings(uiState);
    };
  }
}

/**
 * Wire up playback control buttons (play, stop, next, prev, paragraph nav).
 * `playGuard` is called before play — should return true if play should be blocked.
 */
export function wirePlayerControls(uiState, elements, playGuard = null) {
  if (elements.btnPlay) {
    elements.btnPlay.onclick = () => {
      if (playGuard && playGuard()) return;
      sendCommand('TOGGLE_PLAY');
    };
  }

  if (elements.btnStop) {
    elements.btnStop.onclick = () => sendCommand('STOP');
  }

  if (elements.btnNext) {
    elements.btnNext.onclick = () => sendCommand('NEXT');
  }
  if (elements.btnPrev) {
    elements.btnPrev.onclick = () => sendCommand('PREV');
  }

  if (elements.btnNextPara) {
    elements.btnNextPara.onclick = () => sendCommand('NEXT_PARA');
  }
  if (elements.btnPrevPara) {
    elements.btnPrevPara.onclick = () => sendCommand('PREV_PARA');
  }
}

/**
 * Create the standard callbacks object for handleUpdateUI.
 * Eliminates boilerplate in popup.js and pdf-viewer.js.
 * `extraCallbacks` can override any default callback (e.g. updatePlayButtonState).
 */
export function createHandleUpdateUICallbacks(uiState, elements, extraCallbacks = {}) {
  return {
    renderSentences: () => renderSentences(uiState, elements.textContent, (index) => sendCommand('JUMP', { index })),
    highlightWord: (boundary) => highlightWord(uiState, elements.textContent, boundary),
    highlightCurrentSentence: () => highlightCurrentSentence(uiState, elements.textContent),
    togglePlayIcon: (active) => togglePlayIcon(active, elements.iconPlay, elements.iconPause),
    updateProgress: () => updateProgress(uiState, elements.progressBar),
    updatePlayButtonState: () => setControlsEnabled(elements, uiState.sentences.length > 0),
    ...extraCallbacks
  };
}

