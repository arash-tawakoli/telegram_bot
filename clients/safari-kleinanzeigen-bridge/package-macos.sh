#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
EXTENSION_DIR="$ROOT_DIR/extension"
OUTPUT_DIR="$ROOT_DIR/build-macos"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

xcrun safari-web-extension-packager "$EXTENSION_DIR"   --project-location "$OUTPUT_DIR"   --app-name "TraumWohnung Login Helper"   --bundle-identifier de.traumwohnunghamburg.loginhelper   --swift   --macos-only   --copy-resources

printf '\nSafari Login Helper project created in: %s\n' "$OUTPUT_DIR"
printf 'Open the generated Xcode project, select your signing team, then run the macOS app once.\n'
