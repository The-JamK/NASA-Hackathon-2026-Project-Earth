import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

// Two entries: the landing page at the site root and the app at /app.html.
// Relative asset URLs keep both working at the domain root and under
// /<repository>/ on GitHub Pages.
export default defineConfig({
  base: "./",
  build: {
    // The build is committed (GitHub Pages serves this repository folder), so
    // keep file names stable and let a rebuild overwrite them instead of adding
    // a new hashed copy of the bundle to Git history on every deploy.
    rollupOptions: {
      input: {
        landing: entry("./index.html"),
        app: entry("./app.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
