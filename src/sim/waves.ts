/* src/sim/waves.ts — wave scheduling & difficulty curves (pure functions of wave number).
   A wave starts every WAVE.interval seconds. Spawning is CONTINUOUS TOP-UP: enemies are
   released at spawnRate(n) per second whenever fewer than concurrentCap(n) are alive, so a
   kill immediately makes room for the next spawn. The final WAVE.lull seconds of each wave
   are a no-spawn breather (shortened by the Overrun card). Strength/speed baselines rise
   with wave number. */
import type { Meta, Rng, State } from '../types';
import { cosmeticBuffMult } from './cosmetics';
import { labTierCoinMult } from './labs';

export const WAVE = {
  interval: 30, // seconds between wave starts
  lull: 5, // no-spawn breather at the END of each wave (shrunk by the Overrun card)
  lullFloor: 0.5, // the lull can never drop below this, even with a maxed Overrun card
  baseCount: 8, // concurrent-alive cap at wave 1
  perWave: 5, // added to the alive cap per wave...
  maxCount: 140, // ...up to this ceiling (the hard concurrent "screen cap")
  strPerWave: 0.08, // +8% baseline strength per wave (the LINEAR term)
  expBase: 1.015, // gentle EXPONENTIAL term blended on top so a "wall" emerges at depth
  speedPerWave: 0.0029, // linear ramp tuned so enemies reach the cap (×30) right around wave 10k: 1 + 0.0029·(n-1)
  speedCap: 30, // enemy wave-speed multiplier saturates here, so deep waves can't run away to infinity
  coinStep: 10, // base coins/kill = ceil(wave / coinStep): +1 coin every this many waves
};

// ── Spawn composition (the one place to tweak who shows up and in what mix) ─────────────────────
// Each spawn is rolled independently (continuous top-up has no fixed roster): SPECIAL_FRAC of
// bodies are randomly-typed "specials", the rest are "normal" melee. SPECIAL_FRAC = 1/7 preserves
// the legacy 120:20 normals:specials ratio. Each special type only joins the pool once its unlock
// wave is reached — UNLESS the run's tier is high enough, where everything unlocks from wave 1.
// A boss wave spawns exactly ONE boss (see core's bossSpawned flag); specials still join it.
export const SPAWN = {
  specialFrac: 1 / 7, // per-spawn chance a body is a special (≈ legacy 20/140 ratio)
  specials: ['tank', 'fast', 'ranged'] as const, // the special pool (splitter is intentionally not spawned)
  unlock: { tank: 10, fast: 100, ranged: 150 } as Record<string, number>, // tier-1 unlock wave per special
  allFromTier: 2, // at this tier and above, every special is available from wave 1
  bossEveryWaves: 10, // a boss wave occurs on multiples of this…
  bossUnlockWave: 10, // …starting at this wave
};

// A boss wave carries exactly one boss (force-spawned first); normals + specials fill the rest.
export function isBossWave(n: number): boolean {
  return n >= SPAWN.bossUnlockWave && n % SPAWN.bossEveryWaves === 0;
}

// Which special types may spawn at (real) wave n in the given tier.
export function allowedSpecials(n: number, tier: number): string[] {
  const open = (tier || 1) >= SPAWN.allFromTier;
  return SPAWN.specials.filter((t) => open || n >= SPAWN.unlock[t]);
}

// Roll ONE enemy's type. Deterministic and replay-safe via a FIXED rng-draw protocol:
//   • bossPending → 'boss', consuming ZERO rng draws (the boss bypasses the normal roll).
//   • otherwise   → draw EXACTLY ONE rng for the normal-vs-special decision; if it lands on
//     "special" AND at least one special is unlocked, draw EXACTLY ONE more to pick the type.
//     A "special" roll with nothing unlocked falls back to melee and does NOT take the 2nd draw.
// Draw count is fully determined by (bossPending, first-draw outcome, specials-unlocked), all of
// which are deterministic — so the spawn stream is reconstructable live vs. offline catch-up.
export function rollEnemyType(rng: Rng, n: number, tier: number, bossPending: boolean): string {
  if (bossPending) return 'boss';
  if (rng.next() >= SPAWN.specialFrac) return 'melee';
  const specials = allowedSpecials(n, tier);
  if (!specials.length) return 'melee';
  return specials[(rng.next() * specials.length) | 0];
}

// First-run script: spawn a cluster on a fixed-radius ring so they converge together and a
// no-input 1/1/1/1 hero dies at ~10s (deterministic across seeds). Tuned via headless harness.
export const FIRST_RUN = { count: 10, gap: 0.05, speed: 42, radius: 500 };

export const COIN_DECAY_WAVES = 3; // a survivor older than this many waves...
export const COIN_DECAY_FACTOR = 0.5; // ...pays only this share of its coin value (anti-kite rule)

// Max enemies ALIVE at once at wave n. Keeps the gentle early ramp (8 at wave 1, +5/wave) up to
// the hard 140 cap (reached at wave 28). Continuous top-up refills toward this as enemies die.
export function concurrentCap(n: number): number {
  return Math.min(WAVE.maxCount, WAVE.baseCount + WAVE.perWave * (n - 1));
}

// Max enemies SPAWNED per second at wave n — the income/pressure throttle. A one-shotting player
// earns exactly this many kills/sec (the anti-farm bound); a struggling player fills to the alive
// cap and spawning self-throttles to their kill rate. Step ladder keyed on the real wave number.
export function spawnRate(n: number): number {
  if (n <= 100) return 5;
  if (n <= 500) return 6;
  if (n <= 1000) return 7;
  if (n <= 2000) return 9;
  if (n <= 5000) return 12;
  if (n <= 10000) return 20;
  return 25;
}

// Length of the end-of-wave no-spawn breather, given the Overrun card's accumulated `reduce`
// seconds (stats.lullReduce, 0 when the card isn't active). Floored at WAVE.lullFloor.
export function lullDuration(reduce: number): number {
  return Math.max(WAVE.lullFloor, WAVE.lull - (reduce || 0));
}
// Economy/XP strength: a GENTLE linear×exponential curve (the legacy "wave strength"). It is NO
// LONGER used for enemy HP/damage — those follow the anchored Tower curves below. It survives only
// as the per-kill XP basis, where a tame, tier-independent value keeps levelling from exploding once
// combat stats run into the tens-of-decillions at high tiers.
export function econStr(n: number): number {
  return (1 + WAVE.strPerWave * (n - 1)) * Math.pow(WAVE.expBase, n - 1);
}
export function waveSpeed(n: number): number {
  return Math.min(1 + WAVE.speedPerWave * (n - 1), WAVE.speedCap);
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
