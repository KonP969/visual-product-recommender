#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/kill-port.sh" 5173
echo "Uruchamiam frontend Vite…"
mkdir -p "$ROOT/logs"
cd "$ROOT/frontend"
nohup npm run dev > "$ROOT/logs/frontend.log" 2>&1 &
echo "Frontend uruchomiony (log: logs/frontend.log)"
