#!/usr/bin/env bash
set -euo pipefail

HOST="${DO_HOST:-68.183.49.208}"
USER_NAME="${DO_USER:-root}"
SSH_KEY="${DO_SSH_KEY:-$HOME/.ssh/do_migration_ed25519}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "[setup] SSH key not found: $SSH_KEY" >&2
  exit 1
fi

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$USER_NAME@$HOST" '
set -euo pipefail
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OPS_LOG=/opt/real-mobile-mvp/.logs/codex-ops-$TS.log
mkdir -p /opt/real-mobile-mvp/.logs /opt/real-mobile-mvp/.pids

{
  echo "ts=$TS stage=start event=setup_realapp_systemd"

  cat >/etc/systemd/system/realapp-expo.service <<"UNIT"
[Unit]
Description=RealApp Expo Metro Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/real-mobile-mvp
Environment=EXPO_NO_TELEMETRY=1
EnvironmentFile=-/opt/real-mobile-mvp/.env
ExecStart=/usr/bin/npm start -- --host lan --port 8091 --clear
Restart=always
RestartSec=5
TimeoutStopSec=20
StandardOutput=append:/opt/real-mobile-mvp/.logs/expo-systemd.log
StandardError=append:/opt/real-mobile-mvp/.logs/expo-systemd.log

[Install]
WantedBy=multi-user.target
UNIT

  cat >/etc/systemd/system/realapp-video-editor-api.service <<"UNIT"
[Unit]
Description=RealApp Video Editor API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/real-mobile-mvp/video-editor-api
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-/opt/real-mobile-mvp/video-editor-api/.env
ExecStart=/opt/real-mobile-mvp/video-editor-api/.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8081
Restart=always
RestartSec=3
TimeoutStopSec=20
StandardOutput=append:/opt/real-mobile-mvp/.logs/video-editor-api-systemd.log
StandardError=append:/opt/real-mobile-mvp/.logs/video-editor-api-systemd.log

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl stop realapp-expo.service || true
  systemctl stop realapp-video-editor-api.service || true
  fuser -k 8091/tcp || true
  fuser -k 8081/tcp || true
  sleep 1

  systemctl enable --now realapp-expo.service
  systemctl enable --now realapp-video-editor-api.service

  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) stage=verify event=service_status"
  systemctl is-enabled realapp-expo.service
  systemctl is-active realapp-expo.service
  systemctl is-enabled realapp-video-editor-api.service
  systemctl is-active realapp-video-editor-api.service

  ss -ltnp | grep -E ":8091|:8081" || true
  tail -n 40 /opt/real-mobile-mvp/.logs/expo-systemd.log || true
  tail -n 40 /opt/real-mobile-mvp/.logs/video-editor-api-systemd.log || true

  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) stage=done event=setup_realapp_systemd"
} >>"$OPS_LOG" 2>&1

echo "OPS_LOG=$OPS_LOG"
tail -n 160 "$OPS_LOG"
'
