/* src/backend/index.ts — chooses the live backend and hands out a singleton. This is THE migration
   switch: with VITE_BACKEND_URL unset (static site / GitHub Pages) the game runs on the in-browser
   MockBackend; set it at build time and the identical code talks to a real Node server via HttpBackend.
   No call site changes either way. */
import type { Backend } from './types';
import { MockBackend } from './mock';
import { HttpBackend } from './http';

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (!instance) {
    const url = import.meta.env.VITE_BACKEND_URL;
    instance = url ? new HttpBackend(url) : new MockBackend();
  }
  return instance;
}

/** Override the active backend — used by tests to inject a zero-latency or stub backend. */
export function setBackend(backend: Backend | null): void {
  instance = backend;
}

export * from './types';
export { MockBackend } from './mock';
export { HttpBackend } from './http';
