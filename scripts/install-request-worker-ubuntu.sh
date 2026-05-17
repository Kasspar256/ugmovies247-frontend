#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo/root." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/ugmovies-request-worker"
STATE_DIR="/var/lib/ugmovies-request-worker"
ENV_FILE="/etc/ugmovies-request-worker.env"
SERVICE_FILE="/etc/systemd/system/ugmovies-request-worker.service"
SERVICE_USER="ugrequest"

if [[ ! -f "$REPO_ROOT/request-worker/request-worker.js" ]]; then
  echo "request-worker/request-worker.js was not found. Run this from the ugmovies247 repo." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git ffmpeg

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "Number(process.versions.node.split('.')[0])")" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -m 0755 "$INSTALL_DIR"
install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR/work"
install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR/public" "$STATE_DIR/public/files"
cp "$REPO_ROOT/request-worker/package.json" "$INSTALL_DIR/package.json"
cp "$REPO_ROOT/request-worker/request-worker.js" "$INSTALL_DIR/request-worker.js"

cd "$INSTALL_DIR"
npm install --omit=dev
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$STATE_DIR"
chmod 0755 "$STATE_DIR" "$STATE_DIR/public" "$STATE_DIR/public/files"
find "$STATE_DIR/public/files" -type f -exec chmod 0644 {} \;

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_ROOT/request-worker/.env.example" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE. Edit it with the new request VPS credentials before starting."
fi

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=UGMOVIES247 isolated movie request worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $INSTALL_DIR/request-worker.js
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
echo
echo "Request worker installed."
echo "1. Edit credentials: nano $ENV_FILE"
echo "2. Start worker:    systemctl enable --now ugmovies-request-worker"
echo "3. Watch logs:      journalctl -u ugmovies-request-worker -f"
