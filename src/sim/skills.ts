/* src/sim/skills.ts — UNIFIED upgrade model.

   ONE list of upgrades (UPGRADES). Every upgrade is buyable in two contexts:
     • in a run, with GOLD   → run.levels[id]  (resets each run)
     • out of a run, with COINS → meta.perm[id] (permanent; a "base level skip")

   The effective number of levels a stat has is perm + run (capped at the upgrade's max).
   Tabs: attack / defense / economic (icons, not words). */
import type { BulkQty, CardDef, CardSpec, CardDrawResult, Curve, Meta, State, Stats, TabDef, UpgradeCurve, UpgradeDef, UpgradeSpec } from '../types';
import { labCapBonus, labFlatAdds, labInterestCap, labScaleMults, labTierCoinMult } from './labs';
import { coinMult } from './waves';
import { cosmeticBuffMult, towerForTier, TOWER_UNLOCK_WAVE } from './cosmetics';
import {
  RAPID_COST, BOUNCECHANCE_COST, BOUNCETARGETS_COST, BOUNCERANGE_COST, SUPERCRIT_COST,
  SUPERCRITMULT_COST, REND_COST, DEFPCT_COST, THORNS_COST, KBCHANCE_COST, KBFORCE_COST, KBFORCE_VALUE,
  LIFESTEAL_COST, LIFESTEAL_VALUE, CASHBONUS_COST, COINS_COST, FREEUP_COST, INTEREST_COST,
  GOLD_COST,
} from './tables';

// Turn a balance Curve (data) into a number. Single evaluator for upgrades AND cards, so a
// rebalance of any `curve` field flows to graphs, the sim, and the display with no code change.
// Linear-interpolate a value from sorted [x,y] sample points; clamps below first / above last.
export function interpTable(points: [number, number][], n: number): number {
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
// COST-curve interpolation: like interpTable, but ramps GEOMETRICALLY between samples instead of
// linearly — y = y0·(y1/y0)^t. It hits the SAME curated sample points (e.g. L1=30, L100=80730) but
// the per-level gap grows multiplicatively (~8%/lvl) instead of being a flat (y1−y0)/Δ jump. This
// kills the "first step leaps 30→845 then crawls" artifact of linear interpolation on sparsely
// sampled cost tables. Falls back to linear on any non-positive endpoint (geometric ratio undefined).
export function interpTableGeom(points: [number, number][], n: number): number {
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (n <= points[i][0]) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i];
      if (x1 === x0) return y1;
      const t = (n - x0) / (x1 - x0);
      if (y0 <= 0 || y1 <= 0) return y0 + (y1 - y0) * t; // linear fallback
      return y0 * Math.pow(y1 / y0, t);
    }
  }
  return points[points.length - 1][1];
}
export function evalCurve(c: Curve, n: number): number {
  if (c.kind === 'geom') return n > 0 ? c.mul * Math.pow(c.ratio, n - 1) : 0;
  if (c.kind === 'exp') {
    const v = c.base * Math.pow(c.ratio, n);
    return c.cap != null ? Math.min(c.cap, v) : v;
  }
  if (c.kind === 'table') return interpTable(c.points, n);
  const v = c.base + c.per * n;
  return c.cap != null ? Math.min(c.cap, v) : v;
}
const pctFmt = (v: number): string => (v * 100).toFixed(1) + '%';

// pixel/metre scale: the literal range stat is in METRES; the sim runs in pixels.
export const PX_PER_METER = 4;
export const BASE_RANGE_M = 30; // default attack radius before any Range upgrade
export const MAX_REND = 10; // cap on Rend stacks an enemy can carry
export const REND_DECAY = 4; // seconds a Rend stack persists without a refresh
export const RAPID_CHECK = 5; // seconds between Burst rolls
export const RAPID_MULT = 3; // fire-rate multiplier during a Burst

// cost factory: round(base · growth^n). growth > 1 → accelerating curve. `cost` reads this.base/
// this.grow (not the closed-over args) so the dev dashboard can rebalance base/grow in place.
const curve = (base: number, grow: number): UpgradeCurve => ({
  base,
  grow,
  cost(n: number) {
    return Math.round(this.base * Math.pow(this.grow, n));
  },
});
// table cost: exact sampled [level, cost] points, linear-interpolated (for skills whose real cost
// curve isn't a clean base·grow^n). base/grow are kept as harmless metadata for the dashboard.
const tcurve = (points: [number, number][]): UpgradeCurve => ({
  base: points[0][1],
  grow: 0,
  points,
  cost(n: number) {
    return Math.round(interpTableGeom(this.points!, n));
  },
});

// The three subtabs shared by the in-run bar and the out-of-run Upgrades menu.
export const TAB_DEFS: TabDef[] = [
  { id: 'attack', icon: 'sword' },
  { id: 'defense', icon: 'shield' },
  { id: 'economic', icon: 'coins', gated: true }, // locked until Tier 2 is reached
];

// ── Shared "big number" notation, matching tower-enemy-stats.netlify.app ─────────────────────────
// One scale of suffixes for every UI surface, so a value reads the same in the upgrade list, the HUD
// chips and the enemy panel. CASE-SENSITIVE on purpose (q=1e15 vs Q=1e18, s=1e21 vs S=1e24, …). Past
// 'D' (1e33) it rolls over to two-letter suffixes aa (1e36), ab (1e39), ac (1e42), … indefinitely.
const BIG_SUF = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N', 'D'];
export function bigSuffix(group: number): string {
  if (group <= 0) return '';
  if (group < BIG_SUF.length) return BIG_SUF[group];
  const k = group - BIG_SUF.length; // 0 → 'aa' (1e36)
  return String.fromCharCode(97 + Math.floor(k / 26)) + String.fromCharCode(97 + (k % 26));
}
// Split a number into mantissa (|m| < 1000) and its 1000^group exponent, by repeated division so
// float log-precision can't mis-bucket exact powers of 1000.
export function bigGroup(n: number): { m: number; group: number } {
  let m = Math.abs(n),
    group = 0;
  while (m >= 1000) {
    m /= 1000;
    group++;
  }
  return { m: n < 0 ? -m : m, group };
}
// Compact formatter for the big tabulated stats (2 dp + the shared suffix ladder).
const abbrNum = (v: number): string => {
  if (Math.abs(v) < 1000) return '' + Math.round(v);
  const { m, group } = bigGroup(v);
  return m.toFixed(2) + bigSuffix(group);
};

// Exact Damage tables (sampled every 100 levels; interpolated between). value = damage per shot;
// cost = the per-level purchase price (used for BOTH gold and coin until economy multipliers exist).
const DAMAGE_VALUE: [number, number][] = [
  [1, 6], [100, 1050], [200, 3640], [300, 7770], [400, 13440], [500, 20650], [600, 29400], [700, 39690],
  [800, 51520], [900, 64890], [1000, 79800], [1100, 97550], [1200, 119740], [1300, 146600], [1400, 178270],
  [1500, 214840], [1600, 257990], [1700, 309860], [1800, 370860], [1900, 441240], [2000, 521190], [2100, 613220],
  [2200, 720920], [2300, 845270], [2400, 986890], [2500, 1150000], [2600, 1330000], [2700, 1530000], [2800, 1770000],
  [2900, 2040000], [3000, 2340000], [3100, 2680000], [3200, 3070000], [3300, 3520000], [3400, 4020000], [3500, 4590000],
  [3600, 5240000], [3700, 5970000], [3800, 6820000], [3900, 7770000], [4000, 8850000], [4100, 10050000], [4200, 11420000],
  [4300, 12950000], [4400, 14660000], [4500, 16550000], [4600, 18640000], [4700, 20930000], [4800, 23420000],
  [4900, 26130000], [5000, 29050000], [5100, 32190000], [5200, 35560000], [5300, 39160000], [5400, 42990000],
  [5500, 47060000], [5600, 51370000], [5700, 55930000], [5800, 60740000], [5900, 65800000], [6000, 71110000],
];
const DAMAGE_COST: [number, number][] = [
  [1, 30], [100, 80730], [200, 643070], [300, 1590000], [400, 3030000], [500, 5000000], [600, 7520000],
  [700, 10610000], [800, 14320000], [900, 18640000], [1000, 23600000], [1100, 29210000], [1200, 35500000],
  [1300, 42470000], [1400, 50140000], [1500, 58530000], [1600, 67630000], [1700, 77470000], [1800, 88050000],
  [1900, 99390000], [2000, 111490000], [2100, 124360000], [2200, 138020000], [2300, 152480000], [2400, 167730000],
  [2500, 183790000], [2600, 200670000], [2700, 218370000], [2800, 236910000], [2900, 256280000], [3000, 276510000],
  [3100, 297580000], [3200, 319520000], [3300, 342320000], [3400, 365990000], [3500, 390550000], [3600, 415990000],
  [3700, 442320000], [3800, 469550000], [3900, 497690000], [4000, 526730000], [4100, 556690000], [4200, 587560000],
  [4300, 619370000], [4400, 652100000], [4500, 685770000], [4600, 720380000], [4700, 755930000], [4800, 792440000],
  [4900, 829900000], [5000, 868320000], [5100, 1820000000], [5200, 3790000000], [5300, 7920000000], [5400, 16510000000],
  [5500, 43000000000], [5600, 111930000000], [5700, 291140000000], [5800, 756760000000], [5900, 1970000000000],
  [6000, 5100000000000],
];

// Attack Speed per-level cost (exact). Indexed by OUR level n (= price to buy level n+1), so
// cost(0)=30 buys the 1st level, cost(1)=56 the 2nd, … matching the reference's next-level price.
const ATKSPEED_COST: [number, number][] = [
  [0, 30], [1, 56], [2, 92], [3, 140], [4, 200], [5, 274], [6, 363], [7, 467], [8, 588], [9, 725],
  [10, 879], [11, 1050], [12, 1240], [13, 1450], [14, 1680], [15, 1920], [16, 2190], [17, 2470], [18, 2780],
  [19, 3110], [20, 3450], [21, 3820], [22, 4210], [23, 4620], [24, 5060], [25, 5510], [26, 5990], [27, 6490],
  [28, 7010], [29, 7560], [30, 8130], [31, 8720], [32, 9340], [33, 9980], [34, 10640], [35, 11330], [36, 12050],
  [37, 12780], [38, 13550], [39, 14330], [40, 15150], [41, 15980], [42, 16850], [43, 17730], [44, 18650],
  [45, 19590], [46, 20560], [47, 21550], [48, 22570], [49, 23610], [50, 25430], [51, 26560], [52, 27720],
  [53, 28900], [54, 30120], [55, 31360], [56, 32630], [57, 33930], [58, 35260], [59, 36620], [60, 38010],
  [61, 39420], [62, 40870], [63, 42340], [64, 43840], [65, 45370], [66, 46940], [67, 48530], [68, 50150],
  [69, 51800], [70, 53480], [71, 55190], [72, 56930], [73, 58700], [74, 60500], [75, 65450], [76, 67410],
  [77, 69400], [78, 71420], [79, 73470], [80, 75560], [81, 77680], [82, 79830], [83, 82010], [84, 84230],
  [85, 86480], [86, 88760], [87, 91080], [88, 93430], [89, 95810], [90, 98230], [91, 100680], [92, 103170],
  [93, 105690], [94, 108240], [95, 110830], [96, 113450], [97, 116110], [98, 118800],
];

