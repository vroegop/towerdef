/* dev/dashboard.ts — THROWAWAY dev balance dashboard. Not part of the game build (only index.html
   ships). Imports the REAL registries + sim and lets you graph every upgrade/card/lab curve, slide
   levels, rebalance any curve/cost number IN MEMORY, run the sim to death, and export the model as
   JSON. Nothing in src/ imports this; deleting dev/ changes nothing. */
import type { Curve, LabDef, UpgradeDef, CardDef } from '../src/types';
import { UPGRADES, CARDS, CARD_ORDER, MAX_STARS, TAB_DEFS, UNLOCK_COST_OVERRIDE, skillUnlockCost, STARTER_SKILLS } from '../src/sim/skills';
import { LABS } from '../src/sim/labs';
import { TYPES } from '../src/sim/registries';
import { WAVE, waveStr, waveSpeed, waveCount } from '../src/sim/waves';
import { drawCurve } from './chart';
import { RunStepper, enemyTableAtWave, tierCoinMult, type Scenario, type RunResult } from './runner';

// ---------- tiny DOM helpers ----------
type Props = Record<string, unknown>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, kids: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'class') n.className = String(v);
    else if (k === 'text') n.textContent = String(v);
    else if (k === 'html') n.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v as EventListener);
    else if (v != null) n.setAttribute(k, String(v));
  }
  for (const c of kids) n.append(c);
  return n;
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// ---------- selected levels (the build the sim runs) ----------
const sel = {
  up: {} as Record<string, number>,
  card: {} as Record<string, number>,
  lab: {} as Record<string, number>,
  tier: 1,
};
for (const u of UPGRADES) sel.up[u.id] = 0;
for (const id of CARD_ORDER) sel.card[id] = 0;
for (const L of LABS) sel.lab[L.id] = 0;

// ---------- baseline snapshot for "Reset balance" ----------
function snapshotModel(): string {
  return JSON.stringify(exportModel());
}
function exportModel(): unknown {
  const upgrades: Record<string, unknown> = {};
  for (const u of UPGRADES) {
    upgrades[u.id] = {
      curve: { ...u.curve },
      max: u.max,
      gold: { base: u.gold.base, grow: u.gold.grow },
      coin: { base: u.coin.base, grow: u.coin.grow },
      unlock: STARTER_SKILLS.includes(u.id) ? 0 : skillUnlockCost(u.id),
    };
  }
  const cards: Record<string, unknown> = {};
  for (const id of Object.keys(CARDS)) cards[id] = { curve: { ...CARDS[id].curve } };
  const labs: Record<string, unknown> = {};
  for (const L of LABS) {
    labs[L.id] = {
      per: L.per,
      max: L.max,
      coin: { base: L.coin.base, grow: L.coin.grow },
      time: { base: L.time.base, grow: L.time.grow },
    };
  }
  const types: Record<string, unknown> = {};
  for (const id of Object.keys(TYPES)) {
    const d = TYPES[id];
    types[id] = { hp: d.hp, dmg: d.dmg, speed: d.speed, range: d.range, r: d.r, mass: d.mass, splits: d.splits ?? 0 };
  }
  const wave = {
    strPerWave: WAVE.strPerWave, expBase: WAVE.expBase, speedPerWave: WAVE.speedPerWave,
    baseCount: WAVE.baseCount, perWave: WAVE.perWave, maxCount: WAVE.maxCount,
    coinStep: WAVE.coinStep, interval: WAVE.interval, spawnWindow: WAVE.spawnWindow, screenCap: WAVE.screenCap,
  };
  return { upgrades, cards, labs, enemies: { types, wave } };
}
interface EnemyModel {
  types: Record<string, Partial<Record<string, number>>>;
  wave: Record<string, number>;
}
function applyModel(m: ReturnType<typeof exportModel>): void {
  const model = m as { upgrades: Record<string, { curve: Curve; max: number; gold: { base: number; grow: number }; coin: { base: number; grow: number }; unlock?: number }>; cards: Record<string, { curve: Curve }>; labs: Record<string, { per: number; max: number; coin: { base: number; grow: number }; time: { base: number; grow: number } }>; enemies?: EnemyModel };
  for (const u of UPGRADES) {
    const d = model.upgrades[u.id];
    if (!d) continue;
    Object.assign(u.curve, d.curve);
    u.max = d.max;
    u.gold.base = d.gold.base;
    u.gold.grow = d.gold.grow;
    u.coin.base = d.coin.base;
    u.coin.grow = d.coin.grow;
    if (typeof d.unlock === 'number' && !STARTER_SKILLS.includes(u.id)) UNLOCK_COST_OVERRIDE[u.id] = d.unlock;
  }
  for (const id of Object.keys(CARDS)) if (model.cards[id]) Object.assign(CARDS[id].curve, model.cards[id].curve);
  for (const L of LABS) {
    const d = model.labs[L.id];
    if (!d) continue;
    L.per = d.per;
    L.max = d.max;
    L.coin.base = d.coin.base;
    L.coin.grow = d.coin.grow;
    L.time.base = d.time.base;
    L.time.grow = d.time.grow;
  }
  const en = model.enemies;
  if (en) {
    for (const id of Object.keys(TYPES)) if (en.types[id]) Object.assign(TYPES[id], en.types[id]);
    Object.assign(WAVE, en.wave);
  }
}
const BASELINE = snapshotModel();

