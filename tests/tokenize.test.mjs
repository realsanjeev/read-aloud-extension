// Run: node tests/tokenize.test.mjs — checks sentence splitting in ui/offscreen.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const win = { speechSynthesis: { getVoices: () => [{}], addEventListener: noop }, addEventListener: noop };
win.parent = win;
const ctx = vm.createContext({ window: win, chrome: { runtime: { onMessage: { addListener: noop } } }, Intl, setTimeout, clearTimeout, console });
vm.runInContext(readFileSync(new URL('../ui/offscreen.js', import.meta.url), 'utf8'), ctx);
const { tokenizeSentences, splitLong } = ctx;

const { sentences, lineBreaks } = tokenizeSentences('Hello there. How are you?\n\nNew para.');
assert.deepEqual([...sentences], ['Hello there.', 'How are you?', 'New para.']);
assert.deepEqual([...lineBreaks], [2]);

// Long text splits at the last comma within the limit, never exceeds it, and loses no words.
const long = 'word '.repeat(30) + 'clause, ' + 'more '.repeat(60);
const parts = splitLong(long.trim());
assert.ok(parts.every(p => p.length <= 200), 'chunk over limit');
assert.ok(parts[0].endsWith('clause,'));
assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.trim());
assert.deepEqual([...splitLong('x'.repeat(450))].map(p => p.length), [200, 200, 50]); // no spaces: hard cut
console.log('tokenize ok');
