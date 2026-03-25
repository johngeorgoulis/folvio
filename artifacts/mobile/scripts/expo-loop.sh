#!/usr/bin/env bash
# expo-loop.sh — starts expo and auto-restarts on crash.
# Port cleanup is handled by kill-ports.sh (run via concurrently before this).
set -uo pipefail

EXPO_PORT="${PORT:-18115}"

cleanup() {
  echo "[expo-loop] shutting down."
  fuser -k "${EXPO_PORT}/tcp" 2>/dev/null || true
  kill -- -"$$" 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[expo-loop] starting Metro (attempt ${attempt})."
  EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN:-}" \
  EXPO_PUBLIC_REPL_ID="${REPL_ID:-}" \
    pnpm exec expo start --tunnel --port "${EXPO_PORT}" || true
  echo "[expo-loop] Metro exited — clearing port and restarting in 3 s."
  fuser -k "${EXPO_PORT}/tcp" 2>/dev/null || true
  sleep 3
done
