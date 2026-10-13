#!/usr/bin/env bash
# Loads a few game URLs in headless Chrome and fails on any uncaught exception. Runs on a Mac (Google Chrome) and
# on Linux CI (google-chrome / chromium); WebGL goes through SwiftShader where there is no GPU.
# Usage: scripts/smoke.sh [base-url]
set -u
BASE="${1:-http://localhost:5173}"
if [ -n "${CHROME:-}" ]; then :;
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
else CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"; fi
if [ -z "$CHROME" ]; then echo "no Chrome found; set CHROME=/path/to/chrome"; exit 2; fi
case "$(uname -s)" in
  Darwin) GPU="--use-angle=metal --disable-gpu-sandbox" ;;
  *) GPU="--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox --disable-dev-shm-usage" ;;
esac
fail=0
# A throwaway profile: no extensions, no saved site data from a previous run.
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
for path in "/" "/?lesson=first-hover&mode=teach&cam=chase" "/?lesson=roll&cam=drone" "/?panel=challenges" "/?pos=0,30,-6" "/?panel=pilot" "/?site=gym&cam=pilot" "/?site=gym&lesson=hover-box&mode=show" "/?site=lot&cam=pilot" "/?site=hill&cam=pilot" "/?site=hill&lesson=land-bank&mode=show&cam=chase" "/?hangar=swashplate" "/?prefs=%7B%22model%22%3A%22700-fbl%22%2C%22welcomed%22%3Atrue%7D" "/?prefs=%7B%22site%22%3A%22lot%22%2C%22model%22%3A%22250-fbl%22%2C%22tod%22%3A%22evening%22%7D" "/?prefs=%7B%22site%22%3A%22gym%22%2C%22model%22%3A%22450-flybar%22%7D" "/?quality=low&site=field" "/radio.html?c=ABCD&auto=0"; do
  # shellcheck disable=SC2086
  out=$("$CHROME" --headless=new $GPU --user-data-dir="$PROFILE" --hide-scrollbars --window-size=900,600 --virtual-time-budget=5000 --enable-logging=stderr --v=0 --dump-dom "$BASE$path" 2>&1 >/dev/null | grep -i "uncaught" | head -2)
  if [ -n "$out" ]; then echo "FAIL $path"; echo "$out"; fail=1; else echo "ok   $path"; fi
done
exit $fail
