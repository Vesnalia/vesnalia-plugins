#!/usr/bin/env bash
set -euo pipefail

APP="${1:?usage: homebrew-install.sh /path/to/AliaTouchBar.app}"
BIN="$APP/Contents/MacOS/AliaTouchBar"
SUPPORT="$HOME/Library/Application Support/AliaTouchBar"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS/app.getbb.touchbar.native.plist"
DOMAIN="gui/$(id -u)"
ALIA_BIN="${ALIA_TOUCHBAR_ALIA_BIN:-}"
if [ -z "$ALIA_BIN" ]; then
  for candidate in "$(command -v alia 2>/dev/null || true)" /usr/local/bin/alia /opt/homebrew/bin/alia; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      ALIA_BIN="$candidate"
      break
    fi
  done
fi

[ "$(uname -s)" = "Darwin" ] || { printf '%s\n' 'error: macOS is required' >&2; exit 1; }
[ -x "$BIN" ] || { printf 'error: missing %s\n' "$BIN" >&2; exit 1; }
[ -n "$ALIA_BIN" ] && [ -x "$ALIA_BIN" ] || {
  printf '%s\n' 'error: alia executable not found; install the ALIA CLI first' >&2
  exit 1
}

mkdir -p "$SUPPORT" "$LAUNCH_AGENTS"
printf '%s\n' "$ALIA_BIN" > "$SUPPORT/alia-path"
chmod 600 "$SUPPORT/alia-path"

plutil -create xml1 "$PLIST"
plutil -insert Label -string app.getbb.touchbar.native "$PLIST"
plutil -insert ProgramArguments -json "[\"$BIN\"]" "$PLIST"
plutil -insert RunAtLoad -bool true "$PLIST"
plutil -insert ProcessType -string Interactive "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "$DOMAIN/app.getbb.touchbar.native" 2>/dev/null || true
pkill -TERM -x AliaTouchBar 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
printf 'configured %s for login startup\n' "$APP"
