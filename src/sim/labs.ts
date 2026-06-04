/* src/sim/labs.ts — the LAB layer: the ceiling + slope engine.

   Labs live ENTIRELY OUTSIDE the deterministic run sim. They advance on the wall
   clock (Date.now()), in menus and while offline, so they never touch the seeded
   replay. There are four flavours of lab:
     • 'scale'   — multiplies a sim stat by (1 + per·level) via labScaleMults
                   (Damage/Health also raise a workshop cap via LAB_CAPS; Gold/Kill,
                   Coin/Kill, Crit Damage, Damage/Metre, Armor, Gold/Wave just scale).
     • 'flat'    — ADDS per·level to a sim stat via labFlatAdds (Range +m, Defense +%).
     • 'special' — applied OUTSIDE computeStats: Game Speed (unlocks battle speeds),
                   Starting Gold (run-start gold), Tier Coin (×end-of-run coin reward).
   The first level of every lab takes at least 1 minute (no instant levels).
   computeStats in skills.ts consumes the labScaleMults / labFlatAdds / labCapBonus
   hooks; state.ts and waves.ts consume labStartingGold / labTierCoinMult. */
import type { LabCurve, LabDef, Meta, Research } from '../types';
import { cosmeticBuffMult } from './cosmetics';

// ---- exact per-level tables (OUR-level indexing: point [L-1, x] = price/time to reach level L) ----
// `time` is wall-clock seconds; level 1 (point 0) is instant. `cost` is coins. Linear-interpolated.
// prettier-ignore
const LAB_TIME: [number, number][] = [[0,60],[1,360],[2,960],[3,1860],[4,3120],[5,4800],[6,6960],[7,9540],[8,12660],[9,16320],[10,20580],[11,25380],[12,30840],[13,36900],[14,43620],[15,51000],[16,59100],[17,67920],[18,77460],[19,87720],[20,98760],[21,110640],[22,123240],[23,136680],[24,150960],[25,166020],[26,181980],[27,198780],[28,216480],[29,235080],[30,254580],[31,274980],[32,296280],[33,318600],[34,341820],[35,366000],[36,391200],[37,417300],[38,444480],[39,472620],[40,501840],[41,532020],[42,563280],[43,595560],[44,628920],[45,663300],[46,698820],[47,735420],[48,773100],[49,811860],[50,851820],[51,892800],[52,934980],[53,978300],[54,1022760],[55,1068360],[56,1115160],[57,1163100],[58,1212240],[59,1262580],[60,1314180],[61,1366920],[62,1420860],[63,1476060],[64,1532520],[65,1590180],[66,1649100],[67,1709280],[68,1770720],[69,1833420],[70,1897440],[71,1962720],[72,2029260],[73,2097120],[74,2166360],[75,2236800],[76,2308680],[77,2381820],[78,2456280],[79,2532120],[80,2609280],[81,2687820],[82,2767740],[83,2849040],[84,2931660],[85,3015720],[86,3101160],[87,3187980],[88,3276180],[89,3365820],[90,3456900],[91,3549360],[92,3643260],[93,3738600],[94,3835380],[95,3933600],[96,4033320],[97,4134420],[98,4237020],[99,4341120]];
// prettier-ignore
const LAB_COST: [number, number][] = [[0,30],[1,71],[2,178],[3,398],[4,772],[5,1340],[6,2120],[7,3170],[8,4510],[9,6170],[10,8170],[11,10560],[12,13350],[13,16580],[14,20270],[15,24440],[16,29130],[17,34360],[18,40160],[19,46540],[20,53530],[21,61160],[22,69460],[23,78430],[24,88120],[25,98530],[26,109700],[27,121650],[28,134390],[29,147950],[30,162350],[31,177620],[32,193780],[33,210830],[34,228820],[35,247760],[36,267660],[37,288560],[38,310470],[39,333400],[40,357390],[41,382450],[42,408600],[43,435870],[44,464260],[45,493810],[46,524530],[47,556430],[48,589550],[49,623890],[50,659490],[51,696340],[52,734490],[53,773940],[54,814710],[55,856830],[56,900300],[57,945160],[58,991410],[59,1040000],[60,1090000],[61,1140000],[62,1190000],[63,1240000],[64,1300000],[65,1360000],[66,1410000],[67,1470000],[68,1530000],[69,1600000],[70,1660000],[71,1730000],[72,1800000],[73,1870000],[74,1940000],[75,2010000],[76,2080000],[77,2160000],[78,2240000],[79,2320000],[80,2400000],[81,2480000],[82,2570000],[83,2650000],[84,2740000],[85,2830000],[86,2930000],[87,3020000],[88,3120000],[89,3220000],[90,3320000],[91,3420000],[92,3520000],[93,3630000],[94,3740000],[95,3850000],[96,3960000],[97,4070000],[98,4190000],[99,4310000]];

