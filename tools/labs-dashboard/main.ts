/* tools/labs-dashboard/main.ts — Labs balancing dashboard.
 *
 * A standalone design tool for tuning the research-lab economy. It reads the CURRENT labs straight
 * out of the game (../../src/sim/labs.ts) so every cost / duration shown is the real shipped value,
 * adds a set of SUGGESTED new labs, and lets you edit every field. For each lab it shows the coin
 * cost to start, the per-level durations, the TOTAL time to max the whole lab, and the total coins to
 * max it. Hit Export (or Copy) to get a JSON blob you can hand back to have the new numbers coded into
 * src/sim/labs.ts. Nothing here writes to the game — it is a pure spreadsheet over the lab tables.
 *
 * Cost / time curves are modelled two ways per lab:
 *   • "live"  — use the exact sampled table from the game (default for shipped labs; read-only).
 *   • "curve" — a 3-knob power ramp: value(L) = L1 + (Lmax − L1)·t^exp, t = (L−1)/(max−1).
 *               L1 = the start (level-1) value, Lmax = the value at the final level, exp = steepness
 *               (1 = linear, >1 = back-loaded, <1 = front-loaded). Untick "use game curve" to edit it. */

import { LABS } from '../../src/sim/labs';

// ── tiny DOM + format helpers ───────────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const el = (tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html) n.innerHTML = html;
  return n;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = (v: number): number => Math.round(v);

// compact coin formatting (30 → "30", 53530 → "53.5k", 4310000 → "4.31M")
function fmtCoins(n: number): string {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a < 1000) return String(round(n));
  if (a < 1e6) return (n / 1e3).toFixed(a < 1e4 ? 2 : 1) + 'k';
  if (a < 1e9) return (n / 1e6).toFixed(2) + 'M';
  if (a < 1e12) return (n / 1e9).toFixed(2) + 'B';
  return (n / 1e12).toFixed(2) + 'T';
}
// human duration, two biggest units (60 → "1m", 4341120 → "50d 5h")
function fmtDur(sec: number): string {
  sec = Math.max(0, round(sec));
  if (sec < 60) return sec + 's';
  const d = Math.floor(sec / 86400),
    h = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  const parts: [number, string][] = [
    [d, 'd'], [h, 'h'], [m, 'm'], [s, 's'],
  ];
  return parts.filter(([v]) => v > 0).slice(0, 2).map(([v, u]) => v + u).join(' ') || '0s';
}

// ── the editable model ───────────────────────────────────────────────────────────────────────────────
interface Curve { live: boolean; l1: number; lmax: number; exp: number }
interface LabModel {
  id: string;
  label: string;
  cat: string; // attack | defense | economic | speed
  kind: string; // scale | flat | special
  target: string;
  unit: string; // mult | meters | pct | gold | tierpct | interestcap
  per: number;
  max: number;
  gateWave: number;
  cost: Curve;
  time: Curve;
  suggested: boolean;
  rationale?: string;
  // live sampled-table accessors (present only for shipped labs); index n = step to reach level n+1.
  liveCost?: (n: number) => number;
  liveTime?: (n: number) => number;
}

const CATS = ['attack', 'defense', 'economic', 'speed'];
const KINDS = ['scale', 'flat', 'special'];
const UNITS = ['mult', 'meters', 'pct', 'gold', 'tierpct', 'interestcap'];

// Fit the power-curve exponent so a generated ramp passes through the sampled table's midpoint — gives
// the 3-knob model a sensible starting steepness when you untick "use game curve".
function fitExp(fn: (n: number) => number, max: number): number {
  if (max <= 2) return 1;
  const l1 = fn(0),
    lmax = fn(max - 1);
  if (lmax === l1) return 1;
  const midL = Math.round(max / 2),
    t = (midL - 1) / (max - 1),
    frac = (fn(midL - 1) - l1) / (lmax - l1);
  if (frac <= 0 || frac >= 1 || t <= 0 || t >= 1) return 2;
  return clamp(Math.log(frac) / Math.log(t), 0.2, 8);
}

// Build editable models for the labs the game actually ships, sampling their real cost/time tables.
function currentModels(): LabModel[] {
  return LABS.map((L): LabModel => {
    const liveCost = (n: number): number => L.coin.at(n);
    const liveTime = (n: number): number => L.time.at(n);
    return {
      id: L.id, label: L.label, cat: L.cat, kind: L.kind, target: L.target,
      unit: L.unit || (L.kind === 'scale' ? 'mult' : 'mult'),
      per: L.per, max: L.max, gateWave: (L.gate && L.gate.wave) || 0,
      cost: { live: true, l1: liveCost(0), lmax: liveCost(L.max - 1), exp: fitExp(liveCost, L.max) },
      time: { live: true, l1: liveTime(0), lmax: liveTime(L.max - 1), exp: fitExp(liveTime, L.max) },
      suggested: false, liveCost, liveTime,
    };
  });
}

