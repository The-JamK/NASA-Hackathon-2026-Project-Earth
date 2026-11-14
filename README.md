# NASA Hackathon 2026 - Project Earth 

Case Files — an Earth system trend detective for NASA Space Apps 2026. 

## Run locally

```sh
npm install
npm run dev
```

The app uses prebuilt data under `public/data`; rebuild the data bundle with:  

```sh
uv run python scripts/build_data.py --env-file path/to/.env
```

## Live conditions

The “Live” chip on a city case is served by a small proxy so the Meteomatics
credentials never reach the browser:

- `worker/live.js` — allowlists the bundle's points, queries Meteomatics for them
  in one request, caches for 10 minutes, and answers `live_unconfigured` when
  credentials are absent.
- `worker/index.js` — Workers entry: `/api/live` plus the static app.
- `vite.config.js` — the same handler behind the dev and preview servers, reading
  `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` from `.env`.

If the proxy is not running — the static GitHub Pages build, for example — the
app falls back to the snapshot captured during the data build and labels the
chip **Snapshot**.

To host the proxy, build with `npm run build`, deploy `worker/` with Wrangler
(`worker/wrangler.toml` serves `dist/` as static assets), and store
`METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` as Worker secrets.

## Deploy to GitHub Pages

The app is built with Vite and served from `dist`. The workflow in
`.github/workflows/deploy.yml` builds and publishes `dist` whenever `main` is
pushed. In the repository settings, set **Pages → Build and deployment → Source**
to **GitHub Actions** once; after that the workflow owns the deployment.

Vite uses relative asset paths (`base: "./"`) and the app resolves data,
textures and point imagery through `import.meta.env.BASE_URL`, so the build works
under the repository subpath rather than only at the domain root.

## Tap anywhere on the globe

Tapping the globe answers with the records closest to that coordinate. A yellow
marker sits on the tapped point, two dashed yellow arcs run to the nearest station
and to the nearest GISTEMP cell, each with its distance printed on the globe, and a
small card beside the point lists both records with their distances, a compass
bearing for the station, and an **Open** button for each.

Tapping inside a station's halo (1.6° around the dot) opens that station directly
instead of recommending neighbours, so the globe still behaves like a case browser.
The recommendation is local geometry over the cached bundle: no map tiles, no
geocoder, no outbound link. `node scripts/verify_locate.mjs` checks the nearest
record and the nearest cell against a brute-force minimum without a browser.

Station dots carry a faint halo, which is also the hover target: while the cursor
is anywhere inside that area the dot grows, its halo lights up, and a click opens
the case.

## Pages

Two pages are built from `vite.config.js` (`build.rollupOptions.input`):

- `index.html` — the landing page at the site root: what the app does, a sample
  verdict read live from `public/data`, and the statistical contract.
- `app.html` — the app itself: globe, question box, map link and the case file, which appears only while a case is open.

On GitHub Pages they are served at `/NASA-Hackathon-2026-Project-Earth/` and
`/NASA-Hackathon-2026-Project-Earth/app.html`. Both pages use relative links and
`./` asset URLs, so they also work from a local `vite preview`.
