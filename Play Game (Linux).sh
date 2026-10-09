#!/usr/bin/env bash
# Run this file to play on Linux. It starts a tiny local web server and opens the game.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
PORT=8642
in_use() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }
while in_use "$PORT"; do PORT=$((PORT + 1)); done

if command -v python3 >/dev/null; then python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
elif command -v python >/dev/null; then python -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
elif command -v php >/dev/null; then php -S "127.0.0.1:$PORT" >/dev/null 2>&1 &
elif command -v busybox >/dev/null; then busybox httpd -f -p "127.0.0.1:$PORT" >/dev/null 2>&1 &
else echo "Please install python3 to play (e.g. sudo apt install python3)."; exit 1
fi
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 1

URL="http://127.0.0.1:$PORT/"
opened=
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null; then "$b" --app="$URL" --start-fullscreen >/dev/null 2>&1 & opened=1; break; fi
done
[ -z "$opened" ] && xdg-open "$URL" >/dev/null 2>&1 &

echo
echo "  🎃  Elf on the Shelf: Hollow Hill is running at $URL"
echo "  Press Ctrl+C (or close this terminal) when you're done playing."
echo
wait "$SERVER"
