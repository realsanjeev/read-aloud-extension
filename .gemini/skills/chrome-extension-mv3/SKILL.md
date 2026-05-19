---
name: chrome-extension-mv3
description: Specialized knowledge for Chrome Extension Manifest V3 development. Use when modifying manifest.json, background service workers, content scripts, or extension APIs.
---

# Chrome Extension MV3

Guidance for developing the Speak Aloud Extension using Manifest V3.

## Core Components

- **Service Worker (`background.js`)**:
  - Event-driven, no persistent state in memory.
  - Use `chrome.storage.local` for persistence.
  - Listen for `chrome.runtime.onInstalled` and `chrome.commands.onCommand`.

- **Content Scripts (`content.js`)**:
  - Injected into web pages.
  - Use `Readability.js` for content extraction.
  - Communicates with background via `chrome.runtime.sendMessage`.

- **Offscreen Document (`ui/offscreen.html`)**:
  - Required for APIs not available in service workers (like `window`, `DOM`, `SpeechSynthesis`).
  - Manage lifecycle: `chrome.offscreen.createDocument` and `chrome.offscreen.closeDocument`.

## Message Passing Patterns

Always use a consistent structure for messages:
```javascript
{
  type: 'ACTION_NAME',
  payload: { ... }
}
```

## Permissions & Security

- `activeTab`: Temporary access to the current tab.
- `storage`: For saving user preferences.
- `offscreen`: For TTS and audio.
- `scripting`: For programmatic injection of content scripts.

## Debugging

- Inspect Background: `chrome://extensions` -> "service worker" link.
- Inspect Popup: Right-click extension icon -> "Inspect popup".
- Inspect Content Script: Tab DevTools -> "Console" -> Filter to "Speak Aloud Extension".
