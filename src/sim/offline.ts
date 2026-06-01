/* src/sim/offline.ts — "battles continue while the screen was off".
   We don't run in the background; on resume we replay the elapsed time by calling the
   SAME step() in a tight, render-free loop. Stops the moment the hero dies. */
import type { Sim } from './core';

export const DT = 1 / 30;

interface CatchUpResult {
  ranTicks: number;
  simSeconds: number;
  computeMs: number;
  gold: number;
  kills: number;
  waves: number;
  levels: number;
  died: boolean;
}

// elapsedSec: real seconds the app was away.  maxSec: cap (default 12h).
export function catchUp(sim: Sim, elapsedSec: number, maxSec?: number): CatchUpResult {
  const cap = Math.min(elapsedSec, maxSec || 12 * 3600);
  const ticks = Math.max(0, Math.floor(cap / DT));
  const before = {
    gold: sim.s.econ.goldEarned,
    kills: sim.s.econ.kills,
    wave: sim.s.wave.n,
    level: sim.s.econ.level,
  };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  sim.refreshStats(); // stats are invariant across the replay batch — compute once, not per tick
  let ran = 0;
  for (let i = 0; i < ticks; i++) {
    if (!sim.s.alive) break;
    sim.step(DT);
    ran++;
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (sim.s.fx) sim.s.fx.length = 0; // drop the render-free replay's kill-event backlog
  return {
    ranTicks: ran,
    simSeconds: ran * DT,
    computeMs: ms,
    gold: sim.s.econ.goldEarned - before.gold,
    kills: sim.s.econ.kills - before.kills,
    waves: sim.s.wave.n - before.wave,
    levels: sim.s.econ.level - before.level,
    died: !sim.s.alive,
  };
}
