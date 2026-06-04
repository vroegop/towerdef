/* tests/unit/new-skills.test.ts — the seven new mechanic skills:
   Frostbite (chill), Poison (DoT), Splash (collateral), Dodge (evade), Stun (freeze),
   Greed (no-damage kill-streak gold multiplier), and Coin Power (damage per banked coin). */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { applyHit } from '../../src/sim/projectiles';
import {
  UP_BY_ID, computeStats, skillGroup,
  FROST_DURATION, POISON_DURATION, STUN_DURATION, SPLASH_RADIUS, GREED_CAP,
} from '../../src/sim/skills';
import { migrateMeta } from '../../src/sim/labs';
import type { Enemy, Meta, State } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

// _hurtHero / _enemies / _cleanup are private; reach them via a cast (as the disintegrate suite does).
interface Privates { _hurtHero(a: number, e?: Enemy): void; _enemies(dt: number): void; _cleanup(): void }
const priv = (sim: Sim): Privates => sim as unknown as Privates;

function newSim(over: Partial<Meta> = {}): Sim {
  return new Sim(createState(1, freshMeta(over), false));
}
// An enemy parked far from the tower (so _enemies movement/attack never reaches the hero), with plenty
// of HP to survive a test hit. Pushed onto the sim so applyHit's splash/_enemies see it.
function farEnemy(sim: Sim, type = 'melee', id = 1): Enemy {
  const e = makeEnemy(id, type, 10, makeRng(id + 1), sim.s.arena);
  e.x = sim.s.hero.x + 100000;
  e.y = sim.s.hero.y;
  e.hp = e.hpMax = 1_000_000;
  sim.s.enemies.push(e);
  return e;
}

describe('Frostbite — chill on hit', () => {
  it('slows the target to (1 − frostbite) for FROST_DURATION', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.frostbite = 0.4;
    applyHit(sim.s, e, 100, sim.stats, sim.rng);
    expect(e.slow).toBeCloseTo(0.6, 6);
    expect(e.slowT).toBe(FROST_DURATION);
  });
  it('keeps the strongest chill when re-applied', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.frostbite = 0.4;
    applyHit(sim.s, e, 100, sim.stats, sim.rng); // slow 0.6
    sim.stats.frostbite = 0.6;
    applyHit(sim.s, e, 100, sim.stats, sim.rng); // slow 0.4 (stronger)
    expect(e.slow).toBeCloseTo(0.4, 6);
    sim.stats.frostbite = 0.2;
    applyHit(sim.s, e, 100, sim.stats, sim.rng); // weaker → does not override
    expect(e.slow).toBeCloseTo(0.4, 6);
  });
  it('does nothing when the skill is not owned', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    applyHit(sim.s, e, 100, sim.stats, sim.rng);
    expect(e.slow).toBe(1);
    expect(e.slowT).toBe(0);
  });
});

describe('Poison — damage over time', () => {
  it('lays a burn of (poison × hit damage)/s for POISON_DURATION', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.poison = 0.5;
    applyHit(sim.s, e, 100, sim.stats, sim.rng); // dealt 100 → burn 50/s
    expect(e.poison).toBeCloseTo(50, 6);
    expect(e.poisonT).toBe(POISON_DURATION);
  });
  it('burns HP over time in _enemies', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.poison = 0.5;
    applyHit(sim.s, e, 100, sim.stats, sim.rng);
    const hp0 = e.hp;
    priv(sim)._enemies(0.1);
    expect(hp0 - e.hp).toBeCloseTo(5, 4); // 50/s × 0.1s
    expect(e.poisonT).toBeCloseTo(POISON_DURATION - 0.1, 4);
  });
  it('refreshes to the strongest hit, never a weaker one', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.poison = 0.5;
    applyHit(sim.s, e, 100, sim.stats, sim.rng); // 50
    applyHit(sim.s, e, 40, sim.stats, sim.rng); // 20 < 50 → unchanged
    expect(e.poison).toBeCloseTo(50, 6);
    applyHit(sim.s, e, 200, sim.stats, sim.rng); // 100 > 50 → upgraded
    expect(e.poison).toBeCloseTo(100, 6);
  });
});