// Health & HP-Regen share one cost curve (sampled every 100 levels). Defense Absolute uses a near-
// identical cost but starts at 50 and stops at level 5000.
const HP_COST: [number, number][] = [
  [1, 30], [100, 77220], [200, 610350], [300, 1500000], [400, 2860000], [500, 4700000], [600, 7050000],
  [700, 9940000], [800, 13390000], [900, 17410000], [1000, 22030000], [1100, 27240000], [1200, 33080000],
  [1300, 39540000], [1400, 46640000], [1500, 54400000], [1600, 62820000], [1700, 71920000], [1800, 81700000],
  [1900, 92170000], [2000, 103330000], [2100, 115210000], [2200, 127810000], [2300, 141130000], [2400, 155180000],
  [2500, 169970000], [2600, 185500000], [2700, 201790000], [2800, 218840000], [2900, 236660000], [3000, 255240000],
  [3100, 274610000], [3200, 294750000], [3300, 315690000], [3400, 337420000], [3500, 359960000], [3600, 383300000],
  [3700, 407450000], [3800, 432420000], [3900, 458200000], [4000, 484820000], [4100, 512270000], [4200, 540550000],
  [4300, 569670000], [4400, 599640000], [4500, 630460000], [4600, 662130000], [4700, 694660000], [4800, 728060000],
  [4900, 762320000], [5000, 797450000], [5100, 1670000000], [5200, 3480000000], [5300, 7260000000],
  [5400, 15150000000], [5500, 39450000000], [5600, 102670000000], [5700, 267020000000], [5800, 693950000000],
  [5900, 1800000000000], [6000, 4680000000000],
];
const HEALTH_VALUE: [number, number][] = [
  [1, 10], [100, 21560], [200, 143010], [300, 431240], [400, 943900], [500, 1730000], [600, 2850000], [700, 4330000],
  [800, 6230000], [900, 8590000], [1000, 11440000], [1100, 14830000], [1200, 18790000], [1300, 23360000],
  [1400, 28580000], [1500, 34480000], [1600, 41100000], [1700, 48480000], [1800, 56630000], [1900, 65610000],
  [2000, 75440000], [2100, 86150000], [2200, 97780000], [2300, 110350000], [2400, 123890000], [2500, 138450000],
  [2600, 154040000], [2700, 170700000], [2800, 188460000], [2900, 207340000], [3000, 227370000], [3100, 248590000],
  [3200, 271010000], [3300, 294680000], [3400, 319610000], [3500, 345840000], [3600, 373390000], [3700, 402290000],
  [3800, 432560000], [3900, 464240000], [4000, 497340000], [4100, 531900000], [4200, 567940000], [4300, 605490000],
  [4400, 644560000], [4500, 685200000], [4600, 727420000], [4700, 771250000], [4800, 816720000], [4900, 863840000],
  [5000, 912650000], [5100, 1120000000], [5200, 1370000000], [5300, 1680000000], [5400, 2050000000], [5500, 2500000000],
  [5600, 3050000000], [5700, 3720000000], [5800, 4530000000], [5900, 5520000000], [6000, 6710000000],
];
const REGEN_VALUE: [number, number][] = [
  [1, 0], [100, 269], [200, 1410], [300, 3870], [400, 9020], [500, 17680], [600, 40560], [700, 120370], [800, 300090],
  [900, 619260], [1000, 1120000], [1100, 1820000], [1200, 2780000], [1300, 4020000], [1400, 5580000], [1500, 7480000],
  [1600, 9760000], [1700, 12460000], [1800, 15590000], [1900, 19210000], [2000, 23320000], [2100, 27980000],
  [2200, 33190000], [2300, 39010000], [2400, 45440000], [2500, 52530000], [2600, 60300000], [2700, 68780000],
  [2800, 78000000], [2900, 87980000], [3000, 98770000], [3100, 110370000], [3200, 122820000], [3300, 136160000],
  [3400, 150400000], [3500, 165570000], [3600, 181700000], [3700, 198820000], [3800, 216950000], [3900, 236120000],
  [4000, 256360000], [4100, 277700000], [4200, 300150000], [4300, 323750000], [4400, 348530000], [4500, 374500000],
  [4600, 401690000], [4700, 430140000], [4800, 459860000], [4900, 490880000], [5000, 523230000], [5100, 707800000],
  [5200, 956200000], [5300, 1290000000], [5400, 1740000000], [5500, 2340000000], [5600, 3150000000], [5700, 4220000000],
  [5800, 5670000000], [5900, 7600000000], [6000, 10170000000],
];
const DEFABS_VALUE: [number, number][] = [
  [0, 0], [1, 1], [100, 1020], [200, 5990], [300, 17160], [400, 38390], [500, 74220], [600, 126840], [700, 198060],
  [800, 289480], [900, 402570], [1000, 538720], [1100, 699240], [1200, 885360], [1300, 1100000], [1400, 1340000],
  [1500, 1620000], [1600, 1940000], [1700, 2300000], [1800, 2700000], [1900, 3140000], [2000, 3650000], [2100, 4210000],
  [2200, 4840000], [2300, 5530000], [2400, 6290000], [2500, 7130000], [2600, 8040000], [2700, 9070000], [2800, 10220000],
  [2900, 11500000], [3000, 12920000], [3100, 14500000], [3200, 16230000], [3300, 18120000], [3400, 20190000],
  [3500, 22430000], [3600, 24850000], [3700, 27450000], [3800, 30250000], [3900, 33240000], [4000, 36440000],
  [4100, 39830000], [4200, 43430000], [4300, 47250000], [4400, 51280000], [4500, 55530000], [4600, 60010000],
  [4700, 64710000], [4800, 69640000], [4900, 74810000], [5000, 80210000],
];
const DEFABS_COST: [number, number][] = [
  [1, 50], [100, 77240], [200, 610390], [300, 1500000], [400, 2860000], [500, 4700000], [600, 7050000], [700, 9940000],
  [800, 13390000], [900, 17410000], [1000, 22030000], [1100, 27240000], [1200, 33080000], [1300, 39540000],
  [1400, 46640000], [1500, 54400000], [1600, 62820000], [1700, 71920000], [1800, 81700000], [1900, 92170000],
  [2000, 103330000], [2100, 115210000], [2200, 127810000], [2300, 141130000], [2400, 155180000], [2500, 169970000],
  [2600, 185500000], [2700, 201790000], [2800, 218840000], [2900, 236660000], [3000, 255240000], [3100, 274610000],
  [3200, 294750000], [3300, 315690000], [3400, 337420000], [3500, 359960000], [3600, 383300000], [3700, 407450000],
  [3800, 432420000], [3900, 458200000], [4000, 484820000], [4100, 512270000], [4200, 540550000], [4300, 569670000],
  [4400, 599640000], [4500, 630460000], [4600, 662130000], [4700, 694660000], [4800, 728060000], [4900, 762320000],
  [5000, 797450000],
];

// "Enemy skip" cost curve: mirrors the Damage COIN cost, but read at 10× the level — so skip-skill
// level L costs the same as Damage level 10L (L1 = Damage 10, L600 = Damage 6000). Past level 600 the
// sampled table ends, so cost grows LINEARLY at a fixed step (the Damage 5990→6000 per-level gap).
const skipCostCurve = (): UpgradeCurve => {
  const at = (L: number): number => interpTableGeom(DAMAGE_COST, 10 * L);
  return {
    base: at(1),
    grow: 0,
    cost(n: number): number {
      const L = n + 1; // our cost(n) buys level n+1, so the level being purchased is 1-indexed
      if (L <= 600) return Math.max(1, Math.round(at(L)));
      const slope = at(600) - at(599); // constant linear step beyond the table's end
      return Math.max(1, Math.round(at(600) + (L - 600) * slope));
    },
  };
};

