/* tests/unit/sim.test.ts — unit tests for the deterministic simulation layer.
   These guard the two properties the whole game (and offline catch-up) relies on:
   (1) the PRNG and the full sim are reproducible from a seed, and
   (2) the pure economy/upgrade/lab helpers behave as designed. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState } from '../../src/sim/state';
import { migrateMeta } from '../../src/sim/labs';
import { buyPerm, permCost, computeStats, waveStrSafe } from './helpers';
import { waveCount, waveStr, tierUnlocked, coreMult } from '../../src/sim/waves';
import type { Meta } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    cores: 0, perm: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1, coreMult: 1,
    tierBest: {}, tokens: 0, cards: [], cardBuys: 0, starBuys: 0, totalWaves: 0, waveTokensGranted: 0,
    labs: {}, research: [], labSlots: 1, cells: 0, lastCheckIn: 0, ultimates: {}, ver: 0, ...over,
  });
}

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(12345),
      b = makeRng(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
  it('produces values in [0,1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('restores from a saved state', () => {
    const r = makeRng(99);
    for (let i = 0; i < 5; i++) r.next();
    const saved = r.state;
    const expected = [r.next(), r.next(), r.next()];
    const r2 = makeRng(0);
    r2.state = saved;
    expect([r2.next(), r2.next(), r2.next()]).toEqual(expected);
  });
});

describe('sim determinism', () => {
  it('two runs with the same seed produce identical state', () => {
    const meta = freshMeta();
    const a = new Sim(createState(424242, freshMeta(), false));
    const b = new Sim(createState(424242, meta, false));
    for (let i = 0; i < 2000; i++) {
      a.step(1 / 30);
      b.step(1 / 30);
    }
    expect(a.s.tick).toBe(b.s.tick);
    expect(a.s.econ.kills).toBe(b.s.econ.kills);
    expect(a.s.wave.n).toBe(b.s.wave.n);
    expect(a.s.enemies.length).toBe(b.s.enemies.length);
    expect(a.rng.state).toBe(b.rng.state);
  });
  it('the scripted first run kills a 1/1/1 hero (deterministic intro)', () => {
    const sim = new Sim(createState(1, freshMeta(), true));
    let steps = 0;
    while (sim.s.alive && steps < 60 * 30) {
      sim.step(1 / 30);
      steps++;
    }
    expect(sim.s.alive).toBe(false);
  });
  it('serialize round-trips: a resumed run continues identically to the original', () => {
    // Run a reference sim 200 steps, snapshot at step 100, then resume from that snapshot and
    // confirm the resumed run reaches the EXACT state the reference did at step 200.
    const ref = new Sim(createState(555, freshMeta(), false));
    for (let i = 0; i < 100; i++) ref.step(1 / 30);
    const snap = JSON.parse(JSON.stringify(ref.serialize())); // independent copy of the mid-run save
    for (let i = 0; i < 100; i++) ref.step(1 / 30); // reference plays on to step 200
    const resumed = new Sim(snap); // resume from the step-100 save
    for (let i = 0; i < 100; i++) resumed.step(1 / 30);
    expect(resumed.rng.state).toBe(ref.rng.state);
    expect(resumed.s.econ.kills).toBe(ref.s.econ.kills);
    expect(resumed.s.wave.n).toBe(ref.s.wave.n);
    expect(resumed.s.enemies.length).toBe(ref.s.enemies.length);
  });
});

describe('wave curves', () => {
  it('wave 1 is exactly the baseline (×1 strength)', () => {
    expect(waveStr(1)).toBeCloseTo(1, 10);
    expect(waveCount(1)).toBe(8);
  });
  it('strength rises monotonically with wave', () => {
    let prev = 0;
    for (let n = 1; n <= 100; n++) {
      const s = waveStr(n);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });
  it('enemy count caps at maxCount', () => {
    expect(waveCount(10000)).toBe(140);
  });
});

describe('tiers', () => {
  it('tier 1 is always unlocked, higher tiers gated on prior progress', () => {
    expect(tierUnlocked(freshMeta(), 1)).toBe(true);
    expect(tierUnlocked(freshMeta(), 2)).toBe(false);
    expect(tierUnlocked(freshMeta({ tierBest: { 1: 300 } }), 2)).toBe(true);
  });
  it('core multiplier grows +0.8x per tier', () => {
    expect(coreMult(1)).toBeCloseTo(1);
    expect(coreMult(2)).toBeCloseTo(1.8);
    expect(coreMult(3)).toBeCloseTo(2.6);
  });
});

describe('permanent upgrades', () => {
  it('buying deducts cores and raises the level; refuses when too poor', () => {
    const meta = freshMeta({ cores: permCost(freshMeta(), 'attackSpeed') });
    expect(buyPerm(meta, 'attackSpeed')).toBe(true);
    expect(meta.perm.attackSpeed).toBe(1);
    expect(meta.cores).toBe(0);
    expect(buyPerm(meta, 'attackSpeed')).toBe(false); // no cores left
  });
  it('permanent levels raise computed stats', () => {
    const base = computeStats(createState(1, freshMeta(), false));
    const buffed = computeStats(createState(1, freshMeta({ perm: { rangedDamage: 10 } }), false));
    expect(buffed.rangedDamage).toBeGreaterThan(base.rangedDamage);
  });
});

describe('labs scale stats', () => {
  it('a scale lab multiplies its target stat', () => {
    const base = computeStats(createState(1, freshMeta(), false));
    const labbed = computeStats(createState(1, freshMeta({ labs: { dmgScale: 10 } }), false));
    expect(labbed.rangedDamage).toBeCloseTo(base.rangedDamage * (1 + 0.04 * 10));
    expect(waveStrSafe()).toBe(true);
  });
});
