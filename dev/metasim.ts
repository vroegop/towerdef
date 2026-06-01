/* dev/metasim.ts — THROWAWAY meta-progression simulator.
   Plays the game like a real player: short runs that bank coins, between-run spending on
   permanent upgrades + skill-group unlocks + labs, and gems (from timed check-ins) into cards.
   Reuses the REAL sim + economy modules so balance is authoritative.

   Run:  npx tsx dev/metasim.ts
   Goal: estimate wall-clock time to reach Tier 1 waves 200 / 1000 / 5000 / 10000. */
import type { Meta } from '../src/types';
import { Sim } from '../src/sim/core';
import { createState } from '../src/sim/state';
import { DT } from '../src/sim/offline';
import { migrateMeta, startResearch, reconcileResearch, labCoinCost, labAtMax, labUnlocked, claimCheckIn } from '../src/sim/labs';
import { coinsForRun } from '../src/sim/waves';
import {
  isUnlocked, runAtMax, runUpgradeCost, buyRunUpgrade,
  permCost, permAtMax, buyPerm, nextUnlockGroup, unlockGroup,
  buyCard, buyCardCost, setActiveCard, claimMilestone, claimableCount, MILESTONES,
  FIRST_PERM_COST,
} from '../src/sim/skills';

const TIER = 1;
const SECONDS_PER_DAY = 86400;

// ---- player BUILD priority (strict order; round-robin one level at a time keeps levels balanced
// and avoids draining coins into cheap low-impact stats). Reflect/thorns is the keystone survival
// mechanic (empirically: it's what crosses the early death-wall), so it leads. ----
const PRIORITY: string[] = [
  'thorns', 'health', 'regen', 'armor', 'rangedDamage', 'attackSpeed', 'defPct',
  'critChance', 'critDamage', 'lifesteal', 'msChance', 'msTargets',
  'bounceChance', 'bounceTargets', 'superCrit', 'superCritMult', 'rendChance', 'rendMult',
  'rapidChance', 'rapidDuration', 'knockbackChance', 'knockbackForce', 'bounceRange',
  'dmgPerMeter', 'range',
];

// Cards the player will slot, in preference order (best general build).
const CARD_PRIORITY = ['damage', 'health', 'attackSpeed', 'critChance', 'healthRegen', 'cash',
  'fortress', 'extraDefense', 'range', 'coins', 'slowAura', 'enemyBalance'];

function freshMeta(): Meta {
  return migrateMeta({
    coins: 0, perm: {}, hasPlayed: false, bestWave: 0, claimedMilestones: {},
    tier: TIER, tierBest: {}, gems: 0, cards: [], cardBuys: 0, totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, unlocked: {}, cardSlots: 1,
    activeCards: [], lastCheckIn: 0, ver: 0,
  } as Meta);
}

// ---- in-run gold spending: round-robin over PRIORITY, one affordable level per pass ----
function spendRunGold(sim: Sim): void {
  const s = sim.s;
  for (;;) {
    let bought = false;
    for (const id of PRIORITY) {
      if (!isUnlocked(s.meta, id) || runAtMax(s, id)) continue;
      if (runUpgradeCost(s, id) > s.econ.gold) continue;
      if (buyRunUpgrade(s, id, sim.rng)) bought = true;
    }
    if (!bought) break;
  }
}

interface RunResult { wave: number; coins: number; simSeconds: number; }

// Play ONE run with the current meta. Buys run upgrades each wave with earned gold.
// maxWave caps the run so a strong build doesn't loop forever; tickCap is a hard safety.
function playRun(meta: Meta, seed: number, maxWave: number): RunResult {
  const firstRun = !meta.hasPlayed;
  const sim = new Sim(createState(seed >>> 0, meta, firstRun));
  sim.refreshStats();
  let t = 0;
  let lastWave = 0;
  const tickCap = Math.ceil((maxWave + 2) * 30 / DT) + 200000;
  while (sim.s.alive && sim.s.wave.n < maxWave && t < tickCap) {
    sim.step(DT);
    t++;
    if (sim.s.wave.n !== lastWave) {
      lastWave = sim.s.wave.n;
      sim.refreshStats();
      spendRunGold(sim);
      sim.refreshStats();
    }
  }
  const wave = sim.s.wave.maxWave || sim.s.wave.n;
  const coins = firstRun ? FIRST_PERM_COST : coinsForRun(sim.s, meta.tier || 1);
  return { wave, coins, simSeconds: Math.round(t * DT) };
}

