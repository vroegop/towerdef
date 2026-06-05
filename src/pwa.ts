/* src/pwa.ts — the PWA plumbing: register the service worker, ask the server what version is live,
   and (on an explicit update) wipe every cache so the next boot pulls a fresh bundle. The DECISIONS
   — whether a newer build exists, whether it breaks the save, what to show the player — live in
   main.ts; this module is just the browser/network/cache infrastructure. */
import type { ServerVersion } from './version';

// base:'./' in vite.config means BASE_URL is './' in the build and '/' in dev; both resolve against
// the document, so the game works from any sub-path (GitHub Pages project sites included).
const BASE = import.meta.env.BASE_URL;

// Register the worker that caches the app shell for instant startup. No-op without SW support (or on
// http://, where SW is disallowed) — the game simply runs uncached. Failures are swallowed: a flaky
// registration must never block boot.
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(BASE + 'sw.js').catch((err) => {
      console.info('[PWA] service worker registration failed', err);
    });
  });
}

// Ask the server for its CURRENT version. version.json is emitted per build and served with no SW
// caching (see public/sw.js), and we add cache:'no-store' so we always see the live file. Returns
// null on any failure (offline, 404 in dev, malformed) — the caller then just skips the check.
export async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const res = await fetch(BASE + 'version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerVersion;
    if (!data || typeof data.build !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

// Apply an update: drop every cache (ours + the worker's), then hard-reload so the browser refetches
// index.html and the freshly-hashed bundle. The caller clears a save-breaking save BEFORE calling.
export async function applyUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'clear-caches' });
    }
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  location.reload();
}
