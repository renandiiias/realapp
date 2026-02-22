#!/usr/bin/env bash
set -euo pipefail

TITLE="${1:-Codex terminou}"
BODY="${2:-Pode testar no iPhone agora.}"
DELAY_SECONDS="${3:-8}"
PHONE_RAW="${NOTIFY_PHONE:-${4:-}}"
DRY_RUN="${NOTIFY_DRY_RUN:-0}"
CALL_RETRIES="${NOTIFY_CALL_RETRIES:-3}"

log(){ printf '[notify] %s\n' "$*"; }

clean_phone(){
  printf '%s' "$1" | tr -cd '0-9+'
}

run_applescript_inline() {
  local script="$1"
  python3 - <<'PY' "$script"
import subprocess, sys
script = sys.argv[1]
try:
    p = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=5)
    if p.returncode != 0:
        sys.stderr.write((p.stderr or '').strip()+"\n")
    raise SystemExit(p.returncode)
except subprocess.TimeoutExpired:
    raise SystemExit(124)
PY
}

if ! [[ "$DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  log "delay invalido: $DELAY_SECONDS"
  exit 2
fi
if ! [[ "$CALL_RETRIES" =~ ^[0-9]+$ ]]; then
  log "CALL_RETRIES invalido: $CALL_RETRIES"
  exit 2
fi

PHONE="$(clean_phone "$PHONE_RAW")"
log "title='$TITLE' delay=${DELAY_SECONDS}s dry_run=${DRY_RUN}"

ok_any=0

# 1) Immediate local mac notification (always useful)
if run_applescript_inline "display notification \"$BODY\" with title \"$TITLE\" subtitle \"Codex\" sound name \"Glass\"" >/dev/null 2>&1; then
  log "mac_notification=ok"
  ok_any=1
else
  log "mac_notification=fail"
fi

# 2) Ring iPhone by starting a call from Mac (Continuity / FaceTime)
if [[ -n "$PHONE" ]]; then
  if [[ "$DRY_RUN" = "1" ]]; then
    log "iphone_call=dry_run target=$PHONE"
  else
    (
      sleep "$DELAY_SECONDS"
      for i in $(seq 1 "$CALL_RETRIES"); do
        # 1) Trigger FaceTime Audio dial sheet
        open "facetime-audio://+$PHONE" >/dev/null 2>&1 || true
        sleep 1
        # 2) Best effort auto-confirm on PT/EN UI (requires Accessibility for osascript/Terminal)
        osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "System Events"
  tell process "FaceTime"
    set frontmost to true
    if exists window 1 then
      try
        click (first button of window 1 whose name contains "Ligar")
      end try
      try
        click (first button of window 1 whose name contains "Audio")
      end try
      try
        click (first button of window 1 whose name contains "Call")
      end try
      try
        click (first button of window 1 whose name contains "FaceTime")
      end try
    end if
  end tell
end tell
APPLESCRIPT
        # 3) Fallback deep link
        open "tel://+$PHONE" >/dev/null 2>&1 || true
        sleep 3
      done
    ) &
    log "iphone_call=scheduled target=+$PHONE retries=$CALL_RETRIES"
    ok_any=1
  fi
else
  log "iphone_call=skip (defina NOTIFY_PHONE=5511...)"
fi

# 3) Non-blocking best-effort reminder (may require macOS permission)
if [[ "$DRY_RUN" != "1" ]]; then
  REM_SCRIPT="set d to (current date) + ${DELAY_SECONDS}\ntell application \"Reminders\"\n  if not (exists list \"Codex Alerts\") then make new list with properties {name:\"Codex Alerts\"}\n  tell list \"Codex Alerts\"\n    make new reminder with properties {name:\"${TITLE}\", body:\"${BODY}\", remind me date:d}\n  end tell\nend tell"
  if run_applescript_inline "$REM_SCRIPT" >/dev/null 2>&1; then
    log "reminders=ok"
    ok_any=1
  else
    log "reminders=skip_or_blocked"
  fi
fi

if [[ "$ok_any" -eq 1 ]]; then
  log "success"
  log "obs: para auto-clique no FaceTime funcionar, habilite Acessibilidade para Terminal/osascript no macOS."
  exit 0
fi

log "all_channels_failed"
exit 1
