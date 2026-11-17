#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-${ALIA_TOUCHBAR_VERSION:-0.1.0}}"
BUILD="$ROOT/build"
STAGE="$BUILD/package-$VERSION"
ARCHIVE="$BUILD/AliaTouchBar-$VERSION-universal.zip"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || {
  printf 'error: invalid release version %s\n' "$VERSION" >&2
  exit 1
}

if [ "${ALIA_TOUCHBAR_SKIP_BUILD:-0}" = "1" ]; then
  [ -x "$BUILD/AliaTouchBar.app/Contents/MacOS/AliaTouchBar" ] || {
    printf '%s\n' 'error: ALIA_TOUCHBAR_SKIP_BUILD=1 requires an existing app build' >&2
    exit 1
  }
else
  ALIA_TOUCHBAR_VERSION="$VERSION" bash "$ROOT/build.sh"
fi
rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE"
ditto "$BUILD/AliaTouchBar.app" "$STAGE/AliaTouchBar.app"
cp "$ROOT/homebrew-install.sh" "$STAGE/homebrew-install.sh"
cp "$ROOT/homebrew-uninstall.sh" "$STAGE/homebrew-uninstall.sh"
chmod 755 "$STAGE/homebrew-install.sh" "$STAGE/homebrew-uninstall.sh"

if [ -n "${ALIA_TOUCHBAR_NOTARY_PROFILE:-}" ]; then
  [ "${ALIA_TOUCHBAR_SIGN_IDENTITY:--}" != "-" ] || {
    printf '%s\n' 'error: notarization requires ALIA_TOUCHBAR_SIGN_IDENTITY' >&2
    exit 1
  }
  NOTARY_ARCHIVE="$BUILD/AliaTouchBar-$VERSION-notary.zip"
  rm -f "$NOTARY_ARCHIVE"
  ditto -c -k --keepParent "$STAGE/AliaTouchBar.app" "$NOTARY_ARCHIVE"
  xcrun notarytool submit "$NOTARY_ARCHIVE" \
    --keychain-profile "$ALIA_TOUCHBAR_NOTARY_PROFILE" --wait
  xcrun stapler staple "$STAGE/AliaTouchBar.app"
  rm -f "$NOTARY_ARCHIVE"
fi

find "$STAGE" -exec touch -t 202601010000 {} +
COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent "$STAGE" "$ARCHIVE"
SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
printf 'archive=%s\nsha256=%s\nversion=%s\n' "$ARCHIVE" "$SHA256" "$VERSION"
