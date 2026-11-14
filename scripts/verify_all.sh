#!/usr/bin/env bash
# Every check the ledger names, in one place. Requires the dev server for the
# browser-facing checks: npm run dev (defaults to http://127.0.0.1:5173).
set -euo pipefail
cd "$(dirname "$0")/.."

uv run python scripts/verify_data.py
uv run python scripts/verify_countries.py
uv run --with pytest pytest -q
node scripts/verify_rag.mjs
node scripts/verify_country_plan.mjs
node scripts/verify_locate.mjs
node scripts/verify_offline.mjs
node scripts/verify_clean.mjs
npm run build
node scripts/verify_app.mjs

echo "all checks passed"
