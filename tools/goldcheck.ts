/* tools/goldcheck.ts — headless: how much gold does a MAXED player earn by waves 100/1000/2000/3000?
 * Builds a fully-decked meta (every perm skill at its lab-boosted cap, every lab maxed, every card at
 * max stars and slotted), then runs the real sim with an aggressive auto-buyer and snapshots
 * cumulative gold-earned each time a checkpoint wave is first reached. Run: npx tsx tools/goldcheck.ts */
import type { Meta } from '../src/types';
import { Sim } from '../src/sim/core';
import { createState } from '../src/sim/state';
import { DT } from '../src/sim/offline';
import { UPGRADES, upgradeCap, buyRunUpgrade, CARDS, MAX_STARS, MAX_CARD_SLOTS, computeStats } from '../src/sim/skills';
import { LABS, migrateMeta } from '../src/sim/labs';

function maxedMeta(tier: number, noInterest = false): Meta {
  const meta = migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 999999, tier,
    tierBest: {}, gems: 0, cards: [], cardSlots: MAX_CARD_SLOTS, activeCards: [],
    labs: {}, research: [], labSlots: 5, vials: 0,
  } as unknown as Meta);
  // every lab at its max level (caps + scales + flats + specials)
  for (const L of LABS) meta.labs![L.id] = L.max;
  // every perm skill at its lab-boosted cap (capOf accounts for the +cap labs)
  for (const u of UPGRADES) meta.perm![u.id] = upgradeCap(meta, u.id);
  // every card owned at max stars, and slotted active (22 slots ≥ 20 cards)
  meta.cards = Object.keys(CARDS).map((id) => ({ id, stars: MAX_STARS }));
  meta.activeCards = Object.keys(CARDS).slice(0, MAX_CARD_SLOTS);
  if (noInterest) meta.perm!.interest = 0; // isolate kill+wave income (no compounding hoard)
  return meta;
}

const CHECKPOINTS = [100, 1000, 2000, 3000];
const BUILD = UPGRADES.map((u) => u.id); // auto-buy everything we can each tick

function run(tier: number, seed: number, noInterest = false) {
  const meta = maxedMeta(tier, noInterest);
  const sim = new Sim(createState(seed, meta, false));
  const snap: Record<number, { earned: number; wave: number }> = {};
  const perWaveEarned: Record<number, number> = {};
  let lastWave = 0,
    earnedAtWaveStart = 0,
    ticks = 0;
  const CAP = 3000 * Math.round(30 / DT) + 5000; // ~ enough ticks to reach wave 3000
  while (sim.s.alive && sim.s.wave.n < 3000 && ticks < CAP) {
    sim.step(DT);
    // greedy buyer: a few passes so cheap upgrades chain-buy as gold accumulates
    for (let k = 0; k < 4; k++) for (const id of BUILD) buyRunUpgrade(sim.s, id, sim.rng);
    ticks++;
    const w = sim.s.wave.n;
    if (w !== lastWave) {
      // wave just advanced; record income of the wave we finished and snapshot checkpoints
      for (const c of CHECKPOINTS) {
        if (lastWave < c && w >= c && !snap[c]) {
          snap[c] = { earned: sim.s.econ.goldEarned, wave: w };
        }
      }
      perWaveEarned[lastWave] = sim.s.econ.goldEarned - earnedAtWaveStart;
      earnedAtWaveStart = sim.s.econ.goldEarned;
      lastWave = w;
    }
  }
  return { sim, snap, perWaveEarned, ticks };
}

// ---------- ideal full-clear gold income (analytic), independent of survival ----------
// Per-kill gold = ceil(wave/coinStep) * coinValue * goldFind * cashMult * enemyBalance (NO exp str).
// Enemies/wave: melee + capped specials, ×enemyBalance. We approximate avg coinValue from composition.
function idealPerWaveGold(stats: ReturnType<typeof computeStats>, wave: number): number {
  const coinStep = 10;
  const waveStep = Math.ceil(wave / coinStep);
  const eb = stats.enemyBalance > 1 ? stats.enemyBalance : 1;
  // composition past wave 150 (tier 1): 120 melee (coin 1) + 20 specials (tank 4 / fast 2 / ranged 2,
  // avg ≈ 2.67); boss waves (every 10th) ≈ 1 boss(5) + 139 melee. Blend the two.
  const baseCount = Math.min(140, 8 + 5 * (wave - 1));
  const specials = Math.min(20, baseCount);
  const normals = baseCount - specials;
  const normalCoins = normals * 1;
  const specialCoins = specials * ((4 + 2 + 2) / 3);
  const normalWaveGold = (normalCoins + specialCoins) * Math.round(eb);
  const bossWaveGold = (1 * 5 + Math.min(139, baseCount - 1) * 1) * Math.round(eb);
  const avgPerWaveBasis = (normalWaveGold * 9 + bossWaveGold) / 10; // 1 in 10 waves is a boss
  const perKillMult = stats.goldFind * (stats.cashMult || 1);
  const killGold = avgPerWaveBasis * waveStep * perKillMult;
  const flat = Math.round((stats.goldPerWave || 0) * (stats.cashMult || 1));
  return killGold + flat; // interest excluded (depends on hoarded balance)
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

function report(label: string, noInterest: boolean) {
  console.log(`\n================ ${label} ================`);
  const { sim, snap, perWaveEarned, ticks } = run(1, 1234567, noInterest);
  console.log(`reached wave ${sim.s.wave.n} (alive=${sim.s.alive}, ticks=${ticks}, kills=${fmt(sim.s.econ.kills)})`);
  console.log(`total gold earned at end: ${fmt(sim.s.econ.goldEarned)}`);
  console.log('cumulative gold earned by the time each wave is reached:');
  for (const c of CHECKPOINTS) {
    if (snap[c]) {
      const inc = perWaveEarned[c - 1] != null ? `  (~${fmt(perWaveEarned[c - 1])}/wave near here)` : '';
      console.log(`  wave ${c}: ${fmt(snap[c].earned)} earned${inc}`);
    } else console.log(`  wave ${c}: NOT REACHED (run ended at wave ${sim.s.wave.n})`);
  }
  return sim;
}

// A) full maxed (interest maxed): total earned is dominated by interest compounding on the hoard.
report('TIER 1 — FULL MAXED (interest 99 → compounds on hoard)', false);
// B) maxed but interest OFF: the spendable kill+wave income that the upgrade-cost curves race against.
const simB = report('TIER 1 — MAXED, INTEREST OFF (kill + wave income only)', true);

// analytic full-clear income for the unreached deep waves (no survival/interest needed)
const stats = computeStats(simB.s);
console.log('\n================ ANALYTIC kill+wave income IF every wave fully cleared ================');
console.log(`  (goldFind=${stats.goldFind.toFixed(2)}× cashMult=${(stats.cashMult || 1).toFixed(2)}× enemyBalance=${stats.enemyBalance.toFixed(2)}× goldPerWave=${fmt(stats.goldPerWave || 0)})`);
let cum = 0,
  prev = 0;
for (const c of CHECKPOINTS) {
  for (let w = prev + 1; w <= c; w++) cum += idealPerWaveGold(stats, w);
  prev = c;
  console.log(`  by wave ${c}: ~${fmt(cum)} cumulative   (this wave ~${fmt(idealPerWaveGold(stats, c))}/wave)`);
}
