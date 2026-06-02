/* src/sim/cosmetics.ts — unlockable COSMETICS + their passive buffs.

   A cosmetic is a selectable skin in one of three categories — tower | hud | background.
   Each carries an OPTIONAL passive buff. Buffs are:
     • PASSIVE & always-on — they apply the moment the item is UNLOCKED, regardless of which
       skin you currently have selected (unlike active cards, which must be slotted).
     • MULTIPLICATIVE & stacking — N unlocked items that buff the same stat give base ×∏(1+amount).
     • DERIVED LIVE from this table — never snapshotted into the save. Editing an `amount` (or an
       `unlock`) here re-applies retroactively to every player on their next load, so balancing is a
       one-number change with no migration.

   Towers unlock by TIER PROGRESS: reaching TOWER_UNLOCK_WAVE in tier N unlocks tier N's tower (and
   its buff). The "basic" item in each category (`tier: null`) is always available and carries no
   buff. HUDs and backgrounds use the exact same schema so they can later be unlocked + selected the
   same way; only their picker UI is still to come.

   This module lives in sim/ and must stay free of DOM/canvas — the tower DRAW functions live in
   render/towers.ts, keyed by the same ids. */
import type { Meta } from '../types';

// Reach this wave in a tier to unlock that tier's tower skin + buff.
export const TOWER_UNLOCK_WAVE = 1000;

export type CosmeticKind = 'tower' | 'hud' | 'background';

// A buff multiplies a single keyed quantity by (1 + amount). The `stat` is consumed by whichever
// subsystem owns that quantity (see cosmeticBuffMult callers):
//   sim stats  → rangedDamage | fireRate | maxHp | critMult | range | bounceChance | goldFind
//   economy    → coinMult (end-of-run coins) | gemMult (all gem awards)
//   wall-clock → labSpeed (research finishes faster)
export interface CosmeticBuff {
  stat: string;
  amount: number; // e.g. 0.10 = +10% (×1.10); 1.00 = +100% (×2.00)
}
export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  desc: string; // short flavour line for the picker
  tier: number | null; // tier whose TOWER_UNLOCK_WAVE milestone unlocks it; null = always available
  cost?: number; // if set, BOUGHT with gems (ownership stored in meta.cosmeticsOwned) instead of tier-gated
  buff: CosmeticBuff | null; // null = no buff (the basic items)
}

// Human label for a buff stat (drives the picker chips). Keep in sync with the buff stats above.
export const BUFF_LABEL: Record<string, string> = {
  coinMult: 'coins',
  rangedDamage: 'damage',
  fireRate: 'attack speed',
  maxHp: 'health',
  labSpeed: 'lab speed',
  critChance: 'critical hit',
  critMult: 'crit damage',
  goldFind: 'gold per kill',
  gemMult: 'gems',
  bounceChance: 'bounce chance',
  range: 'range',
};
// "+10% damage" / "+100% gems" — used by the tower picker. Empty string when there's no buff.
export function buffText(buff: CosmeticBuff | null): string {
  if (!buff || !buff.amount) return '';
  return '+' + Math.round(buff.amount * 100) + '% ' + (BUFF_LABEL[buff.stat] || buff.stat);
}

// ---- the registry ----------------------------------------------------------------------------
// TOWERS: one basic (always free, no buff) + ten tier rewards. The tier→buff pairing matches the
// design spec; it is pure data, so reordering which skin sits on which tier is a one-line edit.
const TOWERS: Cosmetic[] = [
  { id: 'keep', kind: 'tower', name: 'Stone Keep', desc: 'A stout round castle tower. Your starting keep.', tier: null, buff: null },
  { id: 'prism', kind: 'tower', name: 'Prismatic Orb', desc: 'A sunlit orb wreathed in chromatic bubbles.', tier: null, cost: 50, buff: { stat: 'critChance', amount: 0.1 } },
  { id: 'sanctum', kind: 'tower', name: "Cleric's Sanctum", desc: 'A marble rotunda blessed with fortune.', tier: 1, buff: { stat: 'coinMult', amount: 0.1 } },
  { id: 'forge', kind: 'tower', name: 'Dwarven Forge', desc: 'A roaring furnace that tempers every shot.', tier: 2, buff: { stat: 'rangedDamage', amount: 0.1 } },
  { id: 'watchtower', kind: 'tower', name: "Ranger's Watchtower", desc: 'A scout post loosing arrows in a blur.', tier: 3, buff: { stat: 'fireRate', amount: 0.1 } },
  { id: 'heartwood', kind: 'tower', name: 'Druidic Heartwood', desc: 'A living bastion brimming with vitality.', tier: 4, buff: { stat: 'maxHp', amount: 0.1 } },
  { id: 'obelisk', kind: 'tower', name: 'Arcane Obelisk', desc: 'A floating monolith that hastens research.', tier: 5, buff: { stat: 'labSpeed', amount: 0.1 } },
  { id: 'necro', kind: 'tower', name: "Necromancer's Eye", desc: 'An eldritch eye that finds every weak point.', tier: 6, buff: { stat: 'critMult', amount: 0.1 } },
  { id: 'hoard', kind: 'tower', name: "Dragon's Hoard", desc: 'A wyrm coiled on its gold — every kill pays.', tier: 7, buff: { stat: 'goldFind', amount: 0.1 } },
  { id: 'crystal', kind: 'tower', name: 'Crystal Conflux', desc: 'A geode that doubles every gem you earn.', tier: 8, buff: { stat: 'gemMult', amount: 1.0 } },
  { id: 'nexus', kind: 'tower', name: 'Elemental Nexus', desc: 'A vortex that ricochets bolts between foes.', tier: 9, buff: { stat: 'bounceChance', amount: 0.1 } },
  { id: 'spire', kind: 'tower', name: "Wizard's Spire", desc: 'A tall spire that sees — and strikes — far.', tier: 10, buff: { stat: 'range', amount: 0.1 } },
];
// HUDs / BACKGROUNDS: only a 0-buff default for now. Adding more here (with a tier + buff) makes
// them unlock + buff exactly like towers; their picker UI is the only remaining piece.
const HUDS: Cosmetic[] = [
  { id: 'dnd', kind: 'hud', name: 'D&D Parchment', desc: 'The classic character-sheet skin.', tier: null, buff: null },
];
const BACKGROUNDS: Cosmetic[] = [
  { id: 'parchment', kind: 'background', name: 'Battle Map', desc: 'A worn parchment battle-map.', tier: null, buff: null },
];
export const COSMETICS: Cosmetic[] = [...TOWERS, ...HUDS, ...BACKGROUNDS];