// Every upgrade as a SPEC: `curve` is the balance data (graphable/rebalanceable); `value` is
// generated from it below. `fmt(v)` formats a COMPUTED value; `max` caps perm+run; `gold`/`coin`
// are the cost curves. `tip` is static or (up) => string and derives any numbers via up.value/fmt.
const UPGRADE_SPECS: UpgradeSpec[] = [
  // ---- ATTACK ----
  { id: 'attackSpeed', stat: 'fireRate', tab: 'attack', icon: 'rate', label: 'Atk Speed',
    name: 'Attack Speed',
    tip: (up) => 'Shots per second. Base: ' + up.fmt(up.value(0)) + ', max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, curve: { kind: 'linear', base: 1, per: 0.05 }, fmt: (v) => v.toFixed(2) + '/s',
    gold: tcurve(ATKSPEED_COST), coin: tcurve(ATKSPEED_COST) },
  { id: 'rangedDamage', tab: 'attack', icon: 'bow', label: 'Damage',
    name: 'Damage',
    tip: (up) => 'Damage per shot. Base ' + up.fmt(up.value(0)) + ' → ' + up.fmt(up.value(up.max)) + ' at level ' + up.max + '. Cards & labs multiply it.',
    max: 6000, curve: { kind: 'table', points: DAMAGE_VALUE }, fmt: abbrNum, gold: tcurve(DAMAGE_COST), coin: tcurve(DAMAGE_COST) },
  { id: 'dmgPerMeter', tab: 'attack', icon: 'ruler', label: 'DMG/m',
    name: 'Damage per Metre',
    tip: (up) => 'Damage multiplier per metre of distance to the target. Max: ' + up.fmt(up.value(up.max)) + '/m.',
    max: 200, curve: { kind: 'linear', base: 0, per: 0.00005 }, fmt: (v) => '+' + v.toFixed(4) + '×/m',
    gold: curve(25, 1.55), coin: curve(6, 1.0018) },
  { id: 'range', stat: 'rangeM', tab: 'attack', icon: 'range', label: 'Range',
    name: 'Attack Range',
    tip: (up) => 'How far the hero can target enemies. Base: ' + up.fmt(up.value(0)) + ', max: ' + up.fmt(up.value(up.max)) + '.',
    max: 79, curve: { kind: 'linear', base: BASE_RANGE_M, per: 0.5 },
    fmt: (v) => v + 'm', gold: curve(1, 1.2), coin: curve(1, 1.2) },
  { id: 'critChance', tab: 'attack', icon: 'crit', label: 'Crit Chance',
    name: 'Critical Hit Chance',
    tip: (up) => 'Chance each shot critically strikes for increased damage. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 80, curve: { kind: 'linear', base: 0, per: 0.01, cap: 0.8 }, fmt: pctFmt,
    gold: curve(40, 1.6), coin: curve(20, 1.008) },
  { id: 'critDamage', stat: 'critMult', tab: 'attack', icon: 'burst', label: 'Crit DMG',
    name: 'Critical Damage',
    tip: (up) => 'Damage multiplier on a critical hit. Starts at ' + up.fmt(up.value(0)) + ', max: ' + up.fmt(up.value(up.max)) + '.',
    max: 150, curve: { kind: 'linear', base: 1.2, per: 0.1 },
    fmt: (v) => (v < 10 ? v.toFixed(1) : v.toFixed(0)) + '×',
    gold: curve(50, 1.6), coin: curve(25, 1.0018) },
  { id: 'superCrit', tab: 'attack', icon: 'burst', label: 'Super Crit',
    name: 'Super Critical Chance',
    tip: 'On a crit, a chance to apply the crit multiplier an additional time.',
    max: 100, curve: { kind: 'linear', base: 0, per: 0.002, cap: 0.2 }, fmt: pctFmt,
    gold: tcurve(SUPERCRIT_COST), coin: tcurve(SUPERCRIT_COST) },
  { id: 'superCritMult', tab: 'attack', icon: 'burst', label: 'Super Crit Mult',
    name: 'Super Crit Mult',
    tip: (up) => 'Extra multiplier applied on a super-crit. Base ' + up.fmt(up.value(0)) + ' → ' + up.fmt(up.value(up.max)) + ' at level ' + up.max + '.',
    max: 120, curve: { kind: 'linear', base: 1.3, per: 0.1 }, fmt: (v) => v.toFixed(2) + '×',
    gold: tcurve(SUPERCRITMULT_COST), coin: tcurve(SUPERCRITMULT_COST) },
  { id: 'rendChance', tab: 'attack', icon: 'crit', label: 'Amp Chance',
    name: 'Amp Chance',
    tip: (up) => 'Chance each hit applies an Amp stack, boosting future damage. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 299, curve: { kind: 'linear', base: 0, per: 0.001, cap: 0.3 }, fmt: pctFmt,
    gold: tcurve(REND_COST), coin: tcurve(REND_COST) },
  { id: 'rendMult', tab: 'attack', icon: 'burst', label: 'Amp Power',
    name: 'Amp Power',
    tip: (up) => 'Damage bonus per Amp stack on the target. Stacks decay after ' + REND_DECAY + 's. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 299, curve: { kind: 'linear', base: 0.001, per: 0.001, cap: 0.3 }, fmt: (v) => '+' + (v * 100).toFixed(1) + '%/hit',
    gold: tcurve(REND_COST), coin: tcurve(REND_COST) },
  { id: 'msChance', tab: 'attack', icon: 'bow', label: 'Lightning',
    name: 'Split chance',
    tip: (up) => 'Chance each attack splits lightning to nearby targets. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, curve: { kind: 'linear', base: 0, per: 0.005, cap: 0.495 }, fmt: pctFmt,
    gold: curve(100, 1.6), coin: curve(25, 1.0018) },
  { id: 'msTargets', tab: 'attack', icon: 'bow', label: 'Lightning',
    name: 'Splits',
    tip: (up) => 'Maximum extra targets hit per split. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 8, curve: { kind: 'linear', base: 1, per: 1 }, fmt: (v) => '' + v,
    gold: curve(250, 1.7), coin: curve(40, 1.02) },
  { id: 'bounceChance', tab: 'attack', icon: 'arrow', label: 'Arc',
    name: 'Arc chance',
    tip: (up) => 'Chance lightning arcs to another enemy after impact. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 85, curve: { kind: 'linear', base: 0, per: 0.008, cap: 0.68 }, fmt: pctFmt,
    gold: tcurve(BOUNCECHANCE_COST), coin: tcurve(BOUNCECHANCE_COST) },
  { id: 'bounceTargets', tab: 'attack', icon: 'arrow', label: 'Arc',
    name: 'Arc splits',
    tip: (up) => 'Maximum enemies an arc can chain through. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 7, curve: { kind: 'linear', base: 1, per: 1 }, fmt: (v) => '' + v,
    gold: tcurve(BOUNCETARGETS_COST), coin: tcurve(BOUNCETARGETS_COST) },
  { id: 'bounceRange', tab: 'attack', icon: 'range', label: 'Arc Range',
    name: 'Arc range',
    tip: (up) => 'Maximum distance for an arc. Base: ' + up.fmt(up.value(0)) + ', max: ' + up.fmt(up.value(up.max)) + '.',
    max: 60, curve: { kind: 'linear', base: 8, per: 0.4 }, fmt: (v) => Math.round(v / PX_PER_METER) + 'm',
    gold: tcurve(BOUNCERANGE_COST), coin: tcurve(BOUNCERANGE_COST) },
  { id: 'rapidChance', tab: 'attack', icon: 'rate', label: 'Burst',
    name: 'Burst Chance',
    tip: (up) => 'Chance every ' + RAPID_CHECK + 's to trigger a ' + RAPID_MULT + '× fire rate burst. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 85, curve: { kind: 'linear', base: 0, per: 0.004, cap: 0.34 }, fmt: pctFmt,
    gold: tcurve(RAPID_COST), coin: tcurve(RAPID_COST) },
  { id: 'rapidDuration', tab: 'attack', icon: 'rate', label: 'Burst Dur.',
    name: 'Burst Duration',
    tip: (up) => 'How long the Burst lasts. Base: ' + up.fmt(up.value(0)) + ', max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, curve: { kind: 'linear', base: 0.65, per: 0.05 }, fmt: (v) => v.toFixed(1) + 's',
    gold: tcurve(RAPID_COST), coin: tcurve(RAPID_COST) },

  // ---- DEFENSE ----
  { id: 'health', stat: 'maxHp', tab: 'defense', icon: 'heart', label: 'HP',
    name: 'Max HP',
    tip: (up) => 'Maximum HP. Base ' + up.fmt(up.value(0)) + ' → ' + up.fmt(up.value(up.max)) + ' at level ' + up.max + '. Cards & labs multiply it.',
    max: 6000, curve: { kind: 'table', points: HEALTH_VALUE }, fmt: abbrNum, gold: tcurve(HP_COST), coin: tcurve(HP_COST) },
  { id: 'regen', tab: 'defense', icon: 'regen', label: 'HP Regen',
    name: 'HP Regeneration',
    tip: (up) => 'HP recovered per second whenever below max HP. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 6000, curve: { kind: 'table', points: REGEN_VALUE }, fmt: (v) => abbrNum(v) + '/s',
    gold: tcurve(HP_COST), coin: tcurve(HP_COST) },
  { id: 'knockbackChance', tab: 'defense', icon: 'arrow', label: 'Knockback',
    name: 'Knockback Chance',
    tip: (up) => 'Chance each hit knocks the enemy back — or slows it if it is too heavy. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 80, curve: { kind: 'linear', base: 0, per: 0.01, cap: 0.8 }, fmt: pctFmt,
    gold: tcurve(KBCHANCE_COST), coin: tcurve(KBCHANCE_COST) },
  { id: 'knockbackForce', tab: 'defense', icon: 'arrow', label: 'Force',
    name: 'Knockback Force',
    tip: (up) => 'Push strength, fought by enemy mass. Base ' + up.fmt(up.value(0)) + ', max ' + up.fmt(up.value(up.max)) + '. Force > mass shoves back (up to 5m); otherwise it slows the enemy.',
    max: 40, curve: { kind: 'table', points: KBFORCE_VALUE }, fmt: (v) => v.toFixed(2),
    gold: tcurve(KBFORCE_COST), coin: tcurve(KBFORCE_COST) },
  { id: 'armor', tab: 'defense', icon: 'shield', label: 'Armor',
    name: 'Armor',
    tip: (up) => 'Flat damage blocked per hit, applied AFTER Defense %. Base ' + up.fmt(up.value(0)) + ' → ' + up.fmt(up.value(up.max)) + ' at level ' + up.max + '.',
    max: 5000, curve: { kind: 'table', points: DEFABS_VALUE }, fmt: abbrNum, gold: tcurve(DEFABS_COST), coin: tcurve(DEFABS_COST) },
  { id: 'defPct', tab: 'defense', icon: 'shield', label: 'Defense %',
    name: 'Defense Percentage',
    tip: (up) => 'Percentage damage reduction applied after Armor. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, curve: { kind: 'linear', base: 0, per: 0.005, cap: 0.495 }, fmt: pctFmt,
    gold: tcurve(DEFPCT_COST), coin: tcurve(DEFPCT_COST) },
  { id: 'thorns', tab: 'defense', icon: 'shield', label: 'Disintegrate',
    name: 'Disintegrate',
    tip: 'Enemies that hit the tower lose a share of their max HP.',
    max: 99, curve: { kind: 'linear', base: 0, per: 0.01, cap: 0.99 }, fmt: (v) => (v * 100).toFixed(0) + '%',
    gold: tcurve(THORNS_COST), coin: tcurve(THORNS_COST) },
  { id: 'lifesteal', tab: 'defense', icon: 'regen', label: 'Lifesteal',
    name: 'Lifesteal',
    tip: (up) => 'Heals for a percentage of all damage dealt. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 80, curve: { kind: 'table', points: LIFESTEAL_VALUE }, fmt: pctFmt,
    gold: tcurve(LIFESTEAL_COST), coin: tcurve(LIFESTEAL_COST) },

  // ---- ECONOMIC (Tier 2+) ----
  { id: 'goldPerWave', tab: 'economic', icon: 'coin', label: 'Gold/Wave',
    name: 'Gold per Wave',
    tip: 'Bonus gold awarded at the start of each wave.',
    max: 149, gated: true, curve: { kind: 'linear', base: 0, per: 4 }, fmt: (v) => '+' + v, gold: tcurve(CASHBONUS_COST), coin: tcurve(CASHBONUS_COST) },
  { id: 'goldPerKill', stat: 'goldFind', tab: 'economic', icon: 'coin', label: 'Gold/Kill',
    name: 'Gold per Kill',
    tip: (up) => 'Multiplier on gold earned from kills. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 149, gated: true, curve: { kind: 'linear', base: 1, per: 0.01 }, fmt: (v) => '×' + v.toFixed(2),
    gold: tcurve(CASHBONUS_COST), coin: tcurve(CASHBONUS_COST) },
  { id: 'cashBonus', stat: 'cashMult', tab: 'economic', icon: 'coin', label: 'Gold Bonus',
    name: 'Gold Bonus',
    tip: (up) => 'Global multiplier on all gold earned. Base: ' + up.fmt(up.value(0)) + '.',
    max: 149, gated: true, curve: { kind: 'linear', base: 1, per: 0.01 }, fmt: (v) => '×' + v.toFixed(2),
    gold: tcurve(CASHBONUS_COST), coin: tcurve(CASHBONUS_COST) },
  { id: 'interest', tab: 'economic', icon: 'coin', label: 'Interest',
    name: 'Interest',
    tip: 'Earns a percentage of banked gold as a bonus each wave, capped per wave (25/wave; raise the ceiling to 20k/wave with the Interest Cap lab).',
    max: 99, gated: true, curve: { kind: 'linear', base: 0, per: 0.0006 }, fmt: (v) => (v * 100).toFixed(1) + '%/wave',
    gold: tcurve(INTEREST_COST), coin: tcurve(INTEREST_COST) },
  { id: 'freeUpAttack', tab: 'economic', icon: 'coins', label: 'Free Atk',
    name: 'Free Attack Upgrade',
    tip: (up) => 'Chance each ATTACK upgrade costs no gold. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, gated: true, curve: { kind: 'linear', base: 0, per: 0.005, cap: 0.495 }, fmt: pctFmt,
    gold: tcurve(FREEUP_COST), coin: tcurve(FREEUP_COST) },
  { id: 'freeUpDefense', tab: 'economic', icon: 'coins', label: 'Free Def',
    name: 'Free Defense Upgrade',
    tip: (up) => 'Chance each DEFENSE upgrade costs no gold. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, gated: true, curve: { kind: 'linear', base: 0, per: 0.005, cap: 0.495 }, fmt: pctFmt,
    gold: tcurve(FREEUP_COST), coin: tcurve(FREEUP_COST) },
  { id: 'freeUpUtility', tab: 'economic', icon: 'coins', label: 'Free Util',
    name: 'Free Utility Upgrade',
    tip: (up) => 'Chance each UTILITY upgrade costs no gold. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 99, gated: true, curve: { kind: 'linear', base: 0, per: 0.005, cap: 0.495 }, fmt: pctFmt,
    gold: tcurve(FREEUP_COST), coin: tcurve(FREEUP_COST) },
  { id: 'coinsPerWave', tab: 'economic', icon: 'coinstar', label: 'Coins/Wave',
    name: 'Coins per Wave',
    tip: 'Bonus coins (permanent currency) banked at end of each wave.',
    max: 149, gated: true, curve: { kind: 'linear', base: 0, per: 1 }, fmt: (v) => '+' + v, gold: tcurve(COINS_COST), coin: tcurve(COINS_COST) },
  { id: 'coinsPerKill', tab: 'economic', icon: 'coinstar', label: 'Coins/Kill',
    name: 'Coins per Kill',
    tip: (up) => 'Global multiplier on coins earned per kill. Base ' + up.fmt(up.value(0)) + ', max ' + up.fmt(up.value(up.max)) + '.',
    max: 149, gated: true, curve: { kind: 'linear', base: 1, per: 0.01 }, fmt: (v) => '×' + v.toFixed(2),
    gold: tcurve(COINS_COST), coin: tcurve(COINS_COST) },
  // ---- ENEMY-SKIP utilities: each wave, a chance to SKIP an enemy stat-level (enemies are treated
  // as one wave lower for that stat, for the rest of the run). +0.05%/level, capped near 35% at L699.
  { id: 'skipEnemyHp', tab: 'economic', icon: 'heart', label: 'Skip HP',
    name: 'Skip Enemy Health',
    tip: (up) => 'Each wave, this chance to skip an enemy HEALTH level — enemies stay one wave weaker for the rest of the run. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 699, gated: true, curve: { kind: 'linear', base: 0, per: 0.0005, cap: 0.3495 }, fmt: pctFmt,
    gold: skipCostCurve(), coin: skipCostCurve() },
  { id: 'skipEnemyDmg', tab: 'economic', icon: 'sword', label: 'Skip Atk',
    name: 'Skip Enemy Attack',
    tip: (up) => 'Each wave, this chance to skip an enemy ATTACK level — enemies stay one wave weaker for the rest of the run. Max: ' + up.fmt(up.value(up.max)) + '.',
    max: 699, gated: true, curve: { kind: 'linear', base: 0, per: 0.0005, cap: 0.3495 }, fmt: pctFmt,
    gold: skipCostCurve(), coin: skipCostCurve() },
];
// In-round GOLD costs TRACK the permanent COIN curve's shape, but are a flat fraction cheaper — so
// gold is ALWAYS cheaper than coin (never the geometric curve that started cheap then exploded past
// coin). Tune GOLD_FACTOR to rebalance the whole economy at once; COIN costs are untouched.
const GOLD_FACTOR = 0.33; // gold ≈ ⅓ of the coin price at every level

