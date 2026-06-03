/* src/sim/enemies.ts — spawning, per-enemy stats, and the HYBRID aging rule.
   Aging (chosen design): when a new wave starts, every survivor becomes
   max(its own value × 1.1, 1.1 × a fresh same-type enemy this wave) for BOTH
   strength and speed. So survivors compound while never dropping below 1.1× the
   current baseline — hoarding a ball of enemies becomes lethal over time. */
import type { Arena, Enemy, Rng, State } from '../types';
import { TYPES } from './registries';
import { SPAWN, allowedSpecials, isBossWave, waveCount, waveSpeed, waveHp, waveDmg } from './waves';

// Expected per-type share of a wave at (real) wave n in `tier`, for the HUD enemy panel. Mirrors
// waveRoster's composition (caps + unlocks + boss rule) using a representative wave size, with the
// special pool split evenly among the unlocked specials.
export function spawnChances(n: number, tier: number): Record<string, number> {
  const count = Math.max(1, waveCount(n));
  const out: Record<string, number> = {};
  if (isBossWave(n)) {
    const normals = Math.min(SPAWN.normalCap, count - 1);
    const total = 1 + normals;
    out.boss = 1 / total;
    out.melee = normals / total;
    return out;
  }
  const specials = allowedSpecials(n, tier);
  const specialN = specials.length ? Math.min(SPAWN.specialCap, count) : 0;
  const normalN = Math.min(SPAWN.normalCap, count - specialN);
  const total = normalN + specialN || 1;
  out.melee = normalN / total;
  for (const t of specials) out[t] = specialN / specials.length / total;
  return out;
}

const ihp = (base: number, mult: number): number => Math.max(1, Math.round(base * mult));

// `diff` is the tier's flat HP/damage multiplier (state.difficultyMult = tierMult(tier)); 1 = tier 1.
// HP and damage follow SEPARATE wave curves, each ×diff. strMult/dmgMult are the resolved per-enemy
// multipliers, kept on the enemy so ageSurvivors can compound them independently.
export function makeEnemy(id: number, type: string, waveN: number, rng: Rng, arena: Arena, cx = arena.w / 2, cy = arena.h / 2, diff = 1): Enemy {
  const def = TYPES[type];
  const strMult = waveHp(waveN) * diff, // HP multiplier (also the "strength" proxy for splits)
    dmgMult = waveDmg(waveN) * diff; // damage multiplier (grows slower than HP)
  const speed = def.speed * waveSpeed(waveN); // tier does NOT change speed (Tower-style)
  const m = 30;
  // Spawn just outside one edge of the arena box, which is centered on (cx, cy) — the stationary
  // hero. (Default center = w/2,h/2 reproduces the legacy origin-anchored box exactly.)
  const left = cx - arena.w / 2,
    top = cy - arena.h / 2;
  let x: number, y: number;
  const edge = (rng.next() * 4) | 0;
  if (edge === 0) {
    x = left + rng.next() * arena.w;
    y = top - m;
  } else if (edge === 1) {
    x = left + arena.w + m;
    y = top + rng.next() * arena.h;
  } else if (edge === 2) {
    x = left + rng.next() * arena.w;
    y = top + arena.h + m;
  } else {
    x = left - m;
    y = top + rng.next() * arena.h;
  }
  const hp = ihp(def.hp, strMult),
    dmg = ihp(def.dmg, dmgMult);
  return {
    id, type, shape: def.shape, behavior: def.behavior, color: def.color, r: def.r,
    x, y, facing: 0,
    strMult, dmgMult, hpMax: hp, hp, dmg,
    speed, range: def.range, state: 'approach', atkCd: 0, kb: 0, hitFlash: 0, hitDmg: 0,
    rend: 0, rendT: 0,
    splits: def.splits || 0, mass: def.mass, slow: 1, slowT: 0,
    bornWave: waveN, veteran: false, agedWaves: 0, heat: 0,
  };
}

export function ageSurvivors(state: State, newWaveN: number): void {
  const diff = state.difficultyMult || 1;
  const baseHp = waveHp(newWaveN) * diff, // fresh same-tier HP multiplier this wave
    baseDmg = waveDmg(newWaveN) * diff,
    baseSpd = waveSpeed(newWaveN);
  for (const e of state.enemies) {
    const def = TYPES[e.type];
    const ratio = e.hpMax > 0 ? e.hp / e.hpMax : 1;
    e.strMult = Math.max(e.strMult * 1.1, 1.1 * baseHp);
    e.dmgMult = Math.max((e.dmgMult || e.strMult) * 1.1, 1.1 * baseDmg);
    e.hpMax = ihp(def.hp, e.strMult);
    e.hp = Math.max(1, e.hpMax * ratio);
    e.dmg = ihp(def.dmg, e.dmgMult);
    const freshSpd = def.speed * baseSpd;
    e.speed = Math.max(e.speed * 1.1, 1.1 * freshSpd);
    e.veteran = true;
    e.agedWaves = (e.agedWaves || 0) + 1;
    e.mass *= 1.04; // mass grows 4% per survived wave (resists knockback more over time)
  }
}
