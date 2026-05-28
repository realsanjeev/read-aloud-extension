# Chrome Web Store Review Report

**Extension**: Read Aloud Extension  
**Version**: 1.0.1  
**Scanned**: May 24, 2026  
**Verdict**: NEEDS FIXES  

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 2     |
| MEDIUM   | 0     |
| PASS     | 13    |

---

## Issues Found

### Missing Privacy Policy

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Code** | Purple Lithium |
| **Root Cause** | The extension requests and uses the `storage` permission (`chrome.storage.local` and `chrome.storage.sync`) to save user player settings (voice, speed, theme) and persist current playback position. |
| **File(s)** | `manifest.json:10` |

**What's wrong:**  
Under Chrome Web Store developer policies, extensions utilizing the `storage` API or accessing user state are required to have a dedicated Privacy Policy. If a privacy policy is not provided during submission, the extension is highly likely to be rejected or delayed.

**How to fix:**  
1. Host a clean, simple privacy policy on a public domain (e.g., GitHub Pages, static website, or a gist). The policy must disclose what data is stored (only settings and local reading index) and clarify that no personal information is collected or sent over the network.
2. Provide the URL of your hosted privacy policy in the **Chrome Web Store Developer Dashboard** under the **Privacy** tab when submitting the listing.
3. (Optional but recommended) Add a `"homepage_url"` field in `manifest.json` that links to a landing page displaying the privacy policy.

---

### Non-Functional Fetch / CORS Restrictions

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Code** | Yellow Magnesium (Non-Functional) & Purple Potassium (Excessive Permissions) |
| **Root Cause** | The extension attempts to fetch remote web page resources directly from the extension context (`ui/popup.js` via `fetch(tab.url)` and `ui/pdf-viewer.js` via `pdfjsLib.getDocument(url)`) without declaring corresponding host permissions in the manifest. |
| **File(s)** | [popup.js](file:///home/sanjeev/Templates/extension/speak-aloud-extension/ui/popup.js#L268), [popup.js](file:///home/sanjeev/Templates/extension/speak-aloud-extension/ui/popup.js#L280), [pdf-viewer.js](file:///home/sanjeev/Templates/extension/speak-aloud-extension/ui/pdf-viewer.js#L112) |

**What's wrong:**  
1. **Network request failures:** Under Manifest V3, network requests from extension components (popup, background, custom pages) to arbitrary domains will fail due to standard CORS enforcement unless the host origin is declared under `host_permissions` in `manifest.json`.
2. **Review risk:** Adding broad host permissions like `"<all_urls>"` or `"*://*/*"` in the manifest to allow arbitrary fetches violates the principle of least privilege, triggering a **Purple Potassium** (Excessive Permissions) violation and putting the extension in a high-scrutiny review tier, causing significant publishing delays.

**How to fix:**  
1. **For text and markdown content:** Instead of using the popup context `fetch(tab.url)` to load file content, let the injected content script extract the page text directly from the active tab. Content scripts run in the page context and can access the loaded DOM/text immediately without making additional network requests.
2. **For PDF files:** Accessing third-party PDFs using `pdfjsLib.getDocument(url)` in the custom `pdf-viewer.html` requires the target server to serve the PDF with permissive `Access-Control-Allow-Origin` headers. To resolve this:
   - Use dynamic/optional host permissions (`chrome.permissions.request`) when the user selects a remote PDF to view.
   - Alternatively, inject the PDF parser directly into the page via the content script, or prompt the user to download the PDF and load it locally via `file://` (which requires enabling "Allow access to file URLs" in `chrome://extensions`).

---

## Passed Checks

- [x] **No remote code execution (Blue Argon)**: Zero instances of `eval()`, `new Function()`, or dynamic remote script imports (`<script src="http...">`).
- [x] **No code obfuscation (Red Titanium)**: No obfuscated code, base64 data injection, or hex-escaped instruction sets. The built files use standard minification and clean Vanilla JS.
- [x] **Permissions match usage (Purple Potassium)**: All permissions declared (`activeTab`, `scripting`, `storage`, `offscreen`) are highly scoped and actively used in the codebase.
- [x] **No insecure data transmission (Purple Copper)**: There are no network requests transmitting sensitive parameters, and only encrypted HTTPS/local protocols are used functionally.
- [x] **Metadata check (Yellow Zinc)**: All essential fields (`name`, `description`, `version`, `icons`) are fully specified, and high-resolution icons (16px, 48px, 128px) exist in `assets/icons/`.
- [x] **Single Purpose (Red Magnesium)**: The extension maintains a highly cohesive scope solely focused on Text-to-Speech (TTS) reading of web pages and PDFs.
- [x] **No deceptive behavior (Red Nickel)**: Core features and behavior correspond exactly to the described functionality.
- [x] **No keyword stuffing (Yellow Argon)**: Description and name fields are concise and natural.
- [x] **Minimum Functionality (Yellow Potassium)**: The extension has a rich feature set, including interactive speed/pitch controls, a floating mini-player, offscreen synthesis, and a custom PDF reader.
- [x] **No cryptocurrency mining (Grey Silicon)**: Completely clean of crypto-related mining libraries or background tasks.
- [x] **No copyright circumvention (Blue Zinc)**: No scripts attempting to bypass paywalls, strip digital rights, or download media illegally.
- [x] **No notification spam (Yellow Nickel)**: No unsolicited notifications or desktop spam.
- [x] **No unauthorized data collection (Purple Nickel)**: Browsing history (`chrome.history`) or network navigation is not tracked, and no data is shared with external servers.

---

## Next Steps

1. **Implement dynamic content extraction** in `ui/popup.js` so that text/markdown page reads use the content script instead of `fetch()`.
2. **Review options for cross-origin PDF retrieval** in `ui/pdf-viewer.js` (such as optional host permissions or local file access tips).
3. **Host a simple Privacy Policy** and add the link to the CWS Developer Dashboard under the Store Listing configuration.
4. **Resubmit for review** once these steps are addressed.

---

*Generated by extension-review skill. Reference: https://developer.chrome.com/docs/webstore/troubleshooting*  
*Powered by [Extension Booster](https://extensionbooster.com/)*
