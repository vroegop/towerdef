/* src/sim/offline.ts — "battles continue while the screen was off".
   We don't run in the background; on resume we replay the elapsed time by calling the
   SAME step() in a tight, render-free loop. Stops the moment the hero dies.

   The same replay runs in two places: synchronously (dev fast-forward, tests) via catchUp(),
   and OFF the main thread in offline.worker.ts for long idle windows so a multi-second tally
   never freezes the UI. Both share the snapshot/summarize helpers below so the two paths can
   never drift in what they count. */
import type { Sim } from './core';

export const DT = 1 / 30;
export const OFFLINE_CAP_SEC = 12 * 3600; // default real-time cap on a single catch-up window

export interface CatchUpResult {
  ranTicks: number;
  simSeconds: number;
  computeMs: number;
  gold: number;
  coins: number; // bonus coins (coins-per-wave + per-kill coins) accrued during the replay
  kills: number;
  waves: number;
  // Meta currencies a survived run can mint while away (boss Energy, superpower gem/vial/energy
  // payouts). Reported as deltas so the worker path can reconcile them into the live meta — the
  // synchronous path mutates meta in place, so for it these are informational only.
  gems: number;
  vials: number;
  energy: number;
  died: boolean;
}

// Everything the result diffs against: the pre-replay run + meta totals.
export interface CatchUpSnapshot {
  gold: number;
  coins: number;
  kills: number;
  wave: number;
  gems: number;
  vials: number;
  energy: number;
}

export function snapshot(sim: Sim): CatchUpSnapshot {
  const m = sim.s.meta || ({} as { gems?: number; vials?: number; energy?: number });
  return {
    gold: sim.s.econ.goldEarned,
    coins: sim.s.econ.bonusCoins,
    kills: sim.s.econ.kills,
    wave: sim.s.wave.n,
    gems: m.gems || 0,
    vials: m.vials || 0,
    energy: m.energy || 0,
  };
}

// How many fixed ticks an `elapsedSec` window (capped) replays. Cheap; callers use it to decide
// whether a window is big enough to be worth handing to the worker.
export function plannedTicks(elapsedSec: number, maxSec?: number): number {
  const cap = Math.min(elapsedSec, maxSec || OFFLINE_CAP_SEC);
  return Math.max(0, Math.floor(cap / DT));
}

export function summarize(sim: Sim, before: CatchUpSnapshot, ran: number, computeMs: number): CatchUpResult {
  const m = sim.s.meta || ({} as { gems?: number; vials?: number; energy?: number });
  return {
    ranTicks: ran,
    simSeconds: ran * DT,
    computeMs,
    gold: sim.s.econ.goldEarned - before.gold,
    coins: sim.s.econ.bonusCoins - before.coins,
    kills: sim.s.econ.kills - before.kills,
    waves: sim.s.wave.n - before.wave,
    gems: (m.gems || 0) - before.gems,
    vials: (m.vials || 0) - before.vials,
    energy: (m.energy || 0) - before.energy,
    died: !sim.s.alive,
  };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// elapsedSec: real seconds the app was away.  maxSec: cap (default 12h).
// Synchronous, blocking replay — used by the dev fast-forward and the unit tests. The live game
// boot/return path runs the same loop in offline.worker.ts instead (see main.ts).
export function catchUp(sim: Sim, elapsedSec: number, maxSec?: number): CatchUpResult {
  const ticks = plannedTicks(elapsedSec, maxSec);
  const before = snapshot(sim);
  const t0 = now();
  sim.refreshStats(); // stats are invariant across the replay batch — compute once, not per tick
  let ran = 0;
  for (let i = 0; i < ticks; i++) {
    if (!sim.s.alive) break;
    sim.step(DT);
    ran++;
  }
  const ms = now() - t0;
  if (sim.s.fx) sim.s.fx.length = 0; // drop the render-free replay's kill-event backlog
  return summarize(sim, before, ran, ms);
}
