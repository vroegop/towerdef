import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
    // Multi-page build: the game is the main entry; the labs balancing dashboard ships alongside
    // it so it's reachable on GitHub Pages at /tools/labs-dashboard/. Adding an explicit input map
    // means the root index.html must be listed here too (it's no longer auto-discovered).
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        labsDashboard: resolve(__dirname, 'tools/labs-dashboard/index.html'),
      },
    },
  },
});

