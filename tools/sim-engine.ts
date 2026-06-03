/* tools/sim-engine.ts — reusable, deterministic PLAYER-LIFE progression engine.
 *
 * Pure + DOM-free, so it runs identically in vite-node (the CLI: progress-sim.ts) and in a Web Worker
 * (the dashboard). It drives the REAL game systems (sim, economy, upgrades, labs, cards, milestones,
 * check-ins) the way a player would, at fast-forward, and reports how long progression takes and
 * where a player caps out per tier.
 *
 * It imports the live registries (UPGRADES / LABS / CARDS), so new offence/defence/utility content is
 * considered automatically. A `Profile` is the player's brain (spend weights, per-skill boosts, lab
 * priority, schedule, and an optional per-tier "grind until wave X before advancing" policy). The
 * engine reports via `onProgress`; the caller throttles/renders.
 *
 * Determinism: same Profile (same `seed`) → identical result. There is NO Date.now / Math.random in
 * this module — time is a virtual clock and card draws use a seeded RNG. */

import { createState } from '../src/sim/state';
import { Sim } from '../src/sim/core';
import { makeRng } from '../src/sim/rng';
import { coinsForRun, MAX_TIER, TIER_UNLOCK_WAVE } from '../src/sim/waves';
import {
  UPGRADES, buyPerm, permCost, permAtMax, isUnlocked, SKILL_GROUPS, isGroupUnlocked, unlockGroup,
  buyRunUpgrade, runUpgradeCost, runAtMax, buyCard, buyCardCost, buyCardSlot, cardSlotCost,
  setActiveCard, activeCardIds, MAX_CARD_SLOTS, FIRST_PERM_COST, claimAllMilestones, bigGroup, bigSuffix,
} from '../src/sim/skills';
import {
  migrateMeta, LABS, labUnlocked, labAtMax, labCoinCost, startResearch, reconcileResearch,
  freeSlots, buyLabSlot, MAX_SLOTS, claimCheckIn, gameSpeed, setGameSpeed, availableSpeeds, labLevel,
} from '../src/sim/labs';
import type { Meta, State } from '../src/types';

export type Cat = 'attack' | 'defense' | 'economic';

// A player profile: how they spend, how much they play, and when they choose to advance tiers.
export interface Profile {
  name: string;
  sessionsPerDay: number; // active sessions/day...
  sessionMinutes: number; // ...of this many real minutes (rest of the day is offline)
  weights: Record<Cat, number>; // relative spend across categories
  skillBoosts?: Record<string, number>; // per-skill multiplier ON TOP of its category weight (e.g. { health: 4 })
  unlockBudgetFrac: number; // unlock the next skill group once cost <= this fraction of coins
  maxLabSlots: number; // concurrent lab slots the player buys with gems (1..MAX_SLOTS)
  maxCardSlots: number; // active card slots bought with gems (1..MAX_CARD_SLOTS)
  labPriority: string[]; // research order (unknown labs appended automatically)
  // Tier-advance policy. Undefined → "max out": advance only when the tier caps out (plateaus). A
  // number → "grind to wave N before advancing" (clamped to the unlock minimum). Per-tier overrides
  // win over the global value. If the player plateaus below their target, that's the WALL.
  advanceAtWave?: number;
  advanceAtWaveByTier?: Record<number, number>;
  seed: number;
}

// Simulation bounds / cap-detection tuning (rarely changed per-profile).
export interface EngineBounds {
  maxDays: number; maxRunsPerTier: number; capPlateauRuns: number;
  capPlateauEps: number; powerGrowEps: number; maxRunWave: number; maxRunSimSeconds: number;
}
export const DEFAULT_BOUNDS: EngineBounds = {
  maxDays: 1500, maxRunsPerTier: 400, capPlateauRuns: 12, capPlateauEps: 0.005, powerGrowEps: 0.01,
  // Real caps up to wave 10000: a run is only cut if the hero survives all the way to 10000 (then the
  // cap shows e.g. "10000+"). Otherwise it ends at the true death wall. The sim-time guard is set just
  // past 10000 waves (30s each) so WAVE is the binding limit; runs that die early stay cheap.
  maxRunWave: 10000, maxRunSimSeconds: 10000 * 30 + 60,
};

