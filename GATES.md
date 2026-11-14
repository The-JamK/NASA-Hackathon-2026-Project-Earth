# Gates: Earth System Trend Detective — Case Files

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

- [x] G12: A place name or a coordinate resolves to the nearest record the bundle holds, covering decimal pairs, DMS, hemisphere suffixes, station names, aliases, countries and the offline gazetteer.
  CHECK: node scripts/verify_locate.mjs
  EXPECT: locate verified
  EVIDENCE: 28 checks over 45 stations and 4,039 grid cells; decimal, degree/minute, hemisphere, station, alias (Sahel → Niamey), country (Kenya → Nairobi), gazetteer (Kigali) and country-centroid lookups resolve; unknown input and out-of-range pairs are rejected; the nearest record is the haversine minimum.

- [x] G13: The map panel is served with the app: locate form, canvas, halo markers, and main.js mounts both the globe and the map.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: page, 45 points, 4,039 grid cells, 3 textures, 11 context images; `#map-panel`, `#locate-form` and `#map-canvas` present; `new MapView` and `resolveLocation` wired in main.js.

- [x] G14: The production build succeeds with the map panel and halo layer.
  CHECK: npm run build
  EXPECT: built in
  EVIDENCE: built in 7.53s on the final source; only the existing chunk-size warning.

- [x] G15: The base map is local: no tile server, geocoder or remote fetch, and the only outbound URL is the Google Maps deep link.
  CHECK: node scripts/verify_offline.mjs
  EXPECT: offline verified
  EVIDENCE: `src/mapview.js` references only `https://www.google.com/maps/…`, calls no fetch, and draws from the local Blue Marble texture; `src/geo.js` makes no network call.

- [x] G16: In the browser the map panel shows a real base map, a typed place opens the nearest case, and the station dot grows when the cursor is anywhere inside its halo, not only on the dot.
  MANUAL: verified in the Cloud browser at 1440×900 against the dev server.
  EVIDENCE: locating “Kigali” read 1.94°S 30.06°E, nearest station Nairobi 755 km E (case CASE-6CA4 opened), closer GISTEMP cell 1.0°S 29.0°E 158 km with an Open action, Google Maps link `?api=1&query=-1.94410,30.06190`; map drew the Blue Marble crop, station dots, target crosshair, connector and scale bar; 45 halo meshes created; hovering the Nairobi dot and a point 11 px away both set hovered=Nairobi, halo scale 1.8, opacity 0.55, cursor pointer, and cleared when the pointer left; console showed only WebGL performance warnings and the expected `/api/live` 503 (no Meteomatics credentials, labelled Snapshot).

- [x] G17: The work is pushed to `main` on GitHub.
  CHECK: git rev-parse HEAD and git rev-parse FETCH_HEAD agree after fetching `main`.
  EXPECT: identical hashes
  EVIDENCE: pushed `63cc511..3cd5c4e HEAD -> main`; `git rev-parse HEAD` and `FETCH_HEAD` both returned `3cd5c4eb52d168ba14783d206e75523fd7cb3099`.

- [x] G18: The tagline “Ask the planet. Get the evidence.”, the dot inside the wordmark, the intake label and the “Case board” wording are gone from both pages and from main.js, and the wordmark reads GAUSSIAN FRONTIERS.
  CHECK: node scripts/verify_app.mjs
  EXPECT: app verified
  EVIDENCE: output lines `chrome: tagline, brand dot, Intake label and case board wording removed` and `case layout: narrative paragraph above the verdict block`; rendered brand text is `GAUSSIAN FRONTIERS`; the landing title is `Case Files — NASA Space Apps 2026`. The landing page's only h1 was that sentence, so the page label now carries it at the kicker's size (9 px, accent) — the hero renders identically to before.

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

## Status

MET: 22
UNMET: 0
ABANDONED: 0
