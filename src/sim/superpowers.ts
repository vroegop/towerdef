/* src/sim/superpowers.ts — the SUPERPOWERS layer (Prestige tab).

   Three tower abilities that coexist with the active-card system, each unlocked + leveled with the
   ENERGY currency (earned +1 per boss kill). A superpower is a "group"; its tracks are individually
   leveled "skills", each driven by a balance `Curve` (same data model as upgrades/cards/labs).

   Unlock cost is by PURCHASE ORDER (not per-power): [500, 10k, 100k][unlockedCount]. Track levels
   cost costBase + costPer·level Energy. All unlocked powers are always active; each has a pause
   toggle. They auto-fire on cooldown — identical live and offline (deterministic, PRNG/tick only).

   tickSuperpowers() runs inside Sim.step (before the hero acts) so run.goldenMult is current for the
   tick's kills; it owns the Golden-Lightning window, the Moat water cycle + slow, and the Crystal
   Circle orbit/shatter. Energy/gem/vial payouts are applied to meta here and in core._cleanup. */
import type { Crystal, Enemy, Meta, Rng, State, SuperpowerDef } from '../types';
import { evalCurve, PX_PER_METER } from './skills';

// ---- balance constants (the few magnitudes not expressed as per-level tracks) ----
export const UNLOCK_COSTS = [500, 10_000, 100_000]; // Energy to unlock the 1st / 2nd / 3rd power (any order)
const TRACK_COST_BASE = 200;
const TRACK_COST_PER = 300;
export const MOAT_INNER_M = 18;       // moat inner edge, metres from the tower
const MOAT_SLOW = 0.2;                // watered moat: enemies move at 20% speed (80% slow), bosses too
const CRYSTAL_ORBIT_FRAC = 0.5;       // crystals ring at 50% of tower range
const CRYSTAL_DURATION = 8;           // seconds the ring orbits before survivors explode
const CRYSTAL_ORBIT_SPEED = 0.5;      // rad/sec the ring rotates
const CRYSTAL_HIT_R = 13;             // px contact radius (world units) for a crystal/fragment vs an enemy
const FRAG_SPEED_FRAC = 0.6;          // shard speed as a fraction of (range px) per second
const FRAG_FOG_RANGE = 1.4;           // shards die past this × range (out in the fog)
const CRYSTAL_BOSS_ENERGY = 20;       // a boss struck by a crystal/shard yields this much Energy

const lin = (base: number, per: number): { kind: 'linear'; base: number; per: number } => ({ kind: 'linear', base, per });
const sec = (v: number): string => v.toFixed(0) + 's';
const mult = (v: number): string => '×' + (Math.round(v * 10) / 10);

// ---- the registry: 3 powers, each a set of Energy-leveled tracks (data only) ----
export const SUPERPOWERS: SuperpowerDef[] = [
  {
    id: 'golden', name: 'Golden Lightning', cat: 'offense', icon: 'burst',
    blurb: 'For a burst, lightning turns gold and every kill pays far more gold & coins.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 20, curve: lin(300, -10), fmt: sec }, // 300s → 100s
      { id: 'duration', label: 'Duration', max: 20, curve: lin(10, 4), fmt: sec },     // 10s → 90s
      { id: 'mult', label: 'Gold/Coin ×', max: 20, curve: lin(2, 0.5), fmt: mult },    // ×2 → ×12
    ],
  },
  {
    id: 'moat', name: 'Moat', cat: 'defense', icon: 'shield',
    blurb: 'A dry trench rings the tower; periodically it floods, slowing everything caught in it.',
    tracks: [
      { id: 'width', label: 'Width', max: 24, curve: lin(2, 2), fmt: (v) => v.toFixed(0) + 'm' },   // 2m → 50m
      { id: 'cooldown', label: 'Flood every', max: 30, curve: lin(200, -5), fmt: sec },             // 200s → 50s
      { id: 'duration', label: 'Water lasts', max: 20, curve: lin(30, 1), fmt: sec },               // 30s → 50s
      { id: 'energy', label: 'Boss Energy ×', max: 8, curve: lin(2, 1), fmt: mult },                // ×2 → ×10
    ],
  },
  {
    id: 'crystal', name: 'Crystal Circle', cat: 'utility', icon: 'cards',
    blurb: 'Crystals orbit and instakill on contact for gems; survivors burst into shards that fly into the fog.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 40, curve: lin(500, -10), fmt: sec },        // 500s → 100s
      { id: 'count', label: 'Crystals', max: 14, curve: lin(4, 1), fmt: (v) => '' + Math.round(v) }, // 4 → 18
      { id: 'gems', label: 'Gems / hit', max: 9, curve: lin(1, 1), fmt: (v) => '' + Math.round(v) }, // 1 → 10
      { id: 'vials', label: 'Vials / hit', max: 10, curve: lin(0, 1), fmt: (v) => '' + Math.round(v) },
      { id: 'energy', label: 'Energy / hit', max: 10, curve: lin(0, 1), fmt: (v) => '' + Math.round(v) },
      { id: 'gold', label: 'Gold/Coin ×', max: 10, curve: lin(1, 0.2), fmt: mult },          // ×1 → ×3
    ],
  },
];
export const SUPER_BY_ID: Record<string, SuperpowerDef> = {};
for (const sp of SUPERPOWERS) SUPER_BY_ID[sp.id] = sp;

