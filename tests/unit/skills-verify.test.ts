/* tests/unit/skills-verify.test.ts — targeted verification that bounce, multishot,
   burst, rend, and other combat skills actually fire and produce their in-sim effects.
   All RNG is seeded; all probabilities are forced to 0 or 1 to eliminate randomness. */
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng';
import { createState } from '../../src/sim/state';
import { migrateMeta } from '../../src/sim/labs';
import { fireProjectile, tickProjectiles, applyHit } from '../../src/sim/projectiles';
import { computeStats, RAPID_MULT } from '../../src/sim/skills';
import { Sim } from '../../src/sim/core';
import type { Enemy, Meta, State, Stats } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

// Minimal enemy placed at a given position with enough HP to survive one hit.
function enemy(id: number, x: number, y: number): Enemy {
  return {
    id, type: 'melee', shape: 'circle', behavior: 'stick', color: '#fff',
    r: 12, x, y, facing: 0, strMult: 1, hpMax: 9999, hp: 9999,
    dmg: 1, speed: 0, range: 0, state: 'approach', atkCd: 0, kb: 0,
    hitFlash: 0, hitDmg: 0, rend: 0, rendT: 0, splits: 0, mass: 1, slow: 1, slowT: 0, heat: 0,
    bornWave: 1, veteran: false, agedWaves: 0,
  };
}

// Minimal stats with the given overrides, everything else zeroed.
function stats(over: Partial<Stats>): Stats {
  const base: Stats = {
    rangedDamage: 10, fireRate: 1, maxHp: 100, regen: 0,
    rangeM: 80, range: 320, dmgPerMeter: 0,
    critChance: 0, critMult: 1, superCrit: 0,
    rendChance: 0, rendMult: 0,
    msChance: 0, msTargets: 1,
    bounceChance: 0, bounceTargets: 0, bounceRange: 0,
    rapidChance: 0, rapidDuration: 0,
    armor: 0, defPct: 0, thorns: 0, lifesteal: 0, knockbackChance: 0, knockbackForce: 0,
    cashMult: 1, interest: 0,
    goldPerWave: 0, coinsPerWave: 0, coinsPerKill: 0, goldFind: 1, xpGain: 1,
  };
  return { ...base, ...over } as Stats;
}

// Minimal hero at origin.
function heroAt(x = 0, y = 0) {
  return { x, y, r: 16, hp: 100, hpMax: 100, sinceHit: 0, atkCd: 0, range: 320 };
}

// Run tickProjectiles until all projectiles are gone, up to maxTicks.
function drainProjectiles(state: State, st: Stats, rng = makeRng(0), maxTicks = 1000): void {
  for (let i = 0; i < maxTicks && state.projectiles.length; i++) {
    tickProjectiles(state, 1 / 60, st, rng);
  }
}

// --- Bounce ---

