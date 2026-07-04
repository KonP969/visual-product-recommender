#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/kill-port.sh" 8001
echo "Uruchamiam Python sidecar (CLIP)…"
mkdir -p "$ROOT/logs"
cd "$ROOT/python-sidecar"
source venv/Scripts/activate
nohup uvicorn main:app --port 8001 > "$ROOT/logs/sidecar.log" 2>&1 &
echo "Python sidecar uruchomiony (log: logs/sidecar.log)"
