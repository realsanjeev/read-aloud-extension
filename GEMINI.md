# Speak Aloud Extension - Project Instructions

This project is a Chrome extension that provides Text-to-Speech (TTS) capabilities for web pages and PDF files.

## Project Structure

- `manifest.json`: Extension configuration (Manifest V3).
- `scripts/`:
  - `background.js`: Service worker handling extension lifecycle and global state.
  - `content.js`: Content script for page interaction and text extraction.
- `ui/`:
  - `popup.html/js`: The main user interface.
  - `offscreen.html/js`: Offscreen document for SpeechSynthesis and audio playback.
  - `pdf-viewer.html/js`: Custom PDF viewer using `pdf.js`.
  - `utils.js`: Shared utility functions.
- `lib/`: Third-party libraries (`pdf.js`, `Readability.js`).
- `assets/`: Icons, CSS, and images.

## Architecture & Conventions

### Manifest V3
- Adhere strictly to Manifest V3 standards.
- Use `chrome.offscreen` for audio playback and `SpeechSynthesis`.

### Communication
- Use `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage` for inter-component communication.
- Standardize message types: `INIT`, `PLAY`, `PAUSE`, `STOP`, `TOGGLE_PLAY`, `NEXT`, `PREV`, `NEXT_PARA`, `PREV_PARA`, `JUMP`, `UPDATE_SETTINGS`, `TEST`, `GET_STATE`, `DETECT_LANG`, `UPDATE_UI`.

### State Management
- `background.js` acts as the primary orchestrator.
- Persistent state should be stored in `chrome.storage.local`.

### UI Styling
- Use Vanilla CSS (found in `assets/style.css` and within `ui/` HTML files).
- Maintain a clean, megaphone-themed aesthetic.

## Tools & Integrations

### GitHub MCP
This project is configured to use the GitHub MCP server for repository interactions.
- **Requirement**: A GitHub Personal Access Token (PAT) with `repo` and `workflow` scopes.
- **Setup**: The extension is configured to use the token from `GITHUB_FIT_TOKEN`. You can load it from your local secret file by adding this to your shell profile:
  ```bash
  export GITHUB_FIT_TOKEN=$(cat ~/.config/opencode/.secrets/GITHUB_FIT_TOKEN)
  ```
- **Commands**: Use `/mcp list` to verify connection and `/mcp reload` to refresh tools.

## Development Workflow

### Testing
- Manual testing in Chrome: Load unpacked extension from the root directory.
- Verify TTS across standard web pages and PDF files.

### Git
- Follow the `git-workflow` skill for commits and branching.
- Use descriptive commit messages following the project's style.
