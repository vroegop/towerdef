/* tools/superweapons-dashboard/weapons.ts — the editable super-weapon catalog + balance maths.
 *
 * A `DraftWeapon` is the dashboard's tunable mirror of the game's `SuperpowerDef`
 * (src/sim/superpowers.ts): a group of Energy-leveled `DraftTrack`s. Crucially the CURRENT in-game
 * powers are imported live from `SUPERPOWERS` and converted to drafts, so the dashboard always opens
 * with the real Moat / Golden Lightning / Crystal Circle balances — edit those, or design brand-new
 * weapons alongside them, then export the result back into superpowers.ts shape.
 *
 * Everything here is plain data + pure functions: no DOM. The unit model mirrors the few track
 * formats the game uses today (seconds / metres / multiplier / percent / count) so we can both render
 * a value AND regenerate the matching `fmt` lambda on export. */

import { SUPERPOWERS, UNLOCK_COSTS } from '../../src/sim/superpowers';
import type { Curve } from '../../src/types';

export type Unit = 'sec' | 'meters' | 'mult' | 'pct' | 'count';
export type Cat = 'offense' | 'defense' | 'utility' | 'economy';

// A single leveled track. Value follows a linear curve (base + per·level), clamped to [0, max] levels;
// `cap` optionally clamps the VALUE. Energy cost of the Nth level is costBase + costPer·level.
export interface DraftTrack {
  id: string;
  label: string;
  unit: Unit;
  base: number;
  per: number;
  cap?: number;
  max: number; // max LEVEL (number of upgrades available)
  costBase: number;
  costPer: number;
}

export interface DraftWeapon {
  id: string;
  name: string;
  cat: Cat;
  art: string; // art id (see art.ts)
  blurb: string;
  proposed: boolean; // false = already in the game; true = a new idea to balance
  tracks: DraftTrack[];
}

export interface Catalog {
  weapons: DraftWeapon[];
  // Energy to unlock the 1st, 2nd, 3rd … power (by purchase order, exactly like the game).
  unlockLadder: number[];
}

export const DEFAULT_COST_BASE = 200;
export const DEFAULT_COST_PER = 300;

// ── value / cost maths ──────────────────────────────────────────────────────────────────────────
export function trackValue(t: DraftTrack, level: number): number {
  const v = t.base + t.per * level;
  return t.cap != null ? Math.min(t.cap, v) : v;
}
// Energy cost to buy the level that takes the track from `level` → `level+1`.
export function trackCostAt(t: DraftTrack, level: number): number {
  return t.costBase + t.costPer * level;
}
// Total Energy to take a track from 0 → max (sum of every level's cost).
export function trackTotalCost(t: DraftTrack): number {
  let sum = 0;
  for (let i = 0; i < t.max; i++) sum += trackCostAt(t, i);
  return sum;
}
// Energy to unlock the weapon that sits at purchase position `index` (0-based).
export function unlockCostAt(cat: Catalog, index: number): number {
  return cat.unlockLadder[index] ?? cat.unlockLadder[cat.unlockLadder.length - 1] ?? 0;
}
// Total Energy to unlock a weapon (at `index`) AND max every one of its tracks.
export function weaponMaxCost(cat: Catalog, w: DraftWeapon, index: number): number {
  return unlockCostAt(cat, index) + w.tracks.reduce((s, t) => s + trackTotalCost(t), 0);
}
// Energy to put exactly one level into every track (a "first taste" of a weapon).
export function weaponFirstLevelCost(w: DraftWeapon): number {
  return w.tracks.reduce((s, t) => s + (t.max > 0 ? trackCostAt(t, 0) : 0), 0);
}

// ── formatting ────────────────────────────────────────────────────────────────────────────────────
export function fmtUnit(unit: Unit, v: number): string {
  switch (unit) {
    case 'sec': return Math.round(v) + 's';
    case 'meters': return Math.round(v) + 'm';
    case 'mult': return '×' + (Math.round(v * 10) / 10);
    case 'pct': return Math.round(v * 100) + '%';
    case 'count': return '' + Math.round(v);
  }
}
export const UNIT_LABEL: Record<Unit, string> = {
  sec: 'seconds', meters: 'metres', mult: '× multiplier', pct: 'percent (0–1)', count: 'count',
};
// Compact big-number abbreviation for Energy figures (1.2k / 3.4M / 5.1B).
export function abbr(n: number): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  const u = ['k', 'M', 'B', 'T'];
  let i = -1;
  let v = n;
  while (Math.abs(v) >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return (Math.round(v * 10) / 10) + u[i];
}