// Generate each upgrade's `value` from its `curve`, and derive its `gold` cost from its `coin` curve
// scaled by GOLD_FACTOR (floored at 1). Closures read live, so the dev dashboard can rebalance a
// coin curve in place and have gold + graphs + the sim follow with no rebuild.
export const UPGRADES: UpgradeDef[] = UPGRADE_SPECS.map((spec) => {
  const def = { ...spec } as UpgradeDef;
  def.stat = spec.stat || spec.id; // default the display-stat mapping to the upgrade's own id
  def.value = (b: number) => evalCurve(def.curve, b);
  const coinCurve = def.coin;
  const goldTable = GOLD_COST[spec.id];
  if (goldTable) {
    // Explicit authored gold curve (sampled). Overrides the coin×GOLD_FACTOR default.
    def.gold = {
      base: goldTable[0][1],
      grow: 0,
      points: goldTable,
      cost(n: number) { return Math.max(1, Math.round(interpTableGeom(this.points!, n))); },
    };
  } else {
    // Default: in-run gold tracks the permanent coin curve, a flat fraction cheaper.
    def.gold = {
      base: Math.max(1, Math.round(coinCurve.cost(0) * GOLD_FACTOR)),
      grow: 0,
      cost: (n: number) => Math.max(1, Math.round(coinCurve.cost(n) * GOLD_FACTOR)),
    };
  }
  return def;
});
export const UP_BY_ID: Record<string, UpgradeDef> = {};
for (const u of UPGRADES) UP_BY_ID[u.id] = u;
export const upgradesIn = (tab: string): UpgradeDef[] => UPGRADES.filter((u) => u.tab === tab);
// Evaluates a tip — functions receive the upgrade itself so they can derive values from
// value/fmt/max without any hardcoded balance numbers in the string.
export const tipOf = (up: UpgradeDef): string =>
  !up.tip ? '' : typeof up.tip === 'function' ? up.tip(up) : up.tip;

// The scripted first run grants exactly enough coins to buy the tutorial's first upgrade.
export const FIRST_PERM_COST = UP_BY_ID.attackSpeed.coin.cost(0);

// ---- SKILL UNLOCK GATE (Workshop) ----
// A skill must be UNLOCKED (with COINS, outside a run) before it can be bought in a run or perm.
// The three STARTER skills are free / pre-unlocked (the first-run tutorial buys attackSpeed).
export const STARTER_SKILLS = ['rangedDamage', 'attackSpeed', 'health'];
// Per-skill unlock-cost overrides (authoritative coin prices from the reference). 0 = free starter.
// Grouped skills (e.g. Multishot Chance + Targets) share one unlock price in the reference; here each
// row carries that price independently — a small, deliberate divergence to keep the gate per-skill.
export const UNLOCK_COST_OVERRIDE: Record<string, number> = {
  // free at game start
  critChance: 0, critDamage: 0, regen: 0,
  // attack
  range: 50, dmgPerMeter: 50,
  msChance: 1500, msTargets: 1500,
  rapidChance: 400, rapidDuration: 400,
  bounceChance: 10_000, bounceTargets: 10_000, bounceRange: 10_000,
  superCrit: 100_000_000, superCritMult: 100_000_000,
  rendChance: 500_000_000_000, rendMult: 500_000_000_000,
  // defense
  defPct: 75, armor: 75,
  thorns: 500, lifesteal: 2000,
  knockbackChance: 5000, knockbackForce: 5000,
  // utility
  cashBonus: 40, goldPerWave: 40,
  coinsPerKill: 100, coinsPerWave: 100,
  freeUpAttack: 800, freeUpDefense: 800, freeUpUtility: 800, interest: 5000,
  skipEnemyHp: 500_000_000, skipEnemyDmg: 500_000_000,
};
// Coin cost to unlock a skill: 0 for starters, the override if listed, else ≈10× its first-level price.
export function skillUnlockCost(id: string): number {
  if (STARTER_SKILLS.includes(id)) return 0;
  if (id in UNLOCK_COST_OVERRIDE) return UNLOCK_COST_OVERRIDE[id];
  const up = UP_BY_ID[id];
  return up ? Math.round(up.coin.cost(0) * 10) : 0;
}
// ---- skill GROUPS: related skills (e.g. Amp Chance + Amp Power) unlock together for ONE price (the
// per-skill price, not the sum). Within each category groups unlock sequentially in ascending cost
// order — buying one frees the next IN THAT TAB, so the categories advance independently. The Workshop
// lists skills in this order, keeping each group's members adjacent. ----
export interface SkillGroup { id: string; label: string; tab: string; cost: number; skills: string[]; }
const RAW_GROUPS: { id: string; label: string; skills: string[] }[] = [
  { id: 'damage', label: 'Damage', skills: ['rangedDamage'] },
  { id: 'atkspeed', label: 'Attack Speed', skills: ['attackSpeed'] },
  { id: 'critical', label: 'Critical', skills: ['critChance', 'critDamage'] },
  { id: 'health', label: 'Health', skills: ['health'] },
  { id: 'regen', label: 'HP Regen', skills: ['regen'] },
  { id: 'range', label: 'Range', skills: ['range', 'dmgPerMeter'] },
  { id: 'multishot', label: 'Lightning', skills: ['msChance', 'msTargets'] },
  { id: 'burst', label: 'Burst', skills: ['rapidChance', 'rapidDuration'] },
  { id: 'bounce', label: 'Lightning Arc', skills: ['bounceChance', 'bounceTargets', 'bounceRange'] },
  { id: 'supercrit', label: 'Super Crit', skills: ['superCrit', 'superCritMult'] },
  { id: 'amp', label: 'Amp', skills: ['rendChance', 'rendMult'] },
  { id: 'defense', label: 'Defense', skills: ['defPct', 'armor'] },
  { id: 'reflect', label: 'Disintegrate', skills: ['thorns'] },
  { id: 'lifesteal', label: 'Lifesteal', skills: ['lifesteal'] },
  { id: 'knockback', label: 'Knockback', skills: ['knockbackChance', 'knockbackForce'] },
  { id: 'gold', label: 'Gold Bonus', skills: ['cashBonus', 'goldPerWave'] },
  { id: 'goldkill', label: 'Gold / Kill', skills: ['goldPerKill'] },
  { id: 'coins', label: 'Coins', skills: ['coinsPerKill', 'coinsPerWave'] },
  { id: 'freeup', label: 'Free Upgrades', skills: ['freeUpAttack', 'freeUpDefense', 'freeUpUtility'] },
  { id: 'interest', label: 'Interest', skills: ['interest'] },
  { id: 'enemyskip', label: 'Enemy Skip', skills: ['skipEnemyHp', 'skipEnemyDmg'] },
];
// cost = the (shared) per-skill unlock price of the group's members; tab from the first member.
// Stable-sorted ascending by cost so the unlock sequence and the skill list follow the same order.
export const SKILL_GROUPS: SkillGroup[] = RAW_GROUPS
  .map((g) => ({ ...g, tab: (UP_BY_ID[g.skills[0]] || { tab: 'attack' }).tab, cost: skillUnlockCost(g.skills[0]) }))
  .sort((a, b) => a.cost - b.cost);
const GROUP_BY_ID: Record<string, SkillGroup> = {};
const GROUP_OF: Record<string, string> = {};
for (const g of SKILL_GROUPS) { GROUP_BY_ID[g.id] = g; for (const s of g.skills) GROUP_OF[s] = g.id; }
export const skillGroup = (id: string): SkillGroup | undefined => GROUP_BY_ID[GROUP_OF[id]];

export function isGroupUnlocked(meta: Meta, gid: string): boolean {
  const g = GROUP_BY_ID[gid];
  if (!g) return true;
  if (g.cost === 0) return true; // starter groups are free / pre-unlocked
  return !!(meta && meta.unlocked && meta.unlocked[gid]);
}
// A skill is buyable once its group is unlocked.
export function isUnlocked(meta: Meta, id: string): boolean {
  const gid = GROUP_OF[id];
  return gid ? isGroupUnlocked(meta, gid) : true;
}
// The single group the player may unlock next: the cheapest still-locked group. Unlock order is
// per-category — pass a tab to get that category's next group, so each tab advances independently.
export function nextUnlockGroup(meta: Meta, tab?: string): SkillGroup | null {
  for (const g of SKILL_GROUPS) {
    if (tab && g.tab !== tab) continue;
    if (!isGroupUnlocked(meta, g.id)) return g;
  }
  return null;
}
// Spend coins (outside a run) to unlock a group. Only the next-in-sequence group within the group's
// OWN category may be bought, so progress in one tab never gates another.
export function unlockGroup(meta: Meta, gid: string): boolean {
  const g = GROUP_BY_ID[gid];
  if (!g || isGroupUnlocked(meta, gid)) return false;
  const next = nextUnlockGroup(meta, g.tab);
  if (!next || next.id !== gid) return false; // must unlock in ascending-cost order within the category
  if ((meta.coins || 0) < g.cost) return false;
  meta.coins -= g.cost;
  meta.unlocked = meta.unlocked || {};
  meta.unlocked[gid] = true;
  return true;
}

// The effective cap for an upgrade: its base `max` PLUS any cap raised by labs.
function capOf(meta: Meta, id: string): number {
  const up = UP_BY_ID[id];
  return up.max + labCapBonus(meta, id);
}
// public alias of capOf (used by the HUD's level badges)
export const upgradeCap = (meta: Meta, id: string): number => capOf(meta, id);

// perm + run levels for an upgrade, capped at its (lab-liftable) cap.
export function boughtOf(state: State, id: string): number {
  const perm = (state.meta && state.meta.perm && state.meta.perm[id]) || 0;
  const run = (state.run && state.run.levels && state.run.levels[id]) || 0;
  // every UNLOCKED upgrade starts at level 1 (a free first level on top of what's purchased).
  const free = isUnlocked(state.meta, id) ? 1 : 0;
  return Math.min(capOf(state.meta, id), perm + run + free);
}
// perm-only level (used by the between-runs menu, which has no live run state)
export const permBought = (meta: Meta, id: string): number =>
  Math.min(capOf(meta, id), ((meta && meta.perm && meta.perm[id]) || 0) + (isUnlocked(meta, id) ? 1 : 0));

