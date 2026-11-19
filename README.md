# Read Aloud Extension

A premium Text-to-Speech (TTS) Chrome Extension that automatically detects and reads the main content of any web page. Features a modern UI with real-time "Karaoke-style" sentence highlighting.

## Key Features

- **🧠 Intelligent Extraction**: Uses Mozilla's Readability.js engine to perfectly extract the main article text, completely ignoring ads, menus, and sidebars.
- **🎤 Real-Time Highlighting**: Highlights the current sentence in yellow as it is spoken (Karaoke mode).
- **🔄 One-Click Reading**: Clicking the extension icon starts reading the page right away, resuming where you left off. Clicking it on another tab switches to that page.
- **📖 Keep Reading**: Turn on "Keep reading the next page" for a site, and moving to the next page (e.g. the next chapter) continues reading automatically.
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

## Better Voices on Linux (Firefox)

The extension speaks with the voices your browser provides. Chrome includes Google's online voices, which sound natural. Firefox on Linux only has the voices installed for **speech-dispatcher**, which by default is eSpeak NG, so it sounds robotic. Installing a better speech engine fixes it.

**Recommended: RHVoice** (Debian 12+ / Ubuntu, supports the speed slider):

```bash
sudo apt install rhvoice-english speech-dispatcher-rhvoice
pkill speech-dispatcher   # it restarts on demand
```

Restart Firefox, then pick an RHVoice voice in the extension's settings. Other languages: `apt search rhvoice-`.

**Most natural: Piper** (neural, offline). Download the engine and a voice (more voices: [Piper samples](https://rhasspy.github.io/piper-samples/)):

```bash
mkdir -p ~/.local/share/piper && cd ~/.local/share/piper
curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz | tar xz --strip-components=1
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

Register it with speech-dispatcher (user config, keeps eSpeak as a fallback):

```bash
mkdir -p ~/.config/speech-dispatcher
cp /etc/speech-dispatcher/speechd.conf ~/.config/speech-dispatcher/
cp -r /etc/speech-dispatcher/modules ~/.config/speech-dispatcher/
cat >> ~/.config/speech-dispatcher/speechd.conf <<'EOF'
AddModule "piper" "sd_generic" "piper-generic.conf"
AddModule "espeak-ng" "sd_espeak-ng" "espeak-ng.conf"
DefaultModule piper
EOF
cat > ~/.config/speech-dispatcher/modules/piper-generic.conf <<EOF
GenericExecuteSynth "printf %s \'\$DATA\' | $HOME/.local/share/piper/piper --model $HOME/.local/share/piper/en_US-lessac-medium.onnx --output_raw | aplay -q -r 22050 -f S16_LE -t raw -"
AddVoice "en" "FEMALE1" "en_US-lessac-medium"
DefaultVoice "en_US-lessac-medium"
EOF
pkill speech-dispatcher
spd-say -o piper "Piper is working"
```

Restart Firefox and select the Piper voice. With this basic setup the speed slider doesn't change Piper's speed; use RHVoice if you need it.

## Usage

1.  Navigate to any article or blog post.
2.  Click the **Read Aloud** extension icon. It extracts the text and starts reading immediately.
    - If you read this page before, it resumes there; click **Start Over** to begin again.
    - Clicking the icon on a *new* page switches reading to that page.
    - To continue automatically when you go to the next page on a site, open **Settings** and turn on **Keep reading the next page on _site_** (asks for access to that site only).
    - Click **Next/Prev** to jump sentences.
    - Click **Settings** (gear icon) to change voice/speed.
    - Click any sentence in the text view to jump directly to it.

## Permissions

- **activeTab**: Required to interact with the current page and extract text.
- **scripting**: Used to inject the extraction logic into the page.
- **storage**: Used to save your voice and speed preferences.
- **Site access (optional)**: Requested per site only when you turn on "Keep reading" or open a PDF from the web.


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