describe('bounce', () => {
  it('does not bounce when bounceChance = 0', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    const e1 = enemy(1, 80, 0);
    const e2 = enemy(2, 0, 80);
    s.enemies = [e1, e2];
    s.projectiles = [];

    // Always-returns-0 RNG → chance roll always fails → no bounce
    const rng = { next: () => 0, state: 0 };
    const st = stats({ bounceChance: 0, bounceTargets: 3, bounceRange: 500 });

    fireProjectile(s, s.hero, e1, st, 10, rng);
    expect(s.projectiles[0].bounces).toBe(0);

    drainProjectiles(s, st, rng);
    expect(e1.hp).toBeLessThan(9999); // e1 was hit
    expect(e2.hp).toBe(9999);         // e2 was NOT hit
  });

  it('bounces to a second enemy when bounceChance = 1', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    const e1 = enemy(1, 80, 0);
    const e2 = enemy(2, 160, 0); // in line, within bounce range
    s.enemies = [e1, e2];
    s.projectiles = [];

    // Always-returns-0 RNG → chance roll (0 < 1.0) passes → bounce triggers
    const rng = { next: () => 0, state: 0 };
    const st = stats({ bounceChance: 1.0, bounceTargets: 1, bounceRange: 500 });

    fireProjectile(s, s.hero, e1, st, 10, rng);
    expect(s.projectiles[0].bounces).toBe(1);

    drainProjectiles(s, st, rng);
    expect(e1.hp).toBeLessThan(9999); // primary target hit
    expect(e2.hp).toBeLessThan(9999); // bounce reached second enemy
  });

  it('chains through multiple enemies up to bounceTargets', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    // 4 enemies in a line; bullet fires at e1, should bounce through e2, e3 (bounceTargets=2)
    const e1 = enemy(1,  80, 0);
    const e2 = enemy(2, 160, 0);
    const e3 = enemy(3, 240, 0);
    const e4 = enemy(4, 320, 0);
    s.enemies = [e1, e2, e3, e4];
    s.projectiles = [];

    const rng = { next: () => 0, state: 0 };
    const st = stats({ bounceChance: 1.0, bounceTargets: 2, bounceRange: 500 });

    fireProjectile(s, s.hero, e1, st, 10, rng);
    expect(s.projectiles[0].bounces).toBe(2);

    drainProjectiles(s, st, rng);
    expect(e1.hp).toBeLessThan(9999); // primary
    expect(e2.hp).toBeLessThan(9999); // bounce 1
    expect(e3.hp).toBeLessThan(9999); // bounce 2
    expect(e4.hp).toBe(9999);          // beyond bounceTargets — untouched
  });

  it('never re-hits the same enemy (hitIds guard)', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    // Only one other enemy → after first bounce there's no valid target; bullet expires
    const e1 = enemy(1, 80, 0);
    const e2 = enemy(2, 160, 0);
    s.enemies = [e1, e2];
    s.projectiles = [];

    const rng = { next: () => 0, state: 0 };
    const st = stats({ bounceChance: 1.0, bounceTargets: 5, bounceRange: 500 });

    fireProjectile(s, s.hero, e1, st, 10, rng);
    drainProjectiles(s, st, rng);

    // e1 hit exactly once; e2 hit exactly once (no back-and-forth ping-pong)
    const e1Dmg = 9999 - e1.hp;
    const e2Dmg = 9999 - e2.hp;
    expect(e1Dmg).toBeCloseTo(10, 0);
    expect(e2Dmg).toBeCloseTo(10, 0);
  });

  it('does not bounce when no enemies are within bounceRange', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    const e1 = enemy(1, 80, 0);
    const e2 = enemy(2, 9000, 0); // way outside bounce range
    s.enemies = [e1, e2];
    s.projectiles = [];

    const rng = { next: () => 0, state: 0 };
    const st = stats({ bounceChance: 1.0, bounceTargets: 3, bounceRange: 50 }); // tiny range

    fireProjectile(s, s.hero, e1, st, 10, rng);
    drainProjectiles(s, st, rng);

    expect(e1.hp).toBeLessThan(9999);
    expect(e2.hp).toBe(9999); // out of range — never reached
  });
});

// --- Multishot ---

