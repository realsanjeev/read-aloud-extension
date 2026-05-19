---
name: pdf-content-extraction
description: Expertise in PDF parsing using pdf.js and web page content extraction using Readability.js. Use when modifying text extraction logic or the PDF viewer.
---

# PDF & Content Extraction

Logic for converting documents and web pages into speakable text.

## PDF Parsing (`pdf.js`)

- Uses `lib/pdf.min.js` and `lib/pdf.worker.min.js`.
- `ui/pdf-viewer.js` handles loading the PDF and extracting text layer data.
- Ensure efficient text extraction page-by-page to avoid memory issues with large PDFs.

## Web Extraction (`Readability.js`)

- Uses `lib/Readability.js` (from Mozilla).
- Injected into the page via `content.js`.
- Goal: Clean up the DOM and extract the "main article" text, bypassing ads, navbars, and sidebars.

## Text Normalization

- Strip unnecessary whitespace.
- Filter out non-speakable characters or artifacts (e.g., [1] citation markers).
- Split text into logical chunks (sentences/paragraphs) for the TTS engine.

## Implementation Notes

- `content.js` uses `Readability` to get the article content.
- `pdf-viewer.js` uses `pdfjsLib` to get text content from pages.
