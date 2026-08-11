#!/bin/bash
# Local dev server for Grind & Flow (static app, no build step).
# Serves the current directory over HTTP so the service worker / fetch calls behave
# like they would in production (opening index.html via file:// breaks Supabase/CORS).

PORT="${1:-8000}"

cd "$(dirname "$0")" || exit 1

echo "Serving Grind & Flow at http://localhost:$PORT"
echo "Press Ctrl+C to stop."

python3 -m http.server "$PORT"
