#!/usr/bin/env bash
# kill-ports.sh — one-shot: clears the Expo port and Metro's default port.
# Runs alongside expo-loop.sh via concurrently so cleanup happens at startup.
EXPO_PORT="${PORT:-18115}"
fuser -k "${EXPO_PORT}/tcp" 2>/dev/null || true
fuser -k "8081/tcp"         2>/dev/null || true
echo "[kill-ports] ports ${EXPO_PORT} and 8081 cleared."
