#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

if [ -n "$(git status --porcelain --untracked-files=all -- dist)" ]; then
  git status --short -- dist >&2
  printf 'dist differs from the committed build\n' >&2
  exit 1
fi