// ---------- numeric field descriptor ----------
interface Field {
  label: string;
  get: () => number;
  set: (v: number) => void;
  step?: number;
}
function curveFields(c: Curve): Field[] {
  if (c.kind === 'geom') {
    return [
      { label: 'mul', get: () => c.mul, set: (v) => (c.mul = v), step: 0.001 },
      { label: 'ratio', get: () => c.ratio, set: (v) => (c.ratio = v), step: 0.01 },
    ];
  }
  if (c.kind === 'exp') {
    return [
      { label: 'base', get: () => c.base, set: (v) => (c.base = v), step: 0.1 },
      { label: 'ratio', get: () => c.ratio, set: (v) => (c.ratio = v), step: 0.001 },
      {
        label: 'cap',
        get: () => (c.cap == null ? NaN : c.cap),
        set: (v) => {
          if (Number.isNaN(v)) delete c.cap;
          else c.cap = v;
        },
        step: 1,
      },
    ];
  }
  if (c.kind === 'table') return []; // exact sampled curve — graphed, not scalar-editable here
  const f: Field[] = [
    { label: 'base', get: () => c.base, set: (v) => (c.base = v), step: 0.0001 },
    { label: 'per', get: () => c.per, set: (v) => (c.per = v), step: 0.0001 },
  ];
  // cap is optional; expose it so it can be edited (NaN/empty clears it)
  f.push({
    label: 'cap',
    get: () => (c.cap == null ? NaN : c.cap),
    set: (v) => {
      if (Number.isNaN(v)) delete c.cap;
      else c.cap = v;
    },
    step: 0.0001,
  });
  return f;
}