describe('Splash — collateral damage', () => {
  it('hits other enemies within SPLASH_RADIUS for (splash × hit damage), sparing those outside', () => {
    const sim = newSim();
    const a = makeEnemy(1, 'melee', 10, makeRng(1), sim.s.arena);
    const b = makeEnemy(2, 'melee', 10, makeRng(2), sim.s.arena);
    const c = makeEnemy(3, 'melee', 10, makeRng(3), sim.s.arena);
    for (const e of [a, b, c]) { e.hp = e.hpMax = 1_000_000; }
    a.x = 5000; a.y = 5000;
    b.x = a.x + (SPLASH_RADIUS - 5); b.y = a.y; // inside
    c.x = a.x + (SPLASH_RADIUS + 50); c.y = a.y; // outside
    sim.s.enemies.push(a, b, c);
    sim.stats.splash = 0.5;
    const bhp = b.hp, chp = c.hp;
    applyHit(sim.s, a, 100, sim.stats, sim.rng);
    expect(bhp - b.hp).toBeCloseTo(50, 4);
    expect(c.hp).toBe(chp);
  });
});

describe('Dodge — evade an incoming hit', () => {
  it('takes no damage and preserves the kill streak when it procs', () => {
    const sim = newSim();
    sim.s.hero.hp = sim.s.hero.hpMax = 1000;
    sim.stats.dodge = 1; sim.stats.defPct = 0; sim.stats.armor = 0;
    sim.s.run.streak = 7;
    priv(sim)._hurtHero(100);
    expect(sim.s.hero.hp).toBe(1000);
    expect(sim.s.run.streak).toBe(7);
  });
  it('takes damage (and breaks the streak) when it does not proc', () => {
    const sim = newSim();
    sim.s.hero.hp = sim.s.hero.hpMax = 1000;
    sim.stats.dodge = 0; sim.stats.defPct = 0; sim.stats.armor = 0;
    sim.s.run.streak = 7;
    priv(sim)._hurtHero(100);
    expect(sim.s.hero.hp).toBe(900);
    expect(sim.s.run.streak).toBe(0);
  });
});

describe('Stun — freeze on hit', () => {
  it('freezes a non-boss for STUN_DURATION and stops its movement', () => {
    const sim = newSim();
    const e = farEnemy(sim);
    sim.stats.stun = 1; // always procs
    applyHit(sim.s, e, 100, sim.stats, sim.rng);
    expect(e.stunT).toBe(STUN_DURATION);
    const x0 = e.x;
    priv(sim)._enemies(0.1);
    expect(e.x).toBe(x0); // frozen: did not advance toward the hero
    expect(e.state).toBe('stun');
    expect(e.stunT).toBeCloseTo(STUN_DURATION - 0.1, 4);
  });
  it('does not freeze bosses (immune)', () => {
    const sim = newSim();
    const boss = farEnemy(sim, 'boss', 2);
    sim.stats.stun = 1;
    applyHit(sim.s, boss, 100, sim.stats, sim.rng);
    expect(boss.stunT || 0).toBe(0);
  });
});