// ── building the default catalog from the live game registry ────────────────────────────────────
// Infer a track's display Unit by sampling its real game `fmt` (the only reliable signal, since fmt is
// a function we can't otherwise introspect). e.g. fmt(2) → "×2" ⇒ mult, "2s" ⇒ sec, "2m" ⇒ meters.
function inferUnit(fmt: (v: number) => string): Unit {
  const s = fmt(2).trim();
  if (s.includes('×')) return 'mult';
  if (s.endsWith('%')) return 'pct';
  if (s.endsWith('s')) return 'sec';
  if (s.endsWith('m')) return 'meters';
  return 'count';
}
// Pull base/per/cap out of a game Curve (every superpower track is linear today; others fall back).
function curveParts(c: Curve): { base: number; per: number; cap?: number } {
  if (c.kind === 'linear') return { base: c.base, per: c.per, cap: c.cap };
  if (c.kind === 'exp') return { base: c.base, per: 0, cap: c.cap }; // not used by superpowers; safe fallback
  if (c.kind === 'geom') return { base: c.mul, per: 0 };
  return { base: c.points[0]?.[1] ?? 0, per: 0 };
}

function gameWeaponToDraft(spId: string): DraftWeapon {
  const sp = SUPERPOWERS.find((s) => s.id === spId)!;
  return {
    id: sp.id,
    name: sp.name,
    cat: sp.cat,
    art: sp.id, // current powers have matching art keyed by their id
    blurb: sp.blurb,
    proposed: false,
    tracks: sp.tracks.map((tr) => {
      const { base, per, cap } = curveParts(tr.curve);
      return {
        id: tr.id,
        label: tr.label,
        unit: inferUnit(tr.fmt),
        base, per, cap,
        max: tr.max,
        costBase: tr.costBase ?? DEFAULT_COST_BASE,
        costPer: tr.costPer ?? DEFAULT_COST_PER,
      };
    }),
  };
}

const mk = (
  id: string, label: string, unit: Unit, base: number, per: number, max: number,
  costBase = DEFAULT_COST_BASE, costPer = DEFAULT_COST_PER, cap?: number,
): DraftTrack => ({ id, label, unit, base, per, max, costBase, costPer, cap });

