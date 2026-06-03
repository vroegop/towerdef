/* src/types.ts — shared type definitions for the whole game.
   These describe the serializable sim state (the save file), the persistent meta, and the
   data registries. The sim mutates these objects in place; the renderer + HUD read them. */

export interface Rng {
  next(): number;
  state: number;
}

export type Shape = 'circle' | 'square' | 'triangle' | 'hexagon' | 'diamond' | 'pentagon';
export type Behavior = 'stick' | 'bounce';

// Bulk-buy quantity: a fixed count, or 'max' (buy as many as affordable up to the cap).
export type BulkQty = number | 'max';

export interface EnemyTypeDef {
  shape: Shape;
  behavior: Behavior;
  color: string; // drawing colour (enemies have a single mode now; no strength tiers)
  hp: number;
  dmg: number;
  speed: number;
  range: number;
  r: number;
  mass: number; // resists knockback: higher mass = less push / more slow
  splits?: number;
  coinValue: number; // coins paid on kill (relative to basic melee = 1), scaled by the wave coin-step
}

// ---- persistent meta (the between-runs save, separate from a run's State) ----
export interface CardInstance {
  id: string;
  stars: number; // here = the card's LEVEL (1..MAX_STARS); kept named `stars` for save compatibility
}
export type Rarity = 'common' | 'rare' | 'epic';
export interface Research {
  id: string;
  cost: number;
  endsAt: number;
}
export interface Meta {
  coins: number;
  perm: Record<string, number>;
  unlocked: Record<string, boolean>; // which skills have been unlocked in the Workshop (gates buying)
  hasPlayed: boolean;
  bestWave: number;
  claimedMilestones: Record<string, boolean>;
  tier: number;
  tierBest: Record<string, number>;
  gems: number;
  cards: CardInstance[];
  cardBuys: number;
  cardSlots: number;      // number of ACTIVE card slots (start 1; bought with gems)
  activeCards: string[];  // card ids placed in slots (only these affect computeStats)
  totalWaves: number;
  labs: Record<string, number>;
  research: Research[];
  labSlots: number;
  vials: number;
  lastCheckIn: number;
  // selected cosmetic id per category (tower / hud / background). Unlock + passive buffs are derived
  // live from src/sim/cosmetics.ts; only the chosen id is persisted here.
  cosmetics?: Record<string, string>;
  cosmeticsOwned?: Record<string, boolean>; // gem-bought cosmetics (tier-gated ones derive from progress)
  gameSpeed?: number; // player-chosen battle speed (0.5/1 free; higher tiers unlocked by the Game Speed lab)
  inRunTutDone?: boolean; // the "run upgrades are temporary" in-run tutorial has been shown once
  ver: number;
}

// ---- live run state (this object IS the save-game snapshot) ----
export interface Arena {
  w: number;
  h: number;
}
export interface Hero {
  x: number;
  y: number;
  r: number;
  hp: number;
  hpMax: number;
  sinceHit: number;
  atkCd: number;
  range: number;
}
export interface Enemy {
  id: number;
  type: string;
  shape: Shape;
  behavior: Behavior;
  color: string;
  r: number;
  x: number;
  y: number;
  facing: number;
  strMult: number;
  hpMax: number;
  hp: number;
  dmg: number;
  speed: number;
  range: number;
  state: string;
  atkCd: number;
  kb: number;
  hitFlash: number;
  hitDmg: number;
  rend: number;
  rendT: number;
  splits: number;
  mass: number; // resists knockback
  slow: number; // active slow multiplier (1 = none) from knockback on a too-heavy enemy
  slowT: number; // seconds the slow remains
  bornWave: number;
  veteran: boolean;
  agedWaves: number;
  heat: number; // landed-hit count; outgoing dmg is scaled by 1.04^heat (compounding heat-up)
}
export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  traveled: number;
  maxDist: number;
  bounces?: number;
  hitIds?: number[] | null;
  bounceRange?: number;
}
// Transient per-kill UI events the renderer consumes (gold/coin drops).
export interface FxEvent {
  seq: number;
  x: number;
  y: number;
  gold?: number;
  coin?: number;
}
export interface Wave {
  n: number;
  clock: number;
  toSpawn: number;
  releaseTimer: number;
  releaseGap: number;
  count: number;
  maxWave: number;
  queue: string[]; // ordered enemy types still to spawn this wave (resume-safe; see waveRoster)
}
export interface Econ {
  gold: number;
  xp: number;
  level: number;
  kills: number;
  goldEarned: number;
  bonusCoins: number;
  hitsTaken: number; // count of landed hits on the hero (instrumentation; also used by the dev dashboard)
}
export interface Run {
  levels: Record<string, number>;
  rapidT: number;
  rapidCheckCd: number;
  // ---- active-card subsystem (per-run; reset each run) ----
  // Per-ability cooldown/active timers, keyed by card id. cd = seconds until ready (>0 = on cooldown);
  // active = seconds the effect is currently live (>0 = active).
  actCd?: Record<string, number>;
  actActive?: Record<string, number>;
  secondWindUsed?: boolean; // Second Wind auto-revive fires once per run
  invuln?: number;          // seconds the hero is invincible (Demon Mode / Second Wind shield)
  dmgBoost?: number;        // transient outgoing-damage multiplier from active abilities (1 = none)
}
export interface State {
  seed: number;
  rng: number;
  tick: number;
  t: number;
  alive: boolean;
  nextId: number;
  atkMode: 'bullet' | 'lightning';
  firstRun: boolean;
  difficultyMult: number;
  arena: Arena;
  hero: Hero;
  enemies: Enemy[];
  projectiles: Projectile[];
  fx: FxEvent[];
  fxSeq: number;
  wave: Wave;
  econ: Econ;
  run: Run;
  meta: Meta;
  // first-run scripted-intro scratch fields (set by core._firstRunWaves)
  firstSpawned?: number;
  firstTimer?: number;
}

