// utils.js — Shared utilities for popup, pdf-viewer, and offscreen

/**
 * Returns a debounced version of fn that delays invocation by `delay` ms.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            try { fn.apply(this, args); } catch (e) { console.error('Debounced fn error:', e); }
        }, delay);
    };
}

/**
 * Retrieves a saved playback position from chrome.storage.local for the given URL.
 * @param {string} url
 * @returns {Promise<{url: string, index: number, timestamp: number}|null>}
 */
export async function getSavedPosition(url) {
    if (!url) return null;
    const key = 'pos_' + url;
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
}
