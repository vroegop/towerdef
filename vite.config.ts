import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Resolve a path relative to this config file (ESM-safe; no __dirname).
const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// The dev server keeps the original port (8778) and disables caching, mirroring the old
// serve.py so muscle-memory + bookmarks keep working. The build emits a static, no-runtime
// bundle to dist/ (deployable to GitHub Pages exactly like the old build-free site).
export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  server: {
    port: 8778,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  preview: {
    port: 8778,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2021',
    sourcemap: true,
    // Multi-page build: the game at the site root, plus the Super Weapons design dashboard (and its
    // static art gallery) under /tools/ so they ship to GitHub Pages alongside the game. base:'./'
    // keeps every page's asset URLs relative, so each works from its own sub-path.
    rollupOptions: {
      input: {
        main: r('./index.html'),
        superweapons: r('./tools/superweapons-dashboard/index.html'),
        superweaponsGallery: r('./tools/superweapons-dashboard/art-gallery.html'),
      },
    },
  },
});
