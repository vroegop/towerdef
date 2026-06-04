/* tests/unit/new-cards.test.ts — gameplay wiring for the eight new cards. The card-toggle suite
   proves each card surfaces its Stats key; this suite proves the sim actually CONSUMES those keys:
   Ambush / Execute (applyHit), Last Stand / Vengeance (_rollDamage), Aegis (shield + _hurtHero),
   Detonate (_cleanup blast), Berserk (crowd-scaled fire rate) and Ascetic (frugal max-HP growth). */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/core';
import { createState } from '../../src/sim/state';
import { makeEnemy } from '../../src/sim/enemies';
import { applyHit } from '../../src/sim/projectiles';
import { computeStats, setActiveCard, buyRunUpgrade } from '../../src/sim/skills';
import { migrateMeta } from '../../src/sim/labs';
import type { Enemy, Meta, State, Stats } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}
// reach the Sim's private methods the same way the rest of the suite does.
type Privates = {
  _hurtHero(a: number, e?: Enemy): void;
  _rollDamage(st: Stats, dist: number): number;
  _startWave(n: number): void;
  _cleanup(): void;
  _hero(dt: number): void;
};
const P = (sim: Sim): Privates => sim as unknown as Privates;
function freshSim(over: Partial<Meta> = {}): Sim {
  return new Sim(createState(1, freshMeta(over), false));
}

describe('Ambush — bonus damage only against full-HP enemies', () => {
  const stats = { ambush: 0.5 } as unknown as Stats; // +50% vs full HP; rend/lifesteal/knockback off
  it('a full-HP enemy takes the bonus; the follow-up hit (no longer full) does not', () => {
    const sim = freshSim();
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp; // == hpMax on spawn → "full"
    applyHit(sim.s, e, 100, stats); // full → 100 × 1.5
    expect(e.hp).toBeCloseTo(hp0 - 150, 6);
    applyHit(sim.s, e, 100, stats); // no longer full → flat 100
    expect(e.hp).toBeCloseTo(hp0 - 250, 6);
  });
  it('does nothing without the card (ambush = 0)', () => {
    const sim = freshSim();
    const e = makeEnemy(1, 'boss', 10, makeRng(1), sim.s.arena);
    const hp0 = e.hp;
    applyHit(sim.s, e, 100, { ambush: 0 } as unknown as Stats);
    expect(e.hp).toBeCloseTo(hp0 - 100, 6);
  });
});

describe('Execute — finish low-HP non-bosses instantly', () => {
  it('a non-boss left below the threshold is slain outright', () => {
    const sim = freshSim();
    const e = makeEnemy(1, 'melee', 5, makeRng(1), sim.s.arena);
    e.hpMax = 100; e.hp = 100;
    applyHit(sim.s, e, 95, { execute: 0.1 } as unknown as Stats); // → 5 HP ≤ 10% → executed
    expect(e.hp).toBe(0);
  });
  it('a non-boss left ABOVE the threshold survives', () => {
    const sim = freshSim();
    const e = makeEnemy(1, 'melee', 5, makeRng(1), sim.s.arena);
    e.hpMax = 100; e.hp = 100;
    applyHit(sim.s, e, 80, { execute: 0.1 } as unknown as Stats); // → 20 HP > 10%
    expect(e.hp).toBeCloseTo(20, 6);
  });
  it('bosses are immune to Execute', () => {
    const sim = freshSim();
    const e = makeEnemy(1, 'boss', 5, makeRng(1), sim.s.arena);
    e.hpMax = 100; e.hp = 100;
    applyHit(sim.s, e, 95, { execute: 0.1 } as unknown as Stats);
    expect(e.hp).toBeCloseTo(5, 6);
  });
});

describe('Last Stand — outgoing damage scales with the hero’s MISSING HP', () => {
  it('peaks at near-death and is zero at full HP', () => {
    const sim = freshSim();
    Object.assign(sim.stats, { rangedDamage: 100, critChance: 0, dmgPerMeter: 0, lastStand: 0.8, vengeance: 0 });
    sim.s.hero.hpMax = 1000;
    sim.s.hero.hp = 1000; // full → no bonus
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(100, 6);
    sim.s.hero.hp = 500; // 50% missing → +40%
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(140, 6);
    sim.s.hero.hp = 0; // ~100% missing → +80%
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(180, 6);
  });
});

describe('Vengeance — cumulative damage taken amplifies damage, up to the cap', () => {
  it('+1% per 1% of max HP suffered, clamped to the ×cap', () => {
    const sim = freshSim();
    Object.assign(sim.stats, { rangedDamage: 100, critChance: 0, dmgPerMeter: 0, lastStand: 0, vengeance: 3 });
    sim.s.hero.hpMax = 1000;
    sim.s.econ.dmgTaken = 0;
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(100, 6);
    sim.s.econ.dmgTaken = 1000; // == 1× max HP → +100%
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(200, 6);
    sim.s.econ.dmgTaken = 9000; // way past the cap → clamped at ×3
    expect(P(sim)._rollDamage(sim.stats, 0)).toBeCloseTo(300, 6);
  });
});

