import { defineConfig } from 'vite';

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
  },
});
