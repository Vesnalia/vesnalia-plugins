#!/usr/bin/env bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/app.getbb.touchbar.native.plist"
READY="$HOME/Library/Application Support/AliaTouchBar/AliaTouchBar.ready"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/app.getbb.touchbar.native" 2>/dev/null || true
pkill -TERM -x AliaTouchBar 2>/dev/null || true
rm -f "$PLIST" "$READY"
printf '%s\n' 'removed ALIA Touch Bar login agent'
