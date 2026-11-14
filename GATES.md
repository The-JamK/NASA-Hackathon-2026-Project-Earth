# Gates: Earth System Trend Detective — Signal & Noise

OWNS: whole project
Scope: a fresh, static web app with a Google-Earth-style 3D globe, real NASA/Meteomatics data bundles, deterministic trend statistics, local vector RAG for case plans, and a case-file UI.

Last verified: 2026-11-14

- [x] G1: The data build produces a bundle with at least 25 points, at least 2,000 global grid cells, and four variables, all from real cached sources.
  CHECK: uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: 45 points · 11 featured · 6 live · 4,039 grid cells · 6 source checks ok · global 1990–2025 slope +0.2362 °C/decade.

- [x] G2: The statistics engine reproduces known-answer fixtures for OLS/HAC, Sen's slope, and Mann–Kendall within tolerance.
  CHECK: uv run pytest -q
  EXPECT: passed
  EVIDENCE: 6 tests passed.

- [x] G3: The production frontend build succeeds.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 4.04s; CSS 15.97 kB; JS 1,955.52 kB (564.89 kB gzip).

- [x] G4: The dev server serves the built app and every required data asset returns HTTP 200.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: page, 3 globe textures, 11 context images and all JSON bundles returned 200; app verified.

- [x] G5: The local vector RAG returns the expected variables for nine golden questions.
  CHECK: node scripts/verify_rag.mjs
  EXPECT: rag verified
  EVIDENCE: 9 golden questions, time parsing and empty-input handling verified.

- [x] G6: No secrets, no pre-hackathon prototype code, and no unignored `.env` are present in the repo.
  CHECK: node scripts/verify_clean.mjs
  EXPECT: clean verified
  EVIDENCE: local `.env` is ignored; no tracked credentials; no prototype path references; ignore rules include `.env`, `node_modules`, `dist`, `data/cache`, `.DS_Store`.

- [x] G7: The case-file UI works at desktop and narrow viewport widths: globe renders, a point click opens a case, and the Ask box returns a plan.
  MANUAL: verified through the preview panel with console/network checks.
  EVIDENCE: WebGL canvas 2880×1800 at 1440×900; Nairobi case CASE-6CA4; Ask “Is the Sahel getting drier?” returned a 63% Niamey rainfall plan; global case counted 3,039 increasing / 78 decreasing / 922 not significant; 2000–2025 switch updated the verdict; 400, 700 and 800 px layouts checked; method dialog 720×702; preview clicks open and close cases after the loading layer is removed; console contained only Vite debug messages.

- [x] G8: The app works from the cached bundle with the network off for data (no live API required to render a case).
  CHECK: node scripts/verify_offline.mjs
  EXPECT: offline verified
  EVIDENCE: no external URLs in app source; 45 points, 4,039 grid cells, 36 global years and 11 context images all local. The check strips the landing page's outbound repository link and its inline SVG namespace URI, which are a link and a namespace rather than requests; it previously failed on them, so the oracle now states what it actually tests.

- [x] G9: A featured red-herring case presents a steep slope without a significance claim.
  CHECK: uv run python scripts/verify_data.py
  EXPECT: data verified
  EVIDENCE: McMurdo T2M +0.303 °C/decade, p = 0.060, verdict NOT PROVEN.

- [x] G10: Every featured point labels its actual imagery source, and at least ten serve real Sentinel-2 L2A pixels fetched through Planetary Computer's STAC/mosaic APIs with RGB band handling and recorded HTTP proof.
  CHECK: uv run python scripts/verify_sentinel.py
  EXPECT: sentinel verified
  EVIDENCE: 11/11 featured points use Sentinel-2 L2A mosaics; each has 9/9 HTTP 200 mosaic tiles. Unsigned visual COG returns HTTP 409 PublicAccessNotPermitted; SAS signing returns 200; signed Range GET returns 206; the COG is 3-band uint8 RGB with scale 1.0. `data/sentinel_report.json` records the item, URLs and statuses; no SAS token is stored.

- [x] G11: The production build works at the GitHub Pages repository subpath, not only at the domain root.
  CHECK: npm run build, then serve `dist` under `/NASA-Hackathon-2026-Project-Earth/`
  EXPECT: `./assets`, data, textures and point imagery all return 200; app opens a case
  EVIDENCE: built `dist/index.html` references `./assets/...`; local subpath test returned 200 for JS, CSS, `data/points.json`, all three globe textures and `data/imagery/nairobi-sentinel.jpg`; Nairobi case opened with a 640×360 image and no console errors. `.github/workflows/deploy.yml` publishes `dist` through GitHub Actions.