// ---- pure level / cost / state helpers (read meta) ------------------------------------------------
const lvlKey = (spId: string, trackId: string): string => spId + '.' + trackId;
export const superUnlocked = (meta: Meta, id: string): boolean => !!(meta.superUnlocked && meta.superUnlocked[id]);
export const superEnabled = (meta: Meta, id: string): boolean => superUnlocked(meta, id) && (meta.superEnabled ? meta.superEnabled[id] !== false : true);
export function superLevel(meta: Meta, spId: string, trackId: string): number {
  return (meta.superLevels && meta.superLevels[lvlKey(spId, trackId)]) || 0;
}
// the live value of a track (level → curve), used by the sim AND the HUD.
export function trackValue(meta: Meta, spId: string, trackId: string): number {
  const sp = SUPER_BY_ID[spId];
  const tr = sp && sp.tracks.find((t) => t.id === trackId);
  return tr ? evalCurve(tr.curve, superLevel(meta, spId, trackId)) : 0;
}
export const unlockedCount = (meta: Meta): number => SUPERPOWERS.reduce((n, sp) => n + (superUnlocked(meta, sp.id) ? 1 : 0), 0);
// the Energy cost to unlock the NEXT power (by purchase order); 0 if all are unlocked.
export const nextUnlockCost = (meta: Meta): number => UNLOCK_COSTS[unlockedCount(meta)] || 0;
export function trackCost(meta: Meta, spId: string, trackId: string): number {
  const sp = SUPER_BY_ID[spId];
  const tr = sp && sp.tracks.find((t) => t.id === trackId);
  if (!tr) return 0;
  const lvl = superLevel(meta, spId, trackId);
  return (tr.costBase ?? TRACK_COST_BASE) + (tr.costPer ?? TRACK_COST_PER) * lvl;
}
export const trackAtMax = (meta: Meta, spId: string, trackId: string): boolean => {
  const tr = SUPER_BY_ID[spId]?.tracks.find((t) => t.id === trackId);
  return !!tr && superLevel(meta, spId, trackId) >= tr.max;
};

// ---- purchases (spend Energy; return success) -----------------------------------------------------
export function buySuperpower(meta: Meta, id: string): boolean {
  if (!SUPER_BY_ID[id] || superUnlocked(meta, id)) return false;
  const cost = nextUnlockCost(meta);
  if (cost <= 0 || (meta.energy || 0) < cost) return false;
  meta.energy = (meta.energy || 0) - cost;
  meta.superUnlocked = meta.superUnlocked || {};
  meta.superEnabled = meta.superEnabled || {};
  meta.superUnlocked[id] = true;
  meta.superEnabled[id] = true; // on by default once unlocked
  return true;
}
export function buySuperTrack(meta: Meta, spId: string, trackId: string): boolean {
  if (!superUnlocked(meta, spId) || trackAtMax(meta, spId, trackId)) return false;
  const cost = trackCost(meta, spId, trackId);
  if ((meta.energy || 0) < cost) return false;
  meta.energy = (meta.energy || 0) - cost;
  meta.superLevels = meta.superLevels || {};
  meta.superLevels[lvlKey(spId, trackId)] = superLevel(meta, spId, trackId) + 1;
  return true;
}
export function toggleSuperpower(meta: Meta, id: string): boolean {
  if (!superUnlocked(meta, id)) return false;
  meta.superEnabled = meta.superEnabled || {};
  meta.superEnabled[id] = !superEnabled(meta, id);
  return true;
}

