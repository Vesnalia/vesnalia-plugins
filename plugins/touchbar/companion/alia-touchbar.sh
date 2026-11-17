#!/bin/sh
set -eu

alia_touchbar_config_dir=${ALIA_TOUCHBAR_CONFIG_DIR:-"$HOME/Library/Application Support/AliaTouchBar"}
alia_touchbar_bin=${ALIA_TOUCHBAR_ALIA_BIN:-}

if [ -z "$alia_touchbar_bin" ] && [ -r "$alia_touchbar_config_dir/alia-path" ]; then
  IFS= read -r alia_touchbar_bin < "$alia_touchbar_config_dir/alia-path"
fi

if [ -z "$alia_touchbar_bin" ] || [ ! -x "$alia_touchbar_bin" ]; then
  printf '%s\n' 'ALIA offline'
  exit 1
fi

exec "$alia_touchbar_bin" touchbar "$@"