// ---- Game Speed lab: its own exact cost/time tables (7 levels; point [L-1, x] = price/time to REACH
// level L). Unlike the shared LAB tables above, level 1 is NOT instant — it costs 9m. ----
// prettier-ignore
const SPEED_COST: [number, number][] = [[0,300],[1,2500],[2,12000],[3,50000],[4,150000],[5,500000],[6,1000000]];
// prettier-ignore
const SPEED_TIME: [number, number][] = [[0,540],[1,9000],[2,35280],[3,122520],[4,329940],[5,1215960],[6,2199960]];

// ---- derived/extra duration tables for the new lab families ----
// Starting Gold: level 1 = 1 minute, each next level +1 minute (level 20 = 20 minutes). at(n) reaches
// level n+1, so point [n, (n+1)·60].
const STARTGOLD_TIME: [number, number][] = Array.from({ length: 20 }, (_, n) => [n, (n + 1) * 60] as [number, number]);
// Defense %: the first 25 Damage-lab durations, doubled (25 levels).
const DEFPCT_TIME: [number, number][] = LAB_TIME.slice(0, 25).map(([l, v]) => [l, v * 2] as [number, number]);
// Tier Coin multiplier: a hand-authored long ladder (10m, 1h, 2h, 3h, 4h, 6h, 8h, 10h, 12h, 24h, 2d,
// 3d, then +1 day per level → 11d at level 20). Seconds.
// prettier-ignore
const TIERCOIN_TIME: [number, number][] = [[0,600],[1,3600],[2,7200],[3,10800],[4,14400],[5,21600],[6,28800],[7,36000],[8,43200],[9,86400],[10,172800],[11,259200],[12,345600],[13,432000],[14,518400],[15,604800],[16,691200],[17,777600],[18,864000],[19,950400]];

// The selectable battle-speed ladder. Indices 0..1 (0.5x, 1x) are ALWAYS available; indices 2..8
// (2x → 5x) unlock one-per-level as the Game Speed lab is completed (level 1 → 2x, … level 7 → 5x).
export const SPEED_STEPS = [0.5, 1, 2, 2.5, 3, 3.5, 4, 4.5, 5];
export const SPEED_LAB = 'gameSpeed';

