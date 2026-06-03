/* src/sim/waves.ts — wave scheduling & difficulty curves (pure functions of wave number).
   A wave starts every WAVE.interval seconds; its enemies spawn over the first spawnWindow
   seconds. screenCap limits CONCURRENT enemies, so a bigger wave only adds pressure when
   the arena isn't already full. Strength/speed baselines rise with wave number. */
import type { Meta, Rng, State } from '../types';
import { cosmeticBuffMult } from './cosmetics';
import { labTierCoinMult } from './labs';

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
// Economy/XP strength: a GENTLE linear×exponential curve (the legacy "wave strength"). It is NO
// LONGER used for enemy HP/damage — those follow the anchored Tower curves below. It survives only
// as the per-kill XP basis, where a tame, tier-independent value keeps levelling from exploding once
// combat stats run into the tens-of-decillions at high tiers.
export function econStr(n: number): number {
  return (1 + WAVE.strPerWave * (n - 1)) * Math.pow(WAVE.expBase, n - 1);
}
export function waveSpeed(n: number): number {
  return 1 + WAVE.speedPerWave * (n - 1);
}

/* ── Enemy HP / DAMAGE curves (modelled on "The Tower", tower-enemy-stats.netlify.app) ────────────
   A baseline (Tier-1) enemy's HP and damage are read from anchor tables sampled from that game's
   real stat blocks, then GEOMETRICALLY interpolated between anchors (interpGeom) — same method as
   our gold/coin cost curves, so the per-wave gap ramps smoothly instead of leaping. HP and damage
   grow at different rates, so they get SEPARATE curves. Past STAT_CAP_WAVE the published data ends,
   so stats keep climbing at a flat +0.05%/wave (POST_CAP_RATE) — an endless soft wall that
   eventually forces a tier change. A tier is a FLAT multiplier on both HP and damage (also Tower-
   style: tier-2 is ×20 at every wave, tier-3 ×60, …), NOT a wave-number shift. */
const STAT_CAP_WAVE = 10000; // last wave with authored anchors; beyond here, the +0.05%/wave tail
const POST_CAP_RATE = 1.0005; // +0.05% per wave, compounding, above STAT_CAP_WAVE

// Tier-1 melee HP per wave (×TYPES.melee.hp = ×1). Anchored from the reference stat blocks.
const BASE_HP: [number, number][] = [
  [1, 2.35], [100, 4360], [150, 17190], [200, 54840], [250, 142350], [300, 323610],
  [500, 4.53e6], [1000, 7.421e8], [2000, 1.71e12], [5000, 6.1826e20], [10000, 1.121e34],
];
// Tier-1 melee DAMAGE per wave (×TYPES.melee.dmg = ×1). Grows slower than HP.
const BASE_DMG: [number, number][] = [
  [1, 1.18], [100, 402.95], [150, 1100], [200, 2420], [250, 4620], [300, 7740],
  [500, 38940], [1000, 482950], [2000, 1.064e7], [5000, 3.86e9], [10000, 6.63e12],
];
// Geometric piecewise interpolation (mirrors interpTableGeom in skills.ts; kept local to avoid a
// circular import, as labs.ts does with its own `interp`). Clamps below first / above last anchor.
function interpGeom(points: [number, number][], n: number): number {
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (n <= points[i][0]) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i];
      if (x1 === x0) return y1;
      const t = (n - x0) / (x1 - x0);
      return y0 * Math.pow(y1 / y0, t); // all anchors are positive, so geometric is always defined
    }
  }
  return points[points.length - 1][1];
}
function statAt(points: [number, number][], n: number): number {
  if (n <= STAT_CAP_WAVE) return interpGeom(points, n);
  const cap = points[points.length - 1][1]; // value at STAT_CAP_WAVE
  return cap * Math.pow(POST_CAP_RATE, n - STAT_CAP_WAVE);
}
// Baseline (Tier-1) enemy HP / damage multiplier at a real wave number. makeEnemy multiplies the
// per-type base (TYPES[t].hp / .dmg) by this and by the tier multiplier.
export function waveHp(n: number): number {
  return statAt(BASE_HP, Math.max(1, n));
}
export function waveDmg(n: number): number {
  return statAt(BASE_DMG, Math.max(1, n));
}

// Game tiers (distinct from enemy TYPES strength classes). A tier is a FLAT multiplier applied to
// every enemy's HP and damage — shared by both, Tower-style. TIER_MULT[t-1] is that multiplier;
// tier 1 = ×1. Values 1–10 are the reference game's clean tier ratios; 11–21 continue its (much
// steeper) escalation, so high tiers become brutal walls. Cosmetic rewards for tiers 11–21 are
// intentionally left empty (milestoneReward falls through to gems/vials when a tier has no tower).
export const MAX_TIER = 21;
export const TIER_UNLOCK_WAVE = 300; // reach this wave in a tier to unlock the next one
const TIER_MULT: number[] = [
  1, 20, 60, 120, 240, 480, 960, 1920, 5760, 40320,
  2.62e6, 1.57e9, 7.87e11, 2.36e14, 7.08e16, 3.54e18, 1.06e20, 2.66e21, 3.45e24, 4.14e27, 4.97e30,
];
export function tierMult(tier: number): number {
  const t = Math.max(1, Math.min(MAX_TIER, tier || 1));
  return TIER_MULT[t - 1];
}
// Coin reward multiplier per tier: tier 1 is the 1x baseline; each higher tier adds +0.8x.
// (Reward balance for the new tiers is intentionally left for a later pass.)
export function coinMult(tier: number): number {
  return 1 + 0.8 * ((tier || 1) - 1);
}
// Coins banked for a finished (non-first) run, floored at 1. SINGLE SOURCE OF TRUTH: bankRun pays
// this out and the in-run stats panel previews it, so the preview can never drift from the reward.
export function coinsForRun(state: State, tier: number): number {
  const e = state.econ;
  // ×coinMult(tier) for the tier baseline, ×the passive cosmetic coin buff (e.g. Cleric's Sanctum),
  // ×the Tier Coin lab multiplier (+1%/level, up to +20%).
  const cos = cosmeticBuffMult(state.meta, 'coinMult');
  return Math.max(1, Math.round(((state.wave.maxWave || 0) + (e.bonusCoins || 0)) * coinMult(tier) * cos * labTierCoinMult(state.meta)));
}
// Tier 1 is always open; tier N>1 needs TIER_UNLOCK_WAVE reached in the tier below.
export function tierUnlocked(meta: Meta, tier: number): boolean {
  if (tier <= 1) return true;
  const prevBest = (meta && meta.tierBest && meta.tierBest[tier - 1]) || 0;
  return prevBest >= TIER_UNLOCK_WAVE;
}