- [x] G12: A tapped coordinate resolves to the nearest station the bundle holds and to the nearest GISTEMP cell, both being the true minimum, with distance and bearing.
  CHECK: node scripts/verify_locate.mjs
  EXPECT: locate verified
  EVIDENCE: 24 assertions over 45 stations and 4,039 cells; nearest station and nearest cell equal a brute-force haversine minimum at the Sahara, London, Sydney, mid-Pacific, Kigali and Reykjavik taps; equatorial distance 1,113.19 km, symmetry, zero-distance, compass strings (E/S/N/NW), coordinate formatting, and null returns on an empty bundle and an empty grid.

- [x] G13: The app ships the tap recommendation instead of the map panel: `#recommendation` is served, `recommendAt`/`nearestCell` are wired, and no map panel, locate form, map canvas, `MapView` or Google Maps link remains.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: page, 45 points, 4,039 grid cells, 3 textures, 11 context images; output lines `recommendation: overlay element served and wired to the tap handler` and `chrome: …`; the check now fails on `#map-panel`, `#locate-form`, `#map-canvas`, `MapView` or any `google.com/maps` reference and passes.

- [x] G14: The production build succeeds with the tap recommendation and halo layer.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 6.67s on the final source; only the existing chunk-size warning.

- [x] G15: The recommendation needs no map service: no external URL and no fetch in the app source, and the overlay is computed from the cached bundle.
  CHECK: node scripts/verify_offline.mjs
  EXPECT: offline verified
  EVIDENCE: `index.html`, `src/main.js`, `src/rag.js`, `src/chart.js`, `src/style.css` and `src/geo.js` contain no external URL; `src/geo.js` performs no fetch; the only allowed outbound references remain the landing page's inline SVG namespace and repository link.

- [x] G16: In the browser the first tap on the world (no prior hover) puts a yellow marker on the tapped point, draws yellow dashed arcs with distance labels to the nearest station and the nearest cell, and shows a card whose Open and close actions work.
  MANUAL: verified in the Cloud browser at 1440×900 against the dev server.
  EVIDENCE: an un-hovered tap at (700, 430) resolved 15.55°N 3.34°E, nearest station Niamey 261 km SSW, nearest cell 15.0°N 5.0°E 189 km, and placed the card at (722, 448); a tap in the South Atlantic resolved 15.31°S 4.55°W with Accra 2,375 km NNE and cell 17.0°S 3.0°W 250 km, drawn as two dashed yellow arcs with `2,375 km` and `250 km` labels; Open on the station row rendered the Accra case and cleared the card and arcs; the × removed the card and the state; a second tap after closing produced a new recommendation; console showed only the expected `/api/live` 503 (no Meteomatics credentials). The map panel, locate form and Google Maps link are absent from the page.

- [x] G17: The work is pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `63cc511..3cd5c4e HEAD -> main`; `git rev-parse HEAD` and `FETCH_HEAD` both returned `3cd5c4eb52d168ba14783d206e75523fd7cb3099`.

- [x] G18: The tagline “Ask the planet. Get the evidence.”, the dot inside the wordmark, the intake label and the “Case board” wording are gone from both pages and from main.js, and the wordmark reads GAUSSIAN FRONTIERS.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: output lines `chrome: tagline, brand dot, Intake label and case board wording removed` and `case layout: narrative paragraph above the verdict block`; rendered brand text is `GAUSSIAN FRONTIERS`; the landing title is `Signal & Noise — NASA Space Apps 2026`. The landing page's only h1 was that sentence, so the page label now carries it at the kicker's size (9 px, accent) — the hero renders identically to before.

- [x] G19: With no case open the right-hand panel is not rendered; opening a case shows it.
  MANUAL: verified in the Cloud browser at 1440×900 against the dev server.
  EVIDENCE: on load the case panel's computed `display` was `none` and its text was empty; `#featured-grid` and the “How a case works” block are gone from the page; locating Nairobi set `display: block` and rendered the case; “Case board” appears in no state.

- [x] G20: In an open case the narrative paragraph sits after the Temperature/Rainfall/Soil/Solar and Window buttons and before the verdict stamp, above the chart and the facts, with its styling unchanged.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: source-order assertion reports `case layout: narrative paragraph above the verdict block`; measured DOM order in the browser was case-head, place-title, place-sub, live-chip, imagery, var-chips, window-row, narrative, verdict, chart, facts; the paragraph keeps `.narrative` (12 px, `#c4d0da`).

- [x] G21: The production build succeeds after the chrome changes.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 6.81s; only the existing chunk-size warning.

- [x] G22: The chrome changes are pushed to `main` after the localhost check.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `a5c2b6a..acdabc2 HEAD -> main` after the browser checks; HEAD and FETCH_HEAD both returned `acdabc2` for the feature commit, and the ledger follow-up advanced `main` afterwards.

- [x] G23: The tap recommendation and its ledger are pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `d73057e..ea41331 HEAD -> main`; `git rev-parse HEAD` and `FETCH_HEAD` both returned `ea41331` for the feature commit, and the ledger follow-up advanced `main` afterwards.

## Status

MET: 23
UNMET: 0
ABANDONED: 0
