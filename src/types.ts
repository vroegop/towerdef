/* src/types.ts — shared type definitions for the whole game.
   These describe the serializable sim state (the save file), the persistent meta, and the
   data registries. The sim mutates these objects in place; the renderer + HUD read them. */

export interface Rng {
  next(): number;
  state: number;
}

export type Shape = 'circle' | 'square' | 'triangle' | 'hexagon' | 'diamond' | 'pentagon';
export type Behavior = 'stick' | 'bounce';

export interface EnemyTypeDef {
  shape: Shape;
  behavior: Behavior;
  hp: number;
  dmg: number;
  speed: number;
  range: number;
  r: number;
  splits?: number;
  vamp?: number;
  aura?: number;
  auraR?: number;
}

export interface TierDef {
  color: string;
  stat: number;
  reward: number;
}

// ---- persistent meta (the between-runs save, separate from a run's State) ----
export interface CardInstance {
  id: string;
  stars: number;
}
export interface Research {
  id: string;
  cost: number;
  endsAt: number;
}
export interface Meta {
  coins: number;
  perm: Record<string, number>;
  hasPlayed: boolean;
  bestWave: number;
  claimedMilestones: Record<string, boolean>;
  tier: number;
  tierBest: Record<string, number>;
  gems: number;
  cards: CardInstance[];
  cardBuys: number;
  totalWaves: number;
  labs: Record<string, number>;
  research: Research[];
  labSlots: number;
  vials: number;
  lastCheckIn: number;
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
  tier: string;
  shape: Shape;
  behavior: Behavior;
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
  vamp: number;
  aura: number;
  auraR: number;
  shielded: number;
  bornWave: number;
  veteran: boolean;
  agedWaves: number;
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
// Transient per-kill UI events the renderer consumes (gold/coin drops, dodge text).
export interface FxEvent {
  seq: number;
  x: number;
  y: number;
  gold?: number;
  coin?: number;
  dodge?: number;
}
export interface Wave {
  n: number;
  clock: number;
  toSpawn: number;
  releaseTimer: number;
  releaseGap: number;
  count: number;
  maxWave: number;
}
export interface Econ {
  gold: number;
  xp: number;
  level: number;
  kills: number;
  goldEarned: number;
  bonusCoins: number;
}
export interface Run {
  levels: Record<string, number>;
  rapidT: number;
  rapidCheckCd: number;
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
}
export interface UpgradeDef {
  id: string;
  tab: string;
  icon: string;
  label: string;
  max: number;
  gated?: boolean;
  value: (b: number) => number;
  fmt: (b: number) => string;
  gold: UpgradeCurve;
  coin: UpgradeCurve;
}
export interface TabDef {
  id: string;
  icon: string;
  gated?: boolean;
}
export interface CardEffect {
  stat: string;
  kind: 'flat' | 'mult';
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
  effects: CardEffect[];
  value: (stars: number) => number;
  fmt: (v: number) => string;
  desc: (v: number) => string;
}
export interface LabCurve {
  base: number;
  grow: number;
  at: (n: number) => number;
}
export interface LabDef {
  id: string;
  cat: string;
  kind: 'cap' | 'scale' | 'special';
  target: string;
  label: string;
  per: number;
  max: number;
  coin: LabCurve;
  time: LabCurve;
  gate: { wave: number };
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
}
export interface HudHandlers {
  settings?: Settings;
  onSaveSettings?: () => void;
  onBuyRun?: (stat: string) => void;
  onBuyPerm?: (id: string) => boolean;
  onClaimMilestone?: (wave: number) => number;
  onSetTier?: (t: number) => boolean;
  onBuyCard?: () => CardDrawResult | null;
  onStartResearch?: (id: string) => boolean;
  onCancelResearch?: (id: string) => boolean;
  onRushResearch?: (id: string) => boolean;
  onBuyLabSlot?: () => boolean;
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
  showOverview(meta: Meta, earn: EarnSummary): void;
  hideOverview(): void;
  showHint(html: string): void;
  hideHint(): void;
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
