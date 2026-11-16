#!/usr/bin/env bash
# Fresh alia worktrees only have tracked files; install dependencies.
set -euo pipefail
npm ci --no-audit --no-fund --loglevel=error
