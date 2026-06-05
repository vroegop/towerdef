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
import type { Crystal, Enemy, Meta, Rng, Sentry, State, Stats, SuperpowerDef } from '../types';
import { evalCurve, PX_PER_METER } from './skills';

// ---- balance constants (the few magnitudes not expressed as per-level tracks) ----
// Energy to unlock the 1st…9th power (by PURCHASE ORDER, not which power). 9 powers now exist; the
// ladder is 500 / 2k / 5k, then +5k for each unlock after that.
export const UNLOCK_COSTS = [500, 2_000, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000];
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
// ---- new-power constants ----
const TESLA_HOP_FRAC = 0.55;          // a Tesla arc chains to the next enemy within this × tower range
const TESLA_REACH_FRAC = 1.4;         // the first arc reaches a target within this × tower range (fog edge)
const VOID_EDGE_M = 10;               // the black hole spawns this many metres inside the tower's max range
const VOID_PULL_SPEED = 140;          // px/s an enemy is dragged toward the black hole centre
const VOID_KILL_GOLD = 2;             // black-hole kills pay this × gold/coins
const AEGIS_SHOCK_GOLD = 10;          // first-break shockwave kills pay this × gold/coins
const SENTRY_COUNT = 4;               // turrets spawned per Sentry Battery activation
const SENTRY_R = 15;                  // turret body / disintegrate-sphere radius (world px)
const SENTRY_RING_FRAC = 0.55;        // turrets ring the tower at this × tower range
const SENTRY_DISINT_CD = 0.8;         // a sphere-touch disintegrate tick is paced to ~one per this many seconds

