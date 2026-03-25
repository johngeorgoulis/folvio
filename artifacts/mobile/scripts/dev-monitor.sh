#!/usr/bin/env bash
# dev-monitor.sh — port cleanup + automatic restart wrapper for Expo tunnel.
#
# Called by `pnpm dev`. Never requires manual intervention:
#   • Kills any stale process holding $PORT before the first start.
#   • On crash (ngrok transient failure, OOM, etc.) waits 3 s, clears the
#     port again, and restarts automatically.
#   • Forwards SIGTERM / SIGINT cleanly so the Replit workflow manager can
#     stop the process without leaving zombie children.

set -euo pipefail

EXPO_PORT="${PORT:-18115}"

free_port() {
  fuser -k "${EXPO_PORT}/tcp" 2>/dev/null || true
}

cleanup() {
  echo "[monitor] SIGTERM received — shutting down."
  free_port
  # Kill every process in our process group so Expo + Metro both exit.
  kill -- -"$$" 2>/dev/null || true
  exit 0
}

trap cleanup SIGTERM SIGINT

echo "[monitor] Clearing port ${EXPO_PORT} before start."
free_port

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[monitor] Starting Expo (attempt ${attempt}) on port ${EXPO_PORT}."

  # Run Expo in a subshell so we can detect its exit code.
  (
    exec env \
      EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN:-}" \
      EXPO_PUBLIC_REPL_ID="${REPL_ID:-}" \
      pnpm exec expo start --tunnel --port "${EXPO_PORT}"
  ) || true

  echo "[monitor] Expo exited. Waiting 3 s before restart."
  sleep 3

  echo "[monitor] Clearing port ${EXPO_PORT} before restart."
  free_port
done