// ---- between-run META spending (coins) ----
function spendCoins(meta: Meta): void {
  // 1) unlock the next skill group whenever affordable (cheapest-first, sequential).
  for (;;) {
    const g = nextUnlockGroup(meta);
    if (!g || (meta.coins || 0) < g.cost) break;
    if (!unlockGroup(meta, g.id)) break;
  }
  // 2) buy permanent upgrade levels: round-robin over PRIORITY, one affordable level per pass.
  for (;;) {
    let bought = false;
    for (const id of PRIORITY) {
      if (!isUnlocked(meta, id) || permAtMax(meta, id)) continue;
      if (permCost(meta, id) > (meta.coins || 0)) continue;
      if (buyPerm(meta, id)) bought = true;
    }
    if (!bought) break;
  }
}

// Start lab research when affordable and a slot is free (labs gate at bestWave>=30).
function manageLabs(meta: Meta, nowMs: number): void {
  for (const id of ['dmgLab', 'hpLab']) {
    if (!labUnlocked(meta, id) || labAtMax(meta, id)) continue;
    if ((meta.research || []).some((r) => r.id === id)) continue;
    const cost = labCoinCost(meta, id);
    if ((meta.coins || 0) >= cost) startResearch(meta, id, nowMs);
  }
}

// Spend gems: buy cards, then keep the best ones slotted. (Card slots cost gems too; we keep it
// simple and only use the free slot + buy a couple slots when flush, matching an unhurried player.)
function spendGems(meta: Meta, rng: () => number): void {
  // draw cards while affordable (each draw costs 5 + 5*cardBuys gems → escalates)
  for (;;) {
    if ((meta.gems || 0) < buyCardCost(meta)) break;
    if (!buyCard(meta, rng)) break;
  }
  // slot the best owned cards into available slots
  const slots = Math.max(1, meta.cardSlots || 1);
  const owned = new Set((meta.cards || []).map((c) => c.id));
  const pick = CARD_PRIORITY.filter((id) => owned.has(id)).slice(0, slots);
  for (let i = 0; i < slots; i++) setActiveCard(meta, i, pick[i] || null);
}

function claimMilestones(meta: Meta): void {
  while (claimableCount(meta) > 0) {
    let claimedAny = false;
    for (const m of MILESTONES) { const r = claimMilestone(meta, m); if (r.coins > 0 || r.gems > 0) claimedAny = true; }
    if (!claimedAny) break;
  }
}

