#!/usr/bin/env bash
# Confirm the deployed site serves exactly the built bundle and still answers
# country questions. Usage: bash scripts/verify_live.sh [url]
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-${BASE_URL:-https://the-jamk.github.io/NASA-Hackathon-2026-Project-Earth}}"
echo "live: $BASE"

for file in points.json rag_index.json countries.json; do
  local_hash=$(shasum -a 256 "dist/data/$file" | awk '{print $1}')
  live_hash=$(curl -fsS --max-time 30 "$BASE/data/$file" | shasum -a 256 | awk '{print $1}')
  if [ "$local_hash" != "$live_hash" ]; then
    echo "FAIL: $file differs (local $local_hash, live $live_hash)"
    exit 1
  fi
  echo "  $file matches dist"
done

BASE_URL="$BASE" node scripts/verify_live_plan.mjs
echo "live verified"
