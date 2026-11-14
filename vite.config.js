import { defineConfig } from "vite";

// Use relative asset URLs so the built app works both at the domain root
// locally and under /<repository>/ on GitHub Pages.
export default defineConfig({
  base: "./",
});
