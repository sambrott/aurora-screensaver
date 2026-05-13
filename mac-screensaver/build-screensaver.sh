#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="AuroraScreenSaver"
BUNDLE="$NAME.saver"
OUT_DIR="$ROOT/artifacts"
BUILD="$OUT_DIR/$BUNDLE"

if command -v pnpm >/dev/null 2>&1; then
  pnpm run build:web-mac
elif command -v npm >/dev/null 2>&1; then
  npm run build:web-mac
else
  npx --yes tsc -b && npx --yes vite build --config vite.screensaver.config.ts
fi

MAC_DIR="$ROOT/mac-screensaver"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
DEPLOY="14.0"

rm -rf "$BUILD"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources/Web"
cp "$MAC_DIR/Info.plist" "$BUILD/Contents/Info.plist"
COPYFILE_DISABLE=1 ditto "$ROOT/dist/" "$BUILD/Contents/Resources/Web/"

COMMON=(
  -sdk "$SDK"
  -framework ScreenSaver -framework WebKit -framework AppKit
  -emit-library -Xlinker -bundle
  -module-name "$NAME" -O
)

swiftc -target arm64-apple-macos"$DEPLOY" "${COMMON[@]}" \
       -o "$BUILD/Contents/MacOS/arm64.bin" "$MAC_DIR/Sources/"*.swift
swiftc -target x86_64-apple-macos"$DEPLOY" "${COMMON[@]}" \
       -o "$BUILD/Contents/MacOS/x86_64.bin" "$MAC_DIR/Sources/"*.swift

lipo -create "$BUILD/Contents/MacOS/arm64.bin" "$BUILD/Contents/MacOS/x86_64.bin" \
     -output "$BUILD/Contents/MacOS/$NAME"
rm -f "$BUILD/Contents/MacOS/arm64.bin" "$BUILD/Contents/MacOS/x86_64.bin"

codesign --force --sign - --timestamp=none "$BUILD"

VER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$MAC_DIR/Info.plist" 2>/dev/null || echo 0)"
ZIP="$OUT_DIR/$NAME-mac.zip"
ZIP_VER="$OUT_DIR/$NAME-mac-v${VER}.zip"
rm -f "$ZIP" "$ZIP_VER"
(
  cd "$OUT_DIR"
  zip -rq "$ZIP" "$BUNDLE"
)
cp "$ZIP" "$ZIP_VER"

cat <<EOF

Built:
  Screensaver bundle: $BUILD
  ZIP (share / install): $ZIP
  Same build, version in filename (good to save/download): $ZIP_VER

Install into your user's Screen Savers folder (creates ~/Library/Screen Savers if needed):
  mkdir -p "\$HOME/Library/Screen Savers"
  unzip -o "$ZIP" -d "\$HOME/Library/Screen Savers"

Or double‑click AuroraScreenSaver.saver from Finder.

Then: System Settings → Screen Saver → Aurora

After replacing while testing:
  killall legacyScreenSaver 2>/dev/null || true
  killall ScreenSaverEngine 2>/dev/null || true

Signing: This bundle uses ad hoc codesign (\`codesign --sign -\`). Sharing the ZIP broadly may require Developer ID + notarization.

If anything still breaks, stream errors while triggering the saver:
  log stream --info --predicate 'subsystem == "com.github.sambrott.AuroraScreenSaver"'
EOF
