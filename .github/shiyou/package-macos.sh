#!/usr/bin/env bash
# shiyou: package-macos.sh <app tarball> <dmg>: ad-hoc signs the unsigned .app that `bun run pack` tars up and wraps
# it in a drag-to-Applications DMG. Apple Silicon only runs signed code, and without an Apple Developer ID the app
# gets an ad-hoc signature instead (not notarized). No hardened runtime, so it needs no entitlements.
set -euo pipefail

tarball=$1
dmg=$2
work=$(mktemp -d)
tar -xf "$tarball" -C "$work"
app=$(find "$work" -mindepth 1 -maxdepth 1 -name '*.app' -type d)
if [ -z "$app" ] || [ "$(printf '%s\n' "$app" | wc -l | tr -d ' ')" != 1 ]; then
  echo "::error::Expected exactly one .app bundle in $tarball" >&2
  exit 1
fi

# Every nested Mach-O file and bundle, deepest first, then the app itself, like .github/release/sign-desktop-macos.sh.
list=$(mktemp)
{
  find "$app/Contents" -type f -print0 | while IFS= read -r -d '' file; do
    case "$(file -b --mime-type "$file")" in application/x-mach-binary*) printf '%s\n' "$file" ;; esac
  done
  find "$app/Contents" -type d \( -name '*.app' -o -name '*.framework' \) -print
} | awk -F/ '{ print NF "\t" $0 }' | sort -t "$(printf '\t')" -k1,1nr | cut -f2- > "$list"
echo "Ad-hoc signing $(wc -l < "$list" | tr -d ' ') items in $app"
while IFS= read -r item; do
  codesign --force --timestamp=none --sign - "$item"
done < "$list"
codesign --force --timestamp=none --sign - "$app"
codesign --verify --deep --strict --verbose=2 "$app"

name=$(basename "$app")
staging=$(mktemp -d)
ditto "$app" "$staging/$name"
ln -s /Applications "$staging/Applications"
mkdir -p "$(dirname "$dmg")"
# hdiutil now and then fails with "Resource busy" on hosted runners.
for attempt in 1 2 3; do
  if hdiutil create -volname "${name%.app}" -srcfolder "$staging" -fs HFS+ -format UDZO -ov "$dmg"; then break; fi
  [ "$attempt" = 3 ] && exit 1
  sleep 10
done
hdiutil verify "$dmg"