// ---------- one item card (upgrade / card / lab / enemy / wave) ----------
// Generic: a card has a level/preview slider, 0-2 graphs, a live readout, and editable balance
// fields. The level source is pluggable (getLevel/setLevel) so upgrades bind it to `sel` while
// enemy/wave cards use a private "preview wave".
interface GraphSpec {
  at: (lvl: number) => number;
  label: string;
  color: string;
}
interface ItemCfg {
  title: string;
  sub: string;
  maxLevel: () => number;
  getLevel: () => number;
  setLevel: (n: number) => void;
  levelText: (lvl: number, max: number) => string;
  graphs: GraphSpec[];
  readout: (lvl: number) => string;
  fields: Field[];
}
function buildItem(cfg: ItemCfg): HTMLElement {
  const canvases = cfg.graphs.map(() => el('canvas', { class: 'chart' }));
  const readoutEl = el('div', { class: 'readout' }); // own full-width line so long values don't overflow
  const levelLabel = el('span', { class: 'lvlnum' });
  const slider = el('input', { type: 'range', min: 0, max: cfg.maxLevel(), step: 1, value: cfg.getLevel() }) as HTMLInputElement;
  const fieldInputs: { inp: HTMLInputElement; get: () => number }[] = [];

  // The level source (getLevel/setLevel) is the truth; redraw() syncs the slider FROM it (so presets
  // reflect here) and re-syncs the balance field boxes from live data (so Reset/import show through).
  function redraw(): void {
    const max = cfg.maxLevel();
    slider.max = String(max);
    let lvl = cfg.getLevel() || 0;
    if (lvl > max) lvl = max;
    cfg.setLevel(lvl);
    slider.value = String(lvl);
    levelLabel.textContent = cfg.levelText(lvl, max);
    readoutEl.textContent = cfg.readout(lvl);
    cfg.graphs.forEach((g, i) => drawCurve(canvases[i], g.at, max, { label: g.label, color: g.color, markLevel: lvl }));
    for (const { inp, get } of fieldInputs) if (document.activeElement !== inp) inp.value = fmtField(get());
  }
  slider.addEventListener('input', () => {
    cfg.setLevel(+slider.value);
    redraw();
  });

  // editable balance fields — a committed edit redraws ALL cards (cross-effects: e.g. a tier's
  // strength feeds enemy-type gold/HP graphs) and flags the model dirty.
  const fieldRow = el('div', { class: 'fields' });
  for (const f of cfg.fields) {
    const inp = el('input', { type: 'number', step: f.step ?? 1, value: fmtField(f.get()) }) as HTMLInputElement;
    fieldInputs.push({ inp, get: f.get });
    inp.addEventListener('change', () => {
      f.set(inp.value === '' ? NaN : parseFloat(inp.value));
      redrawAll();
      markDirty();
    });
    fieldRow.append(el('label', { class: 'field' }, [el('span', { text: f.label }), inp]));
  }

  const kids: (Node | string)[] = [el('div', { class: 'ihead' }, [el('b', { text: cfg.title }), el('span', { class: 'isub', text: cfg.sub })])];
  if (canvases.length) kids.push(el('div', { class: 'charts' }, canvases));
  kids.push(el('div', { class: 'sliderrow' }, [slider, levelLabel]), readoutEl, fieldRow);
  const card = el('div', { class: 'item' }, kids);
  requestAnimationFrame(redraw); // first paint once in the DOM (canvas needs clientWidth)
  REDRAWS.push(redraw);
  return card;
}
const REDRAWS: (() => void)[] = [];
const redrawAll = (): void => {
  for (const fn of REDRAWS) fn();
};
const fmtField = (v: number): string => (Number.isNaN(v) ? '' : String(+v.toPrecision(8)));

// ---------- dirty flag (highlights Reset once balance is edited) ----------
function markDirty(): void {
  $('#reset').classList.add('hot');
}

