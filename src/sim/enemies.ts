/* src/sim/enemies.ts — spawning, per-enemy stats, and the HYBRID aging rule.
   Aging (chosen design): when a new wave starts, every survivor becomes
   max(its own value × 1.1, 1.1 × a fresh same-tier enemy this wave) for BOTH
   strength and speed. So survivors compound while never dropping below 1.1× the
   current baseline — hoarding a ball of enemies becomes lethal over time. */
import type { Arena, Enemy, Rng, State } from '../types';
import { TIERS, TYPES } from './registries';
import { waveSpeed, waveStr } from './waves';

// Archetypes are introduced as the (effective) wave climbs, so early waves stay simple.
export function pickType(rng: Rng, n: number): string {
  if (n % 10 === 0 && rng.next() < 0.2) return 'boss';
  const r = rng.next();
  if (n >= 8 && r < 0.1) return 'fast';
  if (n >= 12 && r < 0.18) return 'tank';
  if (n >= 16 && r < 0.25) return 'splitter';
  if (n >= 22 && r < 0.31) return 'vampire';
  if (n >= 28 && r < 0.36) return 'protector';
  return rng.next() < 0.55 ? 'melee' : 'ranged';
}

export function pickTier(rng: Rng, n: number): string {
  const r = rng.next();
  if (r < Math.min(0.15, 0.015 * n)) return 'elite';
  if (r < Math.min(0.45, 0.05 + 0.03 * n)) return 'hard';
  if (r < 0.9) return 'average';
  return 'weak';
}

const ihp = (base: number, mult: number): number => Math.max(1, Math.round(base * mult));

export function makeEnemy(id: number, type: string, tier: string, waveN: number, rng: Rng, arena: Arena): Enemy {
  const def = TYPES[type],
    tg = TIERS[tier];
  const strMult = waveStr(waveN) * tg.stat;
  const speed = def.speed * waveSpeed(waveN);
  const m = 30;
  let x: number, y: number;
  const edge = (rng.next() * 4) | 0;
  if (edge === 0) {
    x = rng.next() * arena.w;
    y = -m;
  } else if (edge === 1) {
    x = arena.w + m;
    y = rng.next() * arena.h;
  } else if (edge === 2) {
    x = rng.next() * arena.w;
    y = arena.h + m;
  } else {
    x = -m;
    y = rng.next() * arena.h;
  }
  const hp = ihp(def.hp, strMult),
    dmg = ihp(def.dmg, strMult);
  return {
    id, type, tier, shape: def.shape, behavior: def.behavior, r: def.r,
    x, y, facing: 0,
    strMult, hpMax: hp, hp, dmg,
    speed, range: def.range, state: 'approach', atkCd: 0, kb: 0, hitFlash: 0, hitDmg: 0,
    rend: 0, rendT: 0,
    splits: def.splits || 0, vamp: def.vamp || 0, aura: def.aura || 0, auraR: def.auraR || 0, shielded: 0,
    bornWave: waveN, veteran: false, agedWaves: 0,
  };
}

export function ageSurvivors(state: State, newWaveN: number): void {
  const baseStr = waveStr(newWaveN),
    baseSpd = waveSpeed(newWaveN);
  for (const e of state.enemies) {
    const def = TYPES[e.type],
      tg = TIERS[e.tier];
    const ratio = e.hpMax > 0 ? e.hp / e.hpMax : 1;
    const freshStr = baseStr * tg.stat;
    e.strMult = Math.max(e.strMult * 1.1, 1.1 * freshStr);
    e.hpMax = ihp(def.hp, e.strMult);
    e.hp = Math.max(1, e.hpMax * ratio);
    e.dmg = ihp(def.dmg, e.strMult);
    const freshSpd = def.speed * baseSpd;
    e.speed = Math.max(e.speed * 1.1, 1.1 * freshSpd);
    e.veteran = true;
    e.agedWaves = (e.agedWaves || 0) + 1;
  }
}
