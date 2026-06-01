/* src/sim/enemies.ts — spawning, per-enemy stats, and the HYBRID aging rule.
   Aging (chosen design): when a new wave starts, every survivor becomes
   max(its own value × 1.1, 1.1 × a fresh same-type enemy this wave) for BOTH
   strength and speed. So survivors compound while never dropping below 1.1× the
   current baseline — hoarding a ball of enemies becomes lethal over time. */
import type { Arena, Enemy, Rng, State } from '../types';
import { TYPES } from './registries';
import { waveSpeed, waveStr } from './waves';

// Archetypes are introduced as the (effective) wave climbs, so early waves stay simple.
export function pickType(rng: Rng, n: number): string {
  if (n % 10 === 0 && rng.next() < 0.2) return 'boss';
  const r = rng.next();
  if (n >= 8 && r < 0.1) return 'fast';
  if (n >= 12 && r < 0.18) return 'tank';
  if (n >= 16 && r < 0.25) return 'splitter';
  return rng.next() < 0.55 ? 'melee' : 'ranged';
}

const ihp = (base: number, mult: number): number => Math.max(1, Math.round(base * mult));

export function makeEnemy(id: number, type: string, waveN: number, rng: Rng, arena: Arena, cx = arena.w / 2, cy = arena.h / 2): Enemy {
  const def = TYPES[type];
  const strMult = waveStr(waveN);
  const speed = def.speed * waveSpeed(waveN);
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
    dmg = ihp(def.dmg, strMult);
  return {
    id, type, shape: def.shape, behavior: def.behavior, color: def.color, r: def.r,
    x, y, facing: 0,
    strMult, hpMax: hp, hp, dmg,
    speed, range: def.range, state: 'approach', atkCd: 0, kb: 0, hitFlash: 0, hitDmg: 0,
    rend: 0, rendT: 0,
    splits: def.splits || 0, mass: def.mass, slow: 1, slowT: 0,
    bornWave: waveN, veteran: false, agedWaves: 0, heat: 0,
  };
}

export function ageSurvivors(state: State, newWaveN: number): void {
  const baseStr = waveStr(newWaveN),
    baseSpd = waveSpeed(newWaveN);
  for (const e of state.enemies) {
    const def = TYPES[e.type];
    const ratio = e.hpMax > 0 ? e.hp / e.hpMax : 1;
    const freshStr = baseStr;
    e.strMult = Math.max(e.strMult * 1.1, 1.1 * freshStr);
    e.hpMax = ihp(def.hp, e.strMult);
    e.hp = Math.max(1, e.hpMax * ratio);
    e.dmg = ihp(def.dmg, e.strMult);
    const freshSpd = def.speed * baseSpd;
    e.speed = Math.max(e.speed * 1.1, 1.1 * freshSpd);
    e.veteran = true;
    e.agedWaves = (e.agedWaves || 0) + 1;
    e.mass *= 1.04; // mass grows 4% per survived wave (resists knockback more over time)
  }
}
