#!/bin/bash
set -e

echo "Building for Chrome and Firefox..."

# Navigate to the extension directory
cd "$(dirname "$0")"

# Create dist directory
rm -rf dist
mkdir -p dist/chrome
mkdir -p dist/firefox

# Copy source files to temp directories
# We only copy the necessary files and directories for the extension to work
FILES="assets docs lib scripts ui manifest.json README.md LICENSE"

for item in $FILES; do
    if [ -e "$item" ]; then
        cp -r "$item" dist/chrome/
        cp -r "$item" dist/firefox/
    fi
done

echo "Modifying manifest for Firefox..."
# Modify Firefox manifest using Node.js for safe JSON parsing
cd dist/firefox
node -e "
const fs = require('fs');
let m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

// Firefox MV3 uses background scripts (event pages) instead of service workers
if (m.background && m.background.service_worker) {
  m.background.scripts = [m.background.service_worker];
  delete m.background.service_worker;
}

// Firefox does not support the offscreen permission
if (m.permissions) {
  m.permissions = m.permissions.filter(p => p !== 'offscreen');
}

// Firefox ignores minimum_chrome_version
delete m.minimum_chrome_version;

// browser_specific_settings (gecko id, data_collection_permissions) lives in manifest.json

fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2));
"

echo "Zipping Firefox extension..."
zip -r ../firefox-extension.zip ./* > /dev/null
cd ../..

echo "Zipping Chrome extension..."
cd dist/chrome
zip -r ../chrome-extension.zip ./* > /dev/null
cd ../..

echo "Build complete! The ready-to-upload ZIP files are in the 'dist' directory."
ls -l dist/*.zip