// computeStats output: a flat bag of sim numbers. Indexable because cards/labs touch keys by name.
export interface Stats {
  [k: string]: number;
}

// ---- data registries ----
export interface UpgradeCurve {
  base: number;
  grow: number;
  cost: (n: number) => number;
  points?: [number, number][]; // present ⇒ cost is an exact sampled table (interpolated), not base·grow^n
}
// A balance curve expressed as DATA so it can be graphed, rebalanced, and exported without
// touching code. `linear` (base + per·n, optionally capped) covers every upgrade; `geom`
// (mul·ratio^(n-1)) covers the exponential cards. evalCurve() in skills.ts turns it into a number.
export type Curve =
  | { kind: 'linear'; base: number; per: number; cap?: number } // base + per·n (optionally capped)
  | { kind: 'geom'; mul: number; ratio: number } // mul·ratio^(n-1) for n>0, else 0 (per-star cards)
  | { kind: 'exp'; base: number; ratio: number; cap?: number } // base·ratio^n — value(0)=base, then compounds
  | { kind: 'table'; points: [number, number][] }; // exact sampled [level,value] points, linear-interpolated

export interface UpgradeDef {
  id: string;
  tab: string;
  icon: string;
  // The Stats key this upgrade's displayed value maps to (defaults to `id`). Single source of truth
  // for "which sim stat does this skill drive" — consumed by effectiveUpgradeValue. Most upgrades are
  // 1:1 with their id; only a handful diverge (e.g. health→maxHp, attackSpeed→fireRate, range→rangeM).
  stat?: string;
  label: string;      // short label shown on tile
  name?: string;      // full name shown in detail modal (falls back to label)
  tip?: string | ((up: UpgradeDef) => string); // derived at render time or static
  max: number;
  gated?: boolean;
  curve: Curve;                 // the balance data; `value` is generated from it at module load
  value: (b: number) => number; // (auto-generated) reads `curve` live, so edits flow through
  fmt: (v: number) => string;   // formats a COMPUTED value (not a level), so a rebalance shows correctly
  gold: UpgradeCurve;
  coin: UpgradeCurve;
}
// An UpgradeDef before its `value` is generated from `curve` (the literal we write in skills.ts).
export type UpgradeSpec = Omit<UpgradeDef, 'value'>;
export interface TabDef {
  id: string;
  icon: string;
  gated?: boolean;
}
export interface CardEffect {
  stat: string;
  // 'flat'  → value is ADDED to the stat (e.g. +0.05 crit chance)
  // 'mult'  → value is the ABSOLUTE multiplier on the stat (e.g. ×1.50 damage)
  // 'aura'/'mechanic'/'active' → not a plain stat; the value is surfaced in Stats under `stat`
  //   for the sim/active subsystem to read (it does not directly scale a base stat number).
  kind: 'flat' | 'mult' | 'aura' | 'mechanic' | 'active';
}
// The outcome of a card draw / star-up, returned to the HUD so it can play the matching reveal.
export interface CardDrawResult {
  id: string;
  before: number;
  after: number;
  unlocked: boolean;
}
export interface CardDef {
  id: string;
  name: string;
  art: string;
  tint: string;
  rarity: Rarity;
  effects: CardEffect[];
  curve: Curve;                     // balance data; `value` generated from it at module load
  value: (stars: number) => number; // (auto-generated) reads `curve` live
  fmt: (v: number) => string;
  desc: (v: number) => string;
  // Optional active-ability timing (Epics + a couple Rares). Durations in seconds.
  active?: { cooldown?: number; duration?: number };
}
export type CardSpec = Omit<CardDef, 'value'>;
export interface LabCurve {
  base: number;
  grow: number;
  at: (n: number) => number;
}
export interface LabDef {
  id: string;
  cat: string;
  kind: 'cap' | 'scale' | 'flat' | 'special';
  target: string;
  label: string;
  per: number;
  max: number;
  coin: LabCurve;
  time: LabCurve;
  gate: { wave: number };
  // How the per-level effect is phrased in the HUD. Defaults to 'mult' (×) for scale labs.
  unit?: 'mult' | 'meters' | 'pct' | 'gold' | 'tierpct' | 'intcap';
}
// ---- HUD surface ----
export interface EarnSummary {
  coins?: number;
  kills?: number;
  wave?: number;
}
export interface MenuOpts {
  earn?: EarnSummary;
}
export interface Settings {
  goldOnKill: boolean;
  coinOnKill: boolean;
  enemyHp: boolean;
  damageNumbers: boolean;
  showTutorials: boolean;     // play the in-run guided tutorials (also re-enables them after a skip)
  showOfflineReward: boolean; // show the "while you were away" summary modal when a run survives offline
}
// Spoils accrued while a survived run was simulated offline — shown in the offline-reward modal.
export interface OfflineReward {
  gold: number;
  kills: number;
  waves: number;
}
export interface HudHandlers {
  settings?: Settings;
  onSaveSettings?: () => void;
  onSaveMeta?: () => void; // persist meta after the HUD mutates it directly (e.g. tutorial flags)
  onBuyRun?: (stat: string, qty?: BulkQty) => void;
  onBuyPerm?: (id: string, qty?: BulkQty) => boolean;
  onUnlockGroup?: (groupId: string) => boolean;
  onClaimMilestone?: (wave: number) => boolean;
  onClaimAllMilestones?: () => boolean;
  onSetTier?: (t: number) => boolean;
  onSelectCosmetic?: (kind: string, id: string) => boolean;
  onBuyCosmetic?: (id: string) => boolean;
  onBuyCard?: () => CardDrawResult | null;
  onBuyCardSlot?: () => boolean;
  onSetActiveCard?: (slot: number, id: string | null) => boolean;
  onStartResearch?: (id: string) => boolean;
  onCancelResearch?: (id: string) => boolean;
  onRushResearch?: (id: string) => boolean;
  onBuyLabSlot?: () => boolean;
  onSetGameSpeed?: (speed: number) => number; // set the battle speed; returns the value now in effect
  onReconcileLabs?: () => string[] | void;
  onCheckIn?: () => unknown;
  onStartRun?: () => void;
  onExitRun?: () => void;
  onToWorkshop?: () => void;
  onDev?: (kind: string) => void;
  onFF?: (sec: number) => void;
  [k: string]: unknown;
}
export interface Hud {
  update(s: State): void;
  showMenu(meta: Meta, opts: MenuOpts): void;
  refreshMenu(meta: Meta): void;
  hideMenu(): void;
  showOverview(meta: Meta, earn: EarnSummary, opts?: { offline?: boolean }): void;
  hideOverview(): void;
  showHint(html: string): void;
  hideHint(): void;
  showOfflineReward(reward: OfflineReward): void;
  setMeta(meta: Meta): void;
  root: HTMLElement;
  destroy?: () => void;
}
export type HudFactory = (root: HTMLElement, handlers: HudHandlers) => Hud;
export interface ThemeDef {
  cls?: string;
  css?: string;
}
export interface HudHost extends Hud {
  switchTo(name: string, isRevert?: boolean): Promise<boolean>;
  attachDevMenu(dm: DevMenu): void;
  getActiveName(): string | null;
  setDevToggle(kind: string, on: boolean): void;
}
export interface DevMenu {
  el: HTMLElement;
  setToggle(kind: string, on: boolean): void;
  report(msg: string, isErr?: boolean): void;
  refresh(): void;
  destroy(): void;
}
export interface HudRegistryEntry {
  label: string;
  load: () => HudFactory | Promise<HudFactory>;
}
