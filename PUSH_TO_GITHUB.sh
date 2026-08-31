#!/usr/bin/env bash
# Заливка проекта в GitHub. Запусти из этой папки: bash PUSH_TO_GITHUB.sh
set -e
REPO="https://github.com/Wiksikgtgthrh/Aura-ide.git"
git init -b main
git add -A
git commit -m "Aura IDE — итерации 1–6: багфиксы, IDE, участники/права, security, оптимизации"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git push -u origin main --force
echo "✓ Готово: $REPO"
