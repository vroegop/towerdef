/* src/sim/skills.ts — UNIFIED upgrade model.

   ONE list of upgrades (UPGRADES). Every upgrade is buyable in two contexts:
     • in a run, with GOLD   → run.levels[id]  (resets each run)
     • out of a run, with CORES → meta.perm[id] (permanent; a "base level skip")

   The effective number of levels a stat has is perm + run (capped at the upgrade's max).
   Tabs: attack / defense / economic (icons, not words). */
import type { CardDef, CardDrawResult, Meta, State, Stats, TabDef, UpgradeCurve, UpgradeDef } from '../types';
import { labCapBonus, labScaleMults } from './labs';

// pixel/metre scale: the literal range stat is in METRES; the sim runs in pixels.
export const PX_PER_METER = 4;
export const BASE_RANGE_M = 50; // default attack radius before any Range upgrade
export const MAX_RANGE_M = 1000; // hard cap on range (metres)
export const MAX_REND = 10; // cap on Rend stacks an enemy can carry
export const REND_DECAY = 4; // seconds a Rend stack persists without a refresh
export const RAPID_CHECK = 5; // seconds between Rapid Fire burst rolls
export const RAPID_MULT = 3; // fire-rate multiplier during a Rapid Fire burst

// cost factory: round(base · growth^n). growth > 1 → accelerating curve.
const curve = (base: number, grow: number): UpgradeCurve => ({
  base,
  grow,
  cost: (n: number) => Math.round(base * Math.pow(grow, n)),
});

// The three subtabs shared by the in-run bar and the out-of-run Upgrades menu.
export const TAB_DEFS: TabDef[] = [
  { id: 'attack', icon: 'sword' },
  { id: 'defense', icon: 'shield' },
  { id: 'economic', icon: 'coins', gated: true }, // locked until Tier 2 is reached
];