// linear interpolation over a sampled [level, value] table (mirrors interpTable in skills.ts).
function interp(points: [number, number][], n: number): number {
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (n <= points[i][0]) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (n - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}
// table-backed curve: `at(n)` = price/time to buy the NEXT level n (0-indexed), interpolated from a
// shared [level,value] table. base/grow kept as harmless metadata for the dashboard's field editor.
const tcurve = (points: [number, number][]): LabCurve => ({
  base: points[0][1],
  grow: 0,
  at(n: number) {
    return Math.round(interp(points, n));
  },
});
// build a [level,value] table from a flat per-level value list: position i (0-indexed) is the
// price/time to REACH level i+1 (mirrors the dashboard's exported `perLevel` arrays exactly).
const tbl = (vals: number[]): [number, number][] => vals.map((v, i) => [i, v] as [number, number]);

// ---- exact per-level tables for the labs added from the balancing dashboard (tools/labs-dashboard).
// Each list is that lab's exported `perLevel` / `perLevelSeconds` array: entry i = the coin cost / wall-
// clock seconds to reach level i+1. Pasted verbatim from the dashboard export so the game matches it. ----
// prettier-ignore
const ATKSPEED_COST = [30,90,397,1082,2253,4001,6409,9554,13507,18336,24105,30876,38706,47654,57774,69119,81742,95692,111019,127772,145996,165738,187043,209955,234519,260775,288768,318537,350123,383567,418908,456186,495438,536702,580017,625418,672944,722629,774510,828622,885000,943680,1004694,1068078,1133865,1202088,1272780,1345975,1421704,1500000];
// prettier-ignore
const ATKSPEED_TIME = [120,348,1325,3308,6480,10985,16949,24482,33686,44651,57463,72202,88941,107753,128705,151861,177282,205029,235157,267723,302780,340379,380570,423402,468922,517177,568212,622070,678795,738429,801012,866585,935187,1006857,1081634,1159554,1240654,1324970,1412538,1503393,1597568,1695098,1796015,1900354,2008145,2119421,2234214,2352555,2474473,2600000];
// prettier-ignore
const CRITCHANCE_COST = [30,259,1158,2896,5584,9308,14142,20147,27379,35888,45721,56920,69524,83571,99096,116132,134711,154863,176617,200000];
// prettier-ignore
const CRITCHANCE_TIME = [600,2905,11191,26442,49262,80105,119339,167277,224193,290330,365908,451130,546180,651231,766446,891975,1027962,1174544,1331848,1500000];
// prettier-ignore
const REGEN_COST = [30,45,107,234,437,725,1107,1589,2178,2880,3700,4644,5715,6919,8260,9742,11369,13145,15074,17158,19402,21809,24381,27123,30036,33125,36391,39839,43469,47286,51292,55489,59880,64467,69253,74241,79432,84828,90433,96249,102276,108519,114978,121656,128556,135678,143025,150600,158404,166438,174705,183207,191946,200923,210141,219601,229304,239253,249450,259895,270592,281541,292744,304203,315920,327895,340132,352631,365393,378422,391717,405281,419114,433220,447599,462252,477181,492388,507874,523641,539689,556021,572637,589540,606730,624209,641978,660039,678393,697041,715985,735226,754765,774604,794743,815185,835930,856980,878337,900000];
// prettier-ignore
const REGEN_TIME = [120,169,361,731,1304,2099,3130,4410,5953,7768,9865,12253,14941,17937,21248,24881,28844,33142,37781,42768,48108,53807,59870,66302,73108,80293,87861,95818,104167,112913,122059,131611,141572,151946,162737,173949,185585,197648,210143,223073,236441,250251,264506,279209,294363,309972,326038,342565,359555,377011,394937,413336,432209,451560,471391,491706,512507,533796,555576,577850,600620,623889,647659,671933,696713,722002,747801,774113,800941,828287,856153,884542,913455,942894,972863,1003363,1034396,1065965,1098071,1130716,1163903,1197634,1231911,1266736,1302110,1338036,1374515,1411551,1449143,1487296,1526009,1565286,1605128,1645537,1686515,1728063,1770184,1812880,1856151,1900000];
// prettier-ignore
const BOUNCE_COST = [30,374,1722,4329,8361,13948,21199,30207,41055,53820,68570,85369,104276,125348,148637,174192,202062,232291,264924,300000];
// prettier-ignore
const BOUNCE_TIME = [600,3059,11897,28166,52508,85407,127258,178393,239105,309653,390272,481177,582566,694624,817522,951424,1096480,1252838,1420634,1600000];
// prettier-ignore
const GEMFIND_COST = [50,707,4624,14285,31906,59553,99189,152700,221907,308582,414451,541204,690494,863948,1063164,1289715,1545152,1831007,2148792,2500000];
// prettier-ignore
const GEMFIND_TIME = [600,2257,10644,29424,61496,109382,175354,261509,369806,502093,660129,845597,1060111,1305229,1582457,1893255,2239044,2621204,3041084,3500000];

// ---- the two pickable labs (kind 'scale' → multiplies a SIM STAT in computeStats) ----
// Damage: ×(1 + 0.04·lvl) on rangedDamage; Health: ×(1 + 0.05·lvl) on maxHp. Max level 100.
export const LABS: LabDef[] = [
  { id: 'dmgLab', cat: 'attack', kind: 'scale', target: 'rangedDamage', label: 'Damage Lab',
    per: 0.04, max: 100, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'hpLab', cat: 'defense', kind: 'scale', target: 'maxHp', label: 'Health Lab',
    per: 0.05, max: 100, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  // Game Speed: a 'special' lab. It does NOT scale a sim stat (so it never enters labScaleMults /
  // computeStats) — completing a level just widens the set of selectable battle speeds (see below).
  // Unlike every other lab it is available from wave 0 (gate.wave 0): it's the tutorial lab that
  // teaches the research mechanic before the wave-30 milestone opens the rest of the tier-1 ladder.
  { id: SPEED_LAB, cat: 'speed', kind: 'special', target: 'gameSpeed', label: 'Game Speed',
    per: 0.5, max: 7, coin: tcurve(SPEED_COST), time: tcurve(SPEED_TIME), gate: { wave: 0 } },

  // ---- flat labs (kind 'flat' → ADDS to a sim stat in computeStats, via labFlatAdds) ----
  // Range: +1 metre per level (20 levels), same durations as the first 20 Damage levels.
  { id: 'rangeLab', cat: 'attack', kind: 'flat', target: 'rangeM', label: 'Range Lab',
    per: 1, max: 20, unit: 'meters', coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  // Defense %: +1% damage reduction per level (25 levels); durations are DOUBLE the first 25 Damage levels.
  { id: 'defLab', cat: 'defense', kind: 'flat', target: 'defPct', label: 'Defense Lab',
    per: 0.01, max: 25, unit: 'pct', coin: tcurve(LAB_COST), time: tcurve(DEFPCT_TIME), gate: { wave: 30 } },

  // ---- scale labs (kind 'scale' → MULTIPLIES a sim stat; 1 + per·level, so levels add, not compound) ----
  // Gold/Coin per kill: +10% per level (20 levels), first-20 Damage durations.
  { id: 'goldKillLab', cat: 'economic', kind: 'scale', target: 'goldFind', label: 'Gold/Kill Lab',
    per: 0.1, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'coinKillLab', cat: 'economic', kind: 'scale', target: 'coinsPerKill', label: 'Coin/Kill Lab',
    per: 0.1, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  // +5% per level (20 levels), first-20 Damage durations. Level 20 = a one-time +100% (linear, not compounding).
  { id: 'critDmgLab', cat: 'attack', kind: 'scale', target: 'critMult', label: 'Crit Damage Lab',
    per: 0.05, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'dpmLab', cat: 'attack', kind: 'scale', target: 'dmgPerMeter', label: 'Damage/Metre Lab',
    per: 0.02, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'armorLab', cat: 'defense', kind: 'scale', target: 'armor', label: 'Armor Lab',
    per: 0.04, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'goldWaveLab', cat: 'economic', kind: 'scale', target: 'goldPerWave', label: 'Gold/Wave Lab',
    per: 0.05, max: 20, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },

  // ---- special labs (kind 'special' → applied OUTSIDE computeStats, via dedicated helpers) ----
  // Starting Gold: +30 gold at run start per level (20 levels). Durations: 1 min, +1 min per level.
  { id: 'startGoldLab', cat: 'economic', kind: 'special', target: 'startingGold', label: 'Starting Gold Lab',
    per: 30, max: 20, unit: 'gold', coin: tcurve(LAB_COST), time: tcurve(STARTGOLD_TIME), gate: { wave: 30 } },
  // Tier Coin multiplier: +1% on the end-of-run coin reward per level, up to +20% at level 20.
  { id: 'tierCoinLab', cat: 'economic', kind: 'special', target: 'tierCoinMult', label: 'Tier Coin Lab',
    per: 0.01, max: 20, unit: 'tierpct', coin: tcurve(LAB_COST), time: tcurve(TIERCOIN_TIME), gate: { wave: 30 } },
  // Interest Cap: raises the per-wave gold ceiling on the Interest skill. Geometric — the cap climbs
  // from 25/wave (level 0) to 20,000/wave (level 20) via labInterestCap, so increments accelerate.
  // `per` here is harmless metadata (the real value comes from labInterestCap); the HUD renders the
  // 'interestcap' unit through that helper, not per·level.
  { id: 'interestCapLab', cat: 'economic', kind: 'special', target: 'interestCap', label: 'Interest Cap Lab',
    per: 0, max: 20, unit: 'interestcap', coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },

  // ---- labs designed in the balancing dashboard (tools/labs-dashboard); curves are bespoke tables. ----
  // Attack Speed: ×(1 + 0.01·lvl) on fireRate — a second multiplicative DPS axis alongside Damage. 50
  // levels (capped at +50%) so it stays behind the 100-level Damage Lab.
  { id: 'atkSpeedLab', cat: 'attack', kind: 'scale', target: 'fireRate', label: 'Attack Speed Lab',
    per: 0.01, max: 50, coin: tcurve(tbl(ATKSPEED_COST)), time: tcurve(tbl(ATKSPEED_TIME)), gate: { wave: 30 } },
  // Crit Chance: ADDS +5% crit chance per level (flat), to +100% at level 20 — pairs with the Crit Damage lab.
  { id: 'critChanceLab', cat: 'attack', kind: 'flat', target: 'critChance', label: 'Crit Chance Lab',
    per: 0.05, max: 20, unit: 'pct', coin: tcurve(tbl(CRITCHANCE_COST)), time: tcurve(tbl(CRITCHANCE_TIME)), gate: { wave: 30 } },
  // HP Regen: ×(1 + 0.1·lvl) on regen — sustain scaling for long waves. 100 levels (×11 at max).
  { id: 'regenLab', cat: 'defense', kind: 'scale', target: 'regen', label: 'HP Regen Lab',
    per: 0.1, max: 100, coin: tcurve(tbl(REGEN_COST)), time: tcurve(tbl(REGEN_TIME)), gate: { wave: 30 } },
  // Bounce Chance: ADDS +1% per level (flat) to the Lightning/Arc bounce roll (+20% at level 20).
  { id: 'bounceLab', cat: 'attack', kind: 'flat', target: 'bounceChance', label: 'Bounce Chance Lab',
    per: 0.01, max: 20, unit: 'pct', coin: tcurve(tbl(BOUNCE_COST)), time: tcurve(tbl(BOUNCE_TIME)), gate: { wave: 30 } },
  // Gem Find: a 'special' lab — ×(1 + 0.024·lvl) on gem rewards (milestones + check-ins) via labGemMult.
  { id: 'gemFindLab', cat: 'economic', kind: 'special', target: 'gemMult', label: 'Gem Find Lab',
    per: 0.024, max: 20, unit: 'pct', coin: tcurve(tbl(GEMFIND_COST)), time: tcurve(tbl(GEMFIND_TIME)), gate: { wave: 30 } },
];
export const LAB_BY_ID: Record<string, LabDef> = {};
for (const L of LABS) LAB_BY_ID[L.id] = L;

// ---- internal cap effects: each pickable lab ALSO raises a WORKSHOP UPGRADE's max cap. These
// share the lab's completed level, so the scale + cap halves always advance together. `target` here
// is the UPGRADE id (rangedDamage / health), distinct from the scale target (a sim-stat key). ----
const LAB_CAPS: { labId: string; upgrade: string; per: number }[] = [
  { labId: 'dmgLab', upgrade: 'rangedDamage', per: 60 }, // +6000 cap at L100 (doubles the Damage ceiling)
  { labId: 'hpLab', upgrade: 'health', per: 90 }, //       +9000 cap at L100
];

// ---- pure level/effect helpers (read meta.labs = { labId: completedLevel }) ----
const lvl = (meta: Meta, id: string): number => (meta && meta.labs && meta.labs[id]) || 0;
export const labLevel = lvl;

// cap effect: how much extra `max` a given upgrade id has earned (Σ per·level over its lab caps).
export function labCapBonus(meta: Meta, upgradeId: string): number {
  let b = 0;
  for (const c of LAB_CAPS) if (c.upgrade === upgradeId) b += c.per * lvl(meta, c.labId);
  return b;
}
// scale labs: a dict { simStatKey: 1 + Σ per·level } applied multiplicatively in computeStats.
export function labScaleMults(meta: Meta): Record<string, number> {
  const out: Record<string, number> = {};
  for (const L of LABS) {
    if (L.kind !== 'scale') continue;
    out[L.target] = (out[L.target] || 1) + L.per * lvl(meta, L.id);
  }
  return out;
}
// flat labs: a dict { simStatKey: Σ per·level } ADDED to a sim stat in computeStats (range +m, defence +%).
export function labFlatAdds(meta: Meta): Record<string, number> {
  const out: Record<string, number> = {};
  for (const L of LABS) {
    if (L.kind !== 'flat') continue;
    out[L.target] = (out[L.target] || 0) + L.per * lvl(meta, L.id);
  }
  return out;
}
// special labs applied OUTSIDE computeStats:
// Starting Gold — flat gold granted at the start of every run (Σ per·level = 30·level).
export const labStartingGold = (meta: Meta): number => 30 * lvl(meta, 'startGoldLab');
// Tier Coin multiplier — ×(1 + 0.01·level) on the end-of-run coin reward.
export const labTierCoinMult = (meta: Meta): number => 1 + 0.01 * lvl(meta, 'tierCoinLab');
// Gem Find multiplier — ×(1 + 0.024·level) on gem rewards (milestones + check-ins). Mirrors gemFindLab.per
// and the 'gemMult' cosmetic buff; applied at the same reward sites so the two stack multiplicatively.
export const labGemMult = (meta: Meta): number => 1 + 0.024 * lvl(meta, 'gemFindLab');
// Interest Cap — the per-wave gold ceiling on interest income. Geometric ladder over 20 levels:
// 25·800^(level/20), so level 0 = 25/wave and level 20 = 20,000/wave with accelerating increments.
export const labInterestCap = (meta: Meta): number =>
  Math.round(25 * Math.pow(800, lvl(meta, 'interestCapLab') / 20));

// ---- gating / pricing for the NEXT level of a lab ----
export function labUnlocked(meta: Meta, id: string): boolean {
  const L = LAB_BY_ID[id];
  if (!L) return false;
  return ((meta && meta.bestWave) || 0) >= ((L.gate && L.gate.wave) || 0);
}
// The Labs TAB itself is always open: the Game Speed lab (gate.wave 0) is researchable from the very
// first run, so the rail/tab never hides. INDIVIDUAL labs are still gated by labUnlocked() — the rest
// of the tier-1 ladder stays locked until wave 30. (meta kept for signature/back-compat.)
export const labsTabUnlocked = (_meta: Meta): boolean => true;
export function researchRemaining(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  return r ? Math.max(0, (r.endsAt - nowMs) / 1000) : 0;
}
export function researchProgress(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  if (!r || r.waiting) return 0; // a coins-blocked level hasn't begun → 0% done
  const total = labTimeSec(meta, id) * 1000; // buffed (unboosted) duration = total lab-WORK for this level
  if (total <= 0) return 1;
  // Progress is measured in lab-WORK done, not real time, so an active boost fills the bar faster
  // without ever jumping it backwards (remainingWorkMs inverts the boost-aware endsAt projection).
  return Math.max(0, Math.min(1, 1 - remainingWorkMs(meta, id, r.endsAt, nowMs) / total));
}
export function labAtMax(meta: Meta, id: string): boolean {
  const L = LAB_BY_ID[id];
  return lvl(meta, id) >= (L ? L.max : 0);
}
export function labCoinCost(meta: Meta, id: string): number {
  const L = LAB_BY_ID[id];
  return L ? L.coin.at(lvl(meta, id)) : 0;
}
// wall-clock seconds for the next level (level 1 is instant → 0). Divided by the passive lab-speed
// cosmetic buff (e.g. Arcane Obelisk), so faster research flows through both the display and the timer.
export function labTimeSec(meta: Meta, id: string): number {
  const L = LAB_BY_ID[id];
  if (!L) return 0;
  const speed = cosmeticBuffMult(meta, 'labSpeed');
  return Math.max(0, Math.round(L.time.at(lvl(meta, id)) / speed));
}

// ---- timed PER-LAB speed boost (the per-lab "Speed Up" control) ----------------------------------
// A boost makes ONE lab advance `mult`× faster for a fixed real-time window. The window is NOT
// shortened by the multiplier: a 1-day 2× boost runs a full day of real time and banks 2 days of that
// lab's work. We bake the boost into the lab's research `endsAt` (a wall-clock instant) and key the
// boost by lab id (meta.labBoosts), so reconcile stays a dumb `now >= endsAt` check, offline catch-up
// needs no special-casing, and the boost follows the lab as it auto-chains its next levels.
export const MAX_BOOST_MULT = 5; // multipliers go 2×..5×
export const MAX_BOOST_DAYS = 7; // durations go up to 7 days

// The active boost record for a single lab (or undefined).
const boostOf = (meta: Meta, id: string): { mult: number; endsAt: number } | undefined =>
  meta.labBoosts ? meta.labBoosts[id] : undefined;

// The boost multiplier in effect for a lab right now (1 = none / expired).
export function labBoostMult(meta: Meta, id: string, nowMs: number): number {
  const b = boostOf(meta, id);
  return b && b.mult > 1 && b.endsAt > nowMs ? b.mult : 1;
}
// Seconds left on a lab's active boost (0 if none).
export function labBoostRemaining(meta: Meta, id: string, nowMs: number): number {
  const b = boostOf(meta, id);
  return b && b.endsAt > nowMs ? (b.endsAt - nowMs) / 1000 : 0;
}

// Vial price to run ONE lab at `mult`× for `durationSec`. Base "block" = 1 vial / hour (one multiplier
// step at full price). Each step above 2× is 10% cheaper than the last, so over H hours:
// 2× = H, 3× = +0.9·H, 4× = +0.8·H, 5× = +0.7·H.
export function labBoostCost(mult: number, durationSec: number): number {
  const block = durationSec / 3600;
  let cost = 0;
  for (let k = 0; k <= mult - 2; k++) cost += block * (1 - 0.1 * k);
  return Math.round(cost);
}

// Wall-clock instant that `workMs` of lab `id`'s work begun at `startMs` finishes, honouring its boost.
function projectEndsAt(meta: Meta, id: string, startMs: number, workMs: number): number {
  const b = boostOf(meta, id);
  if (!b || b.mult <= 1 || b.endsAt <= startMs) return startMs + workMs;
  const D = b.endsAt - startMs, // real ms of boost still ahead of startMs
    m = b.mult;
  if (workMs <= m * D) return startMs + workMs / m; // finishes inside the boost window
  return startMs + workMs - (m - 1) * D; // boost the first D real-ms, run the tail at 1×
}
// Inverse of projectEndsAt: lab-WORK still left at `nowMs` for a level of lab `id` finishing at `endsAt`.
function remainingWorkMs(meta: Meta, id: string, endsAt: number, nowMs: number): number {
  if (endsAt <= nowMs) return 0;
  const b = boostOf(meta, id);
  if (!b || b.mult <= 1 || b.endsAt <= nowMs) return endsAt - nowMs; // no live boost → 1:1
  if (endsAt <= b.endsAt) return (endsAt - nowMs) * b.mult; // whole tail inside the boost
  return (b.endsAt - nowMs) * b.mult + (endsAt - b.endsAt); // boosted part + unboosted tail
}

// Purchase a speed boost for ONE lab: charge vials, then re-time that lab to the new rate. The lab must
// currently be researching (or coins-blocked) — the per-lab "Speed Up" control only shows on such rows.
export function applyLabBoost(meta: Meta, id: string, mult: number, durationSec: number, nowMs: number): boolean {
  mult = Math.round(mult);
  if (mult < 2 || mult > MAX_BOOST_MULT) return false;
  if (durationSec <= 0 || durationSec > MAX_BOOST_DAYS * 86400) return false;
  if (labBoostMult(meta, id, nowMs) > 1) return false; // one boost per lab — no stacking
  // Settle any level whose timer has already elapsed first, so we re-project the LIVE level rather than a
  // finished one (whose remaining work is 0 → it would collapse to endsAt=nowMs and sit at 100% / 1 gem).
  reconcileResearch(meta, nowMs);
  const r = researchOf(meta, id);
  if (!r) return false; // the lab isn't being researched (or it just maxed out) — nothing to boost
  const cost = labBoostCost(mult, durationSec);
  if ((meta.vials || 0) < cost) return false;
  meta.vials = (meta.vials || 0) - cost;
  meta.labBoosts = meta.labBoosts || {};
  meta.labBoosts[id] = { mult, endsAt: nowMs + durationSec * 1000 };
  // No boost was active for this lab a moment ago, so its remaining real-time IS its remaining work;
  // re-project that work onto the new (faster) timeline. A coins-blocked (waiting) lab has no timer yet
  // — it'll project onto the boost when it resumes in reconcileResearch.
  if (!r.waiting) r.endsAt = projectEndsAt(meta, id, nowMs, Math.max(0, r.endsAt - nowMs));
  return true;
}

// ---- research lifecycle (wall-clock; meta-only; safe to advance from any delta) ----
export function researchOf(meta: Meta, id: string): Research | null {
  return (meta.research || []).find((r) => r.id === id) || null;
}
export const freeSlots = (meta: Meta): number => Math.max(0, (meta.labSlots || 1) - (meta.research || []).length);

// Begin researching a lab's next level. Deducts coins up front (refunded on cancel). A zero-time
// level (the first) completes instantly. Returns false if it cannot start.
export function startResearch(meta: Meta, id: string, nowMs: number): boolean {
  if (!labUnlocked(meta, id) || labAtMax(meta, id)) return false;
  if (researchOf(meta, id)) return false;
  if (freeSlots(meta) <= 0) return false;
  const cost = labCoinCost(meta, id);
  if ((meta.coins || 0) < cost) return false;
  meta.coins -= cost;
  const t = labTimeSec(meta, id);
  if (t <= 0) {
    // instant first level — apply immediately, no slot used.
    meta.labs = meta.labs || {};
    meta.labs[id] = (meta.labs[id] || 0) + 1;
    return true;
  }
  meta.research = meta.research || [];
  meta.research.push({ id, cost, endsAt: projectEndsAt(meta, id, nowMs, t * 1000) });
  return true;
}

// Begin the NEXT level of `id` at wall-clock `startMs` (used by auto-start + waiting resume). If the
// player can't afford it, return a WAITING entry that holds the slot until coins arrive — so a lab
// never goes idle until it maxes out.
function beginNextLevel(meta: Meta, id: string, startMs: number): Research {
  const cost = labCoinCost(meta, id);
  if ((meta.coins || 0) < cost) return { id, cost: 0, endsAt: 0, waiting: true };
  meta.coins -= cost;
  return { id, cost, endsAt: projectEndsAt(meta, id, startMs, labTimeSec(meta, id) * 1000) };
}

// Cancel an in-progress lab: refund its coins, free the slot.
export function cancelResearch(meta: Meta, id: string): boolean {
  const r = researchOf(meta, id);
  if (!r) return false;
  meta.coins = (meta.coins || 0) + (r.cost || 0);
  meta.research = (meta.research || []).filter((x) => x.id !== id);
  return true;
}

// Instant-complete an in-progress lab: costs 1 GEM per minute remaining (ceil). No partial finish —
// not enough gems → no-op. (Named rushVialCost/rushResearch to keep the existing main.ts wiring.)
export function rushVialCost(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  if (!r || r.waiting) return 0; // a waiting (not-yet-started) level has nothing to rush
  // rushing pays out the remaining lab-WORK, so a boosted lab is correspondingly cheaper to finish.
  return Math.max(1, Math.ceil(remainingWorkMs(meta, id, r.endsAt, nowMs) / 1000 / 60));
}
export function rushResearch(meta: Meta, id: string, nowMs: number): boolean {
  const r = researchOf(meta, id);
  if (!r || r.waiting) return false;
  const cost = rushVialCost(meta, id, nowMs);
  if ((meta.gems || 0) < cost) return false;
  meta.gems -= cost;
  r.endsAt = nowMs;
  // Settle the finish NOW — complete this level and auto-start the next — instead of leaving it for the
  // next reconcile tick. Otherwise the just-paid-for level lingers on screen at 100% with a "Finish · 1
  // gem" button (its remaining work is 0), so a second click would charge another gem for nothing.
  reconcileResearch(meta, nowMs);
  return true;
}

// Complete every research whose timer has elapsed, and AUTO-START the next level of the same lab so a
// slot keeps working without intervention (the chain handles long offline gaps — many levels at once).
// A slot only frees up when its lab maxes out; if the next level isn't yet affordable the slot is held
// in a WAITING state and resumes the moment coins allow. Returns the list of completed lab ids.
export function reconcileResearch(meta: Meta, nowMs: number): string[] {
  if (!meta.research || !meta.research.length) return [];
  const done: string[] = [],
    keep: Research[] = [];
  for (const r0 of meta.research) {
    // Resume a coins-blocked level the instant funds are available.
    let r: Research | null = r0.waiting ? beginNextLevel(meta, r0.id, nowMs) : r0;
    while (r && !r.waiting && nowMs >= r.endsAt) {
      meta.labs = meta.labs || {};
      meta.labs[r.id] = (meta.labs[r.id] || 0) + 1;
      done.push(r.id);
      if (labAtMax(meta, r.id)) { r = null; break; } // maxed → the only time a slot goes idle
      // Chain the next level from the instant this one finished, so an offline gap completes the
      // right number of levels (each subsequent endsAt projects off the previous completion time).
      r = beginNextLevel(meta, r.id, r.endsAt);
    }
    if (r) keep.push(r); // running OR waiting-on-coins — either way the slot stays assigned
  }
  meta.research = keep;
  return done;
}

// ---- concurrent research slots (a gem sink; 1 → MAX_SLOTS). Slot 1 free; then 100/400/1400/3000. ----
export const MAX_SLOTS = 5;
const SLOT_COSTS = [0, 100, 400, 1400, 3000]; // index = slot number - 1 (cost to UNLOCK that slot)
export const labSlotCost = (meta: Meta): number => SLOT_COSTS[Math.max(0, (meta.labSlots || 1))] || 0;
export function buyLabSlot(meta: Meta): boolean {
  if ((meta.labSlots || 1) >= MAX_SLOTS) return false;
  const cost = labSlotCost(meta);
  if ((meta.gems || 0) < cost) return false;
  meta.gems -= cost;
  meta.labSlots = (meta.labSlots || 1) + 1;
  return true;
}

// ---- 15-minute check-in: the SOLE source of vials & card currency ----
const CHECKIN_MS = 15 * 60 * 1000; // one claim every 15 minutes
const CHECKIN_CAP = 8; // bank up to 8 claims (~2 hours) while away
export const CHECKIN_VIALS = 5; // vials per claim
export const CHECKIN_GEMS = 5; // card currency (gems) per claim
export function checkInPending(meta: Meta, nowMs: number): number {
  const last = meta.lastCheckIn || nowMs;
  return Math.max(0, Math.min(CHECKIN_CAP, Math.floor((nowMs - last) / CHECKIN_MS)));
}
export function claimCheckIn(meta: Meta, nowMs: number): { claims: number; vials: number; gems: number } | null {
  const n = checkInPending(meta, nowMs);
  if (n <= 0) return null;
  const vials = n * CHECKIN_VIALS,
    gems = Math.round(n * CHECKIN_GEMS * cosmeticBuffMult(meta, 'gemMult') * labGemMult(meta)); // ×gem cosmetic buff ×Gem Find lab
  meta.vials = (meta.vials || 0) + vials;
  meta.gems = (meta.gems || 0) + gems;
  meta.lastCheckIn = nowMs;
  return { claims: n, vials, gems };
}

// ---- game speed: a player-chosen battle multiplier, clamped to what the Game Speed lab unlocks ----
// This is PURE math entering the loop (main.ts runs more fixed steps per real second), so the seeded
// replay stays identical — the determinism invariant holds (see README "Wall-clock vs sim-clock").

// The speeds the player may pick right now: 0x (pause) is always offered, then the 2 always-free
// steps + one ladder step per completed Game Speed level (capped at the ladder length).
export function availableSpeeds(meta: Meta): number[] {
  return [0, ...SPEED_STEPS.slice(0, Math.min(SPEED_STEPS.length, 2 + lvl(meta, SPEED_LAB)))];
}
// Top selectable speed at a given completed level (level 0 → 1x; level L≥1 → SPEED_STEPS[L+1]).
export const speedAtLevel = (level: number): number => SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, level + 1)];

// The speed currently in effect: the saved selection if still unlockable, else the highest unlocked
// speed not exceeding it (defends against a corrupt/edited save), else 1x.
export function gameSpeed(meta: Meta): number {
  const avail = availableSpeeds(meta);
  // null-check rather than `|| 1` so a stored 0 (pause) isn't coerced back to 1x.
  const sel = meta && meta.gameSpeed != null ? meta.gameSpeed : 1;
  if (avail.includes(sel)) return sel;
  const lower = avail.filter((v) => v <= sel).pop();
  return lower != null ? lower : 1;
}
// Persist a chosen speed if it's currently selectable; returns the value now in effect.
export function setGameSpeed(meta: Meta, speed: number): number {
  if (availableSpeeds(meta).includes(speed)) meta.gameSpeed = speed;
  return gameSpeed(meta);
}

// ---- meta defaults / migration (idempotent; additive only, never destructive) ----
const META_VER = 2;
export function migrateMeta(meta: Meta): Meta {
  if (!meta) return meta;
  if (meta.labs == null) meta.labs = {};
  // bulk-buy multiplier tiers (5x/25x/100x/Max) are gated behind these "labs". Pre-complete them for
  // every player so the multiplier is available now. To make the feature unlockable later, remove a
  // key from this seed (and add a matching LabDef) — the HUD hides any tier whose lab isn't complete.
  // (keys mirror BULK_UNLOCKS in skills.ts; inlined to avoid a circular import.)
  for (const id of ['bulk5', 'bulk25', 'bulk100', 'bulkMax']) if (meta.labs[id] == null) meta.labs[id] = 1;
  // skill-unlock gate: meta.unlocked is keyed by GROUP id now. Free/starter groups (cost 0) unlock
  // implicitly in skills.ts, so we only need to default the map for purchased groups.
  if (meta.unlocked == null) meta.unlocked = {};
  if (!Array.isArray(meta.research)) meta.research = [];
  if (meta.labBoosts == null || typeof meta.labBoosts !== 'object') meta.labBoosts = {};
  // drop any pre-per-lab global boost field — boosts are now keyed per lab in meta.labBoosts.
  if ('labBoost' in meta) delete (meta as Record<string, unknown>).labBoost;
  if (meta.labSlots == null) meta.labSlots = 1;
  if (meta.vials == null) meta.vials = 0;
  if (meta.cardSlots == null) meta.cardSlots = 1;
  if (!Array.isArray(meta.activeCards)) meta.activeCards = [];
  if (meta.cosmetics == null || typeof meta.cosmetics !== 'object') meta.cosmetics = {};
  if (meta.cosmeticsOwned == null || typeof meta.cosmeticsOwned !== 'object') meta.cosmeticsOwned = {};
  if (meta.gameSpeed == null) meta.gameSpeed = 1; // default battle speed (0.5x/1x are always available)
  // Superpowers (Prestige tab): Energy currency + per-power state. Additive, never destructive.
  if (meta.energy == null) meta.energy = 0;
  if (meta.superUnlocked == null || typeof meta.superUnlocked !== 'object') meta.superUnlocked = {};
  if (meta.superLevels == null || typeof meta.superLevels !== 'object') meta.superLevels = {};
  if (meta.superEnabled == null || typeof meta.superEnabled !== 'object') meta.superEnabled = {};
  meta.ver = META_VER;
  return meta;
}
