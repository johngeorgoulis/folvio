#!/usr/bin/env bash
# push-preview.sh — push current branch changes to the preview channel on your device.
# Usage: bash mobile-scripts/push-preview.sh [optional message]
set -euo pipefail

BRANCH=$(git rev-parse --abbrev-ref HEAD)
MESSAGE="${1:-$(git log -1 --pretty=format '%s')}"

echo ""
echo "  Pushing update to preview channel"
echo "  Branch : $BRANCH"
echo "  Message: $MESSAGE"
echo ""

npx eas update \
  --channel preview \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "  Done. Open the app on your phone to see the update."