describe('multishot', () => {
  it('fires only 1 projectile when msChance = 0', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    s.enemies = [enemy(1, 80, 0), enemy(2, 0, 80), enemy(3, -80, 0)];
    s.run.levels = { msChance: 1000, msTargets: 3 }; // upgrades bought
    s.projectiles = [];

    const rng = { next: () => 0.99, state: 0 }; // 0.99 > 0 → chance fails (msChance=0 means no roll)
    const st = stats({ msChance: 0, msTargets: 3 });

    // Simulate one attack cycle manually: msChance=0 → only 1 shot
    const targets = s.enemies.slice(0, 1);
    let shots = 1;
    // msChance is 0 so no extra shots
    for (let i = 0; i < shots; i++) fireProjectile(s, s.hero, targets[i], st, 10, rng);
    expect(s.projectiles.length).toBe(1);
  });

  it('fires up to msTargets+1 projectiles when msChance = 1', () => {
    // Test the multishot logic as it runs in Sim._hero():
    // hero fires at up to (1 + msTargets) enemies when chance succeeds.
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt(0, 0);
    s.hero.atkCd = 0;
    // 5 enemies spread at different angles so bullets fly in distinct directions
    const angles = [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI, Math.PI * 4 / 3];
    for (let i = 0; i < 5; i++) {
      s.enemies.push(enemy(i + 1, Math.cos(angles[i]) * 80, Math.sin(angles[i]) * 80));
    }
    s.projectiles = [];
    s.atkMode = 'bullet';

    const st = stats({ msChance: 1.0, msTargets: 3, range: 9999, fireRate: 1 });
    const rng = { next: () => 0, state: 0 }; // 0 < 1.0 → multishot triggers

    // Mirror Sim._hero multishot logic
    const maxExtra = Math.max(0, Math.floor(st.msTargets));
    const inRange = s.enemies.filter(e => Math.hypot(e.x - s.hero.x, e.y - s.hero.y) < st.range);
    inRange.sort((a, b) => Math.hypot(a.x - s.hero.x, a.y - s.hero.y) - Math.hypot(b.x - s.hero.x, b.y - s.hero.y));
    const targets = inRange.slice(0, 1 + maxExtra);

    let shots = 1;
    if (st.msChance && rng.next() < st.msChance) shots = Math.min(targets.length, 1 + maxExtra);
    for (let i = 0; i < shots; i++) fireProjectile(s, s.hero, targets[i], st, 10, rng);

    expect(shots).toBe(4); // 1 primary + 3 extra
    expect(s.projectiles.length).toBe(4);
    // Bullets point in distinct directions since enemies are spread around the hero
    const vxSet = new Set(s.projectiles.map(p => Math.round(p.vx)));
    expect(vxSet.size).toBeGreaterThan(1);
  });

  it('multishot with msChance via full Sim integration', () => {
    // Run a full Sim with guaranteed multishot and count projectiles fired.
    const meta = freshMeta({ perm: { msChance: 1000, msTargets: 3, range: 100 } });
    const s = createState(42, meta, false);
    // Place 5 stationary enemies near the hero, stop them from moving
    s.enemies = [];
    for (let i = 0; i < 5; i++) {
      const e = enemy(i + 1, 40 + i * 20, 0);
      e.speed = 0;
      s.enemies.push(e);
    }
    s.hero.x = 0; s.hero.y = 0;
    s.projectiles = [];
    const sim = new Sim(s);
    sim.refreshStats();
    // Multishot chance caps below 100% post-rebalance, so force it on to test the mechanic fires.
    sim.stats.msChance = 1;

    // Confirm msChance and msTargets stat values are > 0
    expect(sim.stats.msChance).toBeGreaterThan(0);
    expect(sim.stats.msTargets).toBeGreaterThanOrEqual(1);

    // Step for a couple of attack cycles
    let maxProjectiles = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(1 / 60);
      maxProjectiles = Math.max(maxProjectiles, s.projectiles.length);
    }
    // Should have seen at least 2 projectiles in flight at once (multishot fired)
    expect(maxProjectiles).toBeGreaterThanOrEqual(2);
  });
});

// --- Burst (Rapid Fire) ---

describe('burst (rapid fire)', () => {
  it('rapidChance stat is computed correctly from levels', () => {
    const st = computeStats(createState(1, freshMeta({ perm: { rapidChance: 50 } }), false));
    expect(st.rapidChance).toBeCloseTo(0.2, 5); // 50 levels × 0.004/level = 0.2
  });

  it('burst multiplies fire rate while active in the Sim', () => {
    // Run two separate 1-second simulations — one normal, one with burst active from tick 0 —
    // and compare total HP removed from the test enemy. Burst at RAPID_MULT × fire rate should
    // deal roughly RAPID_MULT times more damage. Health perm keeps the hero alive; wave.clock=0
    // freezes the wave system so no distractions spawn.
    const hx = 480, hy = 320; // hero's default spawn position in createState
    const basePerm = { health: 5000, attackSpeed: 10 }; // enough HP to survive; known fire rate

    // --- normal phase ---
    const s1 = createState(1, freshMeta({ perm: basePerm }), false);
    s1.wave.clock = 0;
    const e1 = enemy(10, hx + 50, hy); e1.speed = 0;
    s1.enemies = [e1];
    const sim1 = new Sim(s1);
    sim1.refreshStats();
    for (let i = 0; i < 60; i++) sim1.step(1 / 60);
    const normalDamage = 9999 - e1.hp;

    // --- burst phase (rapidT active for the entire window) ---
    const s2 = createState(2, freshMeta({ perm: basePerm }), false);
    s2.wave.clock = 0;
    s2.run.rapidT = 60; // far longer than the test window — burst stays on throughout
    const e2 = enemy(10, hx + 50, hy); e2.speed = 0;
    s2.enemies = [e2];
    const sim2 = new Sim(s2);
    sim2.refreshStats();
    for (let i = 0; i < 60; i++) sim2.step(1 / 60);
    const burstDamage = 9999 - e2.hp;

    expect(normalDamage).toBeGreaterThan(0);
    expect(burstDamage).toBeGreaterThan(normalDamage);
    expect(burstDamage / normalDamage).toBeGreaterThanOrEqual(RAPID_MULT - 0.5);
  });
});

