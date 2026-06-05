/* src/sim/offline.worker.ts — runs the offline catch-up replay OFF the main thread.

   A long idle window (up to the 12h cap) can be well over a million ticks; replaying it on the
   main thread froze the page on load (black screen). This worker reconstructs the Sim from the
   serialized state, runs the SAME render-free step() loop, and streams progress so main.ts can
   update the "while you were away" screen live while the canvas stays frozen.

   Determinism is unchanged: chunking the loop only decides WHEN we post progress, never how many
   times step() runs. Messages:
     in : { state, elapsedSec, maxSec }
     out: { type:'progress', result, frac } repeatedly, then { type:'done', state, result } */
import type { State } from '../types';
import { Sim } from './core';
import { DT, plannedTicks, snapshot, summarize } from './offline';

interface Req {
  state: State;
  elapsedSec: number;
  maxSec?: number;
}

// Minimal worker-scope typing so we don't need the WebWorker lib in tsconfig.
const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

const PROGRESS_MS = 80; // stream a tally update roughly every 80ms of wall time (~12fps)

ctx.onmessage = (e: MessageEvent<Req>) => {
  const { state, elapsedSec, maxSec } = e.data;
  const sim = new Sim(state);
  const ticks = plannedTicks(elapsedSec, maxSec);
  const before = snapshot(sim);
  const t0 = performance.now();
  sim.refreshStats(); // invariant across the batch — compute once, exactly like catchUp()
  let ran = 0;
  let lastPost = t0;
  for (let i = 0; i < ticks; i++) {
    if (!sim.s.alive) break;
    sim.step(DT);
    ran++;
    const tnow = performance.now();
    if (tnow - lastPost >= PROGRESS_MS) {
      lastPost = tnow;
      ctx.postMessage({ type: 'progress', result: summarize(sim, before, ran, tnow - t0), frac: ticks ? ran / ticks : 1 });
    }
  }
  if (sim.s.fx) sim.s.fx.length = 0; // drop the render-free replay's kill-event backlog
  ctx.postMessage({ type: 'done', state: sim.serialize(), result: summarize(sim, before, ran, performance.now() - t0) });
};
