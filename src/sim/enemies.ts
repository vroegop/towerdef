/* src/sim/enemies.ts — spawning, per-enemy stats, and the HYBRID aging rule.
   Aging (chosen design): when a new wave starts, every survivor becomes
   max(its own value × 1.1, 1.1 × a fresh same-type enemy this wave) for BOTH
   strength and speed. So survivors compound while never dropping below 1.1× the
   current baseline — hoarding a ball of enemies becomes lethal over time. */
import type { Arena, Enemy, Rng, State } from '../types';
import { TYPES } from './registries';
import { SPAWN, allowedSpecials, isBossWave, concurrentCap, waveSpeed, waveHp, waveDmg } from './waves';

// Expected per-type share of spawns at (real) wave n in `tier`, for the HUD enemy panel. Mirrors
// rollEnemyType's per-spawn distribution: SPECIAL_FRAC of bodies are specials (split evenly among
// the unlocked ones), the rest melee. On a boss wave the single boss is folded in as 1/size of a
// representative wave (concurrentCap(n)), with the body mix — specials included — filling the rest.
export function spawnChances(n: number, tier: number): Record<string, number> {
  const out: Record<string, number> = {};
  const size = Math.max(1, concurrentCap(n)); // representative wave size for the HUD estimate
  let bodyFrac = 1;
  if (isBossWave(n)) {
    out.boss = 1 / size;
    bodyFrac = 1 - 1 / size;
  }
  const specials = allowedSpecials(n, tier);
  const specialFrac = specials.length ? SPAWN.specialFrac : 0;
  out.melee = bodyFrac * (1 - specialFrac);
  for (const t of specials) out[t] = (bodyFrac * specialFrac) / specials.length;
  return out;
}

const ihp = (base: number, mult: number): number => Math.max(1, Math.round(base * mult));

// `diff` is the tier's flat HP/damage multiplier (state.difficultyMult = tierMult(tier)); 1 = tier 1.
// HP and damage follow SEPARATE wave curves, each ×diff. strMult/dmgMult are the resolved per-enemy
// multipliers, kept on the enemy so ageSurvivors can compound them independently.
export function makeEnemy(id: number, type: string, waveN: number, rng: Rng, arena: Arena, cx = arena.w / 2, cy = arena.h / 2, diff = 1, spawnR = arena.w * 0.35, hpSkip = 0, dmgSkip = 0): Enemy {
  const def = TYPES[type];
  // Skip Enemy Health/Attack utilities: treat the enemy as `skip` waves lower for that stat (HP and
  // attack scale off the wave number), so accumulated skips keep enemies softer for the rest of the run.
  const strMult = waveHp(Math.max(1, waveN - (hpSkip || 0))) * diff, // HP multiplier (also the "strength" proxy for splits)
    dmgMult = waveDmg(Math.max(1, waveN - (dmgSkip || 0))) * diff; // damage multiplier (grows slower than HP)
  const speed = def.speed * waveSpeed(waveN); // tier does NOT change speed (Tower-style)
  // Spawn on a CIRCLE of radius `spawnR` (default 1.4× tower range, passed by the sim) around the
  // stationary hero at (cx, cy), at a uniformly random angle. The old rectangular arena-box edge
  // spawn is gone — the arena field is now vestigial and read by nothing for placement. Fog of war
  // (render-only) hides this ring: enemies spawn beyond the 1.2× vision edge and fade in as they near.
  const a = rng.next() * Math.PI * 2;
  const x = cx + Math.cos(a) * spawnR,
    y = cy + Math.sin(a) * spawnR;
  const hp = ihp(def.hp, strMult),
    dmg = ihp(def.dmg, dmgMult);
  // The HP/damage gained by being THIS wave rather than the one before (the single-wave step), so
  // Chrono Field can "de-level" the enemy by subtracting it. Never negative.
  const prevHp = ihp(def.hp, waveHp(Math.max(1, waveN - 1 - (hpSkip || 0))) * diff),
    prevDmg = ihp(def.dmg, waveDmg(Math.max(1, waveN - 1 - (dmgSkip || 0))) * diff);
  return {
    id, type, shape: def.shape, behavior: def.behavior, color: def.color, r: def.r,
    x, y, facing: 0,
    strMult, dmgMult, hpMax: hp, hp, dmg,
    speed, range: def.range, state: 'approach', atkCd: 0, kb: 0, hitFlash: 0, hitDmg: 0,
    rend: 0, rendT: 0,
    splits: def.splits || 0, mass: def.mass, slow: 1, slowT: 0, poison: 0, poisonT: 0, stunT: 0,
    hpStep: Math.max(0, hp - prevHp), dmgStep: Math.max(0, dmg - prevDmg),
    bornWave: waveN, veteran: false, agedWaves: 0, heat: 0,
  };
}

export function ageSurvivors(state: State, newWaveN: number): void {
  const diff = state.difficultyMult || 1;
  // Survivors track the same enemy-skip discount as fresh spawns (see makeEnemy).
  const hpSkip = (state.run && state.run.hpSkip) || 0,
    dmgSkip = (state.run && state.run.dmgSkip) || 0;
  const baseHp = waveHp(Math.max(1, newWaveN - hpSkip)) * diff, // fresh same-tier HP multiplier this wave
    baseDmg = waveDmg(Math.max(1, newWaveN - dmgSkip)) * diff,
    baseSpd = waveSpeed(newWaveN);
  for (const e of state.enemies) {
    const def = TYPES[e.type];
    const ratio = e.hpMax > 0 ? e.hp / e.hpMax : 1;
    const oldHpMax = e.hpMax,
      oldDmg = e.dmg;
    e.strMult = Math.max(e.strMult * 1.1, 1.1 * baseHp);
    e.dmgMult = Math.max((e.dmgMult || e.strMult) * 1.1, 1.1 * baseDmg);
    e.hpMax = ihp(def.hp, e.strMult);
    e.hp = Math.max(1, e.hpMax * ratio);
    e.dmg = ihp(def.dmg, e.dmgMult);
    // record this wave's HP/damage step for Chrono's de-level (the gain from aging up one wave)
    e.hpStep = Math.max(0, e.hpMax - oldHpMax);
    e.dmgStep = Math.max(0, e.dmg - oldDmg);
    const freshSpd = def.speed * baseSpd;
    e.speed = Math.max(e.speed * 1.1, 1.1 * freshSpd);
    e.veteran = true;
    e.agedWaves = (e.agedWaves || 0) + 1;
    e.mass *= 1.04; // mass grows 4% per survived wave (resists knockback more over time)
  }
}
