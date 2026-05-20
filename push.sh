#!/bin/bash
PAT=$(cat ~/.config/opencode/.secrets/GITHUB_FIT_TOKEN)
git remote set-url origin "https://realsanjeev:$PAT@github.com/realsanjeev/read-aloud-extension.git"
git add .
git commit -m "feat: migrate settings to dedicated options page (fixes #28)"
git push -u origin feature/issue-28-options-page