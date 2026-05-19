---
name: web-speech-tts
description: Specialized guidance for Web Speech API and Text-to-Speech implementation in an offscreen document. Use when working on ui/offscreen.js or speech logic.
---

# Web Speech TTS

Handling audio playback and SpeechSynthesis in the Speak Aloud Extension.

## SpeechSynthesis API

- **Voices**: Use `speechSynthesis.getVoices()` to list available voices. Note that it's async and may need an event listener.
- **Utterance**: `new SpeechSynthesisUtterance(text)`
- **Properties**: `rate`, `pitch`, `volume`, `voice`, `lang`.

## State Management

Maintain a clear state machine for playback:
- `PLAYING`
- `PAUSED`
- `STOPPED`

Handle `onend`, `onerror`, `onpause`, and `onresume` events on the utterance to sync state with the rest of the extension.

## Offscreen Document Implementation

`ui/offscreen.js` should:
1. Listen for messages from `background.js`.
2. Initialize `speechSynthesis`.
3. Handle utterance lifecycle.
4. Report status updates back to `background.js`.

## Known Issues & Workarounds

- **Long Text**: Break text into smaller chunks (sentences) to prevent the SpeechSynthesis engine from timing out or hanging on some platforms.
- **Resume Bug**: `speechSynthesis.resume()` can be flaky on some Chrome versions. A common workaround is to briefly call `pause()` then `resume()`.