// ---------- build sections ----------
function upgradeItem(u: UpgradeDef): HTMLElement {
  return buildItem({
    title: u.label,
    sub: u.name || u.id,
    maxLevel: () => u.max,
    getLevel: () => sel.up[u.id] || 0,
    setLevel: (n) => (sel.up[u.id] = n),
    levelText: (l, m) => 'lvl ' + l + ' / ' + m,
    graphs: [
      { at: (l) => u.value(l), label: 'value: ' + u.fmt(u.value(0)) + ' → ' + u.fmt(u.value(u.max)), color: '#5fd0ff' },
      { at: (l) => u.gold.cost(l), label: 'gold cost/level', color: '#ffae4a' },
    ],
    readout: (l) =>
      u.fmt(u.value(l)) + '  ·  ' + abbrCost(u.gold.cost(l)) + ' g  ·  ' + abbrCost(u.coin.cost(l)) + ' coin' +
      '  ·  unlock ' + (skillUnlockCost(u.id) === 0 ? 'free' : abbrCost(skillUnlockCost(u.id)) + ' coin'),
    // table-cost upgrades carry sampled points, not base·grow — skip the meaningless cost knobs for them
    fields: [
      ...curveFields(u.curve),
      { label: 'max', get: () => u.max, set: (v) => (u.max = Math.max(1, Math.round(v))), step: 1 },
      // unlock cost (coins, one-time, level-independent); writes the override so it round-trips in export
      ...(STARTER_SKILLS.includes(u.id)
        ? []
        : [{ label: 'unlock', get: () => skillUnlockCost(u.id), set: (v: number) => (UNLOCK_COST_OVERRIDE[u.id] = Math.max(0, Math.round(v))), step: 1 }]),
      ...(u.gold.points
        ? []
        : [
            { label: 'gold.base', get: () => u.gold.base, set: (v: number) => (u.gold.base = v) },
            { label: 'gold.grow', get: () => u.gold.grow, set: (v: number) => (u.gold.grow = v), step: 0.001 },
            { label: 'coin.base', get: () => u.coin.base, set: (v: number) => (u.coin.base = v) },
            { label: 'coin.grow', get: () => u.coin.grow, set: (v: number) => (u.coin.grow = v), step: 0.0001 },
          ]),
    ],
  });
}
const abbrCost = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return '' + Math.round(v);
};
function cardItem(c: CardDef): HTMLElement {
  return buildItem({
    title: c.name + '  [' + c.rarity + ']',
    sub: c.effects.map((e) => e.stat + ' (' + e.kind + ')').join(', '),
    maxLevel: () => MAX_STARS,
    getLevel: () => sel.card[c.id] || 0,
    setLevel: (n) => (sel.card[c.id] = n),
    levelText: (l, m) => 'Lv ' + l + ' / ' + m,
    graphs: [{ at: (s) => c.value(s), label: 'per level → ' + c.fmt(c.value(MAX_STARS)) + ' @' + MAX_STARS, color: '#b98cff' }],
    readout: (s) => (s > 0 ? c.desc(c.value(s)) : '—'),
    fields: curveFields(c.curve),
  });
}
function labItem(L: LabDef): HTMLElement {
  // The two labs scale a sim stat ×(1 + per·lvl) AND raise the matching workshop cap. Cost + time
  // come from shared exact tables (LabCurve.at interpolates them); base/grow are inert metadata now.
  const valAt = (lvl: number): number => 1 + L.per * lvl;
  const fmtT = (s: number): string => (s < 3600 ? (s / 60).toFixed(0) + 'm' : s < 86400 ? (s / 3600).toFixed(1) + 'h' : (s / 86400).toFixed(1) + 'd');
  return buildItem({
    title: L.label,
    sub: L.cat + ' · scale → ' + L.target + ' (+ raises ' + (L.target === 'maxHp' ? 'health' : 'rangedDamage') + ' cap)',
    maxLevel: () => L.max,
    getLevel: () => sel.lab[L.id] || 0,
    setLevel: (n) => (sel.lab[L.id] = n),
    levelText: (l, m) => 'lvl ' + l + ' / ' + m,
    graphs: [
      { at: valAt, label: '×mult vs level → ×' + valAt(L.max).toFixed(2) + ' @' + L.max, color: '#3ddc84' },
      { at: (lvl) => L.coin.at(lvl), label: 'coin cost/level', color: '#ffae4a' },
      { at: (lvl) => L.time.at(lvl), label: 'research time (s)/level', color: '#37d7ff' },
    ],
    readout: (lvl) => '×' + valAt(lvl).toFixed(3) + '  ·  ' + L.coin.at(lvl).toLocaleString() + ' coin  ·  ' + fmtT(L.time.at(lvl)),
    fields: [{ label: 'per', get: () => L.per, set: (v) => (L.per = v), step: 0.001 }, { label: 'max', get: () => L.max, set: (v) => (L.max = Math.max(1, Math.round(v))), step: 1 }],
  });
}

