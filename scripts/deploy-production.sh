#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

echo "[deploy] Fetching latest code from origin/${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[deploy] Installing dependencies"
npm ci

echo "[deploy] Building production app"
npm run build

echo "[deploy] Starting or reloading PM2 apps"
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

echo "[deploy] Done"
