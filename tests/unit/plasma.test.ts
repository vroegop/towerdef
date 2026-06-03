/* tests/unit/plasma.test.ts — Plasma Cannon card behavior.
   Plasma fires ONCE per boss when it appears, homes onto that boss (passing over other
   enemies), and on impact subtracts a snapshot of bossHpMax × plasmaCanon. Pure % max-HP:
   no rend, lifesteal, or knockback. Fizzles if the target dies before impact. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { tickActiveCards } from '../../src/sim/cards-active';
import { tickProjectiles } from '../../src/sim/projectiles';
import { computeStats } from './helpers';
import { migrateMeta } from '../../src/sim/labs';
import type { Meta, State, Stats } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

// State with the Plasma Cannon "active" at the given max-HP fraction, no other active cards.
function plasmaState(frac: number): { s: State; st: Stats; rng: ReturnType<typeof makeRng> } {
  const s = createState(1, freshMeta(), false);
  const st = computeStats(s);
  st.plasmaCanon = frac;
  return { s, st, rng: makeRng(1) };
}

function addBoss(s: State, id: number, dxFromHero = 60): ReturnType<typeof makeEnemy> {
  const b = makeEnemy(id, 'boss', 10, makeRng(id), s.arena, s.hero.x, s.hero.y);
  b.x = s.hero.x + dxFromHero;
  b.y = s.hero.y;
  s.enemies.push(b);
  return b;
}

describe('plasma cannon — firing', () => {
  it('fires exactly one plasma at a boss when it appears, recording the boss id', () => {
    const { s, st, rng } = plasmaState(0.3);
    const boss = addBoss(s, 1);
    tickActiveCards(s, 1 / 30, st, rng);
    const plasmas = s.projectiles.filter((p) => p.kind === 'plasma');
    expect(plasmas.length).toBe(1);
    expect(plasmas[0].targetId).toBe(boss.id);
    expect(s.run.plasmaDone).toContain(boss.id);
  });

  it('never fires a second plasma at the same boss', () => {
    const { s, st, rng } = plasmaState(0.3);
    addBoss(s, 1);
    tickActiveCards(s, 1 / 30, st, rng);
    s.projectiles = []; // clear the first shot; the boss is now in plasmaDone
    tickActiveCards(s, 1 / 30, st, rng);
    expect(s.projectiles.filter((p) => p.kind === 'plasma').length).toBe(0);
  });

  it('snapshots damage = boss.hpMax × plasmaCanon at fire time', () => {
    const { s, st, rng } = plasmaState(0.5);
    const boss = addBoss(s, 1);
    tickActiveCards(s, 1 / 30, st, rng);
    const plasma = s.projectiles.find((p) => p.kind === 'plasma')!;
    expect(plasma.dmg).toBeCloseTo(boss.hpMax * 0.5, 6);
  });

  it('fires one plasma at each of several simultaneous bosses', () => {
    const { s, st, rng } = plasmaState(0.3);
    const a = addBoss(s, 1, 60);
    const b = addBoss(s, 2, -60);
    tickActiveCards(s, 1 / 30, st, rng);
    const targets = s.projectiles.filter((p) => p.kind === 'plasma').map((p) => p.targetId).sort();
    expect(targets).toEqual([a.id, b.id].sort());
  });

  it('does not fire at non-boss enemies', () => {
    const { s, st, rng } = plasmaState(0.3);
    const tank = makeEnemy(1, 'tank', 10, makeRng(1), s.arena, s.hero.x, s.hero.y);
    s.enemies.push(tank);
    tickActiveCards(s, 1 / 30, st, rng);
    expect(s.projectiles.filter((p) => p.kind === 'plasma').length).toBe(0);
  });

  it('does nothing when the card is not owned (plasmaCanon = 0)', () => {
    const { s, st, rng } = plasmaState(0);
    addBoss(s, 1);
    tickActiveCards(s, 1 / 30, st, rng);
    expect(s.projectiles.filter((p) => p.kind === 'plasma').length).toBe(0);
  });
});

describe('plasma cannon — flight & impact', () => {
  function flyToImpact(s: State, st: Stats, rng: ReturnType<typeof makeRng>, maxSteps = 600): void {
    for (let i = 0; i < maxSteps && s.projectiles.some((p) => p.kind === 'plasma'); i++) {
      tickProjectiles(s, 1 / 30, st, rng);
    }
  }

  it('homes onto the boss and subtracts exactly the snapshot damage on impact', () => {
    const { s, st, rng } = plasmaState(0.5);
    const boss = addBoss(s, 1, 80);
    tickActiveCards(s, 1 / 30, st, rng);
    const hp0 = boss.hp;
    const dealt = s.projectiles.find((p) => p.kind === 'plasma')!.dmg;
    flyToImpact(s, st, rng);
    expect(s.projectiles.filter((p) => p.kind === 'plasma').length).toBe(0); // consumed on impact
    expect(boss.hp).toBeCloseTo(hp0 - dealt, 6);
  });

  it('passes over other enemies — only its target boss takes damage', () => {
    const { s, st, rng } = plasmaState(0.5);
    const boss = addBoss(s, 1, 120);
    const blocker = makeEnemy(2, 'melee', 10, makeRng(2), s.arena, s.hero.x + 40, s.hero.y);
    blocker.x = s.hero.x + 40; // sits directly between hero and boss
    blocker.y = s.hero.y;
    s.enemies.push(blocker);
    const blockerHp0 = blocker.hp;
    tickActiveCards(s, 1 / 30, st, rng);
    flyToImpact(s, st, rng);
    expect(blocker.hp).toBe(blockerHp0); // untouched
    expect(boss.hp).toBeLessThan(boss.hpMax); // boss hit
  });

  it('fizzles with no effect if the target boss dies before impact', () => {
    const { s, st, rng } = plasmaState(0.5);
    const boss = addBoss(s, 1, 200);
    tickActiveCards(s, 1 / 30, st, rng);
    tickProjectiles(s, 1 / 30, st, rng); // one step of travel
    boss.hp = 0; // boss killed by something else mid-flight
    s.enemies = s.enemies.filter((e) => e.hp > 0); // _cleanup would remove it
    expect(() => flyToImpact(s, st, rng)).not.toThrow();
    expect(s.projectiles.filter((p) => p.kind === 'plasma').length).toBe(0); // removed, no orphan
  });

  it('counts plasma damage as the hero’s damage (dmgDealt + kill attributed to damage)', () => {
    const { s, st, rng } = plasmaState(0.5);
    const boss = addBoss(s, 1, 80);
    const dealt0 = s.econ.dmgDealt;
    tickActiveCards(s, 1 / 30, st, rng);
    const dealt = s.projectiles.find((p) => p.kind === 'plasma')!.dmg;
    flyToImpact(s, st, rng);
    expect(s.econ.dmgDealt).toBeCloseTo(dealt0 + dealt, 6);
    expect(boss.lastHurt).toBe('dmg'); // a plasma killing blow attributes to damage, not reflect
  });

  it('deals pure %-HP damage — no lifesteal heal on impact', () => {
    const { s, st, rng } = plasmaState(0.5);
    st.lifesteal = 1; // would heal massively if plasma went through the bullet path
    s.hero.hp = 10;
    s.hero.hpMax = 1000;
    addBoss(s, 1, 80);
    tickActiveCards(s, 1 / 30, st, rng);
    flyToImpact(s, st, rng);
    expect(s.hero.hp).toBe(10); // no heal
  });
});
