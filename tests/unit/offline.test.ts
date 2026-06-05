/* tests/unit/offline.test.ts — guards the offline catch-up replay, including the property the
   off-main-thread worker (src/sim/offline.worker.ts) relies on: replaying the same window in
   time-sliced CHUNKS must yield the exact same state and tally as one blocking pass. Chunking only
   decides WHEN progress is posted, never how many times step() runs. */
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/core';
import { createState } from '../../src/sim/state';
import { migrateMeta } from '../../src/sim/labs';
import { catchUp, plannedTicks, snapshot, summarize, DT, OFFLINE_CAP_SEC } from '../../src/sim/offline';
import type { Meta } from '../../src/types';

function freshMeta(): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0,
  });
}

// Re-implements the worker's chunked loop in-process so we can assert it matches catchUp().
function chunkedReplay(sim: Sim, elapsedSec: number, chunk: number): ReturnType<typeof summarize> {
  const ticks = plannedTicks(elapsedSec);
  const before = snapshot(sim);
  sim.refreshStats();
  let ran = 0;
  while (ran < ticks) {
    const end = Math.min(ticks, ran + chunk);
    for (; ran < end; ran++) {
      if (!sim.s.alive) break;
      sim.step(DT);
    }
    if (!sim.s.alive) break;
  }
  if (sim.s.fx) sim.s.fx.length = 0;
  return summarize(sim, before, ran, 0);
}

describe('offline catch-up', () => {
  it('plannedTicks converts seconds to fixed ticks and honours the cap', () => {
    expect(plannedTicks(0)).toBe(0);
    expect(plannedTicks(1)).toBe(Math.floor(1 / DT)); // 30
    expect(plannedTicks(OFFLINE_CAP_SEC * 2)).toBe(Math.floor(OFFLINE_CAP_SEC / DT)); // clamped to the cap
    expect(plannedTicks(60, 10)).toBe(Math.floor(10 / DT)); // explicit maxSec wins
  });

  it('a chunked replay is identical to one blocking pass (the worker invariant)', () => {
    const seconds = 600; // 10 simulated minutes
    const oneShot = new Sim(createState(987654, freshMeta(), false));
    const sliced = new Sim(createState(987654, freshMeta(), false));

    const a = catchUp(oneShot, seconds);
    const b = chunkedReplay(sliced, seconds, 137); // an awkward chunk size to stress boundary handling

    // Same tally (computeMs is wall-clock timing, so normalise it out)...
    expect({ ...b, computeMs: 0 }).toEqual({ ...a, computeMs: 0 });
    // ...and the same resulting sim state (this is what the worker ships back to the main thread).
    expect(sliced.s.tick).toBe(oneShot.s.tick);
    expect(sliced.s.wave.n).toBe(oneShot.s.wave.n);
    expect(sliced.s.econ.kills).toBe(oneShot.s.econ.kills);
    expect(sliced.s.econ.goldEarned).toBe(oneShot.s.econ.goldEarned);
    expect(sliced.s.enemies.length).toBe(oneShot.s.enemies.length);
    expect(sliced.rng.state).toBe(oneShot.rng.state);
  });

  it('summarize reports currency gains as deltas, including meta currencies', () => {
    const sim = new Sim(createState(13, freshMeta(), false));
    const before = snapshot(sim);
    // Hand-bank some gains so the deltas are non-trivial and cover every reported field.
    sim.s.econ.goldEarned += 1234;
    sim.s.econ.bonusCoins += 56;
    sim.s.econ.kills += 7;
    sim.s.wave.n += 2;
    sim.s.meta.energy = (sim.s.meta.energy || 0) + 3;
    sim.s.meta.gems = (sim.s.meta.gems || 0) + 4;
    sim.s.meta.vials = (sim.s.meta.vials || 0) + 5;
    const r = summarize(sim, before, 10, 1.5);
    expect(r).toMatchObject({ gold: 1234, coins: 56, kills: 7, waves: 2, gems: 4, vials: 5, energy: 3, ranTicks: 10, died: false });
  });

  it('stops the replay the moment the hero dies', () => {
    // The scripted first run is deliberately lethal, so a long window ends with a dead hero and a
    // tick count short of the full request.
    const sim = new Sim(createState(1, freshMeta(), true));
    const r = catchUp(sim, 3600);
    expect(r.died).toBe(true);
    expect(r.ranTicks).toBeLessThan(plannedTicks(3600));
  });
});
