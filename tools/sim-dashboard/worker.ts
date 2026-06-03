/* tools/sim-dashboard/worker.ts — runs one progression in a background thread.
 *
 * Receives { profile, bounds }, runs the (synchronous, CPU-heavy) engine here so the page never
 * blocks, and posts progress events back. Progress is throttled to ~0.8s of wall time (performance.now
 * is fine here — it's only for UI pacing, never for sim logic), while 'tier' and 'done' always post.
 * Stopping is done by the page calling worker.terminate(). */

import { runProgression, type Profile, type EngineBounds, type ProgressEvent } from '../sim-engine';

let lastPost = 0;

self.onmessage = (ev: MessageEvent): void => {
  const { profile, bounds } = ev.data as { profile: Profile; bounds?: Partial<EngineBounds> };
  try {
    runProgression({
      profile,
      bounds,
      onProgress: (e: ProgressEvent) => {
        const now = performance.now();
        if (e.kind !== 'progress' || now - lastPost > 800) {
          lastPost = now;
          (self as unknown as Worker).postMessage(e);
        }
      },
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({ kind: 'error', message: String((err as Error)?.stack || err) });
  }
};
