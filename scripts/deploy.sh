#!/usr/bin/env bash
# Publie le build sur la branche gh-pages (GitHub Pages).
# Usage : npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_URL=$(git remote get-url origin)
REPO_NAME=$(basename -s .git "$REMOTE_URL")

BASE_PATH="/${REPO_NAME}/" npm run build

cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Déploiement $(date '+%Y-%m-%d %H:%M')"
# Utilise l'identifiant de GitHub CLI s'il est installé (pas besoin de clé SSH).
if command -v gh >/dev/null 2>&1; then
  git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "$REMOTE_URL" gh-pages
else
  git push -q -f "$REMOTE_URL" gh-pages
fi
rm -rf .git
echo "Publié sur la branche gh-pages de ${REMOTE_URL}"
