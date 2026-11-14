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

# Every data file the app can ask for must exist on the live origin. A 404 here is
# how a missing build file hides: the app loads fine, then one feature dies on a
# fetch nobody watched (an ocean tap, for instance, fetched ocean.json and threw).
missing=0
while IFS= read -r path; do
  rel="${path#dist/}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$BASE/$rel")
  if [ "$code" != "200" ]; then
    echo "FAIL: $rel returns $code on the live origin"
    missing=1
  fi
done < <(find dist/data -name '*.json' | sort)
if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "  every dist/data/*.json is served"

BASE_URL="$BASE" node scripts/verify_live_plan.mjs
echo "live verified"