// ---------- ENEMY + WAVE balance (TYPES / TIERS / WAVE — the live sim reads these) ----------
const WAVE_PREVIEW_MAX = 500; // the enemy/wave preview sliders sweep wave 0..this
const ihp = (base: number, mult: number): number => Math.max(1, Math.round(base * mult)); // mirrors enemies.ts
const sw = (w: number): number => waveStr(Math.max(1, w));
// shared shell for cards whose x-axis is "wave" and that hold a private preview-wave level
function wavePreviewItem(title: string, sub: string, graphs: GraphSpec[], readout: (w: number) => string, fields: Field[]): HTMLElement {
  let pw = 100;
  return buildItem({ title, sub, maxLevel: () => WAVE_PREVIEW_MAX, getLevel: () => pw, setLevel: (n) => (pw = n), levelText: (w) => 'preview wave ' + w, graphs, readout, fields });
}
function enemyTypeItem(typeId: string): HTMLElement {
  const d = TYPES[typeId];
  const hpAt = (w: number): number => ihp(d.hp, sw(w));
  const dmgAt = (w: number): number => ihp(d.dmg, sw(w));
  const spdAt = (w: number): number => Math.round(d.speed * waveSpeed(Math.max(1, w)));
  return wavePreviewItem(
    typeId,
    d.shape + ' · ' + d.behavior,
    [
      { at: hpAt, label: 'HP vs wave', color: '#ff5d6c' },
      { at: dmgAt, label: 'dmg vs wave', color: '#ffae4a' },
    ],
    (w) => '@w' + w + ': hp ' + hpAt(w).toLocaleString() + ' · dmg ' + dmgAt(w).toLocaleString() + ' · spd ' + spdAt(w) + ' · mass ' + d.mass,
    [
      { label: 'hp', get: () => d.hp, set: (v) => (d.hp = v), step: 0.1 },
      { label: 'dmg', get: () => d.dmg, set: (v) => (d.dmg = v), step: 0.1 },
      { label: 'speed', get: () => d.speed, set: (v) => (d.speed = v), step: 1 },
      { label: 'range', get: () => d.range, set: (v) => (d.range = v), step: 1 },
      { label: 'radius', get: () => d.r, set: (v) => (d.r = v), step: 1 },
      { label: 'mass', get: () => d.mass, set: (v) => (d.mass = v), step: 0.5 },
      { label: 'splits', get: () => d.splits ?? 0, set: (v) => (d.splits = v), step: 1 },
    ],
  );
}
function waveSections(): HTMLElement {
  const items = [
    wavePreviewItem('Enemy strength /wave', 'waveStr(n) — HP & dmg multiplier; watch the exponent',
      [{ at: (w) => sw(w), label: 'strength × vs wave', color: '#ff5d6c' }],
      (w) => '@w' + w + ': ×' + sw(w).toFixed(2),
      [{ label: 'strPerWave', get: () => WAVE.strPerWave, set: (v) => (WAVE.strPerWave = v), step: 0.005 }, { label: 'expBase', get: () => WAVE.expBase, set: (v) => (WAVE.expBase = v), step: 0.001 }]),
    wavePreviewItem('Enemy speed /wave', 'waveSpeed(n) — speed multiplier',
      [{ at: (w) => waveSpeed(Math.max(1, w)), label: 'speed × vs wave', color: '#37d7ff' }],
      (w) => '@w' + w + ': ×' + waveSpeed(Math.max(1, w)).toFixed(2),
      [{ label: 'speedPerWave', get: () => WAVE.speedPerWave, set: (v) => (WAVE.speedPerWave = v), step: 0.005 }]),
    wavePreviewItem('Wave size', 'waveCount(n) — enemies spawned per wave (capped)',
      [{ at: (w) => waveCount(Math.max(1, w)), label: 'count vs wave', color: '#5fd0ff' }],
      (w) => '@w' + w + ': ' + waveCount(Math.max(1, w)) + ' enemies',
      [{ label: 'baseCount', get: () => WAVE.baseCount, set: (v) => (WAVE.baseCount = v), step: 1 }, { label: 'perWave', get: () => WAVE.perWave, set: (v) => (WAVE.perWave = v), step: 1 }, { label: 'maxCount', get: () => WAVE.maxCount, set: (v) => (WAVE.maxCount = v), step: 5 }]),
    wavePreviewItem('Coins per kill', 'base coins/kill = ceil(wave / coinStep)',
      [{ at: (w) => Math.ceil(Math.max(1, w) / Math.max(1, WAVE.coinStep)), label: 'coins/kill vs wave', color: '#ff2e4e' }],
      (w) => '@w' + w + ': ' + Math.ceil(Math.max(1, w) / Math.max(1, WAVE.coinStep)) + ' coins/kill',
      [{ label: 'coinStep', get: () => WAVE.coinStep, set: (v) => (WAVE.coinStep = Math.max(1, Math.round(v))), step: 1 }]),
    wavePreviewItem('Wave timing & cap', 'seconds between waves, spawn window, concurrent enemy cap',
      [],
      () => 'interval ' + WAVE.interval + 's · spawn ' + WAVE.spawnWindow + 's · cap ' + WAVE.screenCap,
      [{ label: 'interval', get: () => WAVE.interval, set: (v) => (WAVE.interval = v), step: 1 }, { label: 'spawnWindow', get: () => WAVE.spawnWindow, set: (v) => (WAVE.spawnWindow = v), step: 1 }, { label: 'screenCap', get: () => WAVE.screenCap, set: (v) => (WAVE.screenCap = Math.max(1, Math.round(v))), step: 10 }]),
  ];
  return section('Wave scaling (enemy difficulty & economy)', items);
}

