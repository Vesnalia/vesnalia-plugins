#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/AliaTouchBar.app"
MACOS_DIR="$APP/Contents/MacOS"
RESOURCES="$APP/Contents/Resources"
DEPLOY_TARGET="11.0"
VERSION="${ALIA_TOUCHBAR_VERSION:-0.1.0}"
BUILD_NUMBER="${ALIA_TOUCHBAR_BUILD_NUMBER:-1}"
SIGN_IDENTITY="${ALIA_TOUCHBAR_SIGN_IDENTITY:--}"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || {
  printf 'error: invalid app version %s\n' "$VERSION" >&2
  exit 1
}
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || {
  printf 'error: invalid build number %s\n' "$BUILD_NUMBER" >&2
  exit 1
}

rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RESOURCES"
cp "$ROOT"/Assets/*.svg "$RESOURCES"/
cp "$ROOT"/Assets/*.png "$RESOURCES"/

compile() {
  local arch="$1" output="$2"
  xcrun swiftc -O -warnings-as-errors \
    -target "${arch}-apple-macosx${DEPLOY_TARGET}" \
    -import-objc-header "$ROOT/Sources/AliaTouchBarPrivate.h" \
    -framework Cocoa \
    -F /System/Library/PrivateFrameworks -framework DFRFoundation \
    -o "$output" "$ROOT"/Sources/*.swift
}

slices=()
for arch in x86_64 arm64; do
  if compile "$arch" "$BUILD/AliaTouchBar-$arch" 2>"$BUILD/build-$arch.log"; then
    slices+=("$BUILD/AliaTouchBar-$arch")
  else
    printf 'note: skipping %s slice (see %s)\n' "$arch" "$BUILD/build-$arch.log" >&2
  fi
done

if [ "${#slices[@]}" -eq 0 ]; then
  printf '%s\n' 'error: no architecture compiled' >&2
  cat "$BUILD"/build-*.log >&2
  exit 1
fi

if [ "${#slices[@]}" -gt 1 ]; then
  lipo -create -output "$MACOS_DIR/AliaTouchBar" "${slices[@]}"
else
  cp "${slices[0]}" "$MACOS_DIR/AliaTouchBar"
fi
rm -f "${slices[@]}"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>AliaTouchBar</string>
  <key>CFBundleIdentifier</key><string>app.getbb.touchbar.native</string>
  <key>CFBundleName</key><string>AliaTouchBar</string>
  <key>CFBundleDisplayName</key><string>ALIA Touch Bar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticTermination</key><false/>
  <key>NSSupportsSuddenTermination</key><false/>
</dict>
</plist>
PLIST

plutil -lint "$APP/Contents/Info.plist" >/dev/null
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - --timestamp=none "$APP"
else
  codesign --force --options runtime --sign "$SIGN_IDENTITY" --timestamp "$APP"
fi
codesign --verify --deep --strict "$APP"
printf 'built %s\n' "$APP"
