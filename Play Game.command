#!/bin/bash
# Double-click this file to play. It starts a tiny local web server and opens the game.
cd "$(dirname "$0")"
PORT=8642
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 1
fi
URL="http://127.0.0.1:$PORT/"
if [ -d "/Applications/Google Chrome.app" ]; then
  # app mode: a clean window with no tabs or address bar
  open -na "Google Chrome" --args --app="$URL" --start-fullscreen
else
  open "$URL"
fi
echo ""
echo "  🎃  Elf on the Shelf: Hollow Hill is running at $URL"
echo "  Close this window (or press Ctrl+C) when you're done playing."
echo ""
if [ -n "$SERVER" ]; then wait $SERVER; fi