// Labs I'd suggest adding. Each targets a sim stat that already exists in computeStats (so it's cheap
// to wire up) and slots into an existing category. Costs/times are authored as 3-knob curves in the
// same magnitude band as the shipped labs. `rationale` explains the pick.
function suggestedModels(): LabModel[] {
  const mk = (
    o: Partial<LabModel> & Pick<LabModel, 'id' | 'label' | 'cat' | 'kind' | 'target' | 'per' | 'max'>,
    cost: [number, number, number], time: [number, number, number], rationale: string,
  ): LabModel => ({
    unit: 'mult', gateWave: 30, suggested: true, rationale,
    cost: { live: false, l1: cost[0], lmax: cost[1], exp: cost[2] },
    time: { live: false, l1: time[0], lmax: time[1], exp: time[2] },
    ...o,
  });
  return [
    mk(
      { id: 'atkSpeedLab', label: 'Attack Speed Lab', cat: 'attack', kind: 'scale', target: 'fireRate', per: 0.02, max: 50 },
      [30, 1_500_000, 2.6], [120, 2_600_000, 2.4],
      'DPS is damage×fire rate, but only the Damage Lab scales it. An Attack Speed lab adds the second ' +
        'multiplicative axis. Capped at 50 (+100%) so it stays behind the 100-level Damage Lab.',
    ),
    mk(
      { id: 'critChanceLab', label: 'Crit Chance Lab', cat: 'attack', kind: 'flat', target: 'critChance', per: 0.005, max: 20, unit: 'pct' },
      [30, 200_000, 2.3], [600, 1_500_000, 2.2],
      'A Crit DAMAGE lab already exists; pairing it with crit chance makes crit a real build. +0.5%/level, ' +
        'capped at +10% so it complements skills/cards rather than replacing them.',
    ),
    mk(
      { id: 'regenLab', label: 'HP Regen Lab', cat: 'defense', kind: 'scale', target: 'regen', per: 0.05, max: 30 },
      [30, 900_000, 2.4], [120, 1_900_000, 2.3],
      'Sustain scaling for long waves; multiplies the Regen skill (+5%/level → ×2.5 at max). Defense ' +
        'currently only has Health / Defense% / Armor — this rounds it out.',
    ),
    mk(
      { id: 'lifestealLab', label: 'Lifesteal Lab', cat: 'defense', kind: 'scale', target: 'lifesteal', per: 0.03, max: 20 },
      [30, 500_000, 2.4], [120, 1_400_000, 2.3],
      'Offence-as-defence: scales the Lifesteal skill so high-damage builds heal themselves. Keeps ' +
        'defence interesting for aggressive players.',
    ),
    mk(
      { id: 'bounceLab', label: 'Bounce Chance Lab', cat: 'attack', kind: 'flat', target: 'bounceChance', per: 0.01, max: 20, unit: 'pct' },
      [30, 300_000, 2.3], [600, 1_600_000, 2.2],
      'Feeds the Lightning/Multishot group: +1% bounce per level (+20% at max), giving that build a ' +
        'long-term progression sink it currently lacks.',
    ),
    mk(
      { id: 'gemFindLab', label: 'Gem Find Lab', cat: 'economic', kind: 'special', target: 'gemMult', per: 0.02, max: 20, unit: 'pct' },
      [50, 2_500_000, 2.8], [600, 3_500_000, 2.6],
      'The only economic lab that touches the gem economy (check-ins / lab-slots / rushes). Would need a ' +
        'small labGemMult() helper mirroring labTierCoinMult. Slow, expensive curve — a long-term goal.',
    ),
  ];
}