export interface TierRow {
  tier: number; reachedDay: number; capWave: number; runs: number; daysInTier: number;
  coins: number; gems: number; vials: number; permA: number; permD: number; permE: number;
  labLv: number; cards: number; speed: number; advanced: boolean; guard: boolean;
}
export interface ProgressEvent {
  kind: 'progress' | 'tier' | 'done';
  day: number; tier: number; curWave: number; tierBest: number; totalRuns: number;
  coins: number; gems: number; vials: number; speed: number; rows: TierRow[];
}
export interface RunResult { rows: TierRow[]; days: number; finalTier: number; }

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DT = 1 / 30; // sim timestep (matches offline.ts)
const START_MS = 1_700_000_000_000; // fixed virtual epoch (deterministic)

const CAT_OF: Record<string, Cat> = {};
for (const u of UPGRADES) CAT_OF[u.id] = u.tab as Cat;
const ALL_IDS = UPGRADES.map((u) => u.id);

// Compact "K/M/B/T/q/Q…" formatter (shared with the game's notation), handy for both CLI and UI.
export function fmtBig(n: number): string {
  if (!isFinite(n)) return '∞';
  if (Math.abs(n) < 1000) return String(Math.round(n));
  const { m, group } = bigGroup(n);
  return m.toFixed(2) + bigSuffix(group);
}

// Coarse power proxy: perm levels + lab levels + card stars. Distinguishes a true wall (power AND
// wave stalled) from the slow early grind (power still climbing).
const powerProxy = (meta: Meta): number =>
  ALL_IDS.reduce((s, id) => s + ((meta.perm && meta.perm[id]) || 0), 0) +
  LABS.reduce((s, l) => s + labLevel(meta, l.id), 0) +
  (meta.cards || []).reduce((s, c) => s + (c.stars || 0), 0);
const permSum = (meta: Meta, cat: Cat): number =>
  UPGRADES.filter((u) => u.tab === cat).reduce((s, u) => s + ((meta.perm && meta.perm[u.id]) || 0), 0);
const labSum = (meta: Meta): number => LABS.reduce((s, l) => s + labLevel(meta, l.id), 0);

function freshMeta(nowMs: number): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: false, bestWave: 0, claimedMilestones: {},
    tier: 1, tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [],
    totalWaves: 0, labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: nowMs, ver: 0,
  } as unknown as Meta);
}

// Weighted greedy buy: among affordable, not-maxed, unlocked ids, buy the lowest cost ÷ weight, where
// weight = category weight × any per-skill boost. Repeats until nothing is affordable.
function greedySpend(
  weightOf: (id: string) => number,
  balance: () => number, costOf: (id: string) => number,
  atMax: (id: string) => boolean, unlocked: (id: string) => boolean, buy: (id: string) => boolean,
): void {
  for (;;) {
    let best: string | null = null;
    let bestScore = Infinity;
    const bal = balance();
    for (const id of ALL_IDS) {
      if (!unlocked(id) || atMax(id)) continue;
      const c = costOf(id);
      if (c > bal) continue;
      const score = c / weightOf(id);
      if (score < bestScore) { bestScore = score; best = id; }
    }
    if (!best || !buy(best)) break;
  }
}

