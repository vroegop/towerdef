/* tests/unit/sim.test.ts — unit tests for the deterministic simulation layer.
   These guard the two properties the whole game (and offline catch-up) relies on:
   (1) the PRNG and the full sim are reproducible from a seed, and
   (2) the pure economy/upgrade/lab helpers behave as designed. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState, ARENA_W, ARENA_H } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { migrateMeta } from '../../src/sim/labs';
import { buyPerm, permCost, computeStats, waveStrSafe } from './helpers';
import { waveCount, waveStr, tierUnlocked, coinMult } from '../../src/sim/waves';
import { buyCard, buyCardCost, MAX_STARS, CARD_ORDER } from '../../src/sim/skills';
import type { Meta } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
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
  it('coin multiplier grows +0.8x per tier', () => {
    expect(coinMult(1)).toBeCloseTo(1);
    expect(coinMult(2)).toBeCloseTo(1.8);
    expect(coinMult(3)).toBeCloseTo(2.6);
  });
});

describe('permanent upgrades', () => {
  it('buying deducts coins and raises the level; refuses when too poor', () => {
    const meta = freshMeta({ coins: permCost(freshMeta(), 'attackSpeed') });
    expect(buyPerm(meta, 'attackSpeed')).toBe(true);
    expect(meta.perm.attackSpeed).toBe(1);
    expect(meta.coins).toBe(0);
    expect(buyPerm(meta, 'attackSpeed')).toBe(false); // no coins left
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

describe('card draws (buyCard)', () => {
  // Card draws use Math.random, so we make them deterministic by collapsing the non-maxed pool to a
  // SINGLE candidate (max out every other card). The drawn card is then forced, no matter the roll.
  it('unlocks an un-owned card when it is the only non-maxed option', () => {
    const cards = CARD_ORDER.slice(1).map((id) => ({ id, stars: MAX_STARS }));
    const meta = freshMeta({ cards, gems: 999 });
    const r = buyCard(meta);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(CARD_ORDER[0]);
    expect(r!.unlocked).toBe(true);
    expect(r!.before).toBe(0);
    expect(r!.after).toBe(1);
  });

  it('adds a star to a card you already own when it is the only non-maxed option', () => {
    const cards = CARD_ORDER.map((id) => ({ id, stars: MAX_STARS }));
    cards[0] = { id: CARD_ORDER[0], stars: 3 };
    const meta = freshMeta({ cards, gems: 999 });
    const r = buyCard(meta);
    expect(r!.id).toBe(CARD_ORDER[0]);
    expect(r!.unlocked).toBe(false);
    expect(r!.before).toBe(3);
    expect(r!.after).toBe(4);
  });

  it('never draws a maxed card: returns null when every card is already maxed', () => {
    const cards = CARD_ORDER.map((id) => ({ id, stars: MAX_STARS }));
    const meta = freshMeta({ cards, gems: 999 });
    expect(buyCard(meta)).toBeNull();
  });

  it('refuses to buy when gems are insufficient', () => {
    expect(buyCard(freshMeta({ cards: [], gems: 0 }))).toBeNull();
  });

  it('deducts the cost and counts the buy', () => {
    const cards = CARD_ORDER.slice(1).map((id) => ({ id, stars: MAX_STARS }));
    const meta = freshMeta({ cards, gems: 999, cardBuys: 0 });
    const cost = buyCardCost(meta);
    buyCard(meta);
    expect(meta.gems).toBe(999 - cost);
    expect(meta.cardBuys).toBe(1);
  });
});

describe('arena scales with range', () => {
  it('keeps the base arena size while the range still fits inside it', () => {
    const sim = new Sim(createState(1, freshMeta(), false));
    sim.step(1 / 30);
    expect(sim.s.arena.w).toBe(ARENA_W);
    expect(sim.s.arena.h).toBe(ARENA_H);
  });

  it('grows the arena to stay larger than the range ring once range is high', () => {
    const s = createState(1, freshMeta(), false);
    s.run.levels.range = 5000; // many Range levels → range far exceeds the base arena
    const sim = new Sim(s);
    sim.step(1 / 30);
    const range = sim.s.hero.range;
    expect(range).toBeGreaterThan(ARENA_H); // precondition: range now dwarfs the base arena's short side
    // the box must strictly contain the range ring (diameter 2*range) so enemies still spawn outside it
    expect(sim.s.arena.w).toBeGreaterThan(2 * range);
    expect(sim.s.arena.h).toBeGreaterThan(2 * range);
    expect(sim.s.arena.w).toBeGreaterThan(ARENA_W);
    expect(sim.s.arena.h).toBeGreaterThan(ARENA_H);
  });
});

describe('makeEnemy spawn box', () => {
  it('centers the spawn box on the given point, not the arena origin', () => {
    const rng = makeRng(1);
    const arena = { w: 4000, h: 3000 };
    const cx = 480,
      cy = 320; // a stationary hero, far from the big box's [0,0] corner
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < 800; i++) {
      const e = makeEnemy(i + 1, 'melee', 'average', 1, rng, arena, cx, cy);
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    }
    expect((minX + maxX) / 2).toBeCloseTo(cx, 0); // box centered on the hero, not on w/2
    expect((minY + maxY) / 2).toBeCloseTo(cy, 0);
    expect(maxX - minX).toBeGreaterThan(arena.w * 0.9); // really spans the whole box
    expect(maxY - minY).toBeGreaterThan(arena.h * 0.9);
  });

  it('defaults to the legacy origin-anchored box (hero at w/2, h/2)', () => {
    const rng = makeRng(2);
    const arena = { w: ARENA_W, h: ARENA_H };
    let minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < 800; i++) {
      const e = makeEnemy(i + 1, 'melee', 'average', 1, rng, arena);
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
    }
    expect(minX).toBeLessThan(40); // left edge ≈ 0 (− margin)
    expect(maxX).toBeGreaterThan(ARENA_W - 40); // right edge ≈ w (+ margin)
  });
});