describe('Aegis — a per-wave shield soaks damage before HP, and refreshes each wave', () => {
  it('starts the wave shielded, absorbs the hit, and spares HP / damage-taken until spent', () => {
    const sim = freshSim();
    sim.stats.aegis = 0.2;
    sim.stats.maxHp = 1000;
    sim.s.hero.hpMax = 1000;
    sim.s.hero.hp = 1000; // give the hero real HP so a 100 spill-through doesn't overkill
    P(sim)._startWave(2);
    expect(sim.s.run.shield).toBeCloseTo(200, 6);
    const hp0 = sim.s.hero.hp;
    P(sim)._hurtHero(150); // fully absorbed by the shield
    expect(sim.s.run.shield).toBeCloseTo(50, 6);
    expect(sim.s.hero.hp).toBe(hp0);
    expect(sim.s.econ.dmgTaken).toBe(0); // absorbed damage must not feed Vengeance
    P(sim)._hurtHero(150); // 50 soaked, 100 through to HP
    expect(sim.s.run.shield).toBe(0);
    expect(sim.s.hero.hp).toBeCloseTo(hp0 - 100, 6);
    expect(sim.s.econ.dmgTaken).toBeCloseTo(100, 6);
  });
});

describe('Detonate — a slain enemy blasts nearby foes for a share of its own max HP', () => {
  it('damages a neighbour in range and leaves a distant one untouched', () => {
    const sim = freshSim();
    sim.stats.detonate = 0.5;
    const dead = makeEnemy(1, 'melee', 5, makeRng(1), sim.s.arena);
    dead.x = 0; dead.y = 0; dead.hpMax = 100; dead.hp = 0; dead.splits = 0;
    const near = makeEnemy(2, 'melee', 5, makeRng(2), sim.s.arena);
    near.x = 10; near.y = 0; near.hpMax = 1000; near.hp = 1000;
    const far = makeEnemy(3, 'melee', 5, makeRng(3), sim.s.arena);
    far.x = 500; far.y = 0; far.hpMax = 1000; far.hp = 1000;
    sim.s.enemies = [dead, near, far];
    P(sim)._cleanup();
    expect(near.hp).toBeCloseTo(950, 6); // 50% of the dead enemy's 100 max HP
    expect(far.hp).toBe(1000);
    expect(sim.s.enemies).toContain(near); // survivor stays in play (dies next tick if blasted to 0)
  });
});

describe('Berserk — fire rate climbs with the crowd, up to the cap', () => {
  it('an empty arena fires at base rate; a dense crowd reaches the capped rate', () => {
    const baseSim = freshSim();
    Object.assign(baseSim.stats, { fireRate: 1, berserk: 0, rapidChance: 0 });
    baseSim.s.enemies = [makeEnemy(1, 'melee', 1, makeRng(1), baseSim.s.arena)];
    baseSim.s.enemies[0].x = baseSim.s.hero.x; baseSim.s.enemies[0].y = baseSim.s.hero.y;
    P(baseSim)._hero(0.001);
    const baseCd = baseSim.s.hero.atkCd;

    const sim = freshSim();
    Object.assign(sim.stats, { fireRate: 1, berserk: 0.5, rapidChance: 0 }); // cap +50%, =1%/enemy
    const crowd: Enemy[] = [];
    for (let i = 0; i < 80; i++) { // 80 enemies (> 50) stacked on the hero → capped
      const e = makeEnemy(10 + i, 'melee', 1, makeRng(i + 1), sim.s.arena);
      e.x = sim.s.hero.x; e.y = sim.s.hero.y;
      crowd.push(e);
    }
    sim.s.enemies = crowd;
    P(sim)._hero(0.001);
    // capped fire rate = base × 1.5 ⇒ cooldown is base / 1.5.
    expect(sim.s.hero.atkCd).toBeCloseTo(baseCd / 1.5, 5);
  });
});

describe('Ascetic — frugal waves grow max HP; spending gold freezes it', () => {
  it('computeStats scales max HP by +per-wave × frugal waves', () => {
    const s = createState(1, freshMeta({ cards: [{ id: 'ascetic', stars: 15 }], cardSlots: 1 }), false);
    setActiveCard(s.meta, 0, 'ascetic');
    const per = computeStats(s).ascetic; // the per-wave fraction at level 15
    expect(per).toBeGreaterThan(0);
    s.run.asceticWaves = 0;
    const base = computeStats(s).maxHp;
    s.run.asceticWaves = 10;
    expect(computeStats(s).maxHp).toBeCloseTo(base * (1 + per * 10), 6);
  });

  it('buying an in-run upgrade sets asceticBroken (coin/perm buys do not run this path)', () => {
    const s = createState(1, freshMeta(), false) as State;
    s.econ.gold = 1e9;
    expect(s.run.asceticBroken).toBeFalsy();
    expect(buyRunUpgrade(s, 'rangedDamage')).toBe(true); // a starter skill, pre-unlocked
    expect(s.run.asceticBroken).toBe(true);
  });

  it('_startWave counts frugal waves until broken, then stops', () => {
    const sim = freshSim();
    P(sim)._startWave(2);
    P(sim)._startWave(3);
    expect(sim.s.run.asceticWaves).toBe(2);
    sim.s.run.asceticBroken = true; // a gold/free-up buy happened
    P(sim)._startWave(4);
    expect(sim.s.run.asceticWaves).toBe(2); // frozen
  });
});