const lin = (base: number, per: number): { kind: 'linear'; base: number; per: number } => ({ kind: 'linear', base, per });
// linear track from `start` (level 0) to `end` (level `max`) — per is derived so endpoints are exact.
const ramp = (start: number, end: number, max: number): { kind: 'linear'; base: number; per: number } => lin(start, (end - start) / max);
const sec = (v: number): string => v.toFixed(0) + 's';
const mult = (v: number): string => '×' + (Math.round(v * 10) / 10);
const metres = (v: number): string => Math.round(v) + 'm';
const pct = (v: number): string => Math.round(v * 100) + '%';
const intf = (v: number): string => '' + Math.round(v);

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
      // each crystal/shard hit pays a flat 1 gem + 1 vial (and 20× boss Energy) — see payCrystalHit
      { id: 'gold', label: 'Gold/Coin ×', max: 10, curve: lin(1, 0.2), fmt: mult },          // ×1 → ×3
    ],
  },
  {
    id: 'tesla', name: 'Chain Tesla', cat: 'offense', icon: 'tesla',
    blurb: 'A charged arc leaps to the nearest enemy and chains onward, each jump dealing a multiple of a normal hit.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 24, curve: ramp(60, 24, 24), fmt: sec },     // 60s → 24s
      { id: 'damage', label: 'Damage ×', max: 20, curve: ramp(10, 30, 20), fmt: mult },       // ×10 → ×30 of a hit
      { id: 'chains', label: 'Chain jumps', max: 17, curve: ramp(3, 20, 17), fmt: intf },     // 3 → 20 jumps
    ],
  },
  {
    id: 'inferno', name: 'Inferno Ring', cat: 'offense', icon: 'inferno',
    blurb: 'A ring of fire encircles the tower; everything caught inside burns for a multiple of a normal hit each second.',
    tracks: [
      { id: 'radius', label: 'Radius', max: 22, curve: ramp(8, 30, 22), fmt: metres },        // 8m → 30m
      { id: 'dps', label: 'Burn ×/s', max: 20, curve: ramp(1, 6, 20), fmt: mult },             // ×1 → ×6 of a hit /s
      { id: 'duration', label: 'Burns for', max: 24, curve: ramp(6, 30, 24), fmt: sec },       // 6s → 30s
      { id: 'cooldown', label: 'Cooldown', max: 30, curve: ramp(120, 30, 30), fmt: sec },      // 120s → 30s
    ],
  },
  {
    id: 'frost', name: 'Frost Nova', cat: 'defense', icon: 'frost',
    blurb: 'A shock of cold freezes every enemy in range solid; when the freeze ends the frozen shatter for heavy damage.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 30, curve: ramp(150, 45, 30), fmt: sec },     // 150s → 45s
      { id: 'freeze', label: 'Freeze lasts', max: 20, curve: ramp(2, 10, 20), fmt: sec },      // 2s → 10s
      { id: 'radius', label: 'Radius', max: 24, curve: ramp(10, 46, 24), fmt: metres },        // 10m → 46m
      { id: 'shatter', label: 'Shatter ×', max: 20, curve: ramp(3, 17, 20), fmt: mult },       // ×3 → ×17 of a hit
    ],
  },
  {
    id: 'singularity', name: 'Singularity', cat: 'utility', icon: 'singularity',
    blurb: 'A black hole tears open near the range edge, dragging every enemy to its centre and crushing them; void kills pay double gold & coins.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 19, curve: ramp(600, 60, 19), fmt: sec },     // 600s → 60s
      { id: 'radius', label: 'Pull radius', max: 40, curve: ramp(10, 50, 40), fmt: metres },   // 10m → 50m
      { id: 'duration', label: 'Lasts', max: 24, curve: ramp(6, 30, 24), fmt: sec },           // 6s → 30s
      { id: 'damage', label: 'Crush %/s', max: 30, curve: ramp(0.02, 0.08, 30), fmt: pct },    // 2% → 8% max-HP /s
      // Energy per void kill (1 → 10) — the late-game Energy engine, so its levels cost triple.
      { id: 'energy', label: 'Energy / kill', max: 9, curve: ramp(1, 10, 9), fmt: intf, costBase: 600, costPer: 900 },
    ],
  },
  {
    id: 'chrono', name: 'Chrono Field', cat: 'utility', icon: 'chrono',
    blurb: 'Time distorts: a tower hit can strip an enemy of levels, and while it holds, enemy blows heal the tower instead of hurting it.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 19, curve: ramp(600, 60, 19), fmt: sec },     // 600s → 60s
      { id: 'duration', label: 'Lasts', max: 19, curve: ramp(3, 30, 19), fmt: sec },           // 3s → 30s
      { id: 'levels', label: 'Levels / hit', max: 19, curve: ramp(1, 20, 19), fmt: intf },     // 1 → 20 levels stripped
      { id: 'chance', label: 'Strip chance', max: 19, curve: ramp(0.02, 0.4, 19), fmt: pct },  // 2% → 40% per hit
    ],
  },
  {
    id: 'sentry', name: 'Sentry Battery', cat: 'utility', icon: 'sentry',
    blurb: 'Four mini-turrets deploy and fight with your skills — bullets that bounce (no knockback or lifesteal); enemies bump around them and disintegrate on contact.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', max: 39, curve: ramp(600, 30, 39), fmt: sec },     // 600s → 30s
      { id: 'life', label: 'Turrets last', max: 25, curve: ramp(5, 30, 25), fmt: sec },        // 5s → 30s
      { id: 'damage', label: 'Turret dmg', max: 30, curve: ramp(0.25, 1, 30), fmt: pct },      // 25% → 100% of tower
      { id: 'reward', label: 'Kill gold ×', max: 9, curve: ramp(1, 10, 9), fmt: mult },        // ×1 → ×10 gold/coins
    ],
  },
  {
    id: 'aegis', name: 'Aegis Bulwark', cat: 'defense', icon: 'aegis',
    blurb: 'A shield that pools stronger with every activation, soaking tower damage and burning attackers. The first time it shatters, a shockwave clears the field for huge spoils.',
    tracks: [
      { id: 'shield', label: 'Shield / charge', max: 19, curve: ramp(0.01, 0.2, 19), fmt: pct },  // +1% → +20% maxHP per charge
      { id: 'cooldown', label: 'Charge every', max: 18, curve: ramp(300, 120, 18), fmt: sec },     // 300s → 120s
      { id: 'contact', label: 'Burn attacker', max: 15, curve: ramp(0.19, 0.49, 15), fmt: pct },   // 19% → 49% of attacker HP
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
// `stats` is the hero's current stat sheet (passed from Sim.step). New powers read it for the
// hero's per-hit damage (their effects are "× of a normal hit") and the turrets' inherited skills.
// It is optional only so older direct callers / unit tests that exercise the legacy three powers keep
// working — the new powers that need it simply no-op when it's absent.
export function tickSuperpowers(s: State, dt: number, rng: Rng, stats?: Stats): void {
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
  // ---- the new powers (each gates on its own unlock+enable inside) ----
  tickTesla(s, dt, stats);
  tickInferno(s, dt, stats);
  tickFrost(s, dt, stats);
  tickSingularity(s, dt, rng);
  tickChrono(s, dt);
  tickSentry(s, dt, rng, stats);
  tickAegis(s, dt);
}

// ---- Aegis Bulwark: pool more shield on every activation; absorb + shockwave live in aegisAbsorb ----
function tickAegis(s: State, dt: number): void {
  const meta = s.meta,
    cd = s.run.superCd!;
  if (!superEnabled(meta, 'aegis')) return;
  if ((cd.aegis || 0) <= 0) {
    // each activation adds shield% of the tower's max HP to the pool (it grows the longer it survives)
    s.run.aegisPool = (s.run.aegisPool || 0) + trackValue(meta, 'aegis', 'shield') * (s.hero.hpMax || 0);
    cd.aegis = trackValue(meta, 'aegis', 'cooldown');
  } else cd.aegis = Math.max(0, cd.aegis! - dt);
}

// the hero's reference "normal hit" — the displayed per-shot damage (all damage upgrades/cards folded
// in by computeStats). The spell-like powers deal a multiple of this; 0 with no stat sheet.
const refHit = (stats?: Stats): number => (stats ? stats.rangedDamage : 0);

// ---- Chain Tesla: one bolt that leaps to the nearest enemy and chains onward ----
function tickTesla(s: State, dt: number, stats?: Stats): void {
  const meta = s.meta,
    cd = s.run.superCd!;
  if (!superEnabled(meta, 'tesla') || !stats) return;
  if ((cd.tesla || 0) > 0) {
    cd.tesla = Math.max(0, cd.tesla! - dt);
    return;
  }
  if (!s.enemies.length) return; // hold the bolt until there's something to strike
  const dmg = trackValue(meta, 'tesla', 'damage') * refHit(stats);
  const jumps = Math.round(trackValue(meta, 'tesla', 'chains'));
  const range = s.hero.range || 0;
  // first hop: nearest enemy out to the fog edge; then chain to nearest-unhit within a tighter hop.
  let from = { x: s.hero.x, y: s.hero.y };
  const hitIds: number[] = [];
  const pts: { x: number; y: number }[] = [{ x: from.x, y: from.y }];
  let reach = range * TESLA_REACH_FRAC;
  for (let i = 0; i < jumps; i++) {
    const e = nearestUnhit(s, from.x, from.y, reach, hitIds);
    if (!e) break;
    e.hp -= dmg;
    e.lastHurt = 'dmg';
    e.hitFlash = 0.12;
    e.hitDmg = Math.round(dmg);
    s.econ.dmgDealt += dmg;
    hitIds.push(e.id);
    pts.push({ x: e.x, y: e.y });
    from = { x: e.x, y: e.y };
    reach = range * TESLA_HOP_FRAC;
  }
  if (pts.length > 1) pushTeslaArc(s, pts);
  cd.tesla = trackValue(meta, 'tesla', 'cooldown');
}

// ---- Inferno Ring: a fire ring around the tower that burns everything inside, on a duty cycle ----
function tickInferno(s: State, dt: number, stats?: Stats): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  if (!superEnabled(meta, 'inferno') || !stats) return;
  if ((cd.inferno || 0) <= 0 && (act.inferno || 0) <= 0) act.inferno = trackValue(meta, 'inferno', 'duration');
  if ((act.inferno || 0) > 0) {
    const r = trackValue(meta, 'inferno', 'radius') * PX_PER_METER;
    const burn = trackValue(meta, 'inferno', 'dps') * refHit(stats) * dt;
    if (burn > 0) {
      const r2 = r * r;
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        if ((e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2 <= r2) {
          e.hp -= burn;
          e.lastHurt = 'dmg';
          s.econ.dmgDealt += burn;
          e.hitFlash = Math.max(e.hitFlash, 0.06);
        }
      }
    }
    act.inferno = Math.max(0, act.inferno! - dt);
    if (act.inferno <= 0) cd.inferno = trackValue(meta, 'inferno', 'cooldown');
  } else if ((cd.inferno || 0) > 0) cd.inferno = Math.max(0, cd.inferno! - dt);
}

// ---- Frost Nova: freeze everything in range, then shatter the frozen when the freeze ends ----
function tickFrost(s: State, dt: number, stats?: Stats): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  if (!superEnabled(meta, 'frost') || !stats) return;
  const r = trackValue(meta, 'frost', 'radius') * PX_PER_METER;
  if ((cd.frost || 0) <= 0 && (act.frost || 0) <= 0) {
    // cast: freeze every enemy in range solid (reuses the stun state) for the freeze window
    const freeze = trackValue(meta, 'frost', 'freeze');
    const r2 = r * r;
    for (const e of s.enemies) {
      if (e.hp > 0 && (e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2 <= r2) e.stunT = Math.max(e.stunT || 0, freeze);
    }
    act.frost = freeze;
    emitSuperFx(s, s.hero.x, s.hero.y, 'nova');
  } else if ((act.frost || 0) > 0) {
    act.frost = Math.max(0, act.frost! - dt);
    if (act.frost <= 0) {
      // thaw: the still-frozen in range shatter for a multiple of a normal hit
      const dmg = trackValue(meta, 'frost', 'shatter') * refHit(stats);
      const r2 = r * r;
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        if ((e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2 <= r2) {
          e.hp -= dmg;
          e.lastHurt = 'dmg';
          e.hitFlash = 0.14;
          e.hitDmg = Math.round(dmg);
          s.econ.dmgDealt += dmg;
        }
      }
      emitSuperFx(s, s.hero.x, s.hero.y, 'nova');
      cd.frost = trackValue(meta, 'frost', 'cooldown');
    }
  } else if ((cd.frost || 0) > 0) cd.frost = Math.max(0, cd.frost! - dt);
}

// ---- Singularity: a black hole near the range edge that drags enemies in and crushes them ----
function tickSingularity(s: State, dt: number, rng: Rng): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  if (!superEnabled(meta, 'singularity')) {
    s.blackHole = undefined;
    return;
  }
  if ((cd.singularity || 0) <= 0 && (act.singularity || 0) <= 0) {
    // spawn: VOID_EDGE_M metres inside the tower's max range, at a deterministic random bearing
    const dist = Math.max(0, (s.hero.range || 0) - VOID_EDGE_M * PX_PER_METER);
    const a = rng.next() * Math.PI * 2;
    s.blackHole = { x: s.hero.x + Math.cos(a) * dist, y: s.hero.y + Math.sin(a) * dist, r: trackValue(meta, 'singularity', 'radius') * PX_PER_METER };
    act.singularity = trackValue(meta, 'singularity', 'duration');
    return;
  }
  if ((act.singularity || 0) > 0 && s.blackHole) {
    const bh = s.blackHole;
    const pullR = bh.r;
    const r2 = pullR * pullR;
    const crush = trackValue(meta, 'singularity', 'damage'); // fraction of max-HP per second
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const dx = bh.x - e.x,
        dy = bh.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      // drag toward the centre (clamped so it never overshoots), then crush
      const step = Math.min(d, VOID_PULL_SPEED * dt);
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
      const dmg = e.hpMax * crush * dt;
      if (dmg > 0) {
        e.hp -= dmg;
        e.lastHurt = 'void';
        s.econ.dmgDealt += dmg;
        e.hitFlash = Math.max(e.hitFlash, 0.06);
      }
    }
    act.singularity = Math.max(0, act.singularity! - dt);
    if (act.singularity <= 0) {
      s.blackHole = undefined;
      cd.singularity = trackValue(meta, 'singularity', 'cooldown');
    }
  } else if ((cd.singularity || 0) > 0) cd.singularity = Math.max(0, cd.singularity! - dt);
}

