#!/usr/bin/env bash
# startup.sh — run at every Replit workflow start.
# 1. Pull latest code from GitHub (source of truth)
# 2. Install / sync dependencies
# 3. Start the Expo mobile dev server
set -uo pipefail

WORKSPACE="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKSPACE"

echo ""
echo "╔══════════════════════════════════╗"
echo "║   Folvio startup — $(date +%H:%M:%S)       ║"
echo "╚══════════════════════════════════╝"

# ── Step 1: Git pull from GitHub ─────────────────────────────────────────────
echo ""
echo "[1/3] Syncing with GitHub..."

# Ensure the 'origin' remote points to the public GitHub repo
git remote add origin https://github.com/johngeorgoulis/folvio.git 2>/dev/null || \
  git remote set-url origin https://github.com/johngeorgoulis/folvio.git

git fetch origin master --quiet 2>&1 || {
  echo "      GitHub unreachable — continuing with local code."
}

# Fast-forward if GitHub is ahead; skip safely if we have local-only commits
if git merge-base --is-ancestor origin/master HEAD 2>/dev/null; then
  echo "      Already up to date with GitHub."
elif git merge --ff-only origin/master 2>/dev/null; then
  echo "      Pulled latest commits from GitHub."
else
  echo "      Local branch diverged from GitHub — continuing with local code."
  echo "      (Push your local commits to GitHub to re-sync.)"
fi

# ── Step 2: Install dependencies ─────────────────────────────────────────────
echo ""
echo "[2/3] Installing dependencies..."
pnpm install --prefer-frozen-lockfile 2>&1 | grep -E "^(Packages|ERR|warn|error)" || true
echo "      Dependencies ready."

# ── Step 3: Start the Expo app ───────────────────────────────────────────────
echo ""
echo "[3/3] Starting Expo..."
fuser -k 8081/tcp  2>/dev/null || true
fuser -k 18115/tcp 2>/dev/null || true

exec pnpm --filter @workspace/mobile run dev
