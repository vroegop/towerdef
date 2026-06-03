# Plasma Cannon rework — design

**Date:** 2026-06-03
**Status:** Approved

## Background

The Plasma Cannon card's targeting function `currentBoss` (`src/sim/cards-active.ts`)
selected the highest-`hpMax` enemy regardless of type, so it nuked tanks and aged
regular enemies for 30–58% of their max HP — not just bosses. It also fired on a
12s timer and instantly subtracted HP with no projectile, which read as enemies
"randomly losing half their HP" and a boss "spawning with half HP gone" (the
cooldown parks at 0 with no boss, so it fired on the boss's first tick).

## New behavior

### Trigger
- The card no longer fires on a timer. Each tick, for every `type === 'boss'`
  enemy that is alive and whose id is **not** in `run.plasmaDone`, launch one
  plasma projectile from the hero at it and push the id into `run.plasmaDone`.
- Result: exactly one plasma per boss for its entire lifetime; simultaneous
  bosses each get their own plasma; firing **ignores the hero's range gate**.

### Flight
- The plasma **homes**: each tick its velocity is re-aimed at the target boss's
  current position.
- It passes *over* all other enemies — collides with nothing except its target.
- If the target boss dies before impact, the plasma is removed with no effect.
- No `maxDist` expiry; it lives until impact or target death.

### Impact
- On reaching the boss, subtract a **snapshot** of `boss.hpMax × plasmaCanon`
  captured at *fire* time (mirrors the bullet contract — bullets snapshot `dmg`
  at fire so offline catch-up replays identically). Set `hitFlash`, remove the
  projectile.
- **Pure % max-HP**: no rend, no lifesteal, no knockback.

## Data model

- `Projectile` (`src/types.ts`) gains optional fields:
  - `kind?: 'plasma'`
  - `targetId?: number` — boss to home onto
  - `dist0?: number` — initial distance, used only by the renderer for the arc
  - `dmg` is reused for the snapshot damage.
- `Run` (`src/types.ts`) gains `plasmaDone?: number[]` — persisted per-run so
  save/resume and offline replay never re-fire plasma at an already-hit boss.

## Code layout

- **`src/sim/projectiles.ts`**: new `firePlasma(state, hero, boss, frac)`;
  `tickProjectiles` gains a plasma branch (home → arrival check → impact),
  separate from the bullet collision path.
- **`src/sim/cards-active.ts`**: remove the periodic `currentBoss` block,
  `currentBoss`, and `PLASMA_CD`; add the per-boss spawn loop.
- **`src/sim/skills.ts`**: update tooltip (`plasmaCanon` in the tip map) to
  "When a boss appears, hurls a plasma orb at it for −X% max HP (once per boss)."
  Drop `active: { cooldown: 12 }` so the HUD shows no cooldown ring for a
  non-cooldown card (verify the active-card HUD tolerates its absence).

## Visual (render-only, `src/render/canvas2d.ts`)

Purely cosmetic; the sim plasma travels flat in 2D. The renderer fakes height.

- In the projectile draw loop, branch on `kind === 'plasma'`: look up the target
  boss, compute `progress = clamp(1 − distToTarget / dist0)`.
- **Arc:** lift the orb on screen by `sin(progress·π) × arcHeight` (rises then
  descends) and scale its radius by the same factor, so it reads as rising toward
  the viewer and dropping onto the boss — "thrown over the crowd" from top-down.
- **Style:** cyan (`#37d7ff`) orb with a glow (`shadowBlur`) and a short trail.

## Testing

- Plasma deals the correct % once per boss; never twice (assert via `plasmaDone`).
- Multiple simultaneous bosses each take exactly one plasma.
- Target dies mid-flight → projectile removed, no errant damage.
- Determinism: same seed + same inputs ⇒ identical plasma damage and positions
  across a re-run / offline catch-up.
