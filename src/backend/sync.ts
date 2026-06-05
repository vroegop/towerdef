/* src/backend/sync.ts — the bridge between the device (authoritative localStorage) and the backend.

   Sync policy (deliberately simple, client-wins):
   - The device's localStorage is the live source of truth. Anything earned offline stays put.
   - hydrateDevice() pulls the server bundle ONLY when this device has no progression yet (a fresh
     install or a reinstall after re-auth). If local data exists we never overwrite it — we just warm
     a session in the background so later backups can push.
   - schedulePush() debounces a backup of the current local state up to the server. It is
     fire-and-forget and swallows errors: offline simply means the next save retries.

   All of this is wall-clock lifecycle work that runs outside the sim's step(), so determinism and
   offline catch-up are untouched. */
import type { SaveBundle, Session } from './types';
import { getBackend } from './index';

/** The localStorage keys main.ts owns, passed in so this module has no hard-coded coupling to them. */
export interface StorageKeys {
  meta: string;
  settings: string;
  save: string;
  device: string;
}

const PULL_TIMEOUT_MS = 4000; // a dead/slow server must never hang first-launch boot
const PUSH_DEBOUNCE_MS = 4000;

let sessionPromise: Promise<Session> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function deviceId(keys: StorageKeys): string {
  let id = localStorage.getItem(keys.device);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(keys.device, id);
  }
  return id;
}

/** Authenticate once and cache the session for the page's lifetime. */
function ensureSession(keys: StorageKeys): Promise<Session> {
  if (!sessionPromise) sessionPromise = getBackend().authenticate(deviceId(keys));
  return sessionPromise;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Restore from the backend on a fresh device, honouring client-wins.
 *
 * @returns true if remote data was written into localStorage (caller should re-read local state),
 *          false if local data already existed or there was nothing/no server to restore from.
 */
export async function hydrateDevice(keys: StorageKeys): Promise<boolean> {
  // Client-wins: a device that already holds progression is never overwritten from the server.
  if (localStorage.getItem(keys.meta)) {
    void ensureSession(keys).catch(() => {}); // warm the session for later background pushes
    return false;
  }
  try {
    const backend = getBackend();
    const session = await ensureSession(keys);
    const bundle = await withTimeout(backend.pull(session), PULL_TIMEOUT_MS);
    if (bundle?.meta) {
      localStorage.setItem(keys.meta, JSON.stringify(bundle.meta));
      if (bundle.settings) localStorage.setItem(keys.settings, JSON.stringify(bundle.settings));
      if (bundle.save) localStorage.setItem(keys.save, JSON.stringify(bundle.save));
      return true;
    }
  } catch {
    /* offline, timeout, or no backend → start fresh locally; the first push will seed the server */
  }
  return false;
}

function localBundle(keys: StorageKeys): SaveBundle {
  return {
    meta: parse(localStorage.getItem(keys.meta)),
    settings: parse(localStorage.getItem(keys.settings)),
    save: parse(localStorage.getItem(keys.save)),
    rev: 0, // the server stamps the authoritative rev on push
    updatedAt: Date.now(),
  };
}

async function pushNow(keys: StorageKeys): Promise<void> {
  try {
    const backend = getBackend();
    const session = await ensureSession(keys);
    await backend.push(session, localBundle(keys));
  } catch {
    /* offline → the next save reschedules a push; nothing is lost (local stays authoritative) */
  }
}

/** Debounced backup of current local state to the backend. Safe to call on every save. */
export function schedulePush(keys: StorageKeys, delay = PUSH_DEBOUNCE_MS): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(keys), delay);
}

/** Test/teardown hook: drop the cached session and any pending push timer. */
export function resetSync(): void {
  sessionPromise = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}
