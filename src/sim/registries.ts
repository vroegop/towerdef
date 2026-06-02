/* src/sim/registries.ts — the enemy TYPE table. Add a row here and the whole game adapts.
   Each type = shape + behavior + colour + base numbers + mass. Enemies have a single mode now
   (no strength tiers); difficulty comes purely from the per-wave strength curve in waves.ts. */
import type { EnemyTypeDef } from '../types';

// Integer base stats to match the literal hero model. hp/dmg are multiplied by the per-wave
// strength curve, then rounded (min 1). mass resists knockback (all start at 1).
// Stats are RELATIVE to the basic "melee" enemy (hp 1, speed 46). Per the enemy spec the per-type
// multipliers are baked straight into these base numbers so makeEnemy only applies the wave curve:
//   fast  = 2× speed,            coin 2   (92 = 46×2)
//   ranged= shoots from range,   coin 2
//   tank  = 0.5× speed, 5× hp,   coin 4   (23 = 46×0.5, hp 5 = 1×5)
//   boss  = 0.4× speed, 20× hp,  coin 5   (18.4 = 46×0.4, hp 20 = 1×20); spawns ~every 10 waves
//   split = 2× hp,               coin 4   (halves 4 generations on death — see core._cleanup)
//   melee = baseline,            coin 1
// Radius drives the body for rendering AND for sim collision, hero-contact distance, and the bullet
// hit window (e.r + bullet.r) — so a foe's hitbox always matches the size it draws at. Per-category
// body-size bump over the original baseline: most enemies ×1.25, tanks ×2, bosses ×3.
// Speeds are expressed relative to the "normal" (melee) baseline of 46 px/s:
//   normal ×1 = 46 · fast ×2 = 92 · ranged ×1 = 46 · tank ×0.5 = 23 · boss ×0.4 = 18.4
export const TYPES: Record<string, EnemyTypeDef> = {
  melee: { shape: 'square', behavior: 'stick', color: '#ff6b6b', hp: 1, dmg: 1, speed: 46, range: 0, r: 4.125, mass: 1, coinValue: 1 },
  ranged: { shape: 'triangle', behavior: 'bounce', color: '#4aa8ff', hp: 1, dmg: 1, speed: 46, range: 150, r: 4.125, mass: 1, coinValue: 2 },
  boss: { shape: 'hexagon', behavior: 'stick', color: '#e64cff', hp: 20, dmg: 3, speed: 18.4, range: 0, r: 19.8, mass: 1, coinValue: 5 },
  fast: { shape: 'diamond', behavior: 'stick', color: '#37d7ff', hp: 1, dmg: 0.6, speed: 92, range: 0, r: 3.375, mass: 1, coinValue: 2 }, // swarm → attack speed / multishot
  tank: { shape: 'square', behavior: 'stick', color: '#ffb3d1', hp: 5, dmg: 1.6, speed: 23, range: 0, r: 10.2, mass: 1, coinValue: 4 }, // wall → raw damage / amp
  splitter: { shape: 'pentagon', behavior: 'stick', color: '#ff8a33', hp: 2, dmg: 1, speed: 40, range: 0, r: 4.875, mass: 1, splits: 4, coinValue: 4 }, // → AoE (not spawned by waves; kept for the split mechanic)
};
