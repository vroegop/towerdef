/* src/sim/waves.ts — wave scheduling & difficulty curves (pure functions of wave number).
   A wave starts every WAVE.interval seconds; its enemies spawn over the first spawnWindow
   seconds. screenCap limits CONCURRENT enemies, so a bigger wave only adds pressure when
   the arena isn't already full. Strength/speed baselines rise with wave number. */
import type { Meta, Rng, State } from '../types';
import { cosmeticBuffMult } from './cosmetics';

export const WAVE = {
  interval: 30, // seconds between wave starts
  spawnWindow: 25, // a wave's enemies all spawn within this many seconds of its start
  screenCap: 200, // max concurrent enemies alive (the "screen cap" — stays fixed)
  baseCount: 8, // enemies in wave 1
  perWave: 5, // added per wave...
  maxCount: 140, // ...up to this ceiling (the upgradable "spawn cap")
  strPerWave: 0.08, // +8% baseline strength per wave (the LINEAR term)
  expBase: 1.015, // gentle EXPONENTIAL term blended on top so a "wall" emerges at depth
  speedPerWave: 0.02,
  coinStep: 10, // base coins/kill = ceil(wave / coinStep): +1 coin every this many waves
};

// ── Spawn composition (the one place to tweak who shows up, when, and how many) ────────────────
// A wave is mostly "normal" (melee) bodies, with a capped pool of randomly-typed "specials", and
// at most one boss on every Nth wave. Each special type only joins the pool once its unlock wave is
// reached — UNLESS the run's tier is high enough, where everything unlocks from wave 1. Boss waves
// are kept clean: a single boss leading a column of normals, no specials.
export const SPAWN = {
  normalCap: 120, // max "normal" (melee) bodies in a wave
  specialCap: 20, // max specials (fast/ranged/tank) in a wave, randomly typed among the unlocked ones
  specials: ['tank', 'fast', 'ranged'] as const, // the special pool (splitter is intentionally not spawned)
  unlock: { tank: 10, fast: 100, ranged: 150 } as Record<string, number>, // tier-1 unlock wave per special
  allFromTier: 2, // at this tier and above, every special is available from wave 1
  bossEveryWaves: 10, // a boss wave occurs on multiples of this…
  bossUnlockWave: 10, // …starting at this wave
};

// A boss wave: one boss leads, no specials join it.
export function isBossWave(n: number): boolean {
  return n >= SPAWN.bossUnlockWave && n % SPAWN.bossEveryWaves === 0;
}

// Which special types may spawn at (real) wave n in the given tier.
export function allowedSpecials(n: number, tier: number): string[] {
  const open = (tier || 1) >= SPAWN.allFromTier;
  return SPAWN.specials.filter((t) => open || n >= SPAWN.unlock[t]);
}

// Build the ordered list of enemy types for a wave. Deterministic given the rng + (n, tier, count),
// so it replays identically offline. Caps are hard limits, so the wave never exceeds normalCap +
// specialCap (+1 boss).
export function waveRoster(rng: Rng, n: number, tier: number, count: number): string[] {
  const roster: string[] = [];
  if (count <= 0) return roster;
  if (isBossWave(n)) {
    roster.push('boss'); // the boss leads the column…
    const normals = Math.min(SPAWN.normalCap, count - 1);
    for (let i = 0; i < normals; i++) roster.push('melee'); // …followed by normals, no specials
    return roster;
  }
  const specials = allowedSpecials(n, tier);
  const specialN = specials.length ? Math.min(SPAWN.specialCap, count) : 0;
  const normalN = Math.min(SPAWN.normalCap, count - specialN);
  for (let i = 0; i < normalN; i++) roster.push('melee');
  for (let i = 0; i < specialN; i++) roster.push(specials[(rng.next() * specials.length) | 0]);
  // Deterministic shuffle so specials are sprinkled through the wave instead of clumping at the end.
  for (let i = roster.length - 1; i > 0; i--) {
    const j = (rng.next() * (i + 1)) | 0;
    const tmp = roster[i];
    roster[i] = roster[j];
    roster[j] = tmp;
  }
  return roster;
}

// First-run script: spawn a cluster on a fixed-radius ring so they converge together and a
// no-input 1/1/1/1 hero dies at ~10s (deterministic across seeds). Tuned via headless harness.
export const FIRST_RUN = { count: 10, gap: 0.05, speed: 42, radius: 500 };

export const COIN_DECAY_WAVES = 3; // a survivor older than this many waves...
export const COIN_DECAY_FACTOR = 0.5; // ...pays only this share of its coin value (anti-kite rule)

export function waveCount(n: number): number {
  return Math.min(WAVE.maxCount, WAVE.baseCount + WAVE.perWave * (n - 1));
}
// Strength = linear ramp × gentle exponential. Wave 1 is exactly ×1 (both terms = 1), so the
// scripted first run and early game are unchanged; the exponential only bites at depth, where it
// races the player's compounding (multiplicative) power and creates the wall.
export function waveStr(n: number): number {
  return (1 + WAVE.strPerWave * (n - 1)) * Math.pow(WAVE.expBase, n - 1);
}
export function waveSpeed(n: number): number {
  return 1 + WAVE.speedPerWave * (n - 1);
}

// Game tiers (distinct from enemy TIERS strength classes): each tier doubles the
// *effective* wave number, so tier 2 wave 4 plays like wave 8, tier 3 like wave 16, etc.
export const MAX_TIER = 10;
export const TIER_UNLOCK_WAVE = 300; // reach this wave in a tier to unlock the next one
export function tierDifficulty(tier: number): number {
  return Math.pow(2, (tier || 1) - 1);
}
// Coin reward multiplier per tier: tier 1 is the 1x baseline; each higher tier adds +0.8x.
export function coinMult(tier: number): number {
  return 1 + 0.8 * ((tier || 1) - 1);
}
// Coins banked for a finished (non-first) run, floored at 1. SINGLE SOURCE OF TRUTH: bankRun pays
// this out and the in-run stats panel previews it, so the preview can never drift from the reward.
export function coinsForRun(state: State, tier: number): number {
  const e = state.econ;
  // ×coinMult(tier) for the tier baseline, then ×the passive cosmetic coin buff (e.g. Cleric's Sanctum).
  const cos = cosmeticBuffMult(state.meta, 'coinMult');
  return Math.max(1, Math.round(((state.wave.maxWave || 0) + (e.bonusCoins || 0)) * coinMult(tier) * cos));
}
// Tier 1 is always open; tier N>1 needs TIER_UNLOCK_WAVE reached in the tier below.
export function tierUnlocked(meta: Meta, tier: number): boolean {
  if (tier <= 1) return true;
  const prevBest = (meta && meta.tierBest && meta.tierBest[tier - 1]) || 0;
  return prevBest >= TIER_UNLOCK_WAVE;
}
