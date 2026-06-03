/* tests/unit/disintegrate.test.ts — the Disintegrate skill (internally still `thorns`).
   On contact, an attacker loses a fraction of ITS OWN max HP (not the incoming damage). Fires on
   every landed hit, for melee and ranged alike (both attack paths pass the attacker to _hurtHero). */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { UP_BY_ID } from '../../src/sim/skills';
import { migrateMeta } from '../../src/sim/labs';
import type { Enemy, Meta } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

// _hurtHero is private; the existing suite reaches privates via a cast (see the _separate tests).
function hurt(sim: Sim, amount: number, attacker?: Enemy): void {
  (sim as unknown as { _hurtHero(a: number, e?: Enemy): void })._hurtHero(amount, attacker);
}

function simWithThorns(frac: number): Sim {
  const sim = new Sim(createState(1, freshMeta(), false));
  sim.stats.thorns = frac;
  return sim;
}

describe('disintegrate — damage basis', () => {
  it('deals thorns × the attacker’s OWN max HP, independent of the incoming damage', () => {
    const sim = simWithThorns(0.5);
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    hurt(sim, 9999, e); // huge incoming hit — must NOT scale the retaliation
    expect(e.hp).toBeCloseTo(hp0 - e.hpMax * 0.5, 6);
  });

  it('does not depend on incoming damage: a 1-dmg hit disintegrates the same chunk', () => {
    const sim = simWithThorns(0.5);
    const e = makeEnemy(1, 'melee', 5, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    hurt(sim, 1, e);
    expect(e.hp).toBeCloseTo(hp0 - e.hpMax * 0.5, 6);
  });

  it('fires on every landed hit (stacks across contacts)', () => {
    const sim = simWithThorns(0.2);
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    hurt(sim, 1, e);
    hurt(sim, 1, e);
    expect(e.hp).toBeCloseTo(hp0 - 2 * e.hpMax * 0.2, 6);
  });

  it('also disintegrates ranged attackers (same _hurtHero path)', () => {
    const sim = simWithThorns(0.5);
    const e = makeEnemy(1, 'ranged', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    hurt(sim, 7, e);
    expect(e.hp).toBeCloseTo(hp0 - e.hpMax * 0.5, 6);
  });

  it('does nothing when the skill is not owned (thorns = 0)', () => {
    const sim = simWithThorns(0);
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    hurt(sim, 9999, e);
    expect(e.hp).toBe(hp0);
  });

  it('attributes the hit to the reflect/contact channel (lastHurt + reflectDealt)', () => {
    const sim = simWithThorns(0.5);
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const rd0 = sim.s.econ.reflectDealt;
    hurt(sim, 3, e);
    expect(e.lastHurt).toBe('reflect');
    expect(sim.s.econ.reflectDealt).toBeCloseTo(rd0 + e.hpMax * 0.5, 6);
  });
});

describe('disintegrate — skill scale & display', () => {
  it('caps at 99% of max HP (curve cap 0.99)', () => {
    const u = UP_BY_ID.thorns;
    expect(u.value(99)).toBeCloseTo(0.99, 6);
    expect(u.value(500)).toBeCloseTo(0.99, 6); // capped, never exceeds 99%
  });

  it('displays as a percent of max HP', () => {
    const u = UP_BY_ID.thorns;
    expect(u.fmt(u.value(99))).toBe('99%');
    expect(u.fmt(u.value(50))).toBe('50%');
  });

  it('is named Disintegrate (display only; id stays "thorns" for save compatibility)', () => {
    const u = UP_BY_ID.thorns;
    expect(u.id).toBe('thorns');
    expect(u.name).toBe('Disintegrate');
    expect(u.label).toBe('Disintegrate');
  });
});
