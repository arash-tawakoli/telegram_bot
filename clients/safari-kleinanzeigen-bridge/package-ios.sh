#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
EXTENSION_DIR="$ROOT_DIR/extension"
OUTPUT_DIR="$ROOT_DIR/build"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

xcrun safari-web-extension-packager "$EXTENSION_DIR" \
  --project-location "$OUTPUT_DIR" \
  --app-name "Traumwohnung Bridge" \
  --bundle-identifier de.traumwohnunghamburg.bridge \
  --swift \
  --ios-only

printf '\nSafari Bridge project created in: %s\n' "$OUTPUT_DIR"
printf 'Open the generated Xcode project, select your signing team, then run it on the iPhone.\n'