// ---- moat geometry / slow (read by core._enemies) -------------------------------------------------
// inner/outer radius of the moat band in world px (0 width when un-leveled-but-unlocked = 2m).
export function moatRadii(meta: Meta, _state?: State): { rIn: number; rOut: number } {
  const widthM = trackValue(meta, 'moat', 'width');
  const rIn = MOAT_INNER_M * PX_PER_METER;
  return { rIn, rOut: rIn + widthM * PX_PER_METER };
}
// movement multiplier for an enemy: 0.2 when the moat is unlocked, enabled, currently watered, and the
// enemy sits in the band; else 1.
export function moatSlowFactor(s: State, e: Enemy): number {
  const meta = s.meta;
  if (!superEnabled(meta, 'moat')) return 1;
  if (!(s.run.superActive && (s.run.superActive.moat || 0) > 0)) return 1;
  const { rIn, rOut } = moatRadii(meta);
  const d = Math.hypot(e.x - s.hero.x, e.y - s.hero.y);
  return d >= rIn && d <= rOut ? MOAT_SLOW : 1;
}
// is a (dying) enemy inside the watered moat right now? (for the boss-Energy bonus in _cleanup)
export function inWateredMoat(s: State, e: Enemy): boolean {
  if (!superEnabled(s.meta, 'moat') || !(s.run.superActive && (s.run.superActive.moat || 0) > 0)) return false;
  const { rIn, rOut } = moatRadii(s.meta);
  const d = Math.hypot(e.x - s.hero.x, e.y - s.hero.y);
  return d >= rIn && d <= rOut;
}
// Energy granted for a boss kill: base 1, × the Moat boss-energy track if killed in the water.
export function bossEnergy(s: State, e: Enemy): number {
  return inWateredMoat(s, e) ? Math.round(trackValue(s.meta, 'moat', 'energy')) : 1;
}
// reward (gold+coin) ×multiplier active THIS tick: Golden-Lightning window × (crystal mult if the
// kill was a crystal hit — applied per-enemy in _cleanup via crystalKillMult).
export const crystalKillMult = (meta: Meta): number => trackValue(meta, 'crystal', 'gold') || 1;

// ---- the per-tick driver (called from Sim.step before the hero acts) ------------------------------
export function tickSuperpowers(s: State, dt: number, rng: Rng): void {
  const meta = s.meta;
  s.run.superCd = s.run.superCd || {};
  s.run.superActive = s.run.superActive || {};
  s.run.goldenMult = 1;
  const cd = s.run.superCd,
    act = s.run.superActive;

  // ---- Golden Lightning: auto-fires; for `duration`s every kill pays ×mult gold/coins. ----
  if (superEnabled(meta, 'golden')) {
    if ((cd.golden || 0) <= 0 && (act.golden || 0) <= 0) act.golden = trackValue(meta, 'golden', 'duration');
    if ((act.golden || 0) > 0) {
      s.run.goldenMult = trackValue(meta, 'golden', 'mult');
      act.golden = Math.max(0, act.golden! - dt);
      if (act.golden <= 0) cd.golden = trackValue(meta, 'golden', 'cooldown');
    } else if ((cd.golden || 0) > 0) cd.golden = Math.max(0, cd.golden! - dt);
  }

  // ---- Moat: auto-floods for `duration`s on a `cooldown`. The slow itself is applied in _enemies. ----
  if (superEnabled(meta, 'moat')) {
    if ((cd.moat || 0) <= 0 && (act.moat || 0) <= 0) act.moat = trackValue(meta, 'moat', 'duration');
    if ((act.moat || 0) > 0) {
      act.moat = Math.max(0, act.moat! - dt);
      if (act.moat <= 0) cd.moat = trackValue(meta, 'moat', 'cooldown');
    } else if ((cd.moat || 0) > 0) cd.moat = Math.max(0, cd.moat! - dt);
  }

  // ---- Crystal Circle: spawn ring on cooldown; orbit + instakill; survivors burst into shards. ----
  tickCrystal(s, dt, rng);
}

function emitSuperFx(s: State, x: number, y: number, kind: 'shatter' | 'gem' | 'energy'): void {
  s.superFx = s.superFx || [];
  s.superFx.push({ seq: (s.superFxSeq = (s.superFxSeq || 0) + 1), x, y, kind });
  if (s.superFx.length > 48) s.superFx.shift();
}

// pay out gems / vials / energy for one crystal-or-shard contact; bosses also yield bulk Energy.
function payCrystalHit(s: State, e: Enemy): void {
  const meta = s.meta;
  meta.gems = (meta.gems || 0) + Math.round(trackValue(meta, 'crystal', 'gems'));
  const v = Math.round(trackValue(meta, 'crystal', 'vials'));
  if (v) meta.vials = (meta.vials || 0) + v;
  const en = Math.round(trackValue(meta, 'crystal', 'energy'));
  meta.energy = (meta.energy || 0) + en + (e.type === 'boss' ? CRYSTAL_BOSS_ENERGY : 0);
  e.hp = 0;
  e.lastHurt = 'crystal';
  emitSuperFx(s, e.x, e.y, e.type === 'boss' ? 'energy' : 'gem');
}

