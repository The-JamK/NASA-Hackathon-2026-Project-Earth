import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

// Two entries: the landing page at the site root and the app at /app.html.
// Relative asset URLs keep both working at the domain root and under
// /<repository>/ on GitHub Pages.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        landing: entry("./index.html"),
        app: entry("./app.html"),
      },
    },
  },
});