// ---- CARDS (collectable; bought/levelled with a separate active-play currency: GEMS) ----
// Cards now have 3 RARITIES and up to 15 LEVELS. Only cards placed in an ACTIVE SLOT affect stats.
// The per-level mechanic is the same "star" value mechanic (kept named `stars` for save compat),
// but capped at 15 and shown as a level. Values come from the balance tables (Lv 1,3,5,7,9,11,13
// given; even levels are linear-interpolated; Lv 14–15 extrapolate the per-level step). We encode
// each table as `table` points at the odd levels plus an explicit Lv15 so interpTable fills the gaps.
import type { Rarity } from '../types';
export const MAX_STARS = 15; // max card LEVEL (kept named MAX_STARS for the reveal/star-row visuals)
const xMul = (v: number): string => '×' + v.toFixed(2);
const xPct = (v: number): string => '+' + (v * 100).toFixed(0) + '%';
const secs = (v: number): string => Math.round(v) + 's';
// Each tbl(...) lists [level,value] at Lv 1,3,5,7,9,11,13,15 (Lv15 extrapolated). interpTable does
// the even-level interpolation. `kind:'mult'` cards: value IS the absolute multiplier (×v).
const tbl = (p: [number, number][]): Curve => ({ kind: 'table', points: p });
const CARD_SPECS: Record<string, CardSpec> = {
  // ---------------- COMMON (passive stat multipliers / flats) ----------------
  damage: { id: 'damage', name: 'Damage', art: 'bow', tint: '#4aa8ff', rarity: 'common',
    effects: [{ stat: 'rangedDamage', kind: 'mult' }],
    curve: tbl([[1, 1.50], [3, 2.00], [5, 2.40], [7, 2.80], [9, 3.20], [11, 3.60], [13, 4.00], [15, 4.40]]),
    fmt: xMul, desc: (v) => xMul(v) + ' damage' },
  attackSpeed: { id: 'attackSpeed', name: 'Attack Speed', art: 'rate', tint: '#ffae4a', rarity: 'common',
    effects: [{ stat: 'attackSpeed', kind: 'mult' }],
    curve: tbl([[1, 1.25], [3, 1.40], [5, 1.55], [7, 1.70], [9, 1.85], [11, 2.00], [13, 2.15], [15, 2.30]]),
    fmt: xMul, desc: (v) => xMul(v) + ' attack speed' },
  health: { id: 'health', name: 'Health', art: 'heart', tint: '#ff5d6c', rarity: 'common',
    effects: [{ stat: 'health', kind: 'mult' }],
    curve: tbl([[1, 1.50], [3, 2.00], [5, 2.40], [7, 2.80], [9, 3.20], [11, 3.60], [13, 4.00], [15, 4.40]]),
    fmt: xMul, desc: (v) => xMul(v) + ' health' },
  healthRegen: { id: 'healthRegen', name: 'Health Regen', art: 'regen', tint: '#3ddc84', rarity: 'common',
    effects: [{ stat: 'regen', kind: 'mult' }],
    curve: tbl([[1, 1.40], [3, 1.60], [5, 1.80], [7, 2.00], [9, 2.20], [11, 2.40], [13, 2.60], [15, 2.80]]),
    fmt: xMul, desc: (v) => xMul(v) + ' regen' },
  range: { id: 'range', name: 'Range', art: 'range', tint: '#37d7ff', rarity: 'common',
    effects: [{ stat: 'range', kind: 'mult' }],
    curve: tbl([[1, 1.15], [3, 1.20], [5, 1.25], [7, 1.30], [9, 1.35], [11, 1.40], [13, 1.45], [15, 1.50]]),
    fmt: xMul, desc: (v) => xMul(v) + ' range' },
  cash: { id: 'cash', name: 'Gold', art: 'coin', tint: '#ffd24a', rarity: 'common',
    effects: [{ stat: 'gold', kind: 'mult' }],
    curve: tbl([[1, 1.20], [3, 1.40], [5, 1.60], [7, 1.80], [9, 2.00], [11, 2.20], [13, 2.40], [15, 2.60]]),
    fmt: xMul, desc: (v) => xMul(v) + ' gold earned' },
  coins: { id: 'coins', name: 'Coins', art: 'coinstar', tint: '#ffd24a', rarity: 'common',
    effects: [{ stat: 'coins', kind: 'mult' }],
    curve: tbl([[1, 1.15], [3, 1.20], [5, 1.25], [7, 1.30], [9, 1.35], [11, 1.40], [13, 1.45], [15, 1.50]]),
    fmt: xMul, desc: (v) => xMul(v) + ' coins earned' },
  slowAura: { id: 'slowAura', name: 'Slow Aura', art: 'range', tint: '#37d7ff', rarity: 'common',
    effects: [{ stat: 'slowAura', kind: 'aura' }],
    curve: tbl([[1, 0.13], [3, 0.16], [5, 0.19], [7, 0.22], [9, 0.25], [11, 0.28], [13, 0.31], [15, 0.34]]),
    fmt: (v) => '-' + (v * 100).toFixed(0) + '%', desc: (v) => '-' + (v * 100).toFixed(0) + '% enemy speed in range' },
  critChance: { id: 'critChance', name: 'Critical Chance', art: 'crit', tint: '#ffd24a', rarity: 'common',
    effects: [{ stat: 'critChance', kind: 'flat' }],
    curve: tbl([[1, 0.05], [3, 0.06], [5, 0.07], [7, 0.08], [9, 0.09], [11, 0.10], [13, 0.11], [15, 0.12]]),
    fmt: xPct, desc: (v) => xPct(v) + ' crit chance' },
  enemyBalance: { id: 'enemyBalance', name: 'Enemy Balance', art: 'burst', tint: '#e64cff', rarity: 'common',
    effects: [{ stat: 'enemyBalance', kind: 'mechanic' }],
    curve: tbl([[1, 1.30], [3, 1.40], [5, 1.50], [7, 1.60], [9, 1.70], [11, 1.80], [13, 1.90], [15, 2.00]]),
    fmt: xMul, desc: (v) => xMul(v) + ' cash/kill, more enemies' },
  extraDefense: { id: 'extraDefense', name: 'Extra Defense', art: 'shield', tint: '#3ddc84', rarity: 'common',
    effects: [{ stat: 'defPct', kind: 'flat' }],
    curve: tbl([[1, 0.05], [3, 0.06], [5, 0.07], [7, 0.08], [9, 0.09], [11, 0.10], [13, 0.11], [15, 0.12]]),
    fmt: xPct, desc: (v) => xPct(v) + ' defense' },
  fortress: { id: 'fortress', name: 'Fortress', art: 'shield', tint: '#37d7ff', rarity: 'common',
    effects: [{ stat: 'armor', kind: 'mult' }],
    curve: tbl([[1, 1.30], [3, 1.45], [5, 1.60], [7, 1.75], [9, 1.90], [11, 2.05], [13, 2.20], [15, 2.35]]),
    fmt: xMul, desc: (v) => xMul(v) + ' armor' },
  overrun: { id: 'overrun', name: 'Overrun', art: 'rate', tint: '#e64cff', rarity: 'common',
    effects: [{ stat: 'lullReduce', kind: 'mechanic' }],
    curve: tbl([[1, 0.3], [15, 4.5]]), // linear: 0.3s of lull cut per star (5s base → 0.5s floor at ★15)
    fmt: (v) => '-' + v.toFixed(1) + 's', desc: (v) => '-' + v.toFixed(1) + 's wave cooldown' },
  critPower: { id: 'critPower', name: 'Critical Power', art: 'critPower', tint: '#ffd24a', rarity: 'common',
    effects: [{ stat: 'critDamage', kind: 'mult' }],
    curve: tbl([[1, 1.15], [3, 1.25], [5, 1.35], [7, 1.45], [9, 1.55], [11, 1.65], [13, 1.75], [15, 1.85]]),
    fmt: xMul, desc: (v) => xMul(v) + ' crit damage' },
  frenzy: { id: 'frenzy', name: 'Frenzy', art: 'frenzy', tint: '#ffae4a', rarity: 'common',
    effects: [{ stat: 'rapidChance', kind: 'flat' }],
    curve: tbl([[1, 0.03], [3, 0.04], [5, 0.05], [7, 0.06], [9, 0.07], [11, 0.08], [13, 0.09], [15, 0.10]]),
    fmt: xPct, desc: (v) => xPct(v) + ' burst chance' },
  volley: { id: 'volley', name: 'Volley', art: 'volley', tint: '#4aa8ff', rarity: 'common',
    effects: [{ stat: 'msChance', kind: 'flat' }],
    curve: tbl([[1, 0.04], [3, 0.05], [5, 0.06], [7, 0.07], [9, 0.08], [11, 0.09], [13, 0.10], [15, 0.12]]),
    fmt: xPct, desc: (v) => xPct(v) + ' split chance' },
  lifesteal: { id: 'lifesteal', name: 'Lifesteal', art: 'lifesteal', tint: '#ff5d6c', rarity: 'common',
    effects: [{ stat: 'lifesteal', kind: 'flat' }],
    curve: tbl([[1, 0.01], [3, 0.015], [5, 0.02], [7, 0.025], [9, 0.03], [11, 0.035], [13, 0.04], [15, 0.05]]),
    fmt: (v) => '+' + (v * 100).toFixed(1) + '%', desc: (v) => '+' + (v * 100).toFixed(1) + '% lifesteal' },
  thorns: { id: 'thorns', name: 'Thorns', art: 'thorns', tint: '#37d7ff', rarity: 'common',
    effects: [{ stat: 'thorns', kind: 'flat' }],
    curve: tbl([[1, 0.02], [3, 0.03], [5, 0.04], [7, 0.05], [9, 0.06], [11, 0.07], [13, 0.08], [15, 0.10]]),
    fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% disintegrate' },
  bounty: { id: 'bounty', name: 'Bounty', art: 'bounty', tint: '#ffd24a', rarity: 'common',
    effects: [{ stat: 'goldPerWave', kind: 'flat' }],
    curve: tbl([[1, 10], [3, 15], [5, 20], [7, 25], [9, 30], [11, 40], [13, 50], [15, 60]]),
    fmt: (v) => '+' + Math.round(v), desc: (v) => '+' + Math.round(v) + ' gold/wave' },

  // ---------------- RARE ----------------
  freeUpgrades: { id: 'freeUpgrades', name: 'Free Upgrades', art: 'coins', tint: '#3ddc84', rarity: 'rare',
    effects: [{ stat: 'freeUp', kind: 'flat' }],
    curve: tbl([[1, 0.04], [3, 0.05], [5, 0.06], [7, 0.07], [9, 0.08], [11, 0.09], [13, 0.10], [15, 0.11]]),
    fmt: xPct, desc: (v) => xPct(v) + ' free-upgrade chance' },
  plasmaCanon: { id: 'plasmaCanon', name: 'Plasma Canon', art: 'burst', tint: '#37d7ff', rarity: 'rare',
    effects: [{ stat: 'plasmaCanon', kind: 'active' }],
    curve: tbl([[1, 0.30], [3, 0.34], [5, 0.38], [7, 0.42], [9, 0.46], [11, 0.50], [13, 0.54], [15, 0.58]]),
    fmt: (v) => '-' + (v * 100).toFixed(0) + '%', desc: (v) => 'boss hit -' + (v * 100).toFixed(0) + '% max HP (once per boss)' },
  criticalCoin: { id: 'criticalCoin', name: 'Critical Coin', art: 'coinstar', tint: '#ffd24a', rarity: 'rare',
    effects: [{ stat: 'criticalCoin', kind: 'mechanic' }],
    curve: tbl([[1, 0.15], [3, 0.18], [5, 0.21], [7, 0.24], [9, 0.27], [11, 0.30], [13, 0.33], [15, 0.36]]),
    fmt: xPct, desc: (v) => xPct(v) + ' crit-kill bonus-coin chance' },
  waveSkip: { id: 'waveSkip', name: 'Wave Skip', art: 'arrow', tint: '#4aa8ff', rarity: 'rare',
    effects: [{ stat: 'waveSkip', kind: 'mechanic' }],
    curve: tbl([[1, 0.09], [3, 0.10], [5, 0.11], [7, 0.13], [9, 0.15], [11, 0.17], [13, 0.19], [15, 0.21]]),
    fmt: xPct, desc: (v) => xPct(v) + ' chance to skip a wave' },
  amplify: { id: 'amplify', name: 'Amplify', art: 'amplify', tint: '#e64cff', rarity: 'rare',
    effects: [{ stat: 'rendChance', kind: 'flat' }, { stat: 'rendMult', kind: 'flat' }],
    curve: tbl([[1, 0.04], [3, 0.05], [5, 0.06], [7, 0.07], [9, 0.08], [11, 0.09], [13, 0.10], [15, 0.12]]),
    fmt: xPct, desc: (v) => xPct(v) + ' amp chance & power' },
  overload: { id: 'overload', name: 'Overload', art: 'overload', tint: '#e64cff', rarity: 'rare',
    effects: [{ stat: 'superCrit', kind: 'flat' }],
    curve: tbl([[1, 0.02], [3, 0.03], [5, 0.04], [7, 0.05], [9, 0.06], [11, 0.07], [13, 0.08], [15, 0.10]]),
    fmt: xPct, desc: (v) => xPct(v) + ' super-crit chance' },
  onslaught: { id: 'onslaught', name: 'Onslaught', art: 'onslaught', tint: '#e64cff', rarity: 'rare',
    effects: [{ stat: 'waveAccel', kind: 'mechanic' }],
    curve: tbl([[1, 0.05], [3, 0.07], [5, 0.10], [7, 0.13], [9, 0.16], [11, 0.19], [13, 0.22], [15, 0.25]]),
    fmt: (v) => '-' + (v * 100).toFixed(0) + '%', desc: (v) => '-' + (v * 100).toFixed(0) + '% wave interval' },
  investor: { id: 'investor', name: 'Investor', art: 'investor', tint: '#3ddc84', rarity: 'rare',
    effects: [{ stat: 'interest', kind: 'flat' }],
    curve: tbl([[1, 0.005], [3, 0.007], [5, 0.010], [7, 0.013], [9, 0.016], [11, 0.020], [13, 0.025], [15, 0.030]]),
    fmt: (v) => (v * 100).toFixed(1) + '%/wave', desc: (v) => '+' + (v * 100).toFixed(1) + '%/wave interest' },

  // ---------------- EPIC (active abilities) ----------------
  superTower: { id: 'superTower', name: 'Super Tower', art: 'burst', tint: '#e64cff', rarity: 'epic',
    effects: [{ stat: 'superTower', kind: 'active' }], active: { duration: 15, cooldown: 30 },
    curve: tbl([[1, 2.5], [3, 2.9], [5, 3.3], [7, 3.7], [9, 4.1], [11, 4.5], [13, 5.0], [15, 5.5]]),
    fmt: (v) => '×' + v.toFixed(1), desc: (v) => '×' + v.toFixed(1) + ' damage for 15s' },
  secondWind: { id: 'secondWind', name: 'Revive', art: 'heart', tint: '#ff5d6c', rarity: 'epic',
    effects: [{ stat: 'secondWind', kind: 'active' }],
    curve: tbl([[1, 10], [3, 15], [5, 20], [7, 25], [9, 30], [11, 35], [13, 40], [15, 45]]),
    fmt: secs, desc: (v) => 'revive once/run, ' + Math.round(v) + 's shield' },
  demonMode: { id: 'demonMode', name: 'Dark Wiz', art: 'burst', tint: '#e64cff', rarity: 'epic',
    effects: [{ stat: 'demonMode', kind: 'active' }], active: { duration: 180 },
    curve: tbl([[1, 180], [3, 200], [5, 220], [7, 240], [9, 260], [11, 280], [13, 300], [15, 320]]),
    fmt: secs, desc: (v) => '×3 dmg + invincible ' + Math.round(v) + 's, once/run' },
};
// Generate each card's `value` from its `curve` (reads `def.curve` live, like the upgrades).
export const CARDS: Record<string, CardDef> = {};
for (const id of Object.keys(CARD_SPECS)) {
  const def = { ...CARD_SPECS[id] } as CardDef;
  def.value = (stars: number) => evalCurve(def.curve, stars);
  CARDS[id] = def;
}
// Display order, grouped by rarity (common → rare → epic).
export const CARD_ORDER = [
  'damage', 'attackSpeed', 'health', 'healthRegen', 'range', 'cash', 'coins', 'slowAura',
  'critChance', 'enemyBalance', 'extraDefense', 'fortress', 'overrun',
  'critPower', 'frenzy', 'volley', 'lifesteal', 'thorns', 'bounty',
  'freeUpgrades', 'plasmaCanon', 'criticalCoin', 'waveSkip',
  'amplify', 'overload', 'onslaught', 'investor',
  'superTower', 'secondWind', 'demonMode',
];
export const CARD_SLOTS = CARD_ORDER.length; // grid size (one tile per defined card)
// rarity → draw weight. Roll the rarity first, then pick a card within it.
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 0.8, rare: 0.17, epic: 0.03 };
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic'];
export const cardsOfRarity = (r: Rarity): string[] => CARD_ORDER.filter((id) => CARDS[id].rarity === r);
// plain-language explanation of what each card actually does (shown in the card detail view).
export const CARD_INFO: Record<string, string> = {
  damage: 'Multiplies all of your tower damage.',
  attackSpeed: 'Attack faster — more shots per second.',
  health: 'Multiplies your maximum health.',
  healthRegen: 'Multiplies your health regeneration.',
  range: 'Extends how far you can attack.',
  cash: 'Multiplies all gold earned.',
  coins: 'Multiplies all coins earned.',
  slowAura: 'Enemies within range move slower.',
  critChance: 'Raises your chance to critically strike.',
  enemyBalance: 'More enemies on screen at once, and more cash per kill.',
  extraDefense: 'Adds percentage damage reduction.',
  fortress: 'Multiplies your flat armor.',
  overrun: 'Shortens the no-spawn lull between waves, keeping pressure up.',
  critPower: 'Multiplies your critical-hit damage.',
  frenzy: 'Raises the chance to trigger a high fire-rate burst.',
  volley: 'Raises the chance an attack splits to extra nearby targets.',
  lifesteal: 'Heals you for a share of all damage you deal.',
  thorns: 'Enemies that strike the tower lose a share of their own max HP.',
  bounty: 'Adds bonus gold at the start of every wave.',
  freeUpgrades: 'Raises the chance an in-run upgrade is free.',
  plasmaCanon: 'When a boss appears, hurls a plasma orb that strikes it once for a share of its max HP.',
  criticalCoin: 'Critical kills can drop bonus coins (base × crit damage).',
  waveSkip: 'Chance at each wave to skip it and bank coins + cash.',
  amplify: 'Raises both the chance to apply Amp stacks and the damage each stack adds.',
  overload: 'On a critical hit, raises the chance to apply the crit multiplier again.',
  onslaught: 'Shortens the time between waves — faster spawns, faster spoils, faster bosses.',
  investor: 'Earns extra gold each wave as interest on your banked gold.',
  superTower: 'Activates for 15s of greatly boosted damage (30s cooldown).',
  secondWind: 'Auto-revives at half HP once per run with a brief shield. Stays armed until it fires.',
  demonMode: 'Tap to unleash: triple damage and invincibility for a while. Once per run.',
};
export const starSlot = (i: number, stars: number): string =>
  stars >= i + 11 ? 'chroma' : stars >= i + 6 ? 'gold' : stars >= i + 1 ? 'white' : 'empty';