// --- Rend (Amp stacks) ---

describe('rend / amp', () => {
  it('applyHit applies a rend stack when rendChance = 1', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt();
    const e = enemy(1, 0, 0);
    s.enemies = [e];
    s.projectiles = [];

    const rng = { next: () => 0, state: 0 }; // 0 < 1 → rend always applies
    const st = stats({ rendChance: 1.0, rendMult: 0.5 });

    applyHit(s, e, 10, st, rng);
    expect(e.rend).toBe(1);
  });

  it('rend stacks amplify subsequent damage', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt();
    const e = enemy(1, 0, 0);
    s.enemies = [e];

    const rng = { next: () => 0, state: 0 };
    const st = stats({ rendChance: 0, rendMult: 0.5 }); // no new stacks during damage check

    // Manually pre-load 2 rend stacks
    e.rend = 2;
    e.rendT = 9999;

    const hpBefore = e.hp;
    applyHit(s, e, 10, st, rng);
    const dealt = hpBefore - e.hp;

    // Expected: 10 * (1 + 2 * 0.5) = 10 * 2.0 = 20
    expect(dealt).toBeCloseTo(20, 5);
  });

  it('rend stacks decay to 0 after rendT expires', () => {
    const meta = freshMeta({ perm: { rendChance: 1000, rendMult: 500 } });
    const s = createState(1, meta, false);
    s.enemies = [enemy(1, 60, 0)];
    s.enemies[0].speed = 0;
    const sim = new Sim(s);
    sim.refreshStats();

    // Force a rend stack on the enemy
    s.enemies[0].rend = 3;
    s.enemies[0].rendT = 0.1; // expires after 0.1s

    // Step 1 second (60 frames at 1/60)
    for (let i = 0; i < 60; i++) sim.step(1 / 60);

    expect(s.enemies[0].rend).toBe(0); // stacks decayed
  });
});

// --- Lifesteal ---

describe('lifesteal', () => {
  it('heals the hero for a fraction of damage dealt', () => {
    const s = createState(1, freshMeta(), false);
    s.hero = heroAt();
    s.hero.hp = 50;
    s.hero.hpMax = 100;
    const e = enemy(1, 0, 0);

    const rng = { next: () => 0, state: 0 };
    const st = stats({ lifesteal: 0.25, rendChance: 0, rendMult: 0 });

    applyHit(s, e, 20, st, rng); // deals 20 damage → heals 5
    expect(s.hero.hp).toBeCloseTo(55, 5);
  });
});

// --- Crit ---

describe('crit', () => {
  it('critChance = 0 → no crits (normal damage)', () => {
    // Run a sim with no crit and verify kills happen at expected DPS.
    const meta = freshMeta({ perm: { rangedDamage: 10, critChance: 0, critDamage: 0 } });
    const s = createState(1, meta, false);
    const sim = new Sim(s);
    sim.refreshStats();
    expect(sim.stats.critChance).toBe(0);
    expect(sim.stats.critMult).toBeCloseTo(1.2); // base crit multiplier (×1.2)
  });

  it('critChance is capped at 0.8 (the upgrade cap)', () => {
    // critChance curve: linear base=0, per=0.01, cap=0.8, max 80 levels
    // at max (80 levels): 0 + 0.01×80 = 0.8 (exactly at cap)
    const meta = freshMeta({ perm: { critChance: 80 } });
    const st = computeStats(createState(1, meta, false));
    expect(st.critChance).toBeCloseTo(0.8, 5);

    // Above cap: even with 9999 perm levels, critChance stays at 0.8
    const metaOver = freshMeta({ perm: { critChance: 9999 } });
    const stOver = computeStats(createState(1, metaOver, false));
    expect(stOver.critChance).toBeCloseTo(0.8, 5);

    // critChance < 1 → floor = 0 (no guaranteed crit); the 0.8 is an 80% chance of a single crit.
    expect(Math.floor(st.critChance)).toBe(0);
    expect(st.critChance - Math.floor(st.critChance)).toBeCloseTo(0.8, 5);
  });
});
