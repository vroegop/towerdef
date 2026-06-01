/* src/sim/labs.ts — the LAB layer: the ceiling + slope engine.

   Labs live ENTIRELY OUTSIDE the deterministic run sim. They advance on the wall
   clock (Date.now()), in menus and while offline, so they never touch the seeded
   replay. There are currently TWO labs:
     • Damage Lab — scales the Damage workshop stat AND raises the Damage cap
     • Health Lab — scales the Health workshop stat AND raises the Health cap

   Each lab is ONE pickable entry (kind 'scale'); the cap-raising half is modelled
   as an internal effect (LAB_CAPS) that reads the SAME completed level, so the two
   halves always advance together. computeStats in skills.ts consumes the existing
   labScaleMults / labCapBonus hooks unchanged. */
import type { LabCurve, LabDef, Meta, Research } from '../types';

// ---- exact per-level tables (OUR-level indexing: point [L-1, x] = price/time to reach level L) ----
// `time` is wall-clock seconds; level 1 (point 0) is instant. `cost` is coins. Linear-interpolated.
// prettier-ignore
const LAB_TIME: [number, number][] = [[0,0],[1,360],[2,960],[3,1860],[4,3120],[5,4800],[6,6960],[7,9540],[8,12660],[9,16320],[10,20580],[11,25380],[12,30840],[13,36900],[14,43620],[15,51000],[16,59100],[17,67920],[18,77460],[19,87720],[20,98760],[21,110640],[22,123240],[23,136680],[24,150960],[25,166020],[26,181980],[27,198780],[28,216480],[29,235080],[30,254580],[31,274980],[32,296280],[33,318600],[34,341820],[35,366000],[36,391200],[37,417300],[38,444480],[39,472620],[40,501840],[41,532020],[42,563280],[43,595560],[44,628920],[45,663300],[46,698820],[47,735420],[48,773100],[49,811860],[50,851820],[51,892800],[52,934980],[53,978300],[54,1022760],[55,1068360],[56,1115160],[57,1163100],[58,1212240],[59,1262580],[60,1314180],[61,1366920],[62,1420860],[63,1476060],[64,1532520],[65,1590180],[66,1649100],[67,1709280],[68,1770720],[69,1833420],[70,1897440],[71,1962720],[72,2029260],[73,2097120],[74,2166360],[75,2236800],[76,2308680],[77,2381820],[78,2456280],[79,2532120],[80,2609280],[81,2687820],[82,2767740],[83,2849040],[84,2931660],[85,3015720],[86,3101160],[87,3187980],[88,3276180],[89,3365820],[90,3456900],[91,3549360],[92,3643260],[93,3738600],[94,3835380],[95,3933600],[96,4033320],[97,4134420],[98,4237020],[99,4341120]];
// prettier-ignore
const LAB_COST: [number, number][] = [[0,30],[1,71],[2,178],[3,398],[4,772],[5,1340],[6,2120],[7,3170],[8,4510],[9,6170],[10,8170],[11,10560],[12,13350],[13,16580],[14,20270],[15,24440],[16,29130],[17,34360],[18,40160],[19,46540],[20,53530],[21,61160],[22,69460],[23,78430],[24,88120],[25,98530],[26,109700],[27,121650],[28,134390],[29,147950],[30,162350],[31,177620],[32,193780],[33,210830],[34,228820],[35,247760],[36,267660],[37,288560],[38,310470],[39,333400],[40,357390],[41,382450],[42,408600],[43,435870],[44,464260],[45,493810],[46,524530],[47,556430],[48,589550],[49,623890],[50,659490],[51,696340],[52,734490],[53,773940],[54,814710],[55,856830],[56,900300],[57,945160],[58,991410],[59,1040000],[60,1090000],[61,1140000],[62,1190000],[63,1240000],[64,1300000],[65,1360000],[66,1410000],[67,1470000],[68,1530000],[69,1600000],[70,1660000],[71,1730000],[72,1800000],[73,1870000],[74,1940000],[75,2010000],[76,2080000],[77,2160000],[78,2240000],[79,2320000],[80,2400000],[81,2480000],[82,2570000],[83,2650000],[84,2740000],[85,2830000],[86,2930000],[87,3020000],[88,3120000],[89,3220000],[90,3320000],[91,3420000],[92,3520000],[93,3630000],[94,3740000],[95,3850000],[96,3960000],[97,4070000],[98,4190000],[99,4310000]];

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