export const buyCardCost = (meta: Meta): number => 5 + 5 * (meta.cardBuys || 0);

// ---- active-card slots (gems) ----
// Slot 1 is free; subsequent slots use the table (slot 2 = 50, …, slot 22 = 10000).
export const CARD_SLOT_COSTS = [0, 50, 100, 200, 300, 400, 500, 600, 750, 1000, 1200, 1400, 1600, 1800, 2500,
  3500, 4500, 5500, 6500, 7500, 8500, 10000];
export const MAX_CARD_SLOTS = CARD_SLOT_COSTS.length; // 22
// Cost to buy the NEXT slot (index = current slot count). Returns 0 when already at max.
export function cardSlotCost(meta: Meta): number {
  const cur = Math.max(1, meta.cardSlots || 1);
  return cur >= MAX_CARD_SLOTS ? 0 : CARD_SLOT_COSTS[cur] || 0;
}
export function buyCardSlot(meta: Meta): boolean {
  const cur = Math.max(1, meta.cardSlots || 1);
  if (cur >= MAX_CARD_SLOTS) return false;
  const cost = cardSlotCost(meta);
  if ((meta.gems || 0) < cost) return false;
  meta.gems -= cost;
  meta.cardSlots = cur + 1;
  return true;
}
// Place `id` (or null to clear) into active slot `slot` (0-indexed). An id may occupy only one slot;
// placing a card already active elsewhere moves it. Out-of-range slots are ignored.
export function setActiveCard(meta: Meta, slot: number, id: string | null): boolean {
  const slots = Math.max(1, meta.cardSlots || 1);
  if (slot < 0 || slot >= slots) return false;
  const arr = (meta.activeCards = (meta.activeCards || []).slice(0, slots));
  while (arr.length < slots) arr.push('');
  if (id) {
    const prev = arr.indexOf(id); // de-dupe: a card can be in only one slot
    if (prev >= 0 && prev !== slot) arr[prev] = '';
  }
  arr[slot] = id || '';
  meta.activeCards = arr;
  return true;
}
// The ids currently in active slots (filtered to owned, non-empty, real cards).
export function activeCardIds(meta: Meta): string[] {
  const owned = new Set((meta.cards || []).map((c) => c.id));
  return (meta.activeCards || []).filter((id) => id && owned.has(id) && CARDS[id]);
}

// A single draw rolls RARITY first (common 80% / rare 17% / epic 3%), then picks a card in that
// rarity — preferring an un-owned card, else a non-maxed owned card to level up. If the rolled
// rarity has nothing to give, it falls through to the other rarities (so a draw is never wasted while
// any card can still improve). Returns { id, before, after, unlocked } or null (can't draw / afford).
export function buyCard(meta: Meta, rng?: () => number): CardDrawResult | null {
  meta.cards = meta.cards || [];
  const rand = rng || Math.random;
  const cost = buyCardCost(meta);
  if ((meta.gems || 0) < cost) return null;
  // candidate ids in a rarity that can still improve (un-owned, or owned below max).
  const poolOf = (r: Rarity): string[] =>
    cardsOfRarity(r).filter((id) => {
      const c = meta.cards.find((x) => x.id === id);
      return !c || (c.stars || 0) < MAX_STARS;
    });
  if (!RARITY_ORDER.some((r) => poolOf(r).length)) return null; // everything maxed
  // roll a rarity by weight, then fall back through the rarities (rolled first) until one has a pool.
  const roll = rand();
  let acc = 0,
    rolled: Rarity = 'common';
  for (const r of RARITY_ORDER) {
    acc += RARITY_WEIGHT[r];
    if (roll < acc) { rolled = r; break; }
  }
  const order = [rolled, ...RARITY_ORDER.filter((r) => r !== rolled)];
  let pool: string[] = [];
  for (const r of order) { pool = poolOf(r); if (pool.length) break; }
  if (!pool.length) return null;
  // prefer un-owned cards in the chosen pool; otherwise level up an owned one.
  const unowned = pool.filter((id) => !meta.cards.find((c) => c.id === id));
  const candidates = unowned.length ? unowned : pool;
  const id = candidates[Math.floor(rand() * candidates.length)];
  const owned = meta.cards.find((c) => c.id === id);
  let before: number, after: number, unlocked = false;
  if (owned) {
    before = owned.stars || 0;
    owned.stars = before + 1; // pool excludes maxed cards, so this never exceeds MAX_STARS
    after = owned.stars;
  } else {
    before = 0;
    after = 1;
    unlocked = true;
    meta.cards.push({ id, stars: 1 });
  }
  meta.gems -= cost;
  meta.cardBuys = (meta.cardBuys || 0) + 1;
  return { id, before, after, unlocked };
}