const BY_ID: Record<string, Cosmetic> = {};
for (const c of COSMETICS) BY_ID[c.id] = c;
export const cosmeticById = (id: string): Cosmetic | undefined => BY_ID[id];
export const cosmeticsOf = (kind: CosmeticKind): Cosmetic[] => COSMETICS.filter((c) => c.kind === kind);
// The always-available basic item for a category (the selection a fresh save falls back to):
// the free one (no tier gate AND no gem cost).
export const defaultCosmetic = (kind: CosmeticKind): Cosmetic =>
  cosmeticsOf(kind).find((c) => c.tier == null && !c.cost) || cosmeticsOf(kind)[0];

// ---- unlock state ----------------------------------------------------------------------------
// Tier-gated cosmetics derive purely from progress (nothing stored). Gem-bought cosmetics record
// ownership in meta.cosmeticsOwned. Free basics are always owned.
export function isCosmeticUnlocked(meta: Meta, id: string): boolean {
  const c = BY_ID[id];
  if (!c) return false;
  if (c.cost && c.cost > 0) return !!(meta && meta.cosmeticsOwned && meta.cosmeticsOwned[id]);
  if (c.tier == null) return true; // free basic items are always owned
  const best = (meta && meta.tierBest && meta.tierBest[c.tier]) || 0;
  return best >= TOWER_UNLOCK_WAVE;
}
// Buy a gem-priced cosmetic. No-op (false) if it has no price, is already owned, or you can't afford it.
export function buyCosmetic(meta: Meta, id: string): boolean {
  const c = BY_ID[id];
  if (!c || !c.cost) return false;
  if (isCosmeticUnlocked(meta, id)) return false;
  if ((meta.gems || 0) < c.cost) return false;
  meta.gems -= c.cost;
  meta.cosmeticsOwned = meta.cosmeticsOwned || {};
  meta.cosmeticsOwned[id] = true;
  return true;
}

// ---- selection (the only cosmetic state we persist: one chosen id per category) ---------------
export function selectedCosmeticId(meta: Meta, kind: CosmeticKind): string {
  const sel = (meta && meta.cosmetics && meta.cosmetics[kind]) || '';
  if (sel && BY_ID[sel] && BY_ID[sel].kind === kind && isCosmeticUnlocked(meta, sel)) return sel;
  return defaultCosmetic(kind).id;
}
// Equip an unlocked cosmetic of the given kind. Returns false (no-op) if it isn't ownable yet.
export function selectCosmetic(meta: Meta, kind: CosmeticKind, id: string): boolean {
  const c = BY_ID[id];
  if (!c || c.kind !== kind || !isCosmeticUnlocked(meta, id)) return false;
  meta.cosmetics = meta.cosmetics || {};
  meta.cosmetics[kind] = id;
  return true;
}

// ---- the live buff multiplier (the heart of the system) --------------------------------------
// ×∏(1 + amount) over every UNLOCKED cosmetic that buffs `stat`. Selection-independent: owning the
// unlock is what grants the buff. Returns 1 when nothing buffs the stat.
export function cosmeticBuffMult(meta: Meta, stat: string): number {
  let m = 1;
  if (!meta) return m;
  for (const c of COSMETICS) {
    if (c.buff && c.buff.stat === stat && c.buff.amount && isCosmeticUnlocked(meta, c.id)) {
      m *= 1 + c.buff.amount;
    }
  }
  return m;
}

// Map a workshop UPGRADE id → the sim stat its value feeds, but ONLY for upgrades a cosmetic can
// buff — so the menu can show buffed totals (e.g. Attack Speed shows base ×1.10). Upgrades absent
// here are never cosmetic-buffed, so their displayed value is unchanged.
const UPGRADE_BUFF_STAT: Record<string, string> = {
  rangedDamage: 'rangedDamage',
  attackSpeed: 'fireRate',
  health: 'maxHp',
  critChance: 'critChance',
  critDamage: 'critMult',
  range: 'range',
  bounceChance: 'bounceChance',
  goldPerKill: 'goldFind',
};
// The cosmetic multiplier to apply to an upgrade's DISPLAYED value (1 if it isn't buffed).
export function upgradeBuffMult(meta: Meta, upgradeId: string): number {
  const stat = UPGRADE_BUFF_STAT[upgradeId];
  return stat ? cosmeticBuffMult(meta, stat) : 1;
}
