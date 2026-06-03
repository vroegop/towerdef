/* tests/unit/sim.test.ts — unit tests for the deterministic simulation layer.
   These guard the two properties the whole game (and offline catch-up) relies on:
   (1) the PRNG and the full sim are reproducible from a seed, and
   (2) the pure economy/upgrade/lab helpers behave as designed. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState, ARENA_W, ARENA_H } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { migrateMeta, availableSpeeds, gameSpeed, setGameSpeed, SPEED_STEPS, LAB_BY_ID } from '../../src/sim/labs';
import { buyPerm, permCost, computeStats, waveStrSafe } from './helpers';
import { waveCount, econStr, waveHp, waveDmg, tierMult, MAX_TIER, tierUnlocked, coinMult, waveRoster, allowedSpecials, isBossWave } from '../../src/sim/waves';
import { buyCard, buyCardCost, MAX_STARS, CARD_ORDER, evalCurve, UP_BY_ID, PX_PER_METER, isUnlocked, unlockGroup, nextUnlockGroup, skillGroup, bigSuffix, bigGroup } from '../../src/sim/skills';
import { applyHit } from '../../src/sim/projectiles';
import type { Meta } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
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

describe('wave spawn composition', () => {
  const roster = (n: number, tier: number, count = 200): string[] => waveRoster(makeRng(n * 7 + tier), n, tier, count);
  const kinds = (r: string[]): Set<string> => new Set(r);
  it('waves 1–9 (tier 1) are normal-only — no specials, no boss', () => {
    for (let n = 1; n <= 9; n++) {
      expect([...kinds(roster(n, 1))]).toEqual(['melee']);
    }
  });
  it('wave 10 is a boss wave: exactly one boss leading normals, no specials', () => {
    const r = roster(10, 1);
    expect(r.filter((t) => t === 'boss').length).toBe(1);
    expect([...kinds(r)].sort()).toEqual(['boss', 'melee']);
  });
  it('non-boss waves 11–99 (tier 1) add tank, but not fast/ranged', () => {
    const k = kinds(roster(11, 1));
    expect(k.has('tank')).toBe(true);
    expect(k.has('fast')).toBe(false);
    expect(k.has('ranged')).toBe(false);
  });
  it('fast unlocks past wave 100, ranged past wave 150 (tier 1)', () => {
    expect(allowedSpecials(101, 1).sort()).toEqual(['fast', 'tank']);
    expect(allowedSpecials(151, 1).sort()).toEqual(['fast', 'ranged', 'tank']);
    expect(allowedSpecials(99, 1)).toEqual(['tank']);
  });
  it('tier 2 unlocks every special from wave 1 (boss still only on 10th waves)', () => {
    expect(allowedSpecials(1, 2).sort()).toEqual(['fast', 'ranged', 'tank']);
    expect(isBossWave(1)).toBe(false);
    expect(isBossWave(10)).toBe(true);
  });
  it('respects the caps: ≤120 normal + ≤20 special, and ≤1 boss', () => {
    const r = roster(151, 1, 500); // way over any real wave size, all specials unlocked
    expect(r.filter((t) => t === 'melee').length).toBeLessThanOrEqual(120);
    expect(r.filter((t) => t !== 'melee' && t !== 'boss').length).toBeLessThanOrEqual(20);
    expect(r.filter((t) => t === 'boss').length).toBe(0); // 151 isn't a boss wave
    const b = roster(150, 1, 500); // boss wave
    expect(b.filter((t) => t === 'boss').length).toBe(1);
    expect(b.filter((t) => t === 'melee').length).toBeLessThanOrEqual(120);
  });
});

describe('enemy collision (_separate)', () => {
  function sep(sim: Sim): void {
    (sim as unknown as { _separate(): void })._separate();
  }
  it('pushes an overlapping pair apart until they just touch', () => {
    const sim = new Sim(createState(1, freshMeta(), true));
    const rng = makeRng(1);
    const a = makeEnemy(1, 'melee', 1, rng, sim.s.arena, 0, 0);
    const b = makeEnemy(2, 'melee', 1, rng, sim.s.arena, 0, 0);
    a.x = 100; a.y = 100; // far from the hero so the hero-clamp doesn't interfere
    b.x = 101; b.y = 100; // overlapping (gap 1 << r+r = 4.4)
    sim.s.enemies = [a, b];
    sep(sim);
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    expect(gap).toBeGreaterThanOrEqual(a.r + b.r - 1e-6); // no longer overlapping
    expect(gap).toBeLessThan(a.r + b.r + 1e-6); // and not over-separated
  });
  it('a knocked-back enemy stays put and shoves the other (blocks the crowd)', () => {
    const sim = new Sim(createState(1, freshMeta(), true));
    const rng = makeRng(2);
    const locked = makeEnemy(1, 'melee', 1, rng, sim.s.arena, 0, 0);
    const pushed = makeEnemy(2, 'melee', 1, rng, sim.s.arena, 0, 0);
    locked.x = 200; locked.y = 200; locked.kb = 0.2; // mid-knockback → immovable
    pushed.x = 202; pushed.y = 200; pushed.kb = 0;
    sim.s.enemies = [locked, pushed];
    sep(sim);
    expect(locked.x).toBe(200); // did not budge
    expect(pushed.x).toBeGreaterThan(202); // got shoved fully
    expect(Math.hypot(pushed.x - locked.x, pushed.y - locked.y)).toBeGreaterThanOrEqual(locked.r + pushed.r - 1e-6);
  });
});

describe('wave curves', () => {
  it('econStr wave 1 is exactly the baseline (×1)', () => {
    expect(econStr(1)).toBeCloseTo(1, 10);
    expect(waveCount(1)).toBe(8);
  });
  it('enemy HP and damage rise monotonically with wave', () => {
    let prevHp = 0,
      prevDmg = 0;
    for (let n = 1; n <= 12000; n += 7) {
      const hp = waveHp(n),
        dmg = waveDmg(n);
      expect(hp).toBeGreaterThan(prevHp);
      expect(dmg).toBeGreaterThan(prevDmg);
      prevHp = hp;
      prevDmg = dmg;
    }
  });
  it('HP/damage curves hit their authored anchors', () => {
    expect(waveHp(100)).toBeCloseTo(4360, 0);
    expect(waveHp(10000)).toBeCloseTo(1.121e34, -30);
    expect(waveDmg(100)).toBeCloseTo(402.95, 0);
    expect(waveDmg(1000)).toBeCloseTo(482950, -1);
  });
  it('past wave 10000 stats climb at +0.05%/wave', () => {
    expect(waveHp(10100) / waveHp(10000)).toBeCloseTo(Math.pow(1.0005, 100), 6);
  });
  it('enemy count caps at maxCount', () => {
    expect(waveCount(10000)).toBe(140);
  });
});

describe('big-number notation (matches the reference site)', () => {
  it('maps each 1000-group to the right case-sensitive suffix', () => {
    const expected = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N', 'D'];
    expected.forEach((s, g) => expect(bigSuffix(g)).toBe(s));
    expect(bigSuffix(12)).toBe('aa'); // 1e36
    expect(bigSuffix(13)).toBe('ab'); // 1e39
    expect(bigSuffix(14)).toBe('ac'); // 1e42
    expect(bigSuffix(12 + 26)).toBe('ba'); // rolls the first letter after 'az'
  });
  it('buckets values without float mis-grouping at exact powers of 1000', () => {
    expect(bigGroup(1e6)).toEqual({ m: 1, group: 2 }); // exactly "1.00M", never "1000.00K"
    const big = bigGroup(1.121e34);
    expect(big.group).toBe(11); // 'D'
    expect(big.m).toBeCloseTo(11.21, 2);
  });
});

describe('tier multiplier', () => {
  it('tier 1 is ×1; low tiers match the reference ratios', () => {
    expect(tierMult(1)).toBe(1);
    expect(tierMult(2)).toBe(20);
    expect(tierMult(3)).toBe(60);
  });
  it('rises monotonically across all 21 tiers and clamps out of range', () => {
    for (let t = 2; t <= MAX_TIER; t++) expect(tierMult(t)).toBeGreaterThan(tierMult(t - 1));
    expect(tierMult(0)).toBe(tierMult(1));
    expect(tierMult(999)).toBe(tierMult(MAX_TIER));
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
  it('unlocks skills as GROUPS, sequentially by ascending cost WITHIN each category', () => {
    const meta = freshMeta({ coins: 1e9 });
    // range starts locked (its group is not yet unlocked), so it can't be bought.
    expect(isUnlocked(meta, 'range')).toBe(false);
    expect(buyPerm(meta, 'range')).toBe(false);
    // Each category advances independently. In the ATTACK tab, Range (50) is the next group (the
    // cost-0 starter groups are pre-unlocked); in ECONOMIC, Gold (40) is next. Range can be unlocked
    // without first buying the globally-cheaper Gold group in another tab.
    expect(nextUnlockGroup(meta, 'attack')!.id).toBe('range');
    expect(nextUnlockGroup(meta, 'economic')!.id).toBe('gold');
    // unlocking a group unlocks ALL its members at once for the single group price.
    expect(unlockGroup(meta, 'range')).toBe(true);
    expect(isUnlocked(meta, 'range')).toBe(true);
    expect(isUnlocked(meta, 'dmgPerMeter')).toBe(true);
    expect(buyPerm(meta, 'range')).toBe(true);
    // within the attack tab, a pricier group stays gated until the next-cheapest one is bought.
    expect(unlockGroup(meta, 'burst')).toBe(false); // Multishot (400) comes first in attack
    expect(nextUnlockGroup(meta, 'attack')!.id).toBe('multishot');
    // a DIFFERENT category is unaffected by attack's progress — Gold is still freely unlockable.
    expect(unlockGroup(meta, 'gold')).toBe(true);
    expect(isUnlocked(meta, 'cashBonus')).toBe(true);
    expect(isUnlocked(meta, 'goldPerWave')).toBe(true);
    // a multi-skill group (Amp) maps both stats to one group; cost 0 starter groups are pre-unlocked.
    expect(skillGroup('rendChance')!.id).toBe('amp');
    expect(skillGroup('rendMult')!.id).toBe('amp');
    expect(isUnlocked(freshMeta(), 'attackSpeed')).toBe(true);
    expect(isUnlocked(freshMeta(), 'critChance')).toBe(true);
  });
});

describe('labs scale stats', () => {
  it('a scale lab multiplies its target stat', () => {
    const base = computeStats(createState(1, freshMeta(), false));
    const labbed = computeStats(createState(1, freshMeta({ labs: { dmgLab: 10 } }), false));
    expect(labbed.rangedDamage).toBeCloseTo(base.rangedDamage * (1 + 0.02 * 10)); // Damage Lab: +0.02/level
    expect(waveStrSafe()).toBe(true);
  });
});

describe('game speed lab', () => {
  it('defaults to 1x and offers 0x (pause) / 0.5x / 1x out of the box', () => {
    const meta = freshMeta();
    expect(meta.gameSpeed).toBe(1);
    expect(gameSpeed(meta)).toBe(1);
    expect(availableSpeeds(meta)).toEqual([0, 0.5, 1]);
  });

  it('each completed level unlocks the next speed tier, up to 5x at level 7', () => {
    expect(availableSpeeds(freshMeta({ labs: { gameSpeed: 1 } }))).toEqual([0, 0.5, 1, 2]);
    expect(availableSpeeds(freshMeta({ labs: { gameSpeed: 3 } }))).toEqual([0, 0.5, 1, 2, 2.5, 3]);
    expect(availableSpeeds(freshMeta({ labs: { gameSpeed: 7 } }))).toEqual([0, ...SPEED_STEPS]);
  });

  it('setGameSpeed accepts only currently-unlocked speeds (0x pause is always available)', () => {
    const meta = freshMeta();
    expect(setGameSpeed(meta, 0.5)).toBe(0.5); // always available
    expect(setGameSpeed(meta, 0)).toBe(0); // 0x pause is always available
    expect(gameSpeed(meta)).toBe(0); // and a stored 0 survives (isn't coerced back to 1x)
    expect(setGameSpeed(meta, 3)).toBe(0); // locked → selection unchanged (still 0x)
    const fast = freshMeta({ labs: { gameSpeed: 3 } });
    expect(setGameSpeed(fast, 3)).toBe(3);
  });

  it('clamps a no-longer-unlocked selection down to the highest available speed', () => {
    expect(gameSpeed(freshMeta({ labs: { gameSpeed: 1 }, gameSpeed: 5 }))).toBe(2); // 5x picked, only ≤2x unlocked
    expect(gameSpeed(freshMeta({ gameSpeed: 5 }))).toBe(1); // nothing past 1x unlocked
  });

  it('is a "special" lab — it never scales a sim stat (stays out of computeStats)', () => {
    expect(LAB_BY_ID.gameSpeed.kind).toBe('special');
    expect(LAB_BY_ID.gameSpeed.max).toBe(7);
    const base = computeStats(createState(1, freshMeta(), false));
    const maxed = computeStats(createState(1, freshMeta({ labs: { gameSpeed: 7 } }), false));
    expect(maxed.rangedDamage).toBeCloseTo(base.rangedDamage);
    expect(maxed.maxHp).toBeCloseTo(base.maxHp);
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
    // precondition: range is large enough that the arena must scale (range×4 > ARENA_W)
    expect(range * 4).toBeGreaterThan(ARENA_W);
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
      const e = makeEnemy(i + 1, 'melee', 1, rng, arena, cx, cy);
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
      const e = makeEnemy(i + 1, 'melee', 1, rng, arena);
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
    }
    expect(minX).toBeLessThan(40); // left edge ≈ 0 (− margin)
    expect(maxX).toBeGreaterThan(ARENA_W - 40); // right edge ≈ w (+ margin)
  });
});

describe('curve-as-data (balance model)', () => {
  it('evalCurve: linear with and without cap, and geometric', () => {
    expect(evalCurve({ kind: 'linear', base: 1, per: 0.19 }, 100)).toBeCloseTo(20, 9);
    expect(evalCurve({ kind: 'linear', base: 0, per: 0.001, cap: 1.2 }, 5000)).toBe(1.2); // capped
    expect(evalCurve({ kind: 'linear', base: 0, per: 0.001, cap: 1.2 }, 100)).toBeCloseTo(0.1, 9);
    expect(evalCurve({ kind: 'geom', mul: 1, ratio: 2 }, 0)).toBe(0); // 0 stars → 0
    expect(evalCurve({ kind: 'geom', mul: 1, ratio: 2 }, 1)).toBe(1);
    expect(evalCurve({ kind: 'geom', mul: 1, ratio: 2 }, 5)).toBe(16); // 2^(5-1)
    expect(evalCurve({ kind: 'exp', base: 1, ratio: 1.05 }, 0)).toBe(1); // value(0)=base
    expect(evalCurve({ kind: 'exp', base: 1, ratio: 1.05 }, 100)).toBeCloseTo(Math.pow(1.05, 100), 6);
  });

  it('value() reads its curve live — editing a curve flows through with no rebuild', () => {
    const u = UP_BY_ID.attackSpeed;
    const c = u.curve as { kind: 'linear'; base: number; per: number };
    const origPer = c.per;
    expect(u.value(10)).toBeCloseTo(1 + 10 * origPer, 9);
    c.per = origPer * 2; // simulate a dashboard rebalance
    expect(u.value(10)).toBeCloseTo(1 + 10 * origPer * 2, 9); // reflected immediately
    c.per = origPer; // restore so later tests are unaffected
    expect(u.value(10)).toBeCloseTo(1 + 10 * origPer, 9);
  });
});

describe('knockback (force vs mass)', () => {
  const hitRng = (): { next: () => number; state: number } => ({ next: () => 0, state: 0 }); // 0 < chance → always procs

  it('pushes a light enemy back when force > mass (up to 5m × (1 − mass/force))', () => {
    const s = createState(1, freshMeta(), false);
    const e = makeEnemy(1, 'melee', 1, makeRng(1), s.arena, s.hero.x, s.hero.y);
    e.x = s.hero.x + 100;
    e.y = s.hero.y;
    e.mass = 1;
    s.enemies = [e];
    const st = computeStats(s);
    st.knockbackChance = 1;
    st.knockbackForce = 2; // force 2 > mass 1 → push 5m·(1−1/2)=2.5m
    const x0 = e.x;
    applyHit(s, e, 1, st, hitRng());
    expect(e.x - x0).toBeCloseTo(2.5 * PX_PER_METER, 3); // shoved away from the hero
    expect(e.slowT).toBe(0); // not slowed
  });

  it('slows a heavy enemy instead of pushing when mass ≥ force (speed × force/mass)', () => {
    const s = createState(1, freshMeta(), false);
    const e = makeEnemy(2, 'melee', 1, makeRng(1), s.arena, s.hero.x, s.hero.y);
    e.x = s.hero.x + 100;
    e.mass = 2;
    s.enemies = [e];
    const st = computeStats(s);
    st.knockbackChance = 1;
    st.knockbackForce = 1; // force 1 < mass 2 → slow ×0.5, no push
    const x0 = e.x;
    applyHit(s, e, 1, st, hitRng());
    expect(e.x).toBe(x0); // not pushed
    expect(e.slow).toBeCloseTo(0.5, 6); // force/mass
    expect(e.slowT).toBeGreaterThan(0);
  });
});