// ---- tier / milestones (rewards for furthest-wave progress, tracked PER TIER) ----
// The wave a tier's first batch of labs unlocks at. Its milestone pays no currency — reaching it opens
// the tier-1 lab ladder (the Game Speed lab is always available; everything else gates here). Later
// this is where individual labs will be linked to their own milestone rungs.
export const LAB_UNLOCK_WAVE = 30;
export const MILESTONES: number[] = (() => {
  const a = [10, LAB_UNLOCK_WAVE, 50, 100, 250, 500];
  for (let w = 1000; w <= 10000; w += 1000) a.push(w);
  return a;
})();
// Milestones are PER TIER: progress (the tier's furthest wave) and the claimed flag are both keyed by
// the SELECTED tier, so switching tiers shows that tier's own ladder. A milestone pays one of:
//   • a TOWER SKIN — the wave-1000 milestone IS that tier's tower-skin unlock, and pays nothing else;
//   • COINS on even rungs (wave × MS_COIN_MULT);
//   • a "special" currency on odd rungs — GEMS in tier 1, and in tier 2+ alternating gems / vials
//     (coins, gems, coins, vials, …). Gem/vial amounts escalate 10, 20, 30, … per slot of that kind.
export interface MilestoneReward { coins: number; gems: number; vials: number; tower?: string; lab?: boolean }
const MS_COIN_MULT = 20;
const msKey = (tier: number, wave: number): string => (tier || 1) + ':' + wave;
const msBest = (meta: Meta, tier: number): number => (meta.tierBest && meta.tierBest[tier]) || 0;
const msTiers = (meta: Meta): number[] => Object.keys(meta.tierBest || {}).map(Number).filter((t) => t >= 1);
// The currency rungs are indexed as if the special lab-unlock rung weren't in the ladder, so inserting
// the wave-30 milestone never shifts the coins↔gems pattern (or amounts) of any rung above it.
function currencyRungIndex(wave: number): number {
  const i = MILESTONES.indexOf(wave);
  let skipped = 0;
  for (let k = 0; k < i; k++) if (MILESTONES[k] === LAB_UNLOCK_WAVE) skipped++;
  return i - skipped;
}
export function milestoneReward(wave: number, tier = 1): MilestoneReward {
  const none: MilestoneReward = { coins: 0, gems: 0, vials: 0 };
  const i = MILESTONES.indexOf(wave);
  if (i < 0) return none;
  // Wave 30: the lab-unlock milestone — reaching it opens this tier's labs (no currency reward; the
  // HUD lists exactly which labs). Flagged `lab` so it's rendered/treated like the tower rung, not a claim.
  if (wave === LAB_UNLOCK_WAVE) return { ...none, lab: true };
  // Wave 1000 in a tier that has a tower skin → the skin IS the reward (nothing else).
  if (wave === TOWER_UNLOCK_WAVE) {
    const t = towerForTier(tier || 1);
    if (t) return { ...none, tower: t.id };
  }
  const ci = currencyRungIndex(wave);
  if (ci % 2 === 0) return { ...none, coins: wave * MS_COIN_MULT }; // even rungs → coins
  const oddSlot = (ci - 1) / 2; // 0,1,2,… across the odd rungs
  if ((tier || 1) === 1) return { ...none, gems: 10 * (oddSlot + 1) }; // tier 1: every odd rung pays gems
  // tier 2+: odd rungs alternate gems / vials, each escalating on its own slot of that kind
  return oddSlot % 2 === 0
    ? { ...none, gems: 10 * (oddSlot / 2 + 1) }
    : { ...none, vials: 10 * ((oddSlot - 1) / 2 + 1) };
}
// Whether a milestone is currency-claimable (tower skins + the lab unlock track progress, never "claimed").
const isClaimable = (r: MilestoneReward): boolean => !r.tower && !r.lab && (r.coins > 0 || r.gems > 0 || r.vials > 0);
// Claimable count for ONE tier (drives the hero-tab section badge).
export function tierClaimableCount(meta: Meta, tier: number): number {
  const best = msBest(meta, tier),
    cl = meta.claimedMilestones || {};
  let c = 0;
  for (const w of MILESTONES) if (best >= w && !cl[msKey(tier, w)] && isClaimable(milestoneReward(w, tier))) c++;
  return c;
}
export function claimMilestone(meta: Meta, tier: number, wave: number): MilestoneReward {
  const out: MilestoneReward = { coins: 0, gems: 0, vials: 0 };
  meta.claimedMilestones = meta.claimedMilestones || {};
  const key = msKey(tier, wave);
  const r = milestoneReward(wave, tier);
  if (msBest(meta, tier) >= wave && !meta.claimedMilestones[key] && isClaimable(r)) {
    r.gems = Math.round(r.gems * cosmeticBuffMult(meta, 'gemMult')); // ×gem cosmetic buff
    meta.coins = (meta.coins || 0) + r.coins;
    meta.gems = (meta.gems || 0) + r.gems;
    meta.vials = (meta.vials || 0) + r.vials;
    meta.claimedMilestones[key] = true;
    return r;
  }
  return out;
}
// Claim ALL currently-claimable milestones across every tier (the floating button does this).
export function claimAllMilestones(meta: Meta): MilestoneReward {
  const out: MilestoneReward = { coins: 0, gems: 0, vials: 0 };
  for (const t of msTiers(meta)) {
    const best = msBest(meta, t);
    for (const w of MILESTONES) {
      if (best >= w) {
        const r = claimMilestone(meta, t, w);
        out.coins += r.coins;
        out.gems += r.gems;
        out.vials += r.vials;
      }
    }
  }
  return out;
}

// Turn levels into the numbers the sim runs on, then apply card bonuses.
// Maps a CARD EFFECT `stat` name → the sim stat key it multiplies/adds. This is the card-authoring
// vocabulary, NOT the same as UpgradeDef.stat: it has aliases with no upgrade (`gold`→goldFind) and
// deliberately differs for range (cards scale `range` in PIXELS, while the Range upgrade *displays*
// `rangeM` in metres). Keep it separate — don't try to derive it from UpgradeDef.stat.
const STAT2SIM: Record<string, string> = {
  rangedDamage: 'rangedDamage', attackSpeed: 'fireRate', health: 'maxHp', regen: 'regen',
  critChance: 'critChance', critDamage: 'critMult', gold: 'goldFind', range: 'range',
  armor: 'armor', defPct: 'defPct',
};
// Card effect stats that are NOT a plain base stat — their value is surfaced under this Stats key for
// the sim / active subsystem to read (aura debuffs, mechanic hooks, active-ability magnitudes).
const CARD_PASSTHROUGH: Record<string, string> = {
  coins: 'cardCoinMult',       // ×multiplier on coins earned
  slowAura: 'slowAura',        // enemy speed reduction in range (fraction)
  enemyBalance: 'enemyBalance',// cash/kill ×mult (and a higher alive-cap hook)
  lullReduce: 'lullReduce',    // seconds shaved off the end-of-wave no-spawn lull
  criticalCoin: 'criticalCoin',// crit-kill bonus-coin chance
  waveSkip: 'waveSkip',        // chance to skip a wave
  waveAccel: 'waveAccel',      // wave-cooldown reduction (fraction)
  freeUp: 'cardFreeUp',        // added to the in-run free-upgrade chance
  plasmaCanon: 'plasmaCanon',  // boss max-HP fraction per shot
  superTower: 'superTower',    // damage ×mult while active
  secondWind: 'secondWind',    // shield seconds on revive
  demonMode: 'demonMode',      // invincible/×3 seconds
};
export function computeStats(state: State): Stats {
  const b = (id: string) => boughtOf(state, id);
  const U = UP_BY_ID;
  const rangeM = U.range.value(b('range'));
  const out: Stats = {
    rangedDamage: U.rangedDamage.value(b('rangedDamage')),
    fireRate: U.attackSpeed.value(b('attackSpeed')),
    maxHp: U.health.value(b('health')),
    regen: U.regen.value(b('regen')),
    rangeM,
    range: rangeM * PX_PER_METER,
    dmgPerMeter: U.dmgPerMeter.value(b('dmgPerMeter')),
    critChance: U.critChance.value(b('critChance')),
    critMult: U.critDamage.value(b('critDamage')),
    superCrit: U.superCrit.value(b('superCrit')),
    superCritMult: U.superCritMult.value(b('superCritMult')), // TODO: apply superCritMult in core _rollDamage
    rendChance: U.rendChance.value(b('rendChance')),
    rendMult: U.rendMult.value(b('rendMult')),
    msChance: U.msChance.value(b('msChance')),
    msTargets: U.msTargets.value(b('msTargets')),
    bounceChance: U.bounceChance.value(b('bounceChance')),
    bounceTargets: U.bounceTargets.value(b('bounceTargets')),
    bounceRange: U.bounceRange.value(b('bounceRange')),
    rapidChance: U.rapidChance.value(b('rapidChance')),
    rapidDuration: U.rapidDuration.value(b('rapidDuration')),

    knockbackChance: U.knockbackChance.value(b('knockbackChance')),
    knockbackForce: U.knockbackForce.value(b('knockbackForce')),
    armor: U.armor.value(b('armor')),
    defPct: U.defPct.value(b('defPct')),
    thorns: U.thorns.value(b('thorns')),
    lifesteal: U.lifesteal.value(b('lifesteal')),
    cashMult: U.cashBonus.value(b('cashBonus')),
    interest: U.interest.value(b('interest')),
    interestCap: labInterestCap(state.meta), // per-wave gold ceiling on interest income (25 → 20k via lab)
    goldPerWave: U.goldPerWave.value(b('goldPerWave')),
    coinsPerWave: U.coinsPerWave.value(b('coinsPerWave')),
    coinsPerKill: U.coinsPerKill.value(b('coinsPerKill')),
    goldFind: U.goldPerKill.value(b('goldPerKill')), // value IS the ×multiplier (1.00 → 2.49)
    skipEnemyHp: U.skipEnemyHp.value(b('skipEnemyHp')),   // per-wave chance to skip an enemy HEALTH level
    skipEnemyDmg: U.skipEnemyDmg.value(b('skipEnemyDmg')), // per-wave chance to skip an enemy ATTACK level
    // ---- card-driven aura/mechanic/active stats (0 / 1 when no card supplies them) ----
    cardCoinMult: 1,   // ×coins from the Coins card
    slowAura: 0,       // enemy speed reduction within range (fraction)
    enemyBalance: 1,   // cash/kill ×mult from Enemy Balance
    lullReduce: 0,     // seconds shaved off the between-wave lull (Overrun card)
    criticalCoin: 0,   // crit-kill bonus-coin chance
    waveSkip: 0,       // chance to skip a wave
    waveAccel: 0,      // wave-cooldown reduction (fraction)
    plasmaCanon: 0,    // boss max-HP fraction per plasma shot
    superTower: 0,     // damage ×mult while Super Tower is active
    secondWind: 0,     // Second Wind shield seconds (0 = card not active)
    demonMode: 0,      // Demon Mode duration seconds (0 = card not active)
    cardFreeUp: 0,     // added to the in-run free-upgrade chance
  };
  // Resolve ACTIVE cards + labs into the final stats, keyed by SIM stat. Only cards placed in an
  // active slot count — merely owning a card does nothing. mult-kind card values are ABSOLUTE
  // multipliers (×v); flat-kind add; aura/mechanic/active values overwrite their passthrough stat
  // (taking the max if two active cards somehow share one — they cannot, given de-dupe by id).
  const flat: Record<string, number> = {},
    mult: Record<string, number> = {},
    pass: Record<string, number> = {};
  const activeIds = activeCardIds(state.meta || ({} as State['meta']));
  const cards = activeIds.map((id) => (state.meta.cards || []).find((c) => c.id === id)!).filter(Boolean);
  for (const c of cards) {
    const def = CARDS[c.id];
    if (!def) continue;
    const v = def.value(c.stars || 0);
    for (const e of def.effects) {
      if (e.kind === 'aura' || e.kind === 'mechanic' || e.kind === 'active') {
        const pk = CARD_PASSTHROUGH[e.stat] || e.stat;
        pass[pk] = Math.max(pass[pk] || 0, v);
        continue;
      }
      const k = STAT2SIM[e.stat] || CARD_PASSTHROUGH[e.stat] || e.stat;
      // mult-kind card values are ABSOLUTE multipliers (×v), composed multiplicatively.
      if (e.kind === 'mult') mult[k] = (mult[k] || 1) * v;
      else flat[k] = (flat[k] || 0) + v;
    }
  }
  const labMult = labScaleMults(state.meta) || {};
  const labFlat = labFlatAdds(state.meta) || {};
  const touched = new Set([
    ...Object.keys(flat), ...Object.keys(mult), ...Object.keys(labMult), ...Object.keys(labFlat),
  ]);
  for (const k of touched) {
    if (typeof out[k] !== 'number') continue;
    out[k] = (out[k] + (flat[k] || 0) + (labFlat[k] || 0)) * (labMult[k] || 1) * (mult[k] || 1);
  }
  // The Range lab adds metres (authored on `rangeM`); mirror those metres into the px `range` the sim
  // actually uses for targeting, so display and gameplay stay in lock-step.
  if (labFlat.rangeM) out.range += labFlat.rangeM * PX_PER_METER;
  // Surface card aura/mechanic/active magnitudes (these do not scale a base stat).
  for (const k of Object.keys(pass)) out[k] = pass[k];
  // The Coins card multiplies the coins-per-kill stat directly.
  if (pass.cardCoinMult) out.coinsPerKill = (out.coinsPerKill || 1) * pass.cardCoinMult;
  // Free Upgrades card adds to the effective free-upgrade chance.
  if (pass.cardFreeUp) out.cardFreeUp = pass.cardFreeUp;
  // ---- passive COSMETIC buffs (unlocked tower/hud/background skins) ----
  // Always-on, multiplicative, and composed on TOP of cards + labs (matching their "multiply the
  // total so far" rule). Economy/wall-clock cosmetic buffs (coins / gems / lab speed) live in
  // waves.ts / labs.ts; here we apply only the ones that land on a sim stat.
  const cm = (key: string): number => cosmeticBuffMult(state.meta, key);
  out.rangedDamage *= cm('rangedDamage');
  out.fireRate *= cm('fireRate');
  out.maxHp *= cm('maxHp');
  out.critChance *= cm('critChance');
  out.critMult *= cm('critMult');
  out.bounceChance *= cm('bounceChance');
  out.goldFind *= cm('goldFind');
  const rmul = cm('range');
  out.range *= rmul;
  out.rangeM *= rmul;
  // Unlocking the Lightning group (formerly Multishot) permanently swaps the hero from
  // bullets to lightning. Derived here so it survives reload without extra save state.
  if (isGroupUnlocked(state.meta, 'multishot')) state.atkMode = 'lightning';
  return out;
}