// ---- Chrono Field: just runs the window timer; the heal + level-strip hooks live in core/projectiles ----
function tickChrono(s: State, dt: number): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  if (!superEnabled(meta, 'chrono')) return;
  if ((cd.chrono || 0) <= 0 && (act.chrono || 0) <= 0) act.chrono = trackValue(meta, 'chrono', 'duration');
  else if ((act.chrono || 0) > 0) {
    act.chrono = Math.max(0, act.chrono! - dt);
    if (act.chrono <= 0) cd.chrono = trackValue(meta, 'chrono', 'cooldown');
  } else if ((cd.chrono || 0) > 0) cd.chrono = Math.max(0, cd.chrono! - dt);
}

// ---- Sentry Battery: four mini-turrets that fire bouncing bullets and disintegrate on contact ----
function tickSentry(s: State, dt: number, rng: Rng, stats?: Stats): void {
  const meta = s.meta,
    cd = s.run.superCd!,
    act = s.run.superActive!;
  if (!superEnabled(meta, 'sentry') || !stats) {
    if (!superEnabled(meta, 'sentry')) s.sentries = undefined;
    return;
  }
  if (!(s.sentries && s.sentries.length)) {
    if ((cd.sentry || 0) > 0) {
      cd.sentry = Math.max(0, cd.sentry! - dt);
      return;
    }
    // deploy: ring SENTRY_COUNT turrets around the tower
    const life = trackValue(meta, 'sentry', 'life');
    const ringR = (s.hero.range || 0) * SENTRY_RING_FRAC;
    const arr: Sentry[] = [];
    for (let i = 0; i < SENTRY_COUNT; i++) {
      const a = (i / SENTRY_COUNT) * Math.PI * 2 + Math.PI / 4;
      arr.push({ x: s.hero.x + Math.cos(a) * ringR, y: s.hero.y + Math.sin(a) * ringR, atkCd: 0, life });
    }
    s.sentries = arr;
    act.sentry = life;
    return;
  }
  // live turrets: each fires on the tower's fire rate, disintegrates touchers, and ages out
  const dmgFrac = trackValue(meta, 'sentry', 'damage');
  const fireRate = Math.max(0.1, stats.fireRate || 1);
  const range = s.hero.range || 0;
  const thorns = stats.thorns || 0;
  const keep: Sentry[] = [];
  for (const t of s.sentries) {
    t.life -= dt;
    // disintegrate sphere: enemies touching a turret take tower-contact damage (paced) + get shoved out
    if (thorns > 0) {
      const touch = SENTRY_R;
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        const dx = e.x - t.x,
          dy = e.y - t.y;
        const d2 = dx * dx + dy * dy;
        const min = touch + e.r;
        if (d2 >= min * min) continue;
        const refl = e.hpMax * thorns * (dt / SENTRY_DISINT_CD); // smoothed to ~one tower-touch per CD
        e.hp -= refl;
        e.lastHurt = 'sentry';
        e.hitFlash = Math.max(e.hitFlash, 0.08);
        s.econ.reflectDealt += refl;
        const d = Math.sqrt(d2) || 1; // bump the body out to the sphere edge
        e.x = t.x + (dx / d) * min;
        e.y = t.y + (dy / d) * min;
      }
    }
    // fire bouncing bullets (hitscan): inherit the tower's damage/crit/bounce, minus knockback/lifesteal
    t.atkCd -= dt;
    if (t.atkCd <= 0) {
      const tgt = nearestUnhit(s, t.x, t.y, range, []);
      if (tgt) {
        sentryShot(s, t.x, t.y, tgt, stats, rng, dmgFrac);
        t.atkCd = 1 / fireRate;
      }
    }
    if (t.life > 0) keep.push(t);
  }
  if (keep.length) {
    s.sentries = keep;
    act.sentry = Math.max(0, (act.sentry || 0) - dt);
  } else {
    s.sentries = undefined;
    cd.sentry = trackValue(meta, 'sentry', 'cooldown');
  }
}

