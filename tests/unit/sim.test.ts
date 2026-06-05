/* tests/unit/sim.test.ts — unit tests for the deterministic simulation layer.
   These guard the two properties the whole game (and offline catch-up) relies on:
   (1) the PRNG and the full sim are reproducible from a seed, and
   (2) the pure economy/upgrade/lab helpers behave as designed. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState, ARENA_W, ARENA_H } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { migrateMeta, availableSpeeds, gameSpeed, setGameSpeed, SPEED_STEPS, LAB_BY_ID, LABS, labInterestCap, labUnlocked, labsTabUnlocked } from '../../src/sim/labs';
import { buyPerm, permCost, computeStats, waveStrSafe } from './helpers';
import { concurrentCap, spawnRate, lullDuration, econStr, waveHp, waveDmg, tierMult, MAX_TIER, tierUnlocked, coinMult, rollEnemyType, allowedSpecials, isBossWave } from '../../src/sim/waves';
import { buyCard, buyCardCost, MAX_STARS, CARD_ORDER, evalCurve, UP_BY_ID, PX_PER_METER, isUnlocked, unlockGroup, nextUnlockGroup, skillGroup, bigSuffix, bigGroup, MILESTONES, milestoneReward, tierClaimableCount, LAB_UNLOCK_WAVE } from '../../src/sim/skills';
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

describe('wave spawn composition (per-spawn roll)', () => {
  // Roll a large deterministic sample of NON-boss spawns at (n, tier) and tally the types.
  const sample = (n: number, tier: number, count = 20000): Record<string, number> => {
    const rng = makeRng(n * 7 + tier);
    const out: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const t = rollEnemyType(rng, n, tier, false);
      out[t] = (out[t] || 0) + 1;
    }
    return out;
  };
  it('waves 1–9 (tier 1) are normal-only — no specials unlocked yet', () => {
    for (let n = 1; n <= 9; n++) {
      expect(Object.keys(sample(n, 1, 500)).sort()).toEqual(['melee']);
    }
  });
  it('a pending boss always rolls a boss, consuming no rng draws', () => {
    const rng = makeRng(123);
    const before = rng.next();
    const rng2 = makeRng(123);
    expect(rollEnemyType(rng2, 10, 1, true)).toBe('boss');
    expect(rng2.next()).toBe(before); // boss took zero draws — stream untouched
  });
  it('non-boss waves 11–99 (tier 1) mix in tank, but not fast/ranged', () => {
    const s = sample(11, 1);
    expect(s.tank).toBeGreaterThan(0);
    expect(s.fast || 0).toBe(0);
    expect(s.ranged || 0).toBe(0);
  });
  it('holds the ~6:1 normal:special ratio when specials are unlocked', () => {
    const s = sample(151, 1); // all specials unlocked
    const specials = (s.tank || 0) + (s.fast || 0) + (s.ranged || 0);
    const specialFrac = specials / (specials + (s.melee || 0));
    expect(specialFrac).toBeCloseTo(1 / 7, 1); // ≈ 0.143
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
});

describe('spawn throttles', () => {
  it('concurrent cap ramps 8 → 140 (reaching the cap at wave 28)', () => {
    expect(concurrentCap(1)).toBe(8);
    expect(concurrentCap(27)).toBe(138);
    expect(concurrentCap(28)).toBe(140);
    expect(concurrentCap(10000)).toBe(140);
  });
  it('spawn-rate ladder steps at the documented wave boundaries', () => {
    expect([spawnRate(100), spawnRate(101)]).toEqual([5, 6]);
    expect([spawnRate(500), spawnRate(501)]).toEqual([6, 7]);
    expect([spawnRate(1000), spawnRate(1001)]).toEqual([7, 9]);
    expect([spawnRate(2000), spawnRate(2001)]).toEqual([9, 12]);
    expect([spawnRate(5000), spawnRate(5001)]).toEqual([12, 20]);
    expect([spawnRate(10000), spawnRate(10001)]).toEqual([20, 25]);
  });
  it('lull shrinks 0.3s per reduction-second and floors at 0.5s', () => {
    expect(lullDuration(0)).toBe(5);
    expect(lullDuration(0.3)).toBeCloseTo(4.7, 10);
    expect(lullDuration(4.5)).toBeCloseTo(0.5, 10);
    expect(lullDuration(10)).toBe(0.5); // can't go below the floor
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
    expect(concurrentCap(1)).toBe(8);
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
  it('alive cap maxes at maxCount', () => {
    expect(concurrentCap(10000)).toBe(140);
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

describe('interest cap', () => {
  it('labInterestCap is a geometric ladder from 25/wave (L0) to 20,000/wave (L20)', () => {
    expect(labInterestCap(freshMeta())).toBe(25); // no lab → base ceiling
    expect(labInterestCap(freshMeta({ labs: { interestCapLab: 20 } }))).toBe(20000);
    // accelerating increments: each level's jump exceeds the previous
    const at = (n: number) => labInterestCap(freshMeta({ labs: { interestCapLab: n } }));
    expect(at(10) - at(9)).toBeGreaterThan(at(2) - at(1));
  });
  it('computeStats exposes interestCap, raised by the lab', () => {
    expect(computeStats(createState(1, freshMeta(), false)).interestCap).toBe(25);
    expect(computeStats(createState(1, freshMeta({ labs: { interestCapLab: 20 } }), false)).interestCap).toBe(20000);
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
    expect(unlockGroup(meta, 'multishot')).toBe(false); // Burst (400) comes first in attack
    expect(nextUnlockGroup(meta, 'attack')!.id).toBe('burst');
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
    expect(labbed.rangedDamage).toBeCloseTo(base.rangedDamage * (1 + LAB_BY_ID.dmgLab.per * 10)); // Damage Lab: per/level
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

  it('is available from wave 0 (gate 0) — the only lab open before wave 30', () => {
    expect(LAB_BY_ID.gameSpeed.gate.wave).toBe(0);
  });
});

describe('lab gating', () => {
  it('the Labs tab/rail is always open (the Game Speed lab is researchable from the start)', () => {
    expect(labsTabUnlocked(freshMeta())).toBe(true);
    expect(labsTabUnlocked(freshMeta({ bestWave: 0 }))).toBe(true);
  });

  it('Game Speed unlocks at wave 0; every other lab stays locked until wave 30', () => {
    const fresh = freshMeta({ bestWave: 0 });
    expect(labUnlocked(fresh, 'gameSpeed')).toBe(true);
    expect(labUnlocked(fresh, 'dmgLab')).toBe(false);
    expect(labUnlocked(fresh, 'hpLab')).toBe(false);
    const w29 = freshMeta({ bestWave: 29 });
    expect(labUnlocked(w29, 'dmgLab')).toBe(false);
    const w30 = freshMeta({ bestWave: 30 });
    expect(labUnlocked(w30, 'dmgLab')).toBe(true);
    expect(labUnlocked(w30, 'hpLab')).toBe(true);
  });

  it('every non-speed lab gates at wave 30 (the tier-1 milestone unlock)', () => {
    for (const L of LABS) {
      expect(L.gate.wave).toBe(L.id === 'gameSpeed' ? 0 : 30);
    }
  });
});

describe('milestones', () => {
  it('includes a wave-30 lab-unlock rung that pays no currency and is not claimable', () => {
    expect(MILESTONES).toContain(LAB_UNLOCK_WAVE);
    const r = milestoneReward(LAB_UNLOCK_WAVE, 1);
    expect(r.lab).toBe(true);
    expect(r.coins).toBe(0);
    expect(r.gems).toBe(0);
    expect(r.vials).toBe(0);
    // reaching wave 30 must NOT add a claimable reward (it's a progress unlock, like the tower):
    // the claimable count is identical at best 29 (wave-10 coins only) and best 30 (+ the lab rung).
    expect(tierClaimableCount(freshMeta({ tierBest: { 1: 29 } }), 1)).toBe(1);
    expect(tierClaimableCount(freshMeta({ tierBest: { 1: 30 } }), 1)).toBe(1);
  });

  it('keeps the existing tier-1 currency rewards unchanged after inserting wave 30', () => {
    expect(milestoneReward(10, 1)).toMatchObject({ coins: 200, gems: 0, vials: 0 });
    expect(milestoneReward(50, 1)).toMatchObject({ coins: 0, gems: 10, vials: 0 });
    expect(milestoneReward(100, 1)).toMatchObject({ coins: 2000, gems: 0, vials: 0 });
    expect(milestoneReward(250, 1)).toMatchObject({ coins: 0, gems: 20, vials: 0 });
    expect(milestoneReward(500, 1)).toMatchObject({ coins: 10000, gems: 0, vials: 0 });
    expect(milestoneReward(2000, 1)).toMatchObject({ coins: 40000, gems: 0, vials: 0 });
    expect(milestoneReward(3000, 1)).toMatchObject({ coins: 0, gems: 40, vials: 0 });
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

describe('makeEnemy spawn ring', () => {
  it('spawns on a circle of radius spawnR centered on the given point (the hero)', () => {
    const rng = makeRng(1);
    const arena = { w: 4000, h: 3000 };
    const cx = 480,
      cy = 320; // a stationary hero, far from the box's [0,0] corner
    const spawnR = 700;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < 800; i++) {
      const e = makeEnemy(i + 1, 'melee', 1, rng, arena, cx, cy, 1, spawnR);
      // every body sits exactly spawnR from the hero — a ring, not a box
      expect(Math.hypot(e.x - cx, e.y - cy)).toBeCloseTo(spawnR, 6);
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    }
    expect((minX + maxX) / 2).toBeCloseTo(cx, 0); // ring centered on the hero
    expect((minY + maxY) / 2).toBeCloseTo(cy, 0);
    expect(maxX - minX).toBeCloseTo(2 * spawnR, -1); // spans the full diameter (angles cover the circle)
    expect(maxY - minY).toBeCloseTo(2 * spawnR, -1);
  });

  it('defaults spawnR to 0.35× arena.w when not given', () => {
    const rng = makeRng(2);
    const arena = { w: ARENA_W, h: ARENA_H };
    const cx = arena.w / 2,
      cy = arena.h / 2;
    for (let i = 0; i < 200; i++) {
      const e = makeEnemy(i + 1, 'melee', 1, rng, arena);
      expect(Math.hypot(e.x - cx, e.y - cy)).toBeCloseTo(arena.w * 0.35, 6);
    }
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