// ── compute: per-level cost/time for a lab ────────────────────────────────────────────────────────────
function valueAt(m: LabModel, which: 'cost' | 'time', level: number): number {
  const c = m[which];
  if (c.live) {
    const fn = which === 'cost' ? m.liveCost : m.liveTime;
    if (fn) return round(fn(level - 1)); // table index n = step to reach level n+1
  }
  const max = Math.max(1, m.max);
  const t = max <= 1 ? 0 : (level - 1) / (max - 1);
  return round(c.l1 + (c.lmax - c.l1) * Math.pow(clamp(t, 0, 1), Math.max(0.01, c.exp)));
}
// full per-level arrays + running totals (length = max). costs[i]/times[i] = level i+1.
function expand(m: LabModel): { costs: number[]; times: number[]; cumCost: number[]; cumTime: number[] } {
  const max = Math.max(1, Math.round(m.max));
  const costs: number[] = [], times: number[] = [], cumCost: number[] = [], cumTime: number[] = [];
  let cc = 0, ct = 0;
  for (let L = 1; L <= max; L++) {
    const c = valueAt(m, 'cost', L), t = valueAt(m, 'time', L);
    cc += c; ct += t;
    costs.push(c); times.push(t); cumCost.push(cc); cumTime.push(ct);
  }
  return { costs, times, cumCost, cumTime };
}
// cumulative effect at a given level, phrased for the HUD's unit.
function effectAt(m: LabModel, level: number): string {
  const v = m.per * level;
  switch (m.unit) {
    case 'meters': return '+' + round(v) + ' m';
    case 'pct': return '+' + (v * 100).toFixed(1) + '%';
    case 'gold': return '+' + round(v) + ' gold';
    case 'tierpct': return '+' + (v * 100).toFixed(0) + '% coins';
    case 'interestcap': return 'cap raised';
    default:
      if (m.kind === 'scale') return '×' + (1 + v).toFixed(2);
      return '+' + Number(v.toFixed(3));
  }
}
// which levels to show in the breakdown (all if short, else ~20 sampled milestones incl. 1 and max).
function sampleLevels(max: number): number[] {
  max = Math.max(1, Math.round(max));
  if (max <= 24) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set<number>([1]);
  const step = Math.ceil(max / 20);
  for (let L = step; L < max; L += step) out.add(L);
  out.add(max);
  return [...out].sort((a, b) => a - b);
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────
// Suggestions that have since shipped (their id now appears in the live LABS) are dropped, so a lab
// never shows up under both "Current" and "Suggested".
function initialLabs(): LabModel[] {
  const cur = currentModels();
  const have = new Set(cur.map((m) => m.id));
  return [...cur, ...suggestedModels().filter((m) => !have.has(m.id))];
}
let labs: LabModel[] = initialLabs();

// ── render (inputs built once; derived displays refreshed on every edit) ──────────────────────────────
function makeInput(value: string | number, on: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const inp = el('input', { value: String(value), ...attrs }) as HTMLInputElement;
  inp.oninput = () => on(inp.value);
  return inp;
}
function makeSelect(value: string, opts: string[], on: (v: string) => void): HTMLSelectElement {
  const sel = el('select') as HTMLSelectElement;
  for (const o of opts) sel.appendChild(el('option', { value: o, ...(o === value ? { selected: '1' } : {}) }, o));
  sel.value = value;
  sel.onchange = () => on(sel.value);
  return sel;
}
function field(label: string, control: HTMLElement): HTMLElement {
  const w = el('div');
  w.appendChild(el('label', {}, label));
  w.appendChild(control);
  return w;
}
const num = (v: string): number => (v.trim() === '' ? 0 : parseFloat(v) || 0);

function curveBlock(m: LabModel, which: 'cost' | 'time'): { block: HTMLElement; sync: () => void } {
  const c = m[which];
  const isCost = which === 'cost';
  const hasLive = isCost ? !!m.liveCost : !!m.liveTime;
  const block = el('div', { class: 'block' });

  const h = el('h3', {}, isCost ? '🪙 Coin cost curve' : '⏱ Duration curve');
  const l1 = makeInput(round(c.l1), (v) => { c.l1 = num(v); refresh(); }, { type: 'number', step: 'any' });
  const lmax = makeInput(round(c.lmax), (v) => { c.lmax = num(v); refresh(); }, { type: 'number', step: 'any' });
  const exp = makeInput(c.exp.toFixed(2), (v) => { c.exp = num(v); refresh(); }, { type: 'number', step: '0.05' });

  if (hasLive) {
    const tog = el('span', { class: 'livetoggle' });
    const chk = el('input', { type: 'checkbox', id: m.id + '-' + which + '-live', ...(c.live ? { checked: '1' } : {}) }) as HTMLInputElement;
    chk.onchange = () => { c.live = chk.checked; refresh(); };
    const lab = el('label', { for: chk.id }, 'use game curve');
    tog.append(chk, lab);
    h.appendChild(tog);
  }
  block.appendChild(h);

  const grid = el('div', { class: 'fieldgrid g3' });
  grid.append(
    field(isCost ? 'Level 1 (start)' : 'Level 1 time (s)', l1),
    field(isCost ? 'Final level' : 'Final level (s)', lmax),
    field('Curve exp', exp),
  );
  block.appendChild(grid);

  // keep the (disabled) knobs showing the live anchors while "use game curve" is on
  const sync = (): void => {
    const fn = isCost ? m.liveCost : m.liveTime;
    const dis = c.live && hasLive;
    [l1, lmax, exp].forEach((i) => (i.disabled = dis));
    if (dis && fn) {
      c.l1 = fn(0); c.lmax = fn(Math.max(0, Math.round(m.max) - 1)); c.exp = fitExp(fn, Math.round(m.max));
      l1.value = String(round(c.l1)); lmax.value = String(round(c.lmax)); exp.value = c.exp.toFixed(2);
    }
  };
  return { block, sync };
}

function labCard(m: LabModel): HTMLElement {
  const card = el('div', { class: 'card' + (m.suggested ? ' suggested' : '') });

  // ── header ──
  const hd = el('div', { class: 'hd' });
  const dot = el('span', { class: 'catdot' });
  dot.style.background = `var(--${m.cat}, var(--dim))`;
  const titleInp = makeInput(m.label, (v) => { m.label = v; }, { style: 'width:220px;font-weight:650' });
  hd.append(dot, titleInp);
  if (m.suggested) hd.appendChild(el('span', { class: 'badge' }, 'suggested'));
  const right = el('div', { class: 'right' });
  const del = el('button', { class: 'ghost tiny' }, '✕ remove');
  del.onclick = () => { labs = labs.filter((x) => x !== m); render(); };
  right.appendChild(del);
  hd.appendChild(right);
  card.appendChild(hd);

  // ── body: identity + the two curve blocks ──
  const body = el('div', { class: 'body' });

  const left = el('div', { class: 'fieldgrid' });
  const idRow = el('div', { class: 'fieldgrid g2' });
  idRow.append(
    field('id', makeInput(m.id, (v) => { m.id = v.trim(); })),
    field('target stat', makeInput(m.target, (v) => { m.target = v.trim(); })),
  );
  const catRow = el('div', { class: 'fieldgrid g3' });
  catRow.append(
    field('category', makeSelect(m.cat, CATS, (v) => { m.cat = v; render(); })),
    field('kind', makeSelect(m.kind, KINDS, (v) => { m.kind = v; refresh(); })),
    field('unit', makeSelect(m.unit, UNITS, (v) => { m.unit = v; refresh(); })),
  );
  const valRow = el('div', { class: 'fieldgrid g3' });
  valRow.append(
    field('per-level (per)', makeInput(m.per, (v) => { m.per = num(v); refresh(); }, { type: 'number', step: 'any' })),
    field('max level', makeInput(m.max, (v) => { m.max = Math.max(1, round(num(v))); refresh(); }, { type: 'number', step: '1' })),
    field('unlock @ wave', makeInput(m.gateWave, (v) => { m.gateWave = round(num(v)); }, { type: 'number', step: '1' })),
  );
  left.append(idRow, catRow, valRow);

  const right2 = el('div', { class: 'fieldgrid' });
  const costB = curveBlock(m, 'cost');
  const timeB = curveBlock(m, 'time');
  right2.append(costB.block, timeB.block);

  body.append(left, right2);
  card.appendChild(body);

  // ── computed chips (refreshed) ──
  const chips = el('div', { class: 'chips' });
  card.appendChild(chips);

  // ── rationale (suggested labs) ──
  if (m.rationale) card.appendChild(el('div', { class: 'rationale' }, '<b>Why:</b> ' + m.rationale));

  // ── per-level breakdown (refreshed) ──
  const details = el('details');
  details.appendChild(el('summary', {}, 'Per-level breakdown'));
  const tableWrap = el('div', { class: 'scroll' });
  details.appendChild(tableWrap);
  card.appendChild(details);

  const refreshThis = (): void => {
    costB.sync(); timeB.sync();
    const { costs, times, cumCost, cumTime } = expand(m);
    const total = costs.length;
    const startCost = costs[0] || 0, startTime = times[0] || 0;
    const totCoins = cumCost[total - 1] || 0, totTime = cumTime[total - 1] || 0;
    const avgTime = total ? totTime / total : 0;
    chips.innerHTML =
      `<span class="chip"><span class="k">levels</span> <b>${total}</b></span>` +
      `<span class="chip good"><span class="k">start cost</span> <b>${fmtCoins(startCost)}</b> coins</span>` +
      `<span class="chip"><span class="k">total coins to max</span> <b>${fmtCoins(totCoins)}</b></span>` +
      `<span class="chip"><span class="k">first level</span> <b>${fmtDur(startTime)}</b></span>` +
      `<span class="chip warn"><span class="k">total time to max</span> <b>${fmtDur(totTime)}</b></span>` +
      `<span class="chip"><span class="k">avg / level</span> <b>${fmtDur(avgTime)}</b></span>` +
      `<span class="chip"><span class="k">effect @ max</span> <b>${effectAt(m, total)}</b></span>`;

    const rows = sampleLevels(m.max).map((L) => {
      const i = L - 1;
      return `<tr><td>${L}</td><td>${effectAt(m, L)}</td>` +
        `<td>${fmtCoins(costs[i])}</td><td>${fmtCoins(cumCost[i])}</td>` +
        `<td>${fmtDur(times[i])}</td><td>${fmtDur(cumTime[i])}</td></tr>`;
    }).join('');
    tableWrap.innerHTML =
      `<table><thead><tr><th>Lvl</th><th>Effect</th><th>Coin cost</th><th>Σ coins</th>` +
      `<th>Time</th><th>Σ time</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  (card as HTMLElement & { _refresh?: () => void })._refresh = refreshThis;
  return card;
}

// summary table: per-category rollup of total coins + total time to max every lab in that category.
function summaryEl(): HTMLElement {
  const box = el('div', { class: 'summary' });
  box.appendChild(el('h2', { style: 'font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 8px' }, 'Totals by category'));
  const byCat: Record<string, { n: number; coins: number; time: number; sug: number }> = {};
  for (const m of labs) {
    const { cumCost, cumTime } = expand(m);
    const c = (byCat[m.cat] = byCat[m.cat] || { n: 0, coins: 0, time: 0, sug: 0 });
    c.n++; if (m.suggested) c.sug++;
    c.coins += cumCost[cumCost.length - 1] || 0;
    c.time += cumTime[cumTime.length - 1] || 0;
  }
  let gC = 0, gT = 0, gN = 0;
  const rows = CATS.filter((cat) => byCat[cat]).map((cat) => {
    const c = byCat[cat]; gC += c.coins; gT += c.time; gN += c.n;
    return `<tr><td style="color:var(--${cat})">${cat}</td><td>${c.n}${c.sug ? ` (${c.sug} new)` : ''}</td>` +
      `<td>${fmtCoins(c.coins)}</td><td>${fmtDur(c.time)}</td></tr>`;
  }).join('');
  box.appendChild(el('div', {}, `<table><thead><tr><th>Category</th><th>Labs</th><th>Σ coins to max all</th><th>Σ time to max all</th></tr></thead>` +
    `<tbody>${rows}<tr style="font-weight:700"><td>ALL</td><td>${gN}</td><td>${fmtCoins(gC)}</td><td>${fmtDur(gT)}</td></tr></tbody></table>`));
  return box;
}

function render(): void {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(summaryEl());

  const sections: [string, string, boolean][] = [
    ['Current labs', 'Read live from the game — “use game curve” shows the exact shipped numbers. Untick it to rebalance.', false],
    ['Suggested new labs', 'Proposals targeting stats that already exist in the sim. Edit freely; “Why” explains each pick.', true],
  ];
  for (const [title, sub, suggested] of sections) {
    const list = labs.filter((m) => m.suggested === suggested);
    if (!list.length && suggested === false) continue;
    const sec = el('section');
    sec.appendChild(el('h2', {}, title));
    sec.appendChild(el('p', { class: 'secsub' }, sub));
    for (const m of list) sec.appendChild(labCard(m));
    app.appendChild(sec);
  }
  refresh();
  $('#counts').textContent = `${labs.length} labs · ${labs.filter((m) => m.suggested).length} suggested`;
}
// recompute only derived displays (chips, breakdowns, summary) without rebuilding inputs.
function refresh(): void {
  document.querySelectorAll('.card').forEach((c) => (c as HTMLElement & { _refresh?: () => void })._refresh?.());
  const app = $('#app');
  const old = app.querySelector('.summary');
  if (old) old.replaceWith(summaryEl());
}

// ── export / import ───────────────────────────────────────────────────────────────────────────────────
function toExport(): unknown {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Arena labs dashboard export. perLevel arrays are 1-indexed by position (index 0 = level 1). ' +
      'Hand this to Claude to have the values coded into src/sim/labs.ts.',
    labs: labs.map((m) => {
      const { costs, times, cumCost, cumTime } = expand(m);
      return {
        id: m.id, label: m.label, cat: m.cat, kind: m.kind, target: m.target, unit: m.unit,
        per: m.per, max: m.max, gateWave: m.gateWave, suggested: m.suggested,
        ...(m.rationale ? { rationale: m.rationale } : {}),
        cost: {
          model: m.cost.live ? 'live' : 'curve',
          l1: round(m.cost.l1), lmax: round(m.cost.lmax), exp: Number(m.cost.exp.toFixed(3)),
          startCost: costs[0] || 0, totalToMax: cumCost[cumCost.length - 1] || 0, perLevel: costs,
        },
        time: {
          model: m.time.live ? 'live' : 'curve',
          l1: round(m.time.l1), lmax: round(m.time.lmax), exp: Number(m.time.exp.toFixed(3)),
          startSeconds: times[0] || 0, totalSecondsToMax: cumTime[cumTime.length - 1] || 0, perLevelSeconds: times,
        },
      };
    }),
  };
}
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
function doExport(): void {
  const json = JSON.stringify(toExport(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'arena-labs.json' }) as HTMLAnchorElement;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported arena-labs.json');
}
async function doCopy(): Promise<void> {
  const json = JSON.stringify(toExport(), null, 2);
  try { await navigator.clipboard.writeText(json); toast('Copied JSON to clipboard'); }
  catch { openImport(json); toast('Clipboard blocked — copy from the box'); }
}
function fromImport(data: { labs?: unknown[] }): void {
  if (!data || !Array.isArray(data.labs)) { toast('No "labs" array found'); return; }
  const live = new Map(labs.map((m) => [m.id, m])); // keep live accessors where ids still match
  labs = data.labs.map((raw): LabModel => {
    const d = raw as Record<string, unknown>;
    const c = (d.cost || {}) as Record<string, unknown>;
    const t = (d.time || {}) as Record<string, unknown>;
    const prev = live.get(String(d.id));
    return {
      id: String(d.id ?? 'lab'), label: String(d.label ?? d.id ?? 'Lab'),
      cat: String(d.cat ?? 'attack'), kind: String(d.kind ?? 'scale'),
      target: String(d.target ?? ''), unit: String(d.unit ?? 'mult'),
      per: Number(d.per ?? 0), max: Math.max(1, Math.round(Number(d.max ?? 1))),
      gateWave: Math.round(Number(d.gateWave ?? 0)), suggested: !!d.suggested,
      rationale: d.rationale ? String(d.rationale) : undefined,
      cost: { live: c.model === 'live', l1: Number(c.l1 ?? 0), lmax: Number(c.lmax ?? 0), exp: Number(c.exp ?? 2) },
      time: { live: t.model === 'live', l1: Number(t.l1 ?? 0), lmax: Number(t.lmax ?? 0), exp: Number(t.exp ?? 2) },
      liveCost: prev?.liveCost, liveTime: prev?.liveTime,
    };
  });
  render();
  toast('Imported ' + labs.length + ' labs');
}
function openImport(prefill = ''): void {
  ($('#importText') as HTMLTextAreaElement).value = prefill;
  $('#importOverlay').classList.add('show');
}

// ── wire up the toolbar ───────────────────────────────────────────────────────────────────────────────
$('#export').onclick = doExport;
$('#copy').onclick = doCopy;
$('#import').onclick = () => openImport('');
$('#add').onclick = () => {
  labs.push({
    id: 'newLab' + (labs.length + 1), label: 'New Lab', cat: 'attack', kind: 'scale', target: '',
    unit: 'mult', per: 0.02, max: 20, gateWave: 30, suggested: true, rationale: 'Custom lab.',
    cost: { live: false, l1: 30, lmax: 500_000, exp: 2.4 }, time: { live: false, l1: 120, lmax: 1_400_000, exp: 2.3 },
  });
  render();
};
$('#reset').onclick = () => { labs = initialLabs(); render(); toast('Reset to game defaults'); };
$('#importCancel').onclick = () => $('#importOverlay').classList.remove('show');
$('#importLoad').onclick = () => {
  try { fromImport(JSON.parse(($('#importText') as HTMLTextAreaElement).value)); $('#importOverlay').classList.remove('show'); }
  catch (e) { toast('Invalid JSON: ' + (e as Error).message); }
};

render();