function section(title: string, items: HTMLElement[]): HTMLElement {
  return el('section', {}, [el('h2', { text: title }), el('div', { class: 'grid' }, items)]);
}

// ---------- scenario + results ----------
function currentScenario(): Scenario {
  const seeds = $('#seeds')
    .textContent!.split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  return {
    perm: { ...sel.up },
    cards: { ...sel.card },
    labs: { ...sel.lab },
    tier: sel.tier,
    seeds: seeds.length ? seeds : [1],
    maxWave: parseInt(($('#maxwave') as HTMLInputElement).value, 10) || 10000, // the ONLY cap
  };
}

// ---- live (chunked) recalculation -------------------------------------------------------------
// The sim is heavy at high waves, so a single run to wave 10k can take a while. We time-slice it:
// run ~one frame's worth of ticks, paint the climbing wave count, yield to the browser, repeat.
// `runId` supersedes an older run when Recalculate is clicked again; `stopFlag` ends early.
let runId = 0;
let stopFlag = false;
function setRunningUI(on: boolean): void {
  ($('#recalc') as HTMLButtonElement).disabled = on;
  ($('#stop') as HTMLButtonElement).disabled = !on;
}
const statHtml = (k: string, v: string): string => '<div class="stat"><span>' + k + '</span><b>' + v + '</b></div>';
function renderProgress(seedIdx: number, seedCount: number, seed: number, wave: number, best: number): void {
  $('#results').innerHTML =
    '<div class="resgrid">' +
    statHtml('Calculating…', 'wave ' + wave.toLocaleString()) +
    statHtml('Seed', seedIdx + 1 + ' / ' + seedCount + ' (#' + seed + ')') +
    statHtml('Best so far', best.toLocaleString()) +
    '</div><div class="perseed">running the sim… click <b>Stop</b> to end early</div>';
}
function renderResults(runs: RunResult[], sc: Scenario, ms: number, aborted: boolean): void {
  if (!runs.length) {
    $('#results').innerHTML = 'No runs.';
    return;
  }
  const n = runs.length;
  const mean = (k: keyof RunResult): number => Math.round(runs.reduce((a, r) => a + (r[k] as number), 0) / n);
  const wave = mean('wave'),
    survived = runs.some((r) => r.survived);
  // wording: a manual Stop leaves the hero alive but is NOT the wave cap; reaching the cap alive is.
  const note = aborted ? ' (stopped early — still alive)' : survived ? ' (reached wave cap alive)' : ' (died)';
  const enemyRows = enemyTableAtWave(wave, sc.tier)
    .map((r) => '<tr><td>' + r.type + '</td><td>' + r.hp.toLocaleString() + '</td><td>' + r.dmg.toLocaleString() + '</td><td>' + r.speed + '</td><td>' + r.mass + '</td></tr>')
    .join('');
  $('#results').innerHTML =
    '<div class="resgrid">' +
    statHtml('Wave reached', wave.toLocaleString() + note) +
    statHtml('Kills', mean('kills').toLocaleString()) +
    statHtml('Hits taken', mean('hits').toLocaleString()) +
    statHtml('Gold earned', mean('gold').toLocaleString()) +
    statHtml('Coins banked', mean('coins').toLocaleString() + ' (×' + tierCoinMult(sc.tier).toFixed(1) + ')') +
    statHtml('Sim time', mean('simSeconds').toLocaleString() + 's') +
    '</div>' +
    '<div class="perseed">per-seed waves: ' + runs.map((r) => r.wave.toLocaleString() + (r.survived ? '*' : '')).join(', ') + (aborted ? '  ·  STOPPED early' : '') + '  ·  ' + ms + 'ms</div>' +
    '<table class="enemies"><thead><tr><th>type</th><th>HP</th><th>dmg</th><th>spd</th><th>mass</th></tr></thead><tbody>' +
    enemyRows +
    '</tbody></table>';
}
async function recalc(): Promise<void> {
  const myId = ++runId; // a newer Recalculate click supersedes this run
  stopFlag = false;
  setRunningUI(true);
  const sc = currentScenario();
  const runs: RunResult[] = [];
  const t0 = performance.now();
  const best = (): number => Math.max(0, ...runs.map((r) => r.wave));
  for (let i = 0; i < sc.seeds.length; i++) {
    const cur = new RunStepper(sc, sc.seeds[i]);
    while (!cur.done) {
      const sliceEnd = performance.now() + 24; // ~one frame of compute, then yield
      while (!cur.done && performance.now() < sliceEnd) cur.advance(250);
      if (runId !== myId) return; // superseded — drop this run silently
      renderProgress(i, sc.seeds.length, sc.seeds[i], cur.wave, Math.max(best(), cur.wave));
      await new Promise<number>((r) => requestAnimationFrame(r));
      if (runId !== myId) return;
      if (stopFlag) {
        runs.push(cur.result());
        setRunningUI(false);
        renderResults(runs, sc, Math.round(performance.now() - t0), true);
        return;
      }
    }
    runs.push(cur.result());
  }
  setRunningUI(false);
  renderResults(runs, sc, Math.round(performance.now() - t0), false);
}

