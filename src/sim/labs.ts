/* src/sim/labs.ts — the LAB layer: the ceiling + slope engine.

   Labs live ENTIRELY OUTSIDE the deterministic run sim. They advance on the wall
   clock (Date.now()), in menus and while offline, so they never touch the seeded
   replay. A lab does one of three things:
     • kind 'cap'    → raises an upgrade's effective max
     • kind 'scale'  → multiplies a sim stat
     • kind 'special'→ drives a global outside the stat block (game speed, lab speed) */
import type { LabCurve, LabDef, Meta, Research } from '../types';

// cost factory: round(base · grow^n) — `at(n)` is the price/time of the NEXT level n.
const lcurve = (base: number, grow: number): LabCurve => ({ base, grow, at: (n: number) => Math.round(base * Math.pow(grow, n)) });

export const LABS: LabDef[] = [
  // ---- ATTACK ----
  { id: 'dmgScale', cat: 'attack', kind: 'scale', target: 'rangedDamage', label: 'Damage Amplifier',
    per: 0.04, max: 50, coin: lcurve(60, 1.15), time: lcurve(90, 1.18), gate: { wave: 30 } },
  { id: 'rateScale', cat: 'attack', kind: 'scale', target: 'fireRate', label: 'Fire-Rate Amplifier',
    per: 0.03, max: 50, coin: lcurve(70, 1.15), time: lcurve(100, 1.18), gate: { wave: 45 } },
  { id: 'critScale', cat: 'attack', kind: 'scale', target: 'critMult', label: 'Crit Amplifier',
    per: 0.03, max: 50, coin: lcurve(90, 1.16), time: lcurve(140, 1.2), gate: { wave: 70 } },
  // ---- DEFENSE ----
  { id: 'hpScale', cat: 'defense', kind: 'scale', target: 'maxHp', label: 'Health Amplifier',
    per: 0.04, max: 50, coin: lcurve(60, 1.15), time: lcurve(90, 1.18), gate: { wave: 30 } },
  { id: 'regenScale', cat: 'defense', kind: 'scale', target: 'regen', label: 'Regen Amplifier',
    per: 0.05, max: 50, coin: lcurve(70, 1.15), time: lcurve(110, 1.19), gate: { wave: 60 } },
  // ---- UTILITY ----
  { id: 'coinScale', cat: 'utility', kind: 'scale', target: 'goldFind', label: 'Coin Amplifier',
    per: 0.08, max: 40, coin: lcurve(80, 1.16), time: lcurve(120, 1.2), gate: { wave: 50 } },
  // Game Speed: 8 levels, +0.5x each → 5x at max. gameSpeed scales the loop's step count, not DT.
  { id: 'gameSpeed', cat: 'utility', kind: 'special', target: 'gameSpeed', label: 'Game Speed',
    per: 0.5, max: 8, coin: lcurve(500, 2.0), time: lcurve(3600, 2), gate: { wave: 50 } },
  { id: 'labSpeed', cat: 'utility', kind: 'special', target: 'labTime', label: 'Research Speed',
    per: 0.02, max: 25, coin: lcurve(150, 1.2), time: lcurve(240, 1.22), gate: { wave: 100 } },
];
export const LAB_BY_ID: Record<string, LabDef> = {};
for (const L of LABS) LAB_BY_ID[L.id] = L;
export const labsIn = (cat: string): LabDef[] => LABS.filter((L) => L.cat === cat);
export const LAB_CATS = ['attack', 'defense', 'utility'];

// ---- pure level/effect helpers (read meta.labs = { labId: completedLevel }) ----
const lvl = (meta: Meta, id: string): number => (meta && meta.labs && meta.labs[id]) || 0;
export const labLevel = lvl;

// cap labs: how much extra `max` a given upgrade id has earned.
export function labCapBonus(meta: Meta, upgradeId: string): number {
  let b = 0;
  for (const L of LABS) if (L.kind === 'cap' && L.target === upgradeId) b += L.per * lvl(meta, L.id);
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
// special: live game-speed multiplier (folded into the loop's step count, never into a step).
export const gameSpeed = (meta: Meta): number => 1 + lvl(meta, 'gameSpeed') * LAB_BY_ID.gameSpeed.per;
// special: research-time reduction (capped at 50%).
export const labSpeedReduction = (meta: Meta): number => Math.min(0.5, lvl(meta, 'labSpeed') * LAB_BY_ID.labSpeed.per);

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
  const total = LAB_BY_ID[id].time.at(lvl(meta, id)) * (1 - labSpeedReduction(meta)) * 1000;
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
// wall-clock seconds for the next level, after the lab-speed reduction.
export function labTimeSec(meta: Meta, id: string): number {
  const L = LAB_BY_ID[id];
  if (!L) return 0;
  return Math.max(1, Math.round(L.time.at(lvl(meta, id)) * (1 - labSpeedReduction(meta))));
}

// ---- research lifecycle (wall-clock; meta-only; safe to advance from any delta) ----
export function researchOf(meta: Meta, id: string): Research | null {
  return (meta.research || []).find((r) => r.id === id) || null;
}
export const freeSlots = (meta: Meta): number => Math.max(0, (meta.labSlots || 1) - (meta.research || []).length);

// Begin researching a lab's next level. Deducts coins up front (refunded on cancel).
export function startResearch(meta: Meta, id: string, nowMs: number): boolean {
  if (!labUnlocked(meta, id) || labAtMax(meta, id)) return false;
  if (researchOf(meta, id)) return false;
  if (freeSlots(meta) <= 0) return false;
  const cost = labCoinCost(meta, id);
  if ((meta.coins || 0) < cost) return false;
  meta.coins -= cost;
  meta.research = meta.research || [];
  meta.research.push({ id, cost, endsAt: nowMs + labTimeSec(meta, id) * 1000 });
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

// Rush an in-progress lab by spending vials: halves its remaining time.
export function rushVialCost(meta: Meta, id: string, nowMs: number): number {
  const r = researchOf(meta, id);
  if (!r) return 0;
  return Math.max(1, Math.ceil(Math.max(0, (r.endsAt - nowMs) / 1000) / 120));
}
export function rushResearch(meta: Meta, id: string, nowMs: number): boolean {
  const r = researchOf(meta, id);
  if (!r) return false;
  const cost = rushVialCost(meta, id, nowMs);
  if ((meta.vials || 0) < cost) return false;
  meta.vials -= cost;
  r.endsAt = nowMs + Math.max(0, (r.endsAt - nowMs) * 0.5);
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

// ---- concurrent research slots (a premium-currency / gem sink; 1 → MAX_SLOTS) ----
export const MAX_SLOTS = 5;
export const labSlotCost = (meta: Meta): number => 25 * Math.pow(2, Math.max(0, (meta.labSlots || 1) - 1));
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

// ---- meta defaults / migration (idempotent; additive only, never destructive) ----
const META_VER = 2;
export function migrateMeta(meta: Meta): Meta {
  if (!meta) return meta;
  if (meta.labs == null) meta.labs = {};
  if (!Array.isArray(meta.research)) meta.research = [];
  if (meta.labSlots == null) meta.labSlots = 1;
  if (meta.vials == null) meta.vials = 0;
  meta.ver = META_VER;
  return meta;
}