// ---- the two pickable labs (kind 'scale' → multiplies a SIM STAT in computeStats) ----
// Damage: ×(1 + 0.02·lvl) on rangedDamage; Health: ×(1 + 0.03·lvl) on maxHp. Max level 100.
export const LABS: LabDef[] = [
  { id: 'dmgLab', cat: 'attack', kind: 'scale', target: 'rangedDamage', label: 'Damage Lab',
    per: 0.02, max: 100, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
  { id: 'hpLab', cat: 'defense', kind: 'scale', target: 'maxHp', label: 'Health Lab',
    per: 0.03, max: 100, coin: tcurve(LAB_COST), time: tcurve(LAB_TIME), gate: { wave: 30 } },
];
export const LAB_BY_ID: Record<string, LabDef> = {};
for (const L of LABS) LAB_BY_ID[L.id] = L;
export const labsIn = (cat: string): LabDef[] => LABS.filter((L) => L.cat === cat);
export const LAB_CATS = ['attack', 'defense'];

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

// ---- gating / pricing for the NEXT level of a lab ----
export function labUnlocked(meta: Meta, id: string): boolean {
  const L = LAB_BY_ID[id];
  if (!L) return false;
  return ((meta && meta.bestWave) || 0) >= ((L.gate && L.gate.wave) || 0);
}
export const labsTabUnlocked = (meta: Meta): boolean => ((meta && meta.bestWave) || 0) >= 30;
export function researchRemaining(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  return r ? Math.max(0, (r.endsAt - nowMs) / 1000) : 0;
}
export function researchProgress(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  if (!r) return 0;
  const total = LAB_BY_ID[id].time.at(lvl(meta, id)) * 1000;
  return total > 0 ? Math.max(0, Math.min(1, 1 - (r.endsAt - nowMs) / total)) : 1;
}
export function labAtMax(meta: Meta, id: string): boolean {
  const L = LAB_BY_ID[id];
  return lvl(meta, id) >= (L ? L.max : 0);
}
export function labCoinCost(meta: Meta, id: string): number {
  const L = LAB_BY_ID[id];
  return L ? L.coin.at(lvl(meta, id)) : 0;
}
// wall-clock seconds for the next level (level 1 is instant → 0).
export function labTimeSec(meta: Meta, id: string): number {
  const L = LAB_BY_ID[id];
  if (!L) return 0;
  return Math.max(0, Math.round(L.time.at(lvl(meta, id))));
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
  meta.research.push({ id, cost, endsAt: nowMs + t * 1000 });
  return true;
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
  if (!r) return 0;
  return Math.max(1, Math.ceil(Math.max(0, (r.endsAt - nowMs) / 1000) / 60));
}
export function rushResearch(meta: Meta, id: string, nowMs: number): boolean {
  const r = researchOf(meta, id);
  if (!r) return false;
  const cost = rushVialCost(meta, id, nowMs);
  if ((meta.gems || 0) < cost) return false;
  meta.gems -= cost;
  r.endsAt = nowMs; // finishes on the next reconcile.
  return true;
}

// Complete every research whose timer has elapsed. Returns the list of completed lab ids.
export function reconcileResearch(meta: Meta, nowMs: number): string[] {
  if (!meta.research || !meta.research.length) return [];
  const done: string[] = [],
    keep: Research[] = [];
  for (const r of meta.research) {
    if (nowMs >= r.endsAt) {
      meta.labs = meta.labs || {};
      meta.labs[r.id] = (meta.labs[r.id] || 0) + 1;
      done.push(r.id);
    } else keep.push(r);
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
export function checkInNextMs(meta: Meta, nowMs: number): number {
  const last = meta.lastCheckIn || nowMs;
  if (checkInPending(meta, nowMs) >= CHECKIN_CAP) return 0;
  return Math.max(0, CHECKIN_MS - ((nowMs - last) % CHECKIN_MS));
}
export function claimCheckIn(meta: Meta, nowMs: number): { claims: number; vials: number; gems: number } | null {
  const n = checkInPending(meta, nowMs);
  if (n <= 0) return null;
  const vials = n * CHECKIN_VIALS,
    gems = n * CHECKIN_GEMS;
  meta.vials = (meta.vials || 0) + vials;
  meta.gems = (meta.gems || 0) + gems;
  meta.lastCheckIn = nowMs;
  return { claims: n, vials, gems };
}

// special hooks kept as no-ops for compatibility with callers (game/research speed labs removed).
export const gameSpeed = (_meta: Meta): number => 1;
export const labSpeedReduction = (_meta: Meta): number => 0;

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
  if (meta.labSlots == null) meta.labSlots = 1;
  if (meta.vials == null) meta.vials = 0;
  if (meta.cardSlots == null) meta.cardSlots = 1;
  if (!Array.isArray(meta.activeCards)) meta.activeCards = [];
  meta.ver = META_VER;
  return meta;
}
