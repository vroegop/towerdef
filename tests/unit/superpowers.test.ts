/* tests/unit/superpowers.test.ts — Superpowers: Energy economy + deterministic tick effects. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { migrateMeta } from '../../src/sim/labs';
import {
  SUPERPOWERS, nextUnlockCost, unlockedCount, buySuperpower, buySuperTrack, trackCost, trackValue,
  trackAtMax, toggleSuperpower, superEnabled, tickSuperpowers, moatSlowFactor, bossEnergy,
  superKillMult, superKillBonus, aegisAbsorb, chronoActive, chronoOnHit,
} from '../../src/sim/superpowers';
import { computeStats } from '../../src/sim/skills';
import type { Enemy, Meta } from '../../src/types';

const DT = 1 / 30;
// place a fresh enemy at an absolute world position with a big HP pool (so it survives to be measured).
function enemyAt(id: number, s: ReturnType<typeof createState>, x: number, y: number, hp = 1e12): Enemy {
  const e = makeEnemy(id, 'melee', 1, makeRng(id + 7), s.arena, s.hero.x, s.hero.y);
  e.x = x;
  e.y = y;
  e.hpMax = hp;
  e.hp = hp;
  return e;
}
// unlock a power for free regardless of purchase-order cost.
function grant(m: Meta, id: string): void {
  m.superUnlocked = m.superUnlocked || {};
  m.superEnabled = m.superEnabled || {};
  m.superUnlocked[id] = true;
  m.superEnabled[id] = true;
}

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

describe('superpowers — Energy economy', () => {
  it('unlock cost follows purchase order (500 / 2k / 5k, then +5k), not which power', () => {
    const m = freshMeta({ energy: 1_000_000 });
    expect(nextUnlockCost(m)).toBe(500);
    expect(buySuperpower(m, 'moat')).toBe(true); // moat first is fine
    expect(nextUnlockCost(m)).toBe(2_000);
    expect(buySuperpower(m, 'crystal')).toBe(true);
    expect(nextUnlockCost(m)).toBe(5_000);
    expect(buySuperpower(m, 'golden')).toBe(true);
    expect(unlockedCount(m)).toBe(3);
    expect(nextUnlockCost(m)).toBe(10_000); // 4th rung: +5k for each unlock after the 5k third
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

describe('superpowers — the new weapons', () => {
  it('Chain Tesla strikes the nearest enemies and records an arc', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'tesla');
    for (let i = 0; i < 5; i++) buySuperTrack(m, 'tesla', 'chains'); // raise jumps so it chains
    const s = createState(1, m, false);
    s.hero.range = 240;
    const st = computeStats(s);
    const e1 = enemyAt(1, s, s.hero.x + 40, s.hero.y);
    const e2 = enemyAt(2, s, s.hero.x + 70, s.hero.y);
    s.enemies = [e1, e2];
    tickSuperpowers(s, DT, makeRng(1), st);
    expect(e1.hp).toBeLessThan(1e12); // first hop hit
    expect(e2.hp).toBeLessThan(1e12); // chained to the second
    expect((s.teslaArcs || []).length).toBeGreaterThan(0);
    expect(e1.lastHurt).toBe('dmg');
  });

  it('Inferno Ring burns every enemy inside the radius over time', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'inferno'); // radius 8m = 32px at L0
    const s = createState(2, m, false);
    const st = computeStats(s);
    const inside = enemyAt(1, s, s.hero.x + 20, s.hero.y);
    const outside = enemyAt(2, s, s.hero.x + 9999, s.hero.y);
    s.enemies = [inside, outside];
    tickSuperpowers(s, DT, makeRng(1), st);
    expect(inside.hp).toBeLessThan(1e12);
    expect(outside.hp).toBe(1e12); // out of range: untouched
  });

  it('Frost Nova freezes enemies, then shatters them when the freeze ends', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'frost'); // freeze 2s, radius 10m = 40px at L0
    const s = createState(3, m, false);
    const st = computeStats(s);
    const e = enemyAt(1, s, s.hero.x + 20, s.hero.y);
    s.enemies = [e];
    tickSuperpowers(s, DT, makeRng(1), st); // cast: freeze
    expect((e.stunT || 0)).toBeGreaterThan(0);
    const frozenHp = e.hp;
    for (let i = 0; i < 90 && e.hp >= frozenHp; i++) tickSuperpowers(s, DT, makeRng(1), st); // run past the 2s freeze
    expect(e.hp).toBeLessThan(frozenHp); // shattered on thaw
  });

  it('Singularity spawns a black hole that pulls + crushes for void rewards', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'singularity');
    buySuperTrack(m, 'singularity', 'radius'); // widen the pull a touch
    const s = createState(4, m, false);
    s.hero.range = 240;
    const st = computeStats(s);
    tickSuperpowers(s, DT, makeRng(1), st); // spawn the void
    expect(s.blackHole).toBeTruthy();
    const bh = s.blackHole!;
    const e = enemyAt(1, s, bh.x + 8, bh.y); // sit just inside the pull radius
    s.enemies = [e];
    const before = Math.hypot(e.x - bh.x, e.y - bh.y);
    tickSuperpowers(s, DT, makeRng(1), st);
    expect(Math.hypot(e.x - bh.x, e.y - bh.y)).toBeLessThan(before); // dragged inward
    expect(e.lastHurt).toBe('void');
    expect(superKillMult(s, e)).toBe(2); // void kills pay double
    const energy0 = m.energy || 0;
    e.hp = 0;
    superKillBonus(s, e);
    expect((m.energy || 0)).toBeGreaterThan(energy0); // void kill paid Energy
  });

  it('Chrono Field strips an enemy of HP/damage on tower hits and heals-flag is gated', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'chrono');
    for (let i = 0; i < 19; i++) buySuperTrack(m, 'chrono', 'chance'); // 40% strip chance
    const s = createState(5, m, false);
    expect(chronoActive(s)).toBe(false); // window not open yet
    s.run.superActive = { chrono: 5 };
    expect(chronoActive(s)).toBe(true);
    const e = makeEnemy(1, 'melee', 50, makeRng(9), s.arena, s.hero.x, s.hero.y);
    e.hpStep = 100;
    e.dmgStep = 10;
    e.hpMax = 100000;
    e.hp = 100000;
    e.dmg = 5000;
    const rng = makeRng(7);
    for (let i = 0; i < 60; i++) chronoOnHit(s, e, rng); // ~40% of these strip a level
    expect(e.hpMax).toBeLessThan(100000);
    expect(e.dmg).toBeLessThan(5000);
  });

  it('Aegis Bulwark pools a shield, burns attackers, and shockwaves on its first break', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'aegis');
    const s = createState(6, m, false);
    s.hero.hpMax = 1000;
    const st = computeStats(s);
    tickSuperpowers(s, DT, makeRng(1), st); // one activation pools shield% × maxHP
    expect((s.run.aegisPool || 0)).toBeGreaterThan(0);
    const atk = enemyAt(1, s, s.hero.x + 10, s.hero.y, 1000);
    const victim = enemyAt(2, s, s.hero.x + 30, s.hero.y, 1000);
    s.enemies = [atk, victim];
    const pool = s.run.aegisPool!;
    const left = aegisAbsorb(s, pool + 5, atk); // overrun the pool → first break
    expect(left).toBeCloseTo(5, 3); // damage past the shield leaks through
    expect(atk.hp).toBeLessThan(1000); // attacker was burned
    expect(s.run.aegisBroke).toBe(true);
    expect(victim.hp).toBe(0); // shockwave cleared the field
    expect(victim.lastHurt).toBe('aegis');
    expect(superKillMult(s, victim)).toBe(10);
  });

  it('Sentry Battery deploys four turrets that fire on enemies', () => {
    const m = freshMeta({ energy: 0 });
    grant(m, 'sentry');
    for (let i = 0; i < 30; i++) buySuperTrack(m, 'sentry', 'damage'); // 100% tower damage
    const s = createState(7, m, false);
    s.hero.range = 240;
    const st = computeStats(s);
    tickSuperpowers(s, DT, makeRng(1), st); // deploy
    expect((s.sentries || []).length).toBe(4);
    const e = enemyAt(1, s, s.hero.x + 20, s.hero.y);
    s.enemies = [e];
    for (let i = 0; i < 5; i++) tickSuperpowers(s, DT, makeRng(1), st);
    expect(e.hp).toBeLessThan(1e12); // a turret hit (or its disintegrate sphere) bit the enemy
    expect(['sentry', 'dmg']).toContain(e.lastHurt);
  });

  it('locked powers never perturb the PRNG stream', () => {
    // with no powers unlocked, tickSuperpowers must draw no RNG (offline determinism for everyone else).
    const m = freshMeta({ energy: 0 });
    const s = createState(8, m, false);
    const st = computeStats(s);
    const rng = makeRng(123);
    const before = rng.state;
    for (let i = 0; i < 50; i++) tickSuperpowers(s, DT, rng, st);
    expect(rng.state).toBe(before);
  });
});
