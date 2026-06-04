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
  cost: number;   // coins paid for the level currently in progress (refunded on replace; 0 while waiting)
  endsAt: number; // wall-clock ms the in-progress level completes (0 while waiting on coins)
  // Set when an auto-started next level can't be afforded yet: the slot stays ASSIGNED to this lab
  // (never idle) and reconcileResearch begins the level the moment coins are available.
  waiting?: boolean;
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
  // A purchased, time-limited GLOBAL lab-speed boost (the "Speed Up" modal). While endsAt is in the
  // future every running lab advances `mult`× faster; the window is real wall-clock time and is NOT
  // shortened by the multiplier (a 1-day 2× boost runs a full day and banks 2 days of lab time).
  labBoost?: { mult: number; endsAt: number } | null;
  // ---- Superpowers (Prestige tab): Energy currency + per-power unlock/level/enable state ----
  // Optional so existing save literals / tests stay valid; migrateMeta + loadMeta always seed them.
  energy?: number;                          // earned +1 per boss kill (+ moat/crystal bonuses)
  superUnlocked?: Record<string, boolean>;  // which superpowers are unlocked (cost = purchase order)
  superLevels?: Record<string, number>;     // key `${spId}.${trackId}` → completed level
  superEnabled?: Record<string, boolean>;   // per-power pause toggle (defaults true on unlock)
  // selected cosmetic id per category (tower / hud / background). Unlock + passive buffs are derived
  // live from src/sim/cosmetics.ts; only the chosen id is persisted here.
  cosmetics?: Record<string, string>;
  cosmeticsOwned?: Record<string, boolean>; // gem-bought cosmetics (tier-gated ones derive from progress)
  gameSpeed?: number; // player-chosen battle speed (0.5/1 free; higher tiers unlocked by the Game Speed lab)
  inRunTutDone?: boolean; // the "run upgrades are temporary" in-run tutorial has been shown once
  speedTutDone?: boolean; // the "battle speed → Game Speed lab" tutorial has been shown once
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
  strMult: number; // HP multiplier (per-type base × wave HP curve × tier multiplier)
  dmgMult: number; // damage multiplier (per-type base × wave DMG curve × tier multiplier)
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
  lastHurt?: 'dmg' | 'reflect' | 'crystal'; // source of the most recent HP loss; read at death for kill attribution
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
  // ---- Plasma Cannon: a homing boss-strike, distinct from bullets. ----
  kind?: 'plasma';     // present only on plasma orbs; bullets leave it undefined
  targetId?: number;   // boss this plasma homes onto; fizzles if that boss dies
  dist0?: number;      // launch→target distance at fire time (renderer's arc progress basis)
}
// Transient per-kill UI events the renderer consumes (gold/coin drops).
export interface FxEvent {
  seq: number;
  x: number;
  y: number;
  gold?: number;
  coin?: number;
  // Per-wave info message (rendered as a transient on-screen note, gated by a Display toggle).
  note?: 'waveskip' | 'interest' | 'hpskip' | 'dmgskip';
  noteVal?: number; // the number that goes with the note (wave number, interest gold, or skip count)
}
// A transient superpower render event (shatter burst at x,y with a payout currency tag for floats).
export interface SuperFxEvent { seq: number; x: number; y: number; kind: 'shatter' | 'gem' | 'energy'; }
export interface Wave {
  n: number;
  clock: number;
  spawnTimer: number; // counts down to the next top-up spawn (continuous spawning)
  bossSpawned: boolean; // a boss wave force-spawns its single boss once, tracked here
  maxWave: number;
}
export interface Econ {
  gold: number;
  kills: number;
  goldEarned: number;
  bonusCoins: number;
  hitsTaken: number; // count of landed hits on the hero (instrumentation; also used by the dev dashboard)
  killsByDamage: number; // enemies whose killing blow was the hero's hit/projectile damage
  killsByReflect: number; // enemies whose killing blow was reflect/thorns damage
  dmgTaken: number; // total damage the hero has actually taken this run (post defense/armor)
  dmgDealt: number; // total hit damage the hero has dealt to enemies this run
  reflectDealt: number; // total reflect/thorns damage dealt back to attackers this run
  wavesSkipped: number; // waves auto-skipped by the Wave Skip card this run
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
  plasmaDone?: number[];    // boss ids already struck by Plasma Cannon (one shot per boss, ever)
  demonReq?: boolean;       // Dark Wiz (Demon Mode): player tapped to activate; consumed next tick
  demonUsed?: boolean;      // Dark Wiz fires only once per run
  hpSkip?: number;          // enemy HEALTH levels skipped so far this run (Skip Enemy Health utility)
  dmgSkip?: number;         // enemy ATTACK levels skipped so far this run (Skip Enemy Attack utility)
  // ---- Superpowers (per-run timers, reset each run) ----
  superCd?: Record<string, number>;     // seconds until each power may fire again
  superActive?: Record<string, number>; // seconds the power's window is currently live
  goldenMult?: number;                   // transient ×gold/coins from Golden Lightning this tick (1 = none)
}
// A Crystal Circle crystal: orbits the tower; on enemy contact it instakills + shatters. `ang` is its
// current orbit angle (advances each tick); position is derived from ang + the live orbit radius.
export interface Crystal { ang: number; alive: boolean; }
// A shard flung when a surviving crystal explodes; flies straight, kills on contact, dies in the fog.
export interface CrystalFrag { x: number; y: number; vx: number; vy: number; }
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
  // ---- Crystal Circle entities (per-run; serialized so offline replay is identical) ----
  crystals?: Crystal[];        // orbiting crystals (present only while the ring is up)
  crystalFrags?: CrystalFrag[]; // shards in flight after a shatter
  superFx?: SuperFxEvent[];     // transient superpower events the renderer consumes (shatter bursts)
  superFxSeq?: number;
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
// ---- Superpowers registry (Prestige tab) ----
// A superpower is a "group"; its tracks are individually Energy-leveled "skills". Each track's
// per-level effect value comes from its `curve` via evalCurve (the shared balance evaluator).
export interface SuperTrack {
  id: string;
  label: string;
  max: number;
  curve: Curve;               // level → effect value (e.g. cooldown seconds, ×mult, count, metres)
  fmt: (v: number) => string; // formats a computed value for the HUD
  costBase?: number;          // Energy cost of level 1 (default 200)
  costPer?: number;           // added Energy per subsequent level (default 300)
}
export interface SuperpowerDef {
  id: string;
  name: string;
  cat: 'offense' | 'defense' | 'utility';
  icon: string;
  blurb: string;
  tracks: SuperTrack[];
}
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
  unit?: 'mult' | 'meters' | 'pct' | 'gold' | 'tierpct' | 'interestcap';
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
  // ---- per-wave info messages (transient on-screen notes) ----
  msgWaveSkip: boolean;       // "Wave N skipped"
  msgInterest: boolean;       // "+X interest"
  msgEnemySkip: boolean;      // "Enemy HP/Attack level skipped"
}
// Spoils accrued while a survived run was simulated offline — shown in the offline-reward modal.
// The modal shows the currency gains (gold + coins) as hexagon chips; kills/waves are progress, kept
// here for any non-currency use but not surfaced as "spoils". gems/vials are optional: nothing earns
// them mid-run today, but the modal renders any currency that comes through > 0.
export interface OfflineReward {
  gold: number;
  coins: number;
  kills: number;
  waves: number;
  gems?: number;
  vials?: number;
}
export interface HudHandlers {
  settings?: Settings;
  onSaveSettings?: () => void;
  onSaveMeta?: () => void; // persist meta after the HUD mutates it directly (e.g. tutorial flags)
  onActivateSkill?: (id: string) => void; // player taps an in-run active-skill button (e.g. Dark Wiz)
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
  onApplyLabBoost?: (mult: number, durationSec: number) => boolean; // buy a timed global lab-speed boost
  onBuyLabSlot?: () => boolean;
  onBuySuperpower?: (id: string) => boolean;          // unlock a superpower with Energy
  onBuySuperTrack?: (spId: string, trackId: string) => boolean; // level a superpower track with Energy
  onToggleSuperpower?: (id: string) => boolean;       // pause/resume an unlocked superpower
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
  // Returned-while-paused prompt: ask if the pause was intentional. onCollect fast-forwards the
  // missed time at `speed`; onKeepPaused (optional) just dismisses.
  showPausePrompt(info: { awaySec: number; speed: number }, onCollect: () => void, onKeepPaused?: () => void): void;
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