// The EFFECTIVE value of an upgrade at a hypothetical `level`: base curve × labs × active cards ×
// cosmetics — exactly what the sim runs on. We get perfect parity (no formula duplication / drift) by
// driving the real computeStats on a throwaway state with just this one upgrade overridden to `level`
// (every other upgrade, plus the card loadout / labs / cosmetics, stays at the player's real values).
export function effectiveUpgradeValue(meta: Meta, id: string, level: number): number {
  const up = UP_BY_ID[id];
  if (!up) return 0;
  const perm = (meta && meta.perm && meta.perm[id]) || 0;
  // run.levels stacks on top of perm in boughtOf, so a delta of (level - perm) lands boughtOf on `level`.
  const pseudo = { meta, run: { levels: { [id]: level - perm } } } as unknown as State;
  const st = computeStats(pseudo) as unknown as Record<string, number>;
  const v = st[up.stat || id]; // up.stat is the single source of truth for the id→Stats-key mapping
  return typeof v === 'number' ? v : up.value(level);
}

// The FULL coin multiplier the player effectively earns: tier baseline × Tier Coin lab × the Coins
// card × the passive coin cosmetic buff. This is the multiplier coinsForRun applies to (maxWave +
// per-kill/per-wave coins), so per-kill coins ARE multiplied by tier/lab/card/cosmetic — multiplying
// the banked total is distributive over the per-kill sum. Single source of truth for HUD readouts.
export function effectiveCoinMult(meta: Meta, tier: number): number {
  const card = computeStats({ meta, run: { levels: {} } } as unknown as State).cardCoinMult || 1;
  return coinMult(tier) * labTierCoinMult(meta) * card * cosmeticBuffMult(meta, 'coinMult');
}

// ---- run upgrades (gold; price driven by run levels only) ----
export function runUpgradeCost(state: State, id: string): number {
  const up = UP_BY_ID[id];
  if (!up) return 0;
  return up.gold.cost(state.run.levels[id] || 0);
}
export function runAtMax(state: State, id: string): boolean {
  const perm = (state.meta.perm && state.meta.perm[id]) || 0;
  const free = isUnlocked(state.meta, id) ? 1 : 0; // the free level 1 counts toward the cap
  return perm + (state.run.levels[id] || 0) + free >= capOf(state.meta, id);
}
// `rng` (the live Sim PRNG) is optional; when present it drives the Free-Upgrades roll.
export function buyRunUpgrade(state: State, id: string, rng?: { next(): number }): boolean {
  const up = UP_BY_ID[id];
  if (!up) return false;
  if (!isUnlocked(state.meta, id)) return false; // gated: must be unlocked in the Workshop first
  if (runAtMax(state, id)) return false;
  const n = state.run.levels[id] || 0,
    cost = up.gold.cost(n);
  // Free-upgrade chance = the per-tab Free Upgrade skill + any active Free Upgrades card (additive).
  const FREE_BY_TAB: Record<string, string> = {
    attack: 'freeUpAttack', defense: 'freeUpDefense', economic: 'freeUpUtility',
  };
  const freeId = FREE_BY_TAB[up.tab];
  let freeChance = freeId ? UP_BY_ID[freeId].value(boughtOf(state, freeId)) : 0;
  for (const c of activeCardIds(state.meta || ({} as State['meta']))) {
    const def = CARDS[c];
    if (def && def.effects.some((e) => e.stat === 'freeUp')) {
      const inst = (state.meta.cards || []).find((x) => x.id === c);
      freeChance += def.value((inst && inst.stars) || 0);
    }
  }
  const free = !!rng && freeChance > 0 && rng.next() < freeChance;
  if (!free) {
    if (state.econ.gold < cost) return false;
    state.econ.gold -= cost;
  }
  state.run.levels[id] = n + 1;
  return true;
}

// ---- permanent upgrades (coins; price driven by perm levels only) ----
export function permCost(meta: Meta, id: string): number {
  const up = UP_BY_ID[id];
  const n = (meta && meta.perm && meta.perm[id]) || 0;
  return up ? up.coin.cost(n) : 0;
}
export function permAtMax(meta: Meta, id: string): boolean {
  const free = isUnlocked(meta, id) ? 1 : 0; // the free level 1 counts toward the cap
  return ((meta && meta.perm && meta.perm[id]) || 0) + free >= capOf(meta, id);
}
export function buyPerm(meta: Meta, id: string): boolean {
  const up = UP_BY_ID[id];
  if (!up) return false;
  if (!isUnlocked(meta, id)) return false; // gated: must be unlocked in the Workshop first
  const n = (meta.perm && meta.perm[id]) || 0;
  if (permAtMax(meta, id)) return false;
  const cost = up.coin.cost(n);
  if ((meta.coins || 0) < cost) return false;
  meta.coins -= cost;
  meta.perm = meta.perm || {};
  meta.perm[id] = n + 1;
  return true;
}

// ---- bulk buy (the 1x / 5x / 25x / 100x / Max multiplier on the buy button) ----
// Each tier above 1x is gated behind an "unlock" key. The gate is currently modelled as a
// pre-completed LAB (meta.labs[unlock] >= 1, seeded for every player in migrateMeta) so the
// whole feature can later be locked behind real, purchasable labs by simply dropping that seed.
export interface BulkTier {
  label: string;
  qty: BulkQty;
  unlock: string | null; // null = always available (the base 1x); else a meta.labs key
}
export const BULK_TIERS: BulkTier[] = [
  { label: '1x', qty: 1, unlock: null },
  { label: '5x', qty: 5, unlock: 'bulk5' },
  { label: '25x', qty: 25, unlock: 'bulk25' },
  { label: '100x', qty: 100, unlock: 'bulk100' },
  { label: 'Max', qty: 'max', unlock: 'bulkMax' },
];
// the meta.labs keys that gate the bulk tiers — exported so migrateMeta can seed them.
export const BULK_UNLOCKS = BULK_TIERS.map((t) => t.unlock).filter((u): u is string => !!u);
export function bulkTierUnlocked(meta: Meta, t: BulkTier): boolean {
  return t.unlock == null || ((meta && meta.labs && meta.labs[t.unlock]) || 0) >= 1;
}
// the tiers a player may currently pick. When this is length 1 (only 1x), the HUD hides the
// multiplier toggle entirely — so locking every tier cleanly reverts to a plain single buy.
export const availableBulkTiers = (meta: Meta): BulkTier[] => BULK_TIERS.filter((t) => bulkTierUnlocked(meta, t));

export interface BulkPlan {
  qty: BulkQty;
  count: number; // how many levels are actually affordable + within cap (what 'Buy' will purchase)
  cost: number; // total price of those `count` affordable levels
  full: number; // total price of the *requested* levels (qty, capped to remaining), ignoring funds — for display
  canBuy: boolean; // fixed qty: all N affordable + available; 'max': at least 1
}
// Greedy plan over an increasing cost curve: walk up to `capRemain` levels, summing cost while the
// running total stays within `funds`. For a fixed qty the buy is all-or-nothing (you must afford the
// whole batch); for 'max' it buys the affordable prefix and is enabled whenever that is >= 1.
function planBulk(costAt: (lvl: number) => number, lvl: number, capRemain: number, funds: number, qty: BulkQty): BulkPlan {
  const want = qty === 'max' ? capRemain : Math.min(qty, capRemain);
  let count = 0,
    cost = 0,
    full = 0,
    stop = false;
  for (let i = 0; i < want; i++) {
    const c = costAt(lvl + i);
    full += c;
    if (!stop && cost + c <= funds) {
      cost += c;
      count++;
    } else {
      stop = true;
      if (qty === 'max') break; // 'max' only needs the affordable prefix; no point pricing the rest
    }
  }
  const canBuy = qty === 'max' ? count >= 1 : count === qty && capRemain >= qty;
  return { qty, count, cost, full, canBuy };
}
export function runBulkPlan(state: State, id: string, qty: BulkQty): BulkPlan {
  const up = UP_BY_ID[id];
  if (!up) return { qty, count: 0, cost: 0, full: 0, canBuy: false };
  const perm = (state.meta.perm && state.meta.perm[id]) || 0;
  const lvl = state.run.levels[id] || 0;
  const capRemain = Math.max(0, capOf(state.meta, id) - perm - lvl);
  return planBulk((l) => up.gold.cost(l), lvl, capRemain, state.econ.gold, qty);
}
export function permBulkPlan(meta: Meta, id: string, qty: BulkQty): BulkPlan {
  const up = UP_BY_ID[id];
  if (!up) return { qty, count: 0, cost: 0, full: 0, canBuy: false };
  const n = (meta.perm && meta.perm[id]) || 0;
  const capRemain = Math.max(0, capOf(meta, id) - n);
  return planBulk((l) => up.coin.cost(l), n, capRemain, meta.coins || 0, qty);
}
// Buy `qty` run-upgrade levels (or as many as possible for 'max'). Fixed quantities are atomic:
// if the full batch is not affordable/available, nothing is bought. Returns the count purchased.
export function buyRunUpgradeBulk(state: State, id: string, qty: BulkQty, rng?: { next(): number }): number {
  if (qty !== 'max' && !runBulkPlan(state, id, qty).canBuy) return 0;
  const limit = qty === 'max' ? Infinity : qty;
  let bought = 0;
  while (bought < limit && buyRunUpgrade(state, id, rng)) bought++;
  return bought;
}
export function buyPermBulk(meta: Meta, id: string, qty: BulkQty): number {
  if (qty !== 'max' && !permBulkPlan(meta, id, qty).canBuy) return 0;
  const limit = qty === 'max' ? Infinity : qty;
  let bought = 0;
  while (bought < limit && buyPerm(meta, id)) bought++;
  return bought;
}