// one sentry shot: roll the tower's damage (incl. crit), strike the target, then bounce to nearby
// un-hit enemies using the tower's bounce stats. Attributes kills to 'sentry' for the reward ×.
function sentryShot(s: State, ox: number, oy: number, target: Enemy, stats: Stats, rng: Rng, dmgFrac: number): void {
  const dmg = rollShot(stats, s, rng) * dmgFrac;
  const bounces = stats.bounceChance && rng.next() < stats.bounceChance ? Math.max(0, Math.floor(stats.bounceTargets || 0)) : 0;
  const reach = stats.bounceRange || 0;
  const hitIds: number[] = [];
  let cur: Enemy | null = target;
  let hops = 1 + bounces;
  while (cur && hops-- > 0) {
    cur.hp -= dmg;
    cur.lastHurt = 'sentry';
    cur.hitFlash = 0.12;
    cur.hitDmg = Math.round(dmg);
    s.econ.dmgDealt += dmg;
    hitIds.push(cur.id);
    cur = reach > 0 ? nearestUnhit(s, cur.x, cur.y, reach, hitIds) : null;
  }
}

// the hero's per-shot damage incl. crit / super-crit / active boost (a trimmed _rollDamage for turrets,
// without the positional / Last-Stand / Vengeance terms). Deterministic via the shared PRNG.
function rollShot(stats: Stats, s: State, rng: Rng): number {
  let dmg = stats.rangedDamage;
  let k = Math.floor(stats.critChance || 0);
  if (rng.next() < (stats.critChance || 0) - k) k++;
  if (k > 0) dmg *= Math.pow(stats.critMult || 1, k);
  if (k > 0 && stats.superCrit && rng.next() < stats.superCrit) dmg *= stats.superCritMult || 1;
  const boost = s.run.dmgBoost || 1;
  if (boost !== 1) dmg *= boost;
  return dmg;
}

