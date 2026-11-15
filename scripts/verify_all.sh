#!/usr/bin/env bash
# Every check the ledger names, in one place. Requires the dev server for the
# browser-facing checks: npm run dev (defaults to http://127.0.0.1:5173).
set -euo pipefail
cd "$(dirname "$0")/.."

uv run python scripts/verify_data.py
uv run python scripts/verify_countries.py
node scripts/verify_bundle.mjs
node scripts/verify_gazetteer.mjs
node scripts/verify_search.mjs
node scripts/verify_resolve.mjs
uv run --with pytest pytest -q
node scripts/verify_rag.mjs
node scripts/verify_country_plan.mjs
node scripts/verify_locate.mjs
node scripts/verify_offline.mjs
node scripts/verify_textures.mjs
node scripts/verify_clean.mjs
node scripts/verify_live_proxy.mjs
node scripts/verify_red_herring.mjs
node scripts/verify_ocean.mjs
node scripts/verify_seaice.mjs
node scripts/verify_export.mjs
npm run build
node scripts/verify_firstload.mjs
node scripts/verify_app.mjs
# The deployed app must still serve exactly this build. This is last because it
# is the only check that needs the network.
bash scripts/verify_live.sh

echo "all checks passed"