// Every upgrade. `value(b)` turns a level count into the stat number; `fmt(b)` is the
// string shown to the player; `max` caps perm+run; `gold`/`core` are the two cost curves.
export const UPGRADES: UpgradeDef[] = [
  // ---- ATTACK ----
  { id: 'attackSpeed', tab: 'attack', icon: 'rate', label: 'Attack Speed', max: 10000,
    value: (b) => 1 + b, fmt: (b) => 1 + b + '/s', gold: curve(15, 1.6), core: curve(3, 1.0018) },
  { id: 'rangedDamage', tab: 'attack', icon: 'bow', label: 'Ranged Damage', max: 10000,
    value: (b) => 1 + b, fmt: (b) => '' + (1 + b), gold: curve(10, 1.5), core: curve(4, 1.0018) },
  { id: 'dmgPerMeter', tab: 'attack', icon: 'ruler', label: 'Damage / Metre', max: 10000,
    value: (b) => b * 0.001, fmt: (b) => '+' + (b * 0.001).toFixed(3) + '×/m', gold: curve(25, 1.55), core: curve(6, 1.0018) },
  { id: 'range', tab: 'attack', icon: 'range', label: 'Range', max: 9500,
    value: (b) => Math.min(MAX_RANGE_M, BASE_RANGE_M + b * 0.1),
    fmt: (b) => Math.min(MAX_RANGE_M, BASE_RANGE_M + b * 0.1).toFixed(1) + 'm', gold: curve(20, 1.5), core: curve(5, 1.0018) },
  { id: 'critChance', tab: 'attack', icon: 'crit', label: 'Crit Chance', max: 1200,
    value: (b) => Math.min(1.2, b * 0.001), fmt: (b) => (Math.min(1.2, b * 0.001) * 100).toFixed(1) + '%', gold: curve(40, 1.6), core: curve(20, 1.008) },
  { id: 'critDamage', tab: 'attack', icon: 'burst', label: 'Crit Damage', max: 10000,
    value: (b) => 1 + b * (999 / 10000),
    fmt: (b) => { const v = 1 + b * (999 / 10000); return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + '×'; }, gold: curve(50, 1.6), core: curve(25, 1.0018) },
  { id: 'superCrit', tab: 'attack', icon: 'burst', label: 'Super Crit', max: 1000,
    value: (b) => Math.min(1, b * 0.001), fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%', gold: curve(80, 1.6), core: curve(25, 1.0018) },
  { id: 'rendChance', tab: 'attack', icon: 'crit', label: 'Rend Chance', max: 1000,
    value: (b) => Math.min(1, b * 0.001), fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%', gold: curve(90, 1.6), core: curve(25, 1.0018) },
  { id: 'rendMult', tab: 'attack', icon: 'burst', label: 'Rend Power', max: 1000,
    value: (b) => b * 0.002, fmt: (b) => '+' + (b * 0.002 * 100).toFixed(1) + '%/stack', gold: curve(90, 1.6), core: curve(25, 1.0018) },
  { id: 'msChance', tab: 'attack', icon: 'bow', label: 'Multishot', max: 1000,
    value: (b) => Math.min(1, b * 0.001), fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%', gold: curve(100, 1.6), core: curve(25, 1.0018) },
  { id: 'msTargets', tab: 'attack', icon: 'bow', label: 'Multishot Targets', max: 8,
    value: (b) => 1 + b, fmt: (b) => '' + (1 + b), gold: curve(250, 1.7), core: curve(40, 1.02) },
  { id: 'bounceChance', tab: 'attack', icon: 'arrow', label: 'Bounce Shot', max: 1000,
    value: (b) => Math.min(1, b * 0.001), fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%', gold: curve(100, 1.6), core: curve(25, 1.0018) },
  { id: 'bounceTargets', tab: 'attack', icon: 'arrow', label: 'Bounce Targets', max: 10,
    value: (b) => 1 + b, fmt: (b) => '' + (1 + b), gold: curve(250, 1.7), core: curve(40, 1.02) },
  { id: 'bounceRange', tab: 'attack', icon: 'range', label: 'Bounce Range', max: 10000,
    value: (b) => 120 + b, fmt: (b) => Math.round((120 + b) / PX_PER_METER) + 'm', gold: curve(60, 1.5), core: curve(10, 1.0018) },
  { id: 'rapidChance', tab: 'attack', icon: 'rate', label: 'Rapid Fire', max: 1000,
    value: (b) => Math.min(1, b * 0.001), fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%', gold: curve(100, 1.6), core: curve(25, 1.0018) },
  { id: 'rapidDuration', tab: 'attack', icon: 'rate', label: 'Rapid Duration', max: 480,
    value: (b) => 2 + b * 0.1, fmt: (b) => (2 + b * 0.1).toFixed(1) + 's', gold: curve(120, 1.6), core: curve(20, 1.0018) },

  // ---- DEFENSE ----
  { id: 'health', tab: 'defense', icon: 'heart', label: 'Health', max: 10000,
    value: (b) => 1 + b, fmt: (b) => '' + (1 + b), gold: curve(10, 1.5), core: curve(4, 1.0018) },
  { id: 'regen', tab: 'defense', icon: 'regen', label: 'Health Regen', max: 10000,
    value: (b) => b * 0.2, fmt: (b) => (b * 0.2).toFixed(1) + '/s', gold: curve(20, 1.6), core: curve(5, 1.0018) },
  { id: 'dodge', tab: 'defense', icon: 'dodge', label: 'Dodge', max: 1100,
    value: (b) => Math.min(0.99, b * 0.0009), fmt: (b) => (Math.min(0.99, b * 0.0009) * 100).toFixed(1) + '%', gold: curve(40, 1.6), core: curve(20, 1.008) },
  { id: 'armor', tab: 'defense', icon: 'shield', label: 'Armor', max: 10000,
    value: (b) => b, fmt: (b) => '-' + b, gold: curve(30, 1.55), core: curve(6, 1.0018) },
  { id: 'defPct', tab: 'defense', icon: 'shield', label: 'Defense %', max: 900,
    value: (b) => Math.min(0.9, b * 0.001), fmt: (b) => (Math.min(0.9, b * 0.001) * 100).toFixed(1) + '%', gold: curve(50, 1.6), core: curve(20, 1.008) },
  { id: 'thorns', tab: 'defense', icon: 'shield', label: 'Thorns', max: 10000,
    value: (b) => b * 0.05, fmt: (b) => '+' + (b * 0.05).toFixed(2) + '×', gold: curve(35, 1.55), core: curve(8, 1.0018) },
  { id: 'lifesteal', tab: 'defense', icon: 'regen', label: 'Lifesteal', max: 500,
    value: (b) => Math.min(0.25, b * 0.0005), fmt: (b) => (Math.min(0.25, b * 0.0005) * 100).toFixed(1) + '%', gold: curve(60, 1.6), core: curve(15, 1.0018) },

  // ---- ECONOMIC (Tier 2+) ----
  { id: 'coinsPerWave', tab: 'economic', icon: 'coin', label: 'Coins / Wave', max: 10000, gated: true,
    value: (b) => b, fmt: (b) => '+' + b, gold: curve(30, 1.55), core: curve(8, 1.0018) },
  { id: 'coinsPerKill', tab: 'economic', icon: 'coin', label: 'Coins / Kill', max: 10000, gated: true,
    value: (b) => b * 0.1, fmt: (b) => '+' + (b * 0.1).toFixed(1) + '×', gold: curve(50, 1.6), core: curve(12, 1.0018) },
  { id: 'cashBonus', tab: 'economic', icon: 'coin', label: 'Cash Bonus', max: 10000, gated: true,
    value: (b) => 1 + b * 0.02, fmt: (b) => '×' + (1 + b * 0.02).toFixed(2), gold: curve(40, 1.55), core: curve(10, 1.0018) },
  { id: 'interest', tab: 'economic', icon: 'coin', label: 'Interest', max: 500, gated: true,
    value: (b) => b * 0.002, fmt: (b) => (b * 0.002 * 100).toFixed(1) + '%/wave', gold: curve(80, 1.6), core: curve(20, 1.0018) },
  { id: 'maxInterest', tab: 'economic', icon: 'coin', label: 'Max Interest', max: 10000, gated: true,
    value: (b) => 50 + b * 10, fmt: (b) => '≤' + (50 + b * 10), gold: curve(40, 1.55), core: curve(10, 1.0018) },
  { id: 'freeUp', tab: 'economic', icon: 'coins', label: 'Free Upgrades', max: 200, gated: true,
    value: (b) => Math.min(0.5, b * 0.0025), fmt: (b) => (Math.min(0.5, b * 0.0025) * 100).toFixed(1) + '%', gold: curve(120, 1.6), core: curve(25, 1.0018) },
  { id: 'waveCut', tab: 'economic', icon: 'rate', label: 'Wave Speed', max: 5, gated: true,
    value: (b) => Math.min(5, b), fmt: (b) => '-' + Math.min(5, b) + 's', gold: curve(5000, 4), core: curve(2000, 3) },
  { id: 'coresPerWave', tab: 'economic', icon: 'cores', label: 'Cores / Wave', max: 10000, gated: true,
    value: (b) => b, fmt: (b) => '+' + b, gold: curve(50, 1.6), core: curve(10, 1.0018) },
  { id: 'coresPerKill', tab: 'economic', icon: 'cores', label: 'Cores / Kill', max: 10000, gated: true,
    value: (b) => b * 0.001, fmt: (b) => '+' + (b * 0.001).toFixed(3), gold: curve(60, 1.6), core: curve(15, 1.0018) },
];
export const UP_BY_ID: Record<string, UpgradeDef> = {};
for (const u of UPGRADES) UP_BY_ID[u.id] = u;
export const upgradesIn = (tab: string): UpgradeDef[] => UPGRADES.filter((u) => u.tab === tab);

// economic/utility upgrades: tier gating disabled — everything is buyable from the start (test mode)
export const economyUnlocked = (_meta: Meta): boolean => true;

// The scripted first run grants exactly enough cores to buy the tutorial's first upgrade.
export const FIRST_PERM_COST = UP_BY_ID.attackSpeed.core.cost(0);

// The effective cap for an upgrade: its base `max` PLUS any cap raised by labs.
function capOf(meta: Meta, id: string): number {
  const up = UP_BY_ID[id];
  return up.max + labCapBonus(meta, id);
}

// perm + run levels for an upgrade, capped at its (lab-liftable) cap.
export function boughtOf(state: State, id: string): number {
  const perm = (state.meta && state.meta.perm && state.meta.perm[id]) || 0;
  const run = (state.run && state.run.levels && state.run.levels[id]) || 0;
  return Math.min(capOf(state.meta, id), perm + run);
}
// perm-only level (used by the between-runs menu, which has no live run state)
export const permBought = (meta: Meta, id: string): number =>
  Math.min(capOf(meta, id), (meta && meta.perm && meta.perm[id]) || 0);

// ---- CARDS (Pokemon-style; bought/upgraded with a separate active-play currency: TOKENS) ----
export const MAX_STARS = 15; // 5 white, then 5 gold, then 5 chromatic (each star raises value)
const pow2 = (stars: number): number => (stars > 0 ? Math.pow(2, stars - 1) : 0); // 1,2,4,8,16...
const pct = (v: number): string => '+' + Math.round(v * 100) + '%';
export const CARDS: Record<string, CardDef> = {
  damage: { id: 'damage', name: 'Bullseye', art: 'bullseye', tint: '#37d7ff',
    effects: [{ stat: 'rangedDamage', kind: 'flat' }], value: pow2, fmt: (v) => '+' + v, desc: (v) => '+' + v + ' ranged damage' },
  power: { id: 'power', name: 'Onslaught', art: 'bow', tint: '#4aa8ff',
    effects: [{ stat: 'rangedDamage', kind: 'mult' }], value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' damage' },
  haste: { id: 'haste', name: 'Overclock', art: 'rate', tint: '#ffae4a',
    effects: [{ stat: 'attackSpeed', kind: 'mult' }], value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' attack speed' },
  crit: { id: 'crit', name: 'Deadeye', art: 'crit', tint: '#ffd24a',
    effects: [{ stat: 'critChance', kind: 'flat' }], value: (s) => s * 0.01, fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% crit chance' },
  execute: { id: 'execute', name: 'Executioner', art: 'burst', tint: '#e64cff',
    effects: [{ stat: 'critDamage', kind: 'mult' }], value: (s) => s * 0.15, fmt: pct, desc: (v) => pct(v) + ' crit damage' },
  vitality: { id: 'vitality', name: 'Vitality', art: 'heart', tint: '#ff5d6c',
    effects: [{ stat: 'health', kind: 'flat' }], value: pow2, fmt: (v) => '+' + v, desc: (v) => '+' + v + ' health' },
  regrowth: { id: 'regrowth', name: 'Regrowth', art: 'regen', tint: '#3ddc84',
    effects: [{ stat: 'regen', kind: 'flat' }], value: (s) => s * 0.5, fmt: (v) => '+' + v.toFixed(1) + '/s', desc: (v) => '+' + v.toFixed(1) + ' regen/s' },
  phantom: { id: 'phantom', name: 'Phantom', art: 'dodge', tint: '#37d7ff',
    effects: [{ stat: 'dodge', kind: 'flat' }], value: (s) => s * 0.005, fmt: (v) => '+' + (v * 100).toFixed(1) + '%', desc: (v) => '+' + (v * 100).toFixed(1) + '% dodge' },
  fortune: { id: 'fortune', name: 'Fortune', art: 'coin', tint: '#ffd24a',
    effects: [{ stat: 'coins', kind: 'mult' }], value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' coins' },
  bramble: { id: 'bramble', name: 'Bramble', art: 'shield', tint: '#3ddc84',
    effects: [{ stat: 'thorns', kind: 'flat' }], value: (s) => s * 0.05, fmt: (v) => '+' + v.toFixed(2) + '×', desc: (v) => '+' + v.toFixed(2) + '× thorns' },
  volley: { id: 'volley', name: 'Volley', art: 'bow', tint: '#4aa8ff',
    effects: [{ stat: 'msChance', kind: 'flat' }], value: (s) => s * 0.02, fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% multishot' },
  ricochet: { id: 'ricochet', name: 'Ricochet', art: 'arrow', tint: '#37d7ff',
    effects: [{ stat: 'bounceChance', kind: 'flat' }], value: (s) => s * 0.02, fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% bounce' },
  sunder: { id: 'sunder', name: 'Sunder', art: 'burst', tint: '#e64cff',
    effects: [{ stat: 'rendMult', kind: 'flat' }], value: (s) => s * 0.02, fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% rend power' },
  eagle: { id: 'eagle', name: 'Eagle Eye', art: 'range', tint: '#37d7ff',
    effects: [{ stat: 'range', kind: 'mult' }], value: (s) => s * 0.05, fmt: pct, desc: (v) => pct(v) + ' range' },
  compound: { id: 'compound', name: 'Compound', art: 'coin', tint: '#ffd24a',
    effects: [{ stat: 'interest', kind: 'flat' }], value: (s) => s * 0.002, fmt: (v) => '+' + (v * 100).toFixed(1) + '%', desc: (v) => '+' + (v * 100).toFixed(1) + '% interest' },
};
export const CARD_SLOTS = 20;
export const CARD_ORDER = ['damage', 'power', 'haste', 'crit', 'execute', 'vitality', 'regrowth', 'phantom', 'fortune',
  'bramble', 'volley', 'ricochet', 'sunder', 'eagle', 'compound'];
// plain-language explanation of what each card actually does (shown in the card detail view, so a
// label like "Speed" reads as "Attack faster — more shots per second" instead of a bare stat name).
export const CARD_INFO: Record<string, string> = {
  damage: 'Each shot hits harder.', power: 'Multiplies all of your ranged damage.',
  haste: 'Attack faster — more shots per second.', crit: 'Chance for a shot to critically strike.',
  execute: 'Critical hits deal extra bonus damage.', vitality: 'Raises your maximum health.',
  regrowth: 'Regenerate a little health every second.', phantom: 'Chance to dodge an incoming hit entirely.',
  fortune: 'Earn more coins from every kill.', bramble: 'Reflect a share of damage back to attackers.',
  volley: 'Chance to loose an extra projectile.', ricochet: 'Shots can bounce to a nearby enemy.',
  sunder: 'Shred enemy armor so attacks bite deeper.', eagle: 'Extends how far you can attack.',
  compound: 'Earn interest on your banked coins.',
};
export const cardsUnlocked = (_meta: Meta): boolean => true; // cards available from the start
export function grantInitialCard(meta: Meta): boolean {
  // Players start with an EMPTY collection and unlock cards by drawing them — the first draw of any
  // card type plays the locked-card flip reveal. (Kept as a hook so callers stay unchanged; no-op now.)
  meta.cards = meta.cards || [];
  return false;
}
export const starSlot = (i: number, stars: number): string =>
  stars >= i + 11 ? 'chroma' : stars >= i + 6 ? 'gold' : stars >= i + 1 ? 'white' : 'empty';

export const buyCardCost = (meta: Meta): number => 5 + 5 * (meta.cardBuys || 0);
// A single draw returns a RESULT describing the transition so the HUD can play the right reveal:
//   { id, before, after, unlocked }  — or null when the draw can't happen (everything is already
// maxed) or can't be afforded.
//
// The draw pool is every NON-MAXED card: un-owned cards, plus owned cards below MAX_STARS. Drawing
// an un-owned card unlocks it at 1 star; drawing one you already own adds a star. Maxed cards are
// excluded from the pool, so a draw never wastes tokens on a card that can no longer improve.
export function buyCard(meta: Meta): CardDrawResult | null {
  meta.cards = meta.cards || [];
  const pool = Object.keys(CARDS).filter((id) => {
    const c = meta.cards.find((x) => x.id === id);
    return !c || (c.stars || 0) < MAX_STARS;
  });
  if (!pool.length) return null; // every card maxed — nothing left to draw
  const cost = buyCardCost(meta);
  if ((meta.tokens || 0) < cost) return null;
  const id = pool[Math.floor(Math.random() * pool.length)];
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
  meta.tokens -= cost;
  meta.cardBuys = (meta.cardBuys || 0) + 1;
  return { id, before, after, unlocked };
}

// ---- tier / milestones (cores rewards for furthest-wave progress in the current tier) ----
export const TIER = 1;
export const MILESTONES: number[] = (() => {
  const a = [10, 50, 100, 250, 500];
  for (let w = 1000; w <= 10000; w += 1000) a.push(w);
  return a;
})();
export const milestoneReward = (wave: number): number => wave; // cores; tune freely
export function claimableCount(meta: Meta): number {
  const best = meta.bestWave || 0,
    cl = meta.claimedMilestones || {};
  let c = 0;
  for (const w of MILESTONES) if (best >= w && !cl[w]) c++;
  return c;
}
export function claimMilestone(meta: Meta, wave: number): number {
  const best = meta.bestWave || 0;
  meta.claimedMilestones = meta.claimedMilestones || {};
  if (best >= wave && !meta.claimedMilestones[wave]) {
    const r = milestoneReward(wave);
    meta.cores = (meta.cores || 0) + r;
    meta.claimedMilestones[wave] = true;
    return r;
  }
  return 0;
}

// Turn levels into the numbers the sim runs on, then apply card bonuses.
const STAT2SIM: Record<string, string> = {
  rangedDamage: 'rangedDamage', attackSpeed: 'fireRate', health: 'maxHp', regen: 'regen',
  critChance: 'critChance', critDamage: 'critMult', dodge: 'dodge', coins: 'goldFind',
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
    rendChance: U.rendChance.value(b('rendChance')),
    rendMult: U.rendMult.value(b('rendMult')),
    msChance: U.msChance.value(b('msChance')),
    msTargets: U.msTargets.value(b('msTargets')),
    bounceChance: U.bounceChance.value(b('bounceChance')),
    bounceTargets: U.bounceTargets.value(b('bounceTargets')),
    bounceRange: U.bounceRange.value(b('bounceRange')),
    rapidChance: U.rapidChance.value(b('rapidChance')),
    rapidDuration: U.rapidDuration.value(b('rapidDuration')),

    dodge: U.dodge.value(b('dodge')),
    armor: U.armor.value(b('armor')),
    defPct: U.defPct.value(b('defPct')),
    thorns: U.thorns.value(b('thorns')),
    lifesteal: U.lifesteal.value(b('lifesteal')),
    cashMult: U.cashBonus.value(b('cashBonus')),
    interest: U.interest.value(b('interest')),
    maxInterest: U.maxInterest.value(b('maxInterest')),
    waveCut: U.waveCut.value(b('waveCut')),
    coinsPerWave: U.coinsPerWave.value(b('coinsPerWave')),
    coresPerWave: U.coresPerWave.value(b('coresPerWave')),
    coresPerKill: U.coresPerKill.value(b('coresPerKill')),
    goldFind: 1 + U.coinsPerKill.value(b('coinsPerKill')),
    xpGain: 1,
  };
  // Resolve cards + labs into the final stats, keyed by SIM stat.
  const flat: Record<string, number> = {},
    mult: Record<string, number> = {};
  const cards = (state.meta && state.meta.cards) || [];
  for (const c of cards) {
    const def = CARDS[c.id];
    if (!def) continue;
    const v = def.value(c.stars || 0);
    for (const e of def.effects) {
      const k = STAT2SIM[e.stat] || e.stat;
      if (e.kind === 'mult') mult[k] = (mult[k] || 1) * (1 + v);
      else flat[k] = (flat[k] || 0) + v;
    }
  }
  const labMult = labScaleMults(state.meta) || {};
  const touched = new Set([...Object.keys(flat), ...Object.keys(mult), ...Object.keys(labMult)]);
  for (const k of touched) {
    if (typeof out[k] !== 'number') continue;
    out[k] = (out[k] + (flat[k] || 0)) * (labMult[k] || 1) * (mult[k] || 1);
  }
  // safety clamp: dodge must stay below 1 so the hero can never become un-hittable
  if (out.dodge > 0.99) out.dodge = 0.99;
  return out;
}

// ---- run upgrades (gold; price driven by run levels only) ----
export function runUpgradeCost(state: State, id: string): number {
  const up = UP_BY_ID[id];
  if (!up) return 0;
  return up.gold.cost(state.run.levels[id] || 0);
}
export function runAtMax(state: State, id: string): boolean {
  const perm = (state.meta.perm && state.meta.perm[id]) || 0;
  return perm + (state.run.levels[id] || 0) >= capOf(state.meta, id);
}
// `rng` (the live Sim PRNG) is optional; when present it drives the Free-Upgrades roll.
export function buyRunUpgrade(state: State, id: string, rng?: { next(): number }): boolean {
  const up = UP_BY_ID[id];
  if (!up) return false;
  if (up.gated && !economyUnlocked(state.meta)) return false;
  if (runAtMax(state, id)) return false;
  const n = state.run.levels[id] || 0,
    cost = up.gold.cost(n);
  const freeChance = UP_BY_ID.freeUp.value(boughtOf(state, 'freeUp'));
  const free = !!rng && freeChance > 0 && rng.next() < freeChance;
  if (!free) {
    if (state.econ.gold < cost) return false;
    state.econ.gold -= cost;
  }
  state.run.levels[id] = n + 1;
  return true;
}

// ---- permanent upgrades (cores; price driven by perm levels only) ----
export function permCost(meta: Meta, id: string): number {
  const up = UP_BY_ID[id];
  const n = (meta && meta.perm && meta.perm[id]) || 0;
  return up ? up.core.cost(n) : 0;
}
export function permAtMax(meta: Meta, id: string): boolean {
  return ((meta && meta.perm && meta.perm[id]) || 0) >= capOf(meta, id);
}
export function buyPerm(meta: Meta, id: string): boolean {
  const up = UP_BY_ID[id];
  if (!up) return false;
  if (up.gated && !economyUnlocked(meta)) return false;
  const n = (meta.perm && meta.perm[id]) || 0;
  if (n >= capOf(meta, id)) return false;
  const cost = up.core.cost(n);
  if ((meta.cores || 0) < cost) return false;
  meta.cores -= cost;
  meta.perm = meta.perm || {};
  meta.perm[id] = n + 1;
  return true;
}