// ── the proposed NEW super weapons (starter balances — tune them in the dashboard!) ───────────────
// These are DESIGN PROPOSALS: balances picked to be in the same spirit as the shipped powers
// (cooldowns shrink, durations/counts grow, multipliers ramp). Wiring their MECHANICS into the sim is
// a separate job; this catalog is for finding numbers that feel right + showing the art first.
export const PROPOSED: DraftWeapon[] = [
  {
    id: 'meteor', name: 'Meteor Storm', cat: 'offense', art: 'meteor', proposed: true,
    blurb: 'Meteors rain across the arena, each cratering for heavy splash damage in a blast radius.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 240, -6, 24),     // 240s → 96s
      mk('meteors', 'Meteors', 'count', 3, 1, 17),         // 3 → 20 per storm
      mk('damage', 'Impact ×', 'mult', 4, 0.6, 20),        // ×4 → ×16 of a hero hit
      mk('radius', 'Blast radius', 'meters', 4, 0.8, 20),  // 4m → 20m
    ],
  },
  {
    id: 'tesla', name: 'Chain Tesla', cat: 'offense', art: 'tesla', proposed: true,
    blurb: 'A charged arc leaps to the nearest enemy and chains onward, splitting more with every level.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 60, -1.5, 24),     // 60s → 24s
      mk('damage', 'Arc ×', 'mult', 2, 0.4, 20),           // ×2 → ×10
      mk('chains', 'Chain jumps', 'count', 3, 1, 17),      // 3 → 20 jumps
      mk('duration', 'Storm lasts', 'sec', 4, 0.6, 16),    // 4s → 13.6s
    ],
  },
  {
    id: 'inferno', name: 'Inferno Ring', cat: 'offense', art: 'inferno', proposed: true,
    blurb: 'A ring of fire encircles the tower, burning everything caught inside it over time.',
    tracks: [
      mk('radius', 'Radius', 'meters', 8, 1, 22),          // 8m → 30m
      mk('dps', 'Burn ×/s', 'mult', 1, 0.25, 20),          // ×1 → ×6 of a hero hit per second
      mk('duration', 'Burns for', 'sec', 6, 1, 24),        // 6s → 30s
      mk('cooldown', 'Cooldown', 'sec', 120, -3, 30),      // 120s → 30s
    ],
  },
  {
    id: 'frost', name: 'Frost Nova', cat: 'defense', art: 'frost', proposed: true,
    blurb: 'A shock of cold freezes every enemy in range solid; on thaw the frozen shatter for damage.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 150, -3.5, 30),    // 150s → 45s
      mk('freeze', 'Freeze lasts', 'sec', 2, 0.4, 20),     // 2s → 10s
      mk('radius', 'Radius', 'meters', 10, 1.5, 24),       // 10m → 46m
      mk('shatter', 'Shatter ×', 'mult', 3, 0.7, 20),      // ×3 → ×17
    ],
  },
  {
    id: 'aegis', name: 'Aegis Bulwark', cat: 'defense', art: 'aegis', proposed: true,
    blurb: 'A shield bubble snaps up around the tower, soaking hits and reflecting a share back.',
    tracks: [
      mk('shield', 'Shield HP', 'count', 200, 150, 30),    // 200 → 4700 absorbed
      mk('cooldown', 'Cooldown', 'sec', 180, -4, 30),      // 180s → 60s
      mk('duration', 'Holds for', 'sec', 8, 1, 20),        // 8s → 28s
      mk('reflect', 'Reflect %', 'pct', 0.2, 0.04, 15),    // 20% → 80%
    ],
  },
  {
    id: 'singularity', name: 'Singularity', cat: 'utility', art: 'singularity', proposed: true,
    blurb: 'A black hole tears open, dragging enemies inward and crushing them into pure Energy.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 300, -7, 30),      // 300s → 90s
      mk('radius', 'Pull radius', 'meters', 12, 1.5, 24),  // 12m → 48m
      mk('duration', 'Lasts', 'sec', 4, 0.5, 16),          // 4s → 12s
      mk('energy', 'Energy / crush', 'count', 1, 1, 14),   // 1 → 15
    ],
  },
  {
    id: 'chrono', name: 'Chrono Field', cat: 'utility', art: 'chrono', proposed: true,
    blurb: 'Time dilates: every enemy crawls while the tower keeps firing at full speed (and faster).',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 220, -5, 30),      // 220s → 70s
      mk('duration', 'Lasts', 'sec', 6, 0.8, 20),          // 6s → 22s
      mk('slow', 'Enemy slow', 'pct', 0.3, 0.03, 18),      // 30% → 84% slow
      mk('haste', 'Tower haste ×', 'mult', 1.2, 0.1, 18),  // ×1.2 → ×3
    ],
  },
  {
    id: 'midas', name: 'Midas Rain', cat: 'economy', art: 'midas', proposed: true,
    blurb: 'For a window every kill rains coins and gold — a gold rush bolted onto your kill streak.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 260, -6, 24),      // 260s → 116s
      mk('duration', 'Lasts', 'sec', 10, 2, 20),           // 10s → 50s
      mk('coin', 'Coin ×', 'mult', 2, 0.5, 20),            // ×2 → ×12
      mk('gold', 'Gold ×', 'mult', 2, 0.4, 20),            // ×2 → ×10
    ],
  },
  {
    id: 'mirror', name: 'Mirror Turret', cat: 'utility', art: 'mirror', proposed: true,
    blurb: 'Summons a ghost clone of your tower that fights beside you for the duration of the window.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 200, -4, 30),      // 200s → 80s
      mk('duration', 'Lasts', 'sec', 12, 2, 20),           // 12s → 52s
      mk('damage', 'Clone dmg ×', 'mult', 0.5, 0.05, 20),  // ×0.5 → ×1.5 of your damage
      mk('rate', 'Clone fire ×', 'mult', 0.6, 0.04, 15),   // ×0.6 → ×1.2 of your fire rate
    ],
  },
  {
    id: 'soul', name: 'Soul Harvest', cat: 'utility', art: 'soul', proposed: true,
    blurb: 'Opens a reaping window: every kill is siphoned for Energy, and bosses pay a fortune.',
    tracks: [
      mk('cooldown', 'Cooldown', 'sec', 280, -6, 30),      // 280s → 100s
      mk('duration', 'Lasts', 'sec', 8, 1, 20),            // 8s → 28s
      mk('energy', 'Energy / kill', 'count', 1, 1, 14),    // 1 → 15
      mk('boss', 'Boss bonus ×', 'mult', 2, 1, 18),        // ×2 → ×20
    ],
  },
];

// Default unlock ladder: the game's first three rungs, then a hand-tuned ramp for the extra weapons.
const EXTRA_RUNGS = [500_000, 1_500_000, 4_000_000, 10_000_000, 25_000_000, 60_000_000, 150_000_000, 350_000_000, 800_000_000];

export function defaultCatalog(): Catalog {
  const current = SUPERPOWERS.map((sp) => gameWeaponToDraft(sp.id));
  return {
    weapons: [...current, ...structuredClone(PROPOSED)],
    unlockLadder: [...UNLOCK_COSTS, ...EXTRA_RUNGS],
  };
}
