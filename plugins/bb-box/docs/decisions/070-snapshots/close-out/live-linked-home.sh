#!/bin/sh
set -e
long=${LONG_HOME:-/home/box/home-long-enough-for-the-msb-link}
here=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$long/alia-box" ] || { echo "put a checkout of alia-box in $long/alia-box first"; exit 1; }
home=$long/.local/share/alia-box/microsandbox/home
echo "msb's home: ${#home} bytes, so alia-box reaches it through /tmp/alia-box-msb-$(id -u)"
HOME=$long sh "$here/unit-10/live-setup.sh"
HOME=$long bash "$here/unit-10/live-gates.sh"
link=/tmp/alia-box-msb-$(id -u)
[ -L "$link" ] && [ "$(readlink "$link")" = "$home" ] && echo "msb ran through the link $link" || echo "no link at $link"
