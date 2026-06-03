/* tests/unit/superpowers.test.ts — Superpowers: Energy economy + deterministic tick effects. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { migrateMeta } from '../../src/sim/labs';
import {
  SUPERPOWERS, nextUnlockCost, unlockedCount, buySuperpower, buySuperTrack, trackCost, trackValue,
  trackAtMax, toggleSuperpower, superEnabled, tickSuperpowers, moatSlowFactor, bossEnergy,
} from '../../src/sim/superpowers';
import type { Meta } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

describe('superpowers — Energy economy', () => {
  it('unlock cost follows purchase order (500 / 10k / 100k), not which power', () => {
    const m = freshMeta({ energy: 1_000_000 });
    expect(nextUnlockCost(m)).toBe(500);
    expect(buySuperpower(m, 'moat')).toBe(true); // moat first is fine
    expect(nextUnlockCost(m)).toBe(10_000);
    expect(buySuperpower(m, 'crystal')).toBe(true);
    expect(nextUnlockCost(m)).toBe(100_000);
    expect(buySuperpower(m, 'golden')).toBe(true);
    expect(unlockedCount(m)).toBe(3);
    expect(nextUnlockCost(m)).toBe(0);
  });

  it('refuses to unlock without enough Energy and deducts on success', () => {
    const m = freshMeta({ energy: 499 });
    expect(buySuperpower(m, 'golden')).toBe(false);
    m.energy = 500;
    expect(buySuperpower(m, 'golden')).toBe(true);
    expect(m.energy).toBe(0);
    expect(superEnabled(m, 'golden')).toBe(true); // enabled by default on unlock
  });

  it('track cost = 200 + 300·level and leveling needs the power unlocked', () => {
    const m = freshMeta({ energy: 1_000_000 });
    expect(buySuperTrack(m, 'golden', 'mult')).toBe(false); // locked
    buySuperpower(m, 'golden');
    expect(trackCost(m, 'golden', 'mult')).toBe(200);
    expect(buySuperTrack(m, 'golden', 'mult')).toBe(true);
    expect(trackCost(m, 'golden', 'mult')).toBe(500); // 200 + 300·1
  });

  it('track value follows the curve and stops at max level', () => {
    const m = freshMeta({ energy: 1e9 });
    buySuperpower(m, 'golden');
    expect(trackValue(m, 'golden', 'cooldown')).toBe(300); // level 0
    const cd = SUPERPOWERS.find((s) => s.id === 'golden')!.tracks.find((t) => t.id === 'cooldown')!;
    for (let i = 0; i < cd.max; i++) buySuperTrack(m, 'golden', 'cooldown');
    expect(trackAtMax(m, 'golden', 'cooldown')).toBe(true);
    expect(trackValue(m, 'golden', 'cooldown')).toBe(100); // 300 − 10·20
    expect(buySuperTrack(m, 'golden', 'cooldown')).toBe(false); // can't exceed max
  });

  it('toggle pauses/resumes an unlocked power', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'golden');
    expect(toggleSuperpower(m, 'golden')).toBe(true);
    expect(superEnabled(m, 'golden')).toBe(false);
    toggleSuperpower(m, 'golden');
    expect(superEnabled(m, 'golden')).toBe(true);
  });
});

describe('superpowers — deterministic tick', () => {
  it('Golden Lightning sets a gold/coin multiplier while its window is live', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'golden');
    const s = createState(1, m, false);
    tickSuperpowers(s, 1 / 30, makeRng(1));
    expect(s.run.goldenMult).toBe(trackValue(m, 'golden', 'mult')); // ×2 at level 0
  });

  it('an enabled but paused Golden Lightning never multiplies', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'golden');
    toggleSuperpower(m, 'golden'); // pause
    const s = createState(1, m, false);
    tickSuperpowers(s, 1 / 30, makeRng(1));
    expect(s.run.goldenMult).toBe(1);
  });

  it('Moat slows enemies in the watered band, not outside it', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'moat');
    const s = createState(1, m, false);
    s.hero.range = 120;
    tickSuperpowers(s, 1 / 30, makeRng(1)); // floods immediately (cooldown starts at 0)
    expect((s.run.superActive!.moat || 0)).toBeGreaterThan(0);
    const inBand = makeEnemy(1, 'melee', 1, makeRng(1), s.arena, s.hero.x, s.hero.y);
    inBand.x = s.hero.x + 18 * 4 + 2; // just inside the 18m inner edge (width 2m at L0)
    inBand.y = s.hero.y;
    const outside = makeEnemy(2, 'melee', 1, makeRng(2), s.arena, s.hero.x, s.hero.y);
    outside.x = s.hero.x + 400;
    outside.y = s.hero.y;
    expect(moatSlowFactor(s, inBand)).toBeLessThan(1);
    expect(moatSlowFactor(s, outside)).toBe(1);
  });

  it('Crystal Circle instakills a touched enemy and pays gems', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'crystal');
    const s = createState(1, m, false);
    s.hero.range = 120; // orbit radius = 60px
    const rng = makeRng(1);
    tickSuperpowers(s, 1 / 30, rng); // spawns the ring (4 crystals at level 0)
    expect(s.crystals && s.crystals.length).toBe(4);
    // place an enemy right on the orbit ring at the first crystal's angle (0 rad → +x)
    const e = makeEnemy(1, 'melee', 1, makeRng(9), s.arena, s.hero.x, s.hero.y);
    e.x = s.hero.x + 60;
    e.y = s.hero.y;
    s.enemies = [e];
    const gems0 = m.gems || 0;
    for (let i = 0; i < 60 && e.hp > 0; i++) tickSuperpowers(s, 1 / 30, rng);
    expect(e.hp).toBe(0);
    expect(e.lastHurt).toBe('crystal');
    expect((m.gems || 0)).toBeGreaterThan(gems0);
  });

  it('a boss killed in the watered moat yields more Energy than a bare boss', () => {
    const m = freshMeta({ energy: 1000 });
    buySuperpower(m, 'moat');
    for (let i = 0; i < 4; i++) buySuperTrack(m, 'moat', 'energy'); // ×6 boss energy
    const s = createState(1, m, false);
    s.hero.range = 120;
    tickSuperpowers(s, 1 / 30, makeRng(1));
    const boss = makeEnemy(1, 'boss', 10, makeRng(1), s.arena, s.hero.x, s.hero.y);
    boss.x = s.hero.x + 18 * 4 + 2;
    boss.y = s.hero.y;
    expect(bossEnergy(s, boss)).toBeGreaterThan(1);
  });
});