describe('Greed — no-damage kill-streak gold multiplier', () => {
  // Bank the gold from killing one (already-dead) enemy at a given streak; returns the gold gained.
  function killGold(sim: Sim, streak: number): number {
    const e = makeEnemy(99, 'melee', sim.s.wave.n, makeRng(7), sim.s.arena);
    e.hp = 0; e.lastHurt = 'dmg'; e.agedWaves = 0;
    sim.s.enemies.push(e);
    sim.s.run.streak = streak;
    const g0 = sim.s.econ.gold;
    priv(sim)._cleanup();
    return sim.s.econ.gold - g0;
  }
  it('ramps gold with the streak, capped at ×(1 + GREED_CAP)', () => {
    const sim = newSim();
    sim.s.wave.n = 1000; // large reward basis → rounding is negligible in the ratio
    sim.stats.greed = 0.01; sim.stats.goldFind = 1; sim.stats.cashMult = 1; sim.stats.enemyBalance = 1;
    sim.s.run.goldenMult = 1;
    const gLow = killGold(sim, 0); // streak → 1, mult ≈ 1.01
    const gHigh = killGold(sim, 100000); // streak way past the cap → mult = 1 + GREED_CAP
    expect(gHigh).toBeGreaterThan(gLow);
    expect(gHigh / gLow).toBeGreaterThan(1.8);
    expect(gHigh / gLow).toBeLessThanOrEqual(1 + GREED_CAP + 0.02);
  });
  it('has no effect on gold when the skill is not owned', () => {
    const sim = newSim();
    sim.s.wave.n = 1000;
    sim.stats.greed = 0; sim.stats.goldFind = 1; sim.stats.cashMult = 1; sim.stats.enemyBalance = 1;
    sim.s.run.goldenMult = 1;
    expect(killGold(sim, 0)).toBe(killGold(sim, 100000));
  });
});

describe('Coin Power — damage per banked coin', () => {
  function rangedDamage(coins: number, permLevel: number): number {
    const meta = freshMeta({ coins });
    meta.unlocked = { ...(meta.unlocked || {}), coinpower: true };
    meta.perm = { ...(meta.perm || {}), dmgPerCoin: permLevel };
    return computeStats({ meta, run: { levels: {} } } as unknown as State).rangedDamage;
  }
  it('adds +1 base damage per 100 coins, per level', () => {
    // level 1 (free unlock level): +1 dmg per 100 coins → 10 000 coins ⇒ +100 base damage.
    expect(rangedDamage(10000, 0) - rangedDamage(0, 0)).toBeCloseTo(100, 6);
    // level 50: rate 50 ⇒ 10 000 coins ⇒ +5000; the delta over level 1 is +4900.
    expect(rangedDamage(10000, 49) - rangedDamage(10000, 0)).toBeCloseTo(4900, 6);
  });
  it('adds nothing with zero coins', () => {
    expect(rangedDamage(0, 49) - rangedDamage(0, 0)).toBeCloseTo(0, 6);
  });
});

describe('new skills — curves, caps, and grouping', () => {
  it('cap at their authored ceilings', () => {
    expect(UP_BY_ID.frostbite.value(120)).toBeCloseTo(0.6, 6);
    expect(UP_BY_ID.frostbite.value(9999)).toBeCloseTo(0.6, 6);
    expect(UP_BY_ID.dodge.value(120)).toBeCloseTo(0.6, 6);
    expect(UP_BY_ID.stun.value(100)).toBeCloseTo(0.4, 6);
    expect(UP_BY_ID.poison.value(60)).toBeCloseTo(0.6, 6);
    expect(UP_BY_ID.splash.value(50)).toBeCloseTo(0.5, 6);
    expect(UP_BY_ID.greed.value(100)).toBeCloseTo(0.02, 6);
    expect(UP_BY_ID.dmgPerCoin.value(200)).toBe(200);
  });
  it('land in the expected tabs', () => {
    expect(UP_BY_ID.poison.tab).toBe('attack');
    expect(UP_BY_ID.splash.tab).toBe('attack');
    expect(UP_BY_ID.dmgPerCoin.tab).toBe('attack');
    expect(UP_BY_ID.frostbite.tab).toBe('defense');
    expect(UP_BY_ID.dodge.tab).toBe('defense');
    expect(UP_BY_ID.stun.tab).toBe('defense');
    expect(UP_BY_ID.greed.tab).toBe('economic');
  });
  it('are each unlockable as their own Workshop group', () => {
    for (const id of ['poison', 'splash', 'dmgPerCoin', 'frostbite', 'dodge', 'stun', 'greed']) {
      expect(skillGroup(id)).toBeTruthy();
    }
  });
});
