import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Resolve a path relative to this config file (ESM-safe; no __dirname).
const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// ---- App version: one source of truth, baked into the client AND emitted as a server file ----
// version.config.json (committed) holds the human-set semver + the list of build numbers that broke
// the save format. The BUILD number is supplied by CI (GITHUB_RUN_NUMBER) so it bumps automatically
// on every deploy — no commit-back needed. We:
//   1. `define` the version/build/save-breaking list as compile-time constants for the client (so a
//      shipped build knows exactly which version IT is), and
//   2. emit dist/version.json — the file the live game polls to learn the server's CURRENT version.
// In `vite dev` (no generateBundle) version.json isn't served; the in-app check just no-ops on 404.
function appVersionPlugin(): Plugin {
  const cfg = JSON.parse(readFileSync(r('./version.config.json'), 'utf8')) as {
    version?: string;
    saveBreakingBuilds?: number[];
  };
  const build = Number(process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || 0) || 0;
  const version = (cfg.version || '0.0.0') + '+' + (build || 'dev');
  const saveBreakingBuilds = Array.isArray(cfg.saveBreakingBuilds) ? cfg.saveBreakingBuilds : [];
  return {
    name: 'app-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(version),
          __APP_BUILD__: JSON.stringify(build),
          __SAVE_BREAKING_BUILDS__: JSON.stringify(saveBreakingBuilds),
        },
      };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, build, saveBreakingBuilds, builtAt: new Date().toISOString() }, null, 2),
      });
    },
  };
}

// The dev server keeps the original port (8778) and disables caching, mirroring the old
// serve.py so muscle-memory + bookmarks keep working. The build emits a static, no-runtime
// bundle to dist/ (deployable to GitHub Pages exactly like the old build-free site).
export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  plugins: [appVersionPlugin()],
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
    // Multi-page build: the game at the site root, plus the dev dashboards (labs balancing + Super
    // Weapons design, and the latter's static art gallery) under /tools/ so they ship to GitHub Pages
    // alongside the game. Listing inputs explicitly means the root index.html must be included here
    // too (it's no longer auto-discovered). base:'./' keeps every page's asset URLs relative, so each
    // works from its own sub-path.
    rollupOptions: {
      input: {
        main: r('./index.html'),
        labsDashboard: r('./tools/labs-dashboard/index.html'),
        superweapons: r('./tools/superweapons-dashboard/index.html'),
        superweaponsGallery: r('./tools/superweapons-dashboard/art-gallery.html'),
      },
    },
  },
});