function tickCrystal(s: State, dt: number, _rng: Rng): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  const range = s.hero.range || 0;
  // advance any in-flight shards first (they outlive the ring)
  if (s.crystalFrags && s.crystalFrags.length) {
    const fog2 = (range * FRAG_FOG_RANGE) ** 2;
    const keep = [];
    for (const fr of s.crystalFrags) {
      fr.x += fr.vx * dt;
      fr.y += fr.vy * dt;
      const dx = fr.x - s.hero.x,
        dy = fr.y - s.hero.y;
      if (dx * dx + dy * dy > fog2) continue; // flew into the fog → gone
      const hit = nearestEnemyWithin(s, fr.x, fr.y, CRYSTAL_HIT_R);
      if (hit) {
        payCrystalHit(s, hit);
        continue;
      } // shard shatters on the enemy
      keep.push(fr);
    }
    s.crystalFrags = keep;
  }
  if (!superEnabled(meta, 'crystal')) {
    s.crystals = undefined;
    return;
  }
  const haveRing = !!(s.crystals && s.crystals.length);
  if (!haveRing) {
    // waiting on cooldown → spawn the ring when ready
    if ((cd.crystal || 0) > 0) {
      cd.crystal = Math.max(0, cd.crystal! - dt);
      return;
    }
    const n = Math.round(trackValue(meta, 'crystal', 'count'));
    const arr: Crystal[] = [];
    for (let i = 0; i < n; i++) arr.push({ ang: (i / n) * Math.PI * 2, alive: true });
    s.crystals = arr;
    act.crystal = CRYSTAL_DURATION;
    return;
  }
  // ring is up: orbit + collide
  const orbitR = range * CRYSTAL_ORBIT_FRAC;
  let anyAlive = false;
  for (const c of s.crystals!) {
    if (!c.alive) continue;
    c.ang += CRYSTAL_ORBIT_SPEED * dt;
    const cxp = s.hero.x + Math.cos(c.ang) * orbitR,
      cyp = s.hero.y + Math.sin(c.ang) * orbitR;
    const hit = nearestEnemyWithin(s, cxp, cyp, CRYSTAL_HIT_R);
    if (hit) {
      payCrystalHit(s, hit);
      c.alive = false;
      emitSuperFx(s, cxp, cyp, 'shatter');
    } else anyAlive = true;
  }
  act.crystal = Math.max(0, (act.crystal || 0) - dt);
  if (act.crystal <= 0 || !anyAlive) {
    // duration over (or all consumed): survivors burst into 4 shards each.
    if (anyAlive) {
      const fragSpeed = range * FRAG_SPEED_FRAC;
      s.crystalFrags = s.crystalFrags || [];
      for (const c of s.crystals!) {
        if (!c.alive) continue;
        const cxp = s.hero.x + Math.cos(c.ang) * orbitR,
          cyp = s.hero.y + Math.sin(c.ang) * orbitR;
        for (let f = 0; f < 4; f++) {
          const fa = c.ang + (f / 4) * Math.PI * 2 + 0.4;
          s.crystalFrags.push({ x: cxp, y: cyp, vx: Math.cos(fa) * fragSpeed, vy: Math.sin(fa) * fragSpeed });
        }
        emitSuperFx(s, cxp, cyp, 'shatter');
      }
    }
    s.crystals = undefined;
    cd.crystal = trackValue(meta, 'crystal', 'cooldown');
  }
}

// nearest living enemy whose body overlaps a point within `pad` px (deterministic: lowest id wins ties).
function nearestEnemyWithin(s: State, x: number, y: number, pad: number): Enemy | null {
  let best: Enemy | null = null,
    bestD = Infinity;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const rr = e.r + pad;
    const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d2 <= rr * rr && (d2 < bestD || (d2 === bestD && (!best || e.id < best.id)))) {
      best = e;
      bestD = d2;
    }
  }
  return best;
}

// reset per-run superpower entities/timers (called when a fresh run starts).
export function resetSuperRun(s: State): void {
  s.run.superCd = {};
  s.run.superActive = {};
  s.run.goldenMult = 1;
  s.crystals = undefined;
  s.crystalFrags = undefined;
  s.superFx = [];
  s.superFxSeq = 0;
}
