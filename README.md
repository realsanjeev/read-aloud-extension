# Read Aloud Extension

A premium Text-to-Speech (TTS) Chrome Extension that automatically detects and reads the main content of any web page. Features a modern UI with real-time "Karaoke-style" sentence highlighting.

## Key Features

- **🧠 Intelligent Extraction**: Uses Mozilla's Readability.js engine to perfectly extract the main article text, completely ignoring ads, menus, and sidebars.
- **🎤 Real-Time Highlighting**: Highlights the current sentence in yellow as it is spoken (Karaoke mode).
- **🔄 Seamless Transition**: Clicking the extension icon on a new tab while reading another will automatically stop the old tab and instantly start reading the new one!
- **📄 Local PDF Support**: Built-in PDF reader that extracts text locally, keeping your documents secure.
- **🔒 Privacy First**: All text extraction, language detection, and TTS are done completely offline in your browser. No data is sent to external servers.
- **🎛️ Complete Control**: Play, Pause, Stop, and skip sentences (Next/Previous).
- **🎨 Premium UI**: A clean, modern interface with a "Reader View".
- **⚙️ Customization**:
    - **Voice**: Choose from any available browser voice.
    - **Speed**: Adjust reading rate (0.5x - 3.0x).
    - **Pitch**: Fine-tune voice pitch.
    - **Persistence**: Settings are saved automatically.

## Installation

**Official Stores:**
- [Available on Chrome Web Store](https://chromewebstore.google.com/detail/read-aloud-extension/albdidadjkmkoieokamkkdhpidmjgpea)
- [Available on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/read-aloud-extension/)

**Manual Installation (Developer Mode):**
1.  Clone or download this repository.
2.  Run `./build.sh` to generate the extension packages.
3.  **Chrome**: Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist/chrome` directory.
4.  **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select the `manifest.json` inside the `dist/firefox` directory.

## Usage

1.  Navigate to any article or blog post.
2.  Values the **Read Aloud** extension icon.
3.  The extension will auto-extract the text and display it.
4.  Click **Play** to start reading.
    - If you are already reading a page and click the extension on a *new* page, it will automatically start reading the new page!
    - Click **Next/Prev** to jump sentences.
    - Click **Settings** (gear icon) to change voice/speed.
    - Click any sentence in the text view to jump directly to it.

## Permissions

- **activeTab**: Required to interact with the current page and extract text.
- **scripting**: Used to inject the extraction logic into the page.
- **storage**: Used to save your voice and speed preferences.


## Commands
- <kbd>Alt</kbd> + <kbd>O</kbd>: Play/Stop the audio
- <kbd>Alt</kbd> + <kbd>P</kbd>: Pause/resume the audio
- <kbd>Alt</kbd> + <kbd>.</kbd>: Next Sentence
- <kbd>Alt</kbd> + <kbd>,</kbd>: Previous sentence
### References:
- Icon based on: [Flaticon Megaphone](https://www.flaticon.com/free-icon/megaphone_9018879)
- [Chrome Extension Manifest - Developer Docs](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Chrome Extension Permission - Developer Docs](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
