#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/kill-port.sh" 8000
echo "Uruchamiam ChromaDB…"
cd "$ROOT"
nohup chroma run --path ./chroma_db --port 8000 > "$ROOT/logs/chroma.log" 2>&1 &
echo "ChromaDB uruchomiony (log: logs/chroma.log)"
