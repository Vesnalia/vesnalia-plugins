#!/bin/bash
# Regenerates themes/e-corp.css from source/theme.src.css by inlining every asset as a data
# URI. bb ships theme.css to the client as a CSS *string*, so there is no
# stylesheet URL for a relative url() to resolve against, and the theme folder
# is not served over HTTP. The stylesheet is capped at ~256 KB.
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
