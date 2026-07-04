#!/usr/bin/env bash
# Zabija proces nasłuchujący na podanym porcie (Windows)
PORT=$1
PID=$(netstat -ano | grep ":${PORT}" | grep "LISTENING" | awk '{print $5}' | head -1)
if [ -n "$PID" ]; then
  echo "Zabijam PID $PID na porcie $PORT…"
  taskkill //PID "$PID" //F
else
  echo "Brak procesu na porcie $PORT"
fi
