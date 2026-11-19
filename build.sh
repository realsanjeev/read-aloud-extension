#!/bin/bash
set -e

echo "Building for Chrome and Firefox..."
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/chrome dist/firefox

# Only what the extension needs at runtime
FILES="assets docs lib scripts ui manifest.json README.md LICENSE"
for item in $FILES; do
    cp -r "$item" dist/chrome/
    cp -r "$item" dist/firefox/
done

# manifest.json runs unpacked in both browsers (each ignores the other's background key);
# the store builds drop the keys the other browser would warn about.
node -e "
const fs = require('fs');
const edit = (dir, fn) => {
  const p = dir + '/manifest.json';
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(m);
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
};
edit('dist/chrome', m => {
  delete m.background.scripts;
  delete m.browser_specific_settings;
});
edit('dist/firefox', m => {
  delete m.background.service_worker;
  delete m.minimum_chrome_version;
  m.permissions = m.permissions.filter(p => p !== 'offscreen');
});
"

if command -v web-ext >/dev/null; then
    web-ext lint --source-dir dist/firefox
else
    echo "Skipping Firefox lint: install with 'npm i -g web-ext'"
fi

(cd dist/firefox && zip -qr ../firefox-extension.zip .)
(cd dist/chrome && zip -qr ../chrome-extension.zip .)

echo "Build complete! The ready-to-upload ZIP files are in the 'dist' directory."
ls -l dist/*.zip