// nearest living enemy to (x,y) within `reach`, excluding ids already hit. Deterministic id tie-break.
function nearestUnhit(s: State, x: number, y: number, reach: number, hitIds: number[]): Enemy | null {
  let best: Enemy | null = null,
    bestD = reach * reach;
  for (const e of s.enemies) {
    if (e.hp <= 0 || hitIds.indexOf(e.id) >= 0) continue;
    const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d2 <= bestD && (best === null || d2 < bestD || e.id < best.id)) {
      best = e;
      bestD = d2;
    }
  }
  return best;
}

// record a transient Tesla arc for the renderer to fade (capped ring buffer).
function pushTeslaArc(s: State, pts: { x: number; y: number }[]): void {
  s.teslaArcs = s.teslaArcs || [];
  s.teslaArcs.push({ seq: (s.superFxSeq = (s.superFxSeq || 0) + 1), pts });
  while (s.teslaArcs.length > 8) s.teslaArcs.shift();
}

// ---- hooks read by core.ts / projectiles.ts ------------------------------------------------------
// Is Chrono's window live? (enemy blows heal the tower while true.)
export const chronoActive = (s: State): boolean => superEnabled(s.meta, 'chrono') && (s.run.superActive?.chrono || 0) > 0;

// On a TOWER hit (bullet/lightning), Chrono can strip the enemy of levels: subtract the HP/damage it
// gained in its last wave-step × the level count. Consumes RNG only while the window is live, so a
// player without Chrono active keeps the exact legacy PRNG stream.
export function chronoOnHit(s: State, e: Enemy, rng?: Rng): void {
  if (!rng || !chronoActive(s)) return;
  if (rng.next() >= trackValue(s.meta, 'chrono', 'chance')) return;
  const n = Math.round(trackValue(s.meta, 'chrono', 'levels'));
  if (n <= 0) return;
  const dHp = (e.hpStep || 0) * n,
    dDmg = (e.dmgStep || 0) * n;
  e.hpMax = Math.max(1, e.hpMax - dHp);
  e.hp -= dHp; // can drop ≤0 → dies this tick, attributed to the hero's damage (lastHurt already 'dmg')
  if (e.hp > e.hpMax) e.hp = e.hpMax;
  e.dmg = Math.max(0, e.dmg - dDmg);
  e.hitFlash = Math.max(e.hitFlash, 0.12);
}