// ---------------------------------------------------------------------------
// MAIN: grind runs back-to-back. Wall-clock = Σ run durations (continuous play). Labs + gem
// check-ins accrue on that same clock (they advance during play/offline). Report when bestWave
// first crosses each target.
// ---------------------------------------------------------------------------
function simulate(): void {
  const meta = freshMeta();
  let elapsedSec = 0; // wall-clock seconds of continuous play
  let rngState = 0x9e3779b9 >>> 0;
  const rng = (): number => { // small LCG for card draws (deterministic, independent of sim)
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };

  const TARGETS = [200, 1000, 5000, 10000];
  const hit: Record<number, { runs: number; days: number; bestWave: number } | null> = {};
  for (const t of TARGETS) hit[t] = null;

  let runIdx = 0;
  let bestEver = 0;
  let stagnant = 0;
  const MAX_RUNS = 200000;
  let runMaxWave = 50; // cap each run; raised as the player gets stronger

  while (runIdx < MAX_RUNS) {
    runIdx++;
    const nowMs = elapsedSec * 1000;
    // passive income that accrued during the *previous* run's wall-clock:
    reconcileResearch(meta, nowMs);
    // check-ins: claimCheckIn pays for all pending 15-min windows since lastCheckIn (cap 8).
    if (!meta.lastCheckIn) meta.lastCheckIn = 0;
    claimCheckIn(meta, nowMs);
    claimMilestones(meta);
    spendCoins(meta);
    manageLabs(meta, nowMs);
    spendGems(meta, rng);

    const seed = (runIdx * 2654435761) >>> 0;
    const r = playRun(meta, seed, runMaxWave);

    // bank (mirrors main.ts bankRun)
    meta.coins = (meta.coins || 0) + r.coins;
    const prevBest = meta.bestWave || 0;
    meta.bestWave = Math.max(prevBest, r.wave);
    meta.tierBest = meta.tierBest || {};
    meta.tierBest[TIER] = Math.max(meta.tierBest[TIER] || 0, r.wave);
    meta.totalWaves = (meta.totalWaves || 0) + r.wave;
    if (!meta.hasPlayed) meta.hasPlayed = true;

    elapsedSec += r.simSeconds;
    // let runs go a bit past current best so we can measure deeper reaches
    // cap run depth near the empirical Tier-1 wall (~1160) so we don't waste compute simulating
    // unreachable depth; +200 headroom lets us confirm the wall.
    runMaxWave = Math.max(50, Math.min(1400, Math.ceil(meta.bestWave * 1.3) + 50));

    for (const t of TARGETS) {
      if (!hit[t] && meta.bestWave >= t) {
        hit[t] = { runs: runIdx, days: elapsedSec / SECONDS_PER_DAY, bestWave: meta.bestWave };
        console.log(`*** TARGET wave ${t} reached: run ${runIdx}, ${fmtTime(elapsedSec / SECONDS_PER_DAY)} play, bestWave=${meta.bestWave}, coins=${fmt(meta.coins)}`);
      }
    }

    if (meta.bestWave > bestEver) { bestEver = meta.bestWave; stagnant = 0; }
    else stagnant++;

    if (runIdx % 50 === 0 || (runIdx < 50)) {
      const days = elapsedSec / SECONDS_PER_DAY;
      console.log(`run ${runIdx}: best=${meta.bestWave} thisRun=${r.wave} coins=${fmt(meta.coins)} gems=${meta.gems} ` +
        `dmgLab=${meta.labs.dmgLab || 0} hpLab=${meta.labs.hpLab || 0} cards=${(meta.cards || []).length} elapsed=${days.toFixed(1)}d`);
    }

    if (hit[10000]) break;
    // stop if clearly walled: no improvement over many runs AND coins not accumulating usefully
    if (stagnant > 800) { console.log(`\n>>> WALL: no progress in 800 runs. Best reachable ≈ wave ${bestEver}.`); break; }
  }

  console.log('\n================ RESULTS (Tier 1) ================');
  for (const t of TARGETS) {
    const h = hit[t];
    if (h) {
      console.log(`Wave ${t}: reached after ${h.runs} runs, ~${fmtTime(h.days)} of continuous play.`);
    } else {
      console.log(`Wave ${t}: NOT reached. Best ever = wave ${bestEver}.`);
    }
  }
  console.log(`\nFinal: best=${bestEver}, totalRuns=${runIdx}, totalPlay=${fmtTime(elapsedSec / SECONDS_PER_DAY)}`);
  console.log(`Labs: dmgLab L${meta.labs.dmgLab || 0}, hpLab L${meta.labs.hpLab || 0}. Cards owned: ${(meta.cards || []).length}.`);
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return '' + Math.round(v);
}
function fmtTime(days: number): string {
  if (days < 1 / 24) return (days * 24 * 60).toFixed(0) + ' min';
  if (days < 1) return (days * 24).toFixed(1) + ' hours';
  if (days < 60) return days.toFixed(1) + ' days';
  return (days / 30).toFixed(1) + ' months';
}

simulate();
