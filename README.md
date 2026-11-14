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

## Deploy to GitHub Pages

The app is built with Vite and served from `dist`. The workflow in
`.github/workflows/deploy.yml` builds and publishes `dist` whenever `main` is
pushed. In the repository settings, set **Pages → Build and deployment → Source**
to **GitHub Actions** once; after that the workflow owns the deployment.

Vite uses relative asset paths (`base: "./"`) and the app resolves data,
textures and point imagery through `import.meta.env.BASE_URL`, so the build works
under the repository subpath rather than only at the domain root.