// Aegis Bulwark: absorb `amt` of incoming tower damage with the pooled shield, burning the attacker
// for a fraction of ITS max HP. Returns the damage left over for the hero. The first time the pool is
// emptied in a run, a battlefield-clearing shockwave fires (later breaks are silent).
export function aegisAbsorb(s: State, amt: number, attacker?: Enemy): number {
  const meta = s.meta;
  if (!superEnabled(meta, 'aegis') || (s.run.aegisPool || 0) <= 0) return amt;
  // the attacker takes contact damage (a share of its own max HP), like the tower's disintegrate
  if (attacker) {
    const refl = attacker.hpMax * trackValue(meta, 'aegis', 'contact');
    attacker.hp -= refl;
    attacker.lastHurt = 'reflect';
    attacker.hitFlash = 0.12;
    s.econ.reflectDealt += refl;
  }
  const soak = Math.min(s.run.aegisPool!, amt);
  s.run.aegisPool! -= soak;
  const left = amt - soak;
  if (s.run.aegisPool! <= 0) {
    s.run.aegisPool = 0;
    if (!s.run.aegisBroke) {
      // first break: clear the battlefield. Each kill is routed to the 'aegis' reward path in _cleanup.
      for (const e of s.enemies) {
        if (e.hp > 0) {
          e.hp = 0;
          e.lastHurt = 'aegis';
        }
      }
      s.run.aegisBroke = true;
      emitSuperFx(s, s.hero.x, s.hero.y, 'shock');
    }
  }
  return left;
}

