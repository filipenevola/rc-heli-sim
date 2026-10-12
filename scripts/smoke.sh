#!/usr/bin/env bash
# Loads a few game URLs in headless Chrome against the dev server and fails on any uncaught exception.
# Usage: scripts/smoke.sh [base-url]
set -u
BASE="${1:-http://localhost:5173}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fail=0
for path in "/" "/?lesson=first-hover&mode=teach&cam=chase" "/?lesson=roll&cam=drone" "/?panel=challenges" "/?pos=0,30,-6" "/?panel=pilot" "/?site=gym&cam=pilot" "/?site=gym&lesson=hover-box&mode=show"; do
  out=$("$CHROME" --headless=new --disable-gpu-sandbox --use-angle=metal --hide-scrollbars --window-size=900,600 --virtual-time-budget=5000 --enable-logging=stderr --v=0 --dump-dom "$BASE$path" 2>&1 >/dev/null | grep -i "uncaught" | head -2)
  if [ -n "$out" ]; then echo "FAIL $path"; echo "$out"; fail=1; else echo "ok   $path"; fi
done
exit $fail