function setAllUpgrades(level: number | 'max'): void {
  // Presets ONLY set the slider levels (and repaint). They do NOT recalculate — only the
  // Recalculate button runs the sim, so you can tweak individual sliders afterward and then run.
  for (const u of UPGRADES) sel.up[u.id] = level === 'max' ? u.max : Math.min(u.max, level);
  redrawAll();
}

// ---------- boot ----------
function boot(): void {
  const root = $('#app');
  const groups: Record<string, UpgradeDef[]> = {};
  for (const t of TAB_DEFS) groups[t.id] = [];
  for (const u of UPGRADES) (groups[u.tab] ||= []).push(u);

  root.append(
    section('Attack upgrades', groups.attack.map(upgradeItem)),
    section('Defense upgrades', groups.defense.map(upgradeItem)),
    section('Economic upgrades', groups.economic.map(upgradeItem)),
    section('Cards', CARD_ORDER.filter((id) => CARDS[id]).map((id) => cardItem(CARDS[id]))),
    section('Labs', LABS.map(labItem)),
    waveSections(),
    section('Enemy types', Object.keys(TYPES).map(enemyTypeItem)),
  );

  // toolbar wiring
  $('#recalc').addEventListener('click', () => void recalc());
  $('#stop').addEventListener('click', () => (stopFlag = true));
  $('#p1').addEventListener('click', () => setAllUpgrades(1));
  $('#p10').addEventListener('click', () => setAllUpgrades(10));
  $('#p100').addEventListener('click', () => setAllUpgrades(100));
  $('#p1000').addEventListener('click', () => setAllUpgrades(1000));
  $('#pmax').addEventListener('click', () => setAllUpgrades('max'));
  $('#reset').addEventListener('click', () => {
    applyModel(JSON.parse(BASELINE));
    $('#reset').classList.remove('hot');
    for (const fn of REDRAWS) fn();
  });
  const tierSel = $('#tier') as HTMLSelectElement;
  tierSel.addEventListener('change', () => (sel.tier = parseInt(tierSel.value, 10) || 1));
  $('#export').addEventListener('click', () => {
    const json = JSON.stringify(exportModel(), null, 2);
    const ta = $('#exportbox') as HTMLTextAreaElement;
    ta.value = json;
    $('#exportwrap').classList.remove('hide');
    ta.select();
  });
  $('#exportclose').addEventListener('click', () => $('#exportwrap').classList.add('hide'));
  $('#exportcopy').addEventListener('click', () => navigator.clipboard.writeText(($('#exportbox') as HTMLTextAreaElement).value));
  // No auto-run on load — only the Recalculate button runs the sim (the results panel shows a prompt).
}
boot();