// The gold/coin reward × for a kill, by its superpower source (folded into _cleanup's superMult atop
// Golden Lightning). 1 = no superpower bonus.
export function superKillMult(s: State, e: Enemy): number {
  switch (e.lastHurt) {
    case 'crystal': return crystalKillMult(s.meta) || 1;
    case 'void': return VOID_KILL_GOLD;
    case 'aegis': return AEGIS_SHOCK_GOLD;
    case 'sentry': return trackValue(s.meta, 'sentry', 'reward') || 1;
    default: return 1;
  }
}

// Non-gold currency a kill pays by its superpower source (Energy for void kills; gems+vials+energy per
// 1000 waves for the Aegis shockwave). Called once per dead enemy in _cleanup.
export function superKillBonus(s: State, e: Enemy): void {
  const meta = s.meta;
  if (e.lastHurt === 'void') {
    meta.energy = (meta.energy || 0) + Math.round(trackValue(meta, 'singularity', 'energy'));
  } else if (e.lastHurt === 'aegis') {
    const per = Math.floor(s.wave.n / 1000); // nothing below wave 1000
    if (per > 0) {
      meta.gems = (meta.gems || 0) + per;
      meta.vials = (meta.vials || 0) + per;
      meta.energy = (meta.energy || 0) + per;
    }
  }
}

function emitSuperFx(s: State, x: number, y: number, kind: 'shatter' | 'gem' | 'energy' | 'nova' | 'shock'): void {
  s.superFx = s.superFx || [];
  s.superFx.push({ seq: (s.superFxSeq = (s.superFxSeq || 0) + 1), x, y, kind });
  if (s.superFx.length > 48) s.superFx.shift();
}

// pay out for one crystal-or-shard contact: a flat 1 gem + 1 vial and no Energy per hit — bosses also
// yield the bulk 20× boss-Energy bonus. Orbiting crystals and shards pay identically.
function payCrystalHit(s: State, e: Enemy): void {
  const meta = s.meta;
  meta.gems = (meta.gems || 0) + 1;
  meta.vials = (meta.vials || 0) + 1;
  if (e.type === 'boss') meta.energy = (meta.energy || 0) + CRYSTAL_BOSS_ENERGY;
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
      } // shard hits one enemy, then shatters (is removed)
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
  s.run.aegisPool = 0;
  s.run.aegisBroke = false;
  s.crystals = undefined;
  s.crystalFrags = undefined;
  s.blackHole = undefined;
  s.sentries = undefined;
  s.teslaArcs = undefined;
  s.superFx = [];
  s.superFxSeq = 0;
}
