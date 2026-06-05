/* src/version.ts — the build's own identity, baked in by the `app-version` Vite plugin
   (see vite.config.ts). A shipped bundle knows exactly which version IT is, so the live
   update check (src/pwa.ts) can compare it against the server's version.json. */

// __APP_*__ are replaced at build time by Vite's `define` (declared globally in src/vite-env.d.ts).
// Outside a Vite build (e.g. unit tests) they're simply absent, so each read is guarded by `typeof`
// and falls back to a dev-safe default.
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0+dev';
export const APP_BUILD: number = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;
export const SAVE_BREAKING_BUILDS: number[] =
  typeof __SAVE_BREAKING_BUILDS__ !== 'undefined' ? __SAVE_BREAKING_BUILDS__ : [];

// The shape of the server's version.json (emitted into dist/ by the same plugin).
export interface ServerVersion {
  version: string;
  build: number;
  saveBreakingBuilds?: number[];
  builtAt?: string;
}

// Everything the update modal + rail button need to describe an available update.
export interface UpdateInfo {
  current: string; // version string this client was built as
  currentBuild: number;
  latest: string; // server's current version string
  latestBuild: number;
  breaksSave: boolean; // true if crossing from currentBuild→latestBuild passes a save-breaking build
}

// Would updating from `currentBuild` to `latestBuild` cross a build that invalidated the save format?
// We OR the server's list with our own baked list so a save-break is honoured whether it was known at
// this client's build time or only declared later on the server.
export function updateBreaksSave(currentBuild: number, latestBuild: number, serverBreaking?: number[]): boolean {
  const builds = new Set<number>([...SAVE_BREAKING_BUILDS, ...(serverBreaking || [])]);
  for (const b of builds) if (b > currentBuild && b <= latestBuild) return true;
  return false;
}