export function runProgression(opts: {
  profile: Profile;
  bounds?: Partial<EngineBounds>;
  onProgress?: (e: ProgressEvent) => void;
}): RunResult {
  const p = opts.profile;
  const B: EngineBounds = { ...DEFAULT_BOUNDS, ...(opts.bounds || {}) };
  const cardRng = makeRng((p.seed ^ 0x5f3759df) >>> 0);
  const weightOf = (id: string): number =>
    (p.weights[CAT_OF[id]] || 0.1) * ((p.skillBoosts && p.skillBoosts[id]) || 1);
  const labOrder = [...p.labPriority, ...LABS.map((l) => l.id).filter((id) => !p.labPriority.includes(id))];

  let clock = START_MS;
  const meta = freshMeta(clock);
  const activeSecPerDay = p.sessionsPerDay * p.sessionMinutes * 60;
  let activeToday = 0;

  const passTime = (nowMs: number): void => { reconcileResearch(meta, nowMs); claimCheckIn(meta, nowMs); };

  const equipCards = (): void => {
    const active = new Set(activeCardIds(meta));
    const pool = (meta.cards || []).filter((c) => !active.has(c.id)).sort((a, b) => (b.stars || 0) - (a.stars || 0));
    for (let slot = 0; slot < (meta.cardSlots || 1); slot++) {
      if ((meta.activeCards || [])[slot]) continue;
      const next = pool.shift();
      if (!next) break;
      setActiveCard(meta, slot, next.id);
    }
  };
  const spendMeta = (nowMs: number): void => {
    for (let pass = 0; pass < SKILL_GROUPS.length; pass++) {
      let did = false;
      for (const g of SKILL_GROUPS) {
        if (isGroupUnlocked(meta, g.id)) continue;
        if (g.cost <= (meta.coins || 0) * p.unlockBudgetFrac && unlockGroup(meta, g.id)) did = true;
      }
      if (!did) break;
    }
    greedySpend(weightOf, () => meta.coins || 0, (id) => permCost(meta, id),
      (id) => permAtMax(meta, id), (id) => isUnlocked(meta, id), (id) => buyPerm(meta, id));
    while ((meta.labSlots || 1) < Math.min(p.maxLabSlots, MAX_SLOTS) && buyLabSlot(meta)) { /* */ }
    while ((meta.cardSlots || 1) < Math.min(p.maxCardSlots, MAX_CARD_SLOTS) && (meta.gems || 0) >= cardSlotCost(meta) && buyCardSlot(meta)) { /* */ }
    let guard = 0;
    while ((meta.gems || 0) >= buyCardCost(meta) && guard++ < 500) { if (!buyCard(meta, () => cardRng.next())) break; }
    equipCards();
    setGameSpeed(meta, Math.max(...availableSpeeds(meta)));
    while (freeSlots(meta) > 0) {
      const pick = labOrder.find((id) => labUnlocked(meta, id) && !labAtMax(meta, id) &&
        !(meta.research || []).some((r) => r.id === id) && labCoinCost(meta, id) <= (meta.coins || 0));
      if (!pick || !startResearch(meta, pick, nowMs)) break;
    }
  };

  // One run, played actively to the hero's death (power-determined wall), spending gold each wave.
  const playRun = (seed: number): { wave: number; simSec: number; state: State; guard: boolean } => {
    const isFirst = !meta.hasPlayed;
    const state = createState(seed >>> 0, meta, isFirst);
    const sim = new Sim(state);
    const spendGold = (): void => greedySpend(weightOf, () => state.econ.gold || 0,
      (id) => runUpgradeCost(state, id), (id) => runAtMax(state, id),
      (id) => isUnlocked(meta, id), (id) => buyRunUpgrade(state, id, sim.rng));
    let lastWave = state.wave.n;
    let t = 0;
    spendGold(); sim.refreshStats();
    while (state.alive && t < B.maxRunSimSeconds && (state.wave.n || 0) < B.maxRunWave) {
      sim.step(DT); t += DT;
      if (state.wave.n !== lastWave) { lastWave = state.wave.n; spendGold(); sim.refreshStats(); }
    }
    return { wave: state.wave.maxWave || state.wave.n || 0, simSec: t, state, guard: state.alive };
  };
  const bankRun = (state: State): void => {
    const wave = state.wave.maxWave || state.wave.n || 0;
    const coins = !meta.hasPlayed ? FIRST_PERM_COST : coinsForRun(state, meta.tier || 1);
    meta.coins = (meta.coins || 0) + coins;
    meta.bestWave = Math.max(meta.bestWave || 0, wave);
    meta.tierBest = meta.tierBest || {};
    const t = meta.tier || 1;
    meta.tierBest[t] = Math.max(meta.tierBest[t] || 0, wave);
    meta.totalWaves = (meta.totalWaves || 0) + wave;
    meta.hasPlayed = true;
  };

  const rows: TierRow[] = [];
  let runIdx = 0;
  let tier = 1;
  let tierStartClock = clock;
  let tierRuns = 0;
  let tierBest = 0;
  let tierGuard = false;
  let plateau = 0;
  let lastPow = powerProxy(meta);

  const targetFor = (t: number): number | undefined => {
    const raw = (p.advanceAtWaveByTier && p.advanceAtWaveByTier[t]) ?? p.advanceAtWave;
    return raw == null ? undefined : Math.max(TIER_UNLOCK_WAVE, raw);
  };
  // Record the current tier's row and either advance (reset for the next tier) or signal the wall.
  const finishTier = (advanced: boolean): boolean => {
    rows.push({
      tier, reachedDay: (tierStartClock - START_MS) / DAY, capWave: tierBest, runs: tierRuns,
      daysInTier: (clock - tierStartClock) / DAY, coins: meta.coins || 0, gems: meta.gems || 0,
      vials: meta.vials || 0, permA: permSum(meta, 'attack'), permD: permSum(meta, 'defense'),
      permE: permSum(meta, 'economic'), labLv: labSum(meta), cards: (meta.cards || []).length,
      speed: gameSpeed(meta), advanced, guard: tierGuard,
    });
    emit('tier');
    if (!advanced) return false;
    tier++; meta.tier = tier; tierStartClock = clock; tierRuns = 0; tierBest = 0; tierGuard = false; plateau = 0;
    return true;
  };
  const emit = (kind: ProgressEvent['kind']): void => {
    opts.onProgress && opts.onProgress({
      kind, day: (clock - START_MS) / DAY, tier, curWave: tierBest, tierBest, totalRuns: runIdx,
      coins: meta.coins || 0, gems: meta.gems || 0, vials: meta.vials || 0, speed: gameSpeed(meta), rows,
    });
  };

  while ((clock - START_MS) / DAY < B.maxDays) {
    spendMeta(clock);
    const r = playRun(p.seed + runIdx++);
    bankRun(r.state);
    claimAllMilestones(meta);
    spendMeta(clock);
    tierRuns++;

    const realSec = r.simSec / Math.max(1, gameSpeed(meta));
    clock += realSec * 1000;
    activeToday += realSec;
    passTime(clock);
    if (activeToday >= activeSecPerDay) { // end of play day → one offline (idle+sleep) block
      clock += (DAY / 1000 - activeSecPerDay) * 1000;
      passTime(clock);
      activeToday = 0;
    }

    const pow = powerProxy(meta);
    const improvedWave = r.wave > tierBest * (1 + B.capPlateauEps);
    const grewPower = pow > lastPow * (1 + B.powerGrowEps);
    if (improvedWave) { tierBest = r.wave; tierGuard = r.guard; }
    plateau = improvedWave || grewPower ? 0 : plateau + 1;
    lastPow = Math.max(lastPow, pow);
    emit('progress');

    const target = targetFor(tier);
    if (target != null && tierBest >= target && tier < MAX_TIER) {
      if (!finishTier(true)) break; // hit the grind target → advance
    } else if (plateau >= B.capPlateauRuns || tierRuns >= B.maxRunsPerTier) {
      // Capped. With no target this is the "max-out" advance (if past the unlock); with a target it
      // means we stalled BELOW the goal → wall.
      const advanced = target == null && tierBest >= TIER_UNLOCK_WAVE && tier < MAX_TIER;
      if (!finishTier(advanced)) break;
    }
  }
  if (!rows.some((row) => row.tier === tier)) finishTier(false); // day cap hit mid-tier
  emit('done');
  return { rows, days: (clock - START_MS) / DAY, finalTier: tier };
}
