#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/kill-port.sh" 3001
echo "Uruchamiam backend Express…"
mkdir -p "$ROOT/logs"
cd "$ROOT/backend"
nohup npm run dev > "$ROOT/logs/backend.log" 2>&1 &
echo "Backend uruchomiony (log: logs/backend.log)"
