/* tools/superweapons-dashboard/main.ts — the Super Weapons design & balance dashboard UI.
 *
 * One screen to (a) see every super weapon's example art, (b) tune every balance number — value
 * curves, max levels, the Energy cost to unlock and the Energy cost per upgrade — and (c) plan a
 * build with the "suggest upgrades" planner. The current in-game powers (Moat / Golden Lightning /
 * Crystal Circle) load live from the game registry; the rest are design proposals you can rebalance,
 * rename, re-art, add to, or delete. Edits persist to localStorage and export back into
 * src/sim/superpowers.ts shape. Pure UI + maths — no game engine, no DOM dependency beyond this file.
 *
 * Run it with:  npm run super:dashboard */

import { ART_IDS, weaponArt } from './art';
import {
  abbr, defaultCatalog, fmtUnit, trackCostAt, trackTotalCost, trackValue, UNIT_LABEL,
  unlockCostAt, weaponFirstLevelCost, weaponMaxCost, DEFAULT_COST_BASE, DEFAULT_COST_PER,
  type Cat, type Catalog, type DraftTrack, type DraftWeapon, type Unit,
} from './weapons';
import { planUpgrades, valueEfficiency, type Strategy } from './planner';

const STORE_KEY = 'arena.superweapons.catalog.v1';
const CATS: Cat[] = ['offense', 'defense', 'utility', 'economy'];
const UNITS: Unit[] = ['sec', 'meters', 'mult', 'pct', 'count'];

// ── tiny DOM helpers ────────────────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const el = (tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html) n.innerHTML = html;
  return n;
};
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── state ──────────────────────────────────────────────────────────────────────────────────────
let cat: Catalog = loadCatalog();
let selId: string = cat.weapons[0]?.id || '';
let planBudget = 250_000;
let planStrategy: Strategy = 'breadth';
const planInclude = new Set<string>(cat.weapons.map((w) => w.id));

function loadCatalog(): Catalog {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Catalog;
  } catch {
    /* fall through to defaults */
  }
  return defaultCatalog();
}
function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cat));
  } catch {
    /* ignore quota / private-mode failures */
  }
  $('#dirty').textContent = 'edited · saved locally';
}
const selected = (): DraftWeapon | undefined => cat.weapons.find((w) => w.id === selId);
const weaponIndex = (id: string): number => cat.weapons.findIndex((w) => w.id === id);
const uid = (base: string): string => {
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'weapon';
  let n = id;
  let i = 2;
  while (cat.weapons.some((w) => w.id === n)) n = id + i++;
  return n;
};

// ── sidebar: the weapon catalog ──────────────────────────────────────────────────────────────────
function renderSide(): void {
  const side = $('#side');
  side.innerHTML = '';
  const pad = el('div', { class: 'pad' });

  pad.appendChild(el('h2', {}, 'Collection'));
  pad.appendChild(el('div', { class: 'hint' },
    `${cat.weapons.length} weapons · ${cat.weapons.filter((w) => !w.proposed).length} in the game, ` +
    `${cat.weapons.filter((w) => w.proposed).length} proposed`));

  const list = el('div', { class: 'wlist', style: 'margin-top:10px' });
  cat.weapons.forEach((w, i) => {
    const item = el('div', { class: 'witem' + (w.id === selId ? ' sel' : '') });
    const thumb = el('div', { class: 'thumb cat-' + w.cat });
    thumb.innerHTML = weaponArt(w.art, 30);
    item.appendChild(thumb);
    const mid = el('div');
    mid.innerHTML =
      `<div class="nm">${esc(w.name)}` +
      (w.proposed ? '<span class="badge-new">NEW</span>' : '<span class="badge-live">LIVE</span>') + '</div>' +
      `<div class="meta"><span class="cat-${w.cat}" style="text-transform:capitalize">${w.cat}</span> · ` +
      `unlock ${abbr(unlockCostAt(cat, i))}</div>`;
    item.appendChild(mid);
    const ctrls = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
    const up = el('button', { class: 'ghost tiny', title: 'move up', 'data-up': w.id }, '▲');
    const dn = el('button', { class: 'ghost tiny', title: 'move down', 'data-dn': w.id }, '▼');
    ctrls.append(up, dn);
    item.appendChild(ctrls);
    item.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('[data-up],[data-dn]')) return;
      selId = w.id;
      rerender();
    });
    list.appendChild(item);
  });
  pad.appendChild(list);

  const btns = el('div', { class: 'btns', style: 'margin-top:14px' });
  const add = el('button', {}, '+ New weapon');
  add.onclick = addWeapon;
  const dup = el('button', { class: 'ghost' }, 'Duplicate');
  dup.onclick = duplicateSelected;
  btns.append(add, dup);
  pad.appendChild(btns);

  const btns2 = el('div', { class: 'btns', style: 'margin-top:8px' });
  const reset = el('button', { class: 'ghost' }, '↺ Reset to game');
  reset.onclick = () => {
    if (confirm('Discard all edits and reload the live game balances + default proposals?')) {
      cat = defaultCatalog();
      selId = cat.weapons[0]?.id || '';
      planInclude.clear();
      cat.weapons.forEach((w) => planInclude.add(w.id));
      save();
      rerender();
    }
  };
  btns2.append(reset);
  pad.appendChild(btns2);

  side.appendChild(pad);

  side.querySelectorAll<HTMLElement>('[data-up]').forEach((b) =>
    (b.onclick = () => moveWeapon(b.dataset.up!, -1)));
  side.querySelectorAll<HTMLElement>('[data-dn]').forEach((b) =>
    (b.onclick = () => moveWeapon(b.dataset.dn!, 1)));
}

function moveWeapon(id: string, dir: number): void {
  const i = weaponIndex(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cat.weapons.length) return;
  [cat.weapons[i], cat.weapons[j]] = [cat.weapons[j], cat.weapons[i]];
  save();
  rerender();
}
function addWeapon(): void {
  const id = uid('newWeapon');
  cat.weapons.push({
    id, name: 'New Weapon', cat: 'offense', art: 'meteor', proposed: true,
    blurb: 'Describe what this super weapon does in the arena.',
    tracks: [
      { id: 'cooldown', label: 'Cooldown', unit: 'sec', base: 180, per: -4, max: 24, costBase: DEFAULT_COST_BASE, costPer: DEFAULT_COST_PER },
      { id: 'power', label: 'Power ×', unit: 'mult', base: 2, per: 0.5, max: 20, costBase: DEFAULT_COST_BASE, costPer: DEFAULT_COST_PER },
    ],
  });
  planInclude.add(id);
  selId = id;
  save();
  rerender();
}
function duplicateSelected(): void {
  const w = selected();
  if (!w) return;
  const copy: DraftWeapon = structuredClone(w);
  copy.id = uid(w.id + 'copy');
  copy.name = w.name + ' (copy)';
  copy.proposed = true;
  cat.weapons.splice(weaponIndex(w.id) + 1, 0, copy);
  planInclude.add(copy.id);
  selId = copy.id;
  save();
  rerender();
}

// ── main pane ─────────────────────────────────────────────────────────────────────────────────────
function renderMain(): void {
  const main = $('#main');
  main.innerHTML = '';
  const w = selected();
  if (!w) {
    main.appendChild(el('div', { class: 'hint' }, 'No weapon selected.'));
    return;
  }
  main.appendChild(buildEditor(w));
  main.appendChild(buildEconomy());
  main.appendChild(buildPlanner());
  main.appendChild(buildExport());
  patchComputed();
}

// the live-value / cost cells we patch in place on every keystroke (no rebuild → focus is kept)
function patchComputed(): void {
  const w = selected();
  if (!w) return;
  const idx = weaponIndex(w.id);
  // per-track effect + energy cells
  for (const t of w.tracks) {
    const eff = document.querySelector<HTMLElement>(`[data-eff="${t.id}"]`);
    if (eff) eff.innerHTML = trackEffectCell(t);
    const en = document.querySelector<HTMLElement>(`[data-en="${t.id}"]`);
    if (en) en.innerHTML = trackEnergyCell(t);
  }
  const sum = document.getElementById('wsummary');
  if (sum) sum.innerHTML = weaponSummaryHtml(w, idx);
  const ul = document.getElementById('unlockline');
  if (ul) ul.innerHTML = unlockLineHtml(w, idx);
  const econ = document.getElementById('econ-totals');
  if (econ) econ.innerHTML = econTotalsHtml();
  const pr = document.getElementById('plan-results');
  if (pr) pr.innerHTML = planResultsHtml();
}

// ── editor ─────────────────────────────────────────────────────────────────────────────────────
function buildEditor(w: DraftWeapon): HTMLElement {
  const wrap = el('div', { class: 'editor' });

  // preview column
  const prev = el('div', { class: 'preview' });
  const arena = el('div', { class: 'arena' });
  arena.innerHTML =
    '<div class="ring"></div><div class="tower"></div>' +
    `<div class="art cat-${w.cat}" style="color:var(--${w.cat})">${weaponArt(w.art, 110)}</div>`;
  prev.appendChild(arena);
  prev.appendChild(el('div', { class: 'cap' }, 'example art · the tower sits at centre, range ring dashed'));
  const sw = el('div', { class: 'swatches' });
  ART_IDS.forEach((id) => {
    const b = el('button', { class: 'sw' + (id === w.art ? ' sel' : ''), title: id, 'data-art': id });
    b.innerHTML = weaponArt(id, 22);
    b.onclick = () => { w.art = id; save(); rerender(); };
    sw.appendChild(b);
  });
  prev.appendChild(sw);
  wrap.appendChild(prev);

  // fields column
  const f = el('div', { class: 'fields' });
  const head = el('div', { class: 'row2' });

  const nameWrap = el('div');
  nameWrap.appendChild(el('label', {}, 'Name'));
  const name = el('input', { type: 'text', value: w.name, 'data-k': 'name' }) as HTMLInputElement;
  name.oninput = () => { w.name = name.value; save(); patchSidebarName(w); };
  nameWrap.appendChild(name);
  head.appendChild(nameWrap);

  const catWrap = el('div');
  catWrap.appendChild(el('label', {}, 'Category'));
  const csel = el('select') as HTMLSelectElement;
  CATS.forEach((c) => csel.appendChild(el('option', { value: c, ...(c === w.cat ? { selected: 'selected' } : {}) }, c)));
  csel.onchange = () => { w.cat = csel.value as Cat; save(); rerender(); };
  catWrap.appendChild(csel);
  head.appendChild(catWrap);
  f.appendChild(head);

  f.appendChild(el('label', {}, 'Blurb (what the player reads)'));
  const blurb = el('textarea', { 'data-k': 'blurb' }, '') as HTMLTextAreaElement;
  blurb.value = w.blurb;
  blurb.oninput = () => { w.blurb = blurb.value; save(); };
  f.appendChild(blurb);

  const unlockLine = el('div', { id: 'unlockline', class: 'pill-row', style: 'margin-top:10px' });
  f.appendChild(unlockLine);

  // tracks table
  f.appendChild(el('h2', { style: 'margin-top:14px' }, 'Upgrade tracks'));
  const tbl = el('table', { class: 'tracks' });
  tbl.innerHTML =
    '<thead><tr>' +
    ['Track', 'Unit', 'Base', '/Lvl', 'Max', 'Cost¹', '+Cost', 'Effect (L0→max)', 'Energy', ''].map((h) => `<th>${h}</th>`).join('') +
    '</tr></thead>';
  const tb = el('tbody');
  w.tracks.forEach((t) => tb.appendChild(buildTrackRow(w, t)));
  tbl.appendChild(tb);
  f.appendChild(tbl);

  const addTrack = el('button', { class: 'ghost tiny', style: 'margin-top:8px' }, '+ add track');
  addTrack.onclick = () => {
    const base = 'track';
    let id = base;
    let i = 2;
    while (w.tracks.some((t) => t.id === id)) id = base + i++;
    w.tracks.push({ id, label: 'New Track', unit: 'mult', base: 1, per: 0.2, max: 20, costBase: DEFAULT_COST_BASE, costPer: DEFAULT_COST_PER });
    save();
    rerender();
  };
  f.appendChild(addTrack);

  f.appendChild(el('div', { id: 'wsummary', class: 'summary' }));

  // delete weapon
  const del = el('button', { class: 'danger tiny', style: 'margin-top:14px' },
    (w.proposed ? 'Delete weapon' : 'Remove from collection'));
  del.onclick = () => {
    if (confirm(`Remove "${w.name}" from the dashboard collection?`)) {
      cat.weapons = cat.weapons.filter((x) => x.id !== w.id);
      planInclude.delete(w.id);
      selId = cat.weapons[0]?.id || '';
      save();
      rerender();
    }
  };
  f.appendChild(del);

  wrap.appendChild(f);
  return wrap;
}

function buildTrackRow(w: DraftWeapon, t: DraftTrack): HTMLElement {
  const tr = el('tr', { 'data-track': t.id });
  // label
  const lblTd = el('td');
  const lbl = el('input', { type: 'text', class: 'lbl', value: t.label, 'data-k': `${t.id}:label` }) as HTMLInputElement;
  lbl.oninput = () => { t.label = lbl.value; save(); patchComputed(); };
  lblTd.appendChild(lbl);
  tr.appendChild(lblTd);
  // unit
  const us = el('td');
  const usel = el('select', { title: 'unit' }) as HTMLSelectElement;
  UNITS.forEach((u) => usel.appendChild(el('option', { value: u, title: UNIT_LABEL[u], ...(u === t.unit ? { selected: 'selected' } : {}) }, u)));
  usel.onchange = () => { t.unit = usel.value as Unit; save(); rerender(); };
  us.appendChild(usel);
  tr.appendChild(us);
  // numeric fields — each takes a setter so we never have to assign through a `keyof` index
  const numCell = (val: number, name: string, set: (v: number) => void, step = 'any'): HTMLElement => {
    const td = el('td');
    const inp = el('input', { type: 'number', step, class: 'num', value: String(val), 'data-k': `${t.id}:${name}` }) as HTMLInputElement;
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) {
        set(v);
        save();
        patchComputed();
      }
    };
    td.appendChild(inp);
    return td;
  };
  tr.appendChild(numCell(t.base, 'base', (v) => (t.base = v)));
  tr.appendChild(numCell(t.per, 'per', (v) => (t.per = v)));
  tr.appendChild(numCell(t.max, 'max', (v) => (t.max = v), '1'));
  tr.appendChild(numCell(t.costBase, 'costBase', (v) => (t.costBase = v), '1'));
  tr.appendChild(numCell(t.costPer, 'costPer', (v) => (t.costPer = v), '1'));
  // computed cells
  tr.appendChild(el('td', { 'data-eff': t.id, class: 'effcol' }, trackEffectCell(t)));
  tr.appendChild(el('td', { 'data-en': t.id }, trackEnergyCell(t)));
  // remove
  const rm = el('td');
  const x = el('button', { class: 'ghost tiny', title: 'remove track' }, '✕');
  x.onclick = () => {
    w.tracks = w.tracks.filter((y) => y.id !== t.id);
    save();
    rerender();
  };
  rm.appendChild(x);
  tr.appendChild(rm);
  return tr;
}

function sparkline(t: DraftTrack): string {
  const n = Math.max(1, Math.round(t.max));
  let min = Infinity;
  let max = -Infinity;
  const vals: number[] = [];
  for (let i = 0; i <= n; i++) {
    const v = trackValue(t, i);
    vals.push(v);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const W = 58;
  const H = 16;
  const span = max - min || 1;
  const pts = vals
    .map((v, i) => `${((i / n) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 2) - 1).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="#5b8cff" stroke-width="1.4"/></svg>`;
}
function trackEffectCell(t: DraftTrack): string {
  const v0 = fmtUnit(t.unit, trackValue(t, 0));
  const vmax = fmtUnit(t.unit, trackValue(t, Math.round(t.max)));
  return `<span class="preview-val">${v0} → ${vmax}</span>${sparkline(t)}`;
}
function trackEnergyCell(t: DraftTrack): string {
  const c1 = trackCostAt(t, 0);
  const cmax = trackCostAt(t, Math.max(0, Math.round(t.max) - 1));
  return `<span class="cost-val">${abbr(c1)} → ${abbr(cmax)}</span>` +
    `<div class="hint">Σ ${abbr(trackTotalCost(t))}</div>`;
}
function unlockLineHtml(w: DraftWeapon, idx: number): string {
  return `<span class="pill">Unlocks as power <b>#${idx + 1}</b> to buy</span>` +
    `<span class="pill">Unlock cost <b class="e">${abbr(unlockCostAt(cat, idx))}</b> Energy</span>` +
    `<span class="pill" style="opacity:.7">order set by ▲▼ in the list</span>`;
}
function weaponSummaryHtml(w: DraftWeapon, idx: number): string {
  return (
    `<span><b>${w.tracks.length}</b> tracks</span>` +
    `<span>one level each: <b class="e">${abbr(weaponFirstLevelCost(w))}</b></span>` +
    `<span>all tracks → max: <b class="e">${abbr(w.tracks.reduce((s, t) => s + trackTotalCost(t), 0))}</b></span>` +
    `<span>unlock + fully max: <b class="e">${abbr(weaponMaxCost(cat, w, idx))}</b> Energy</span>`
  );
}
function patchSidebarName(w: DraftWeapon): void {
  const items = document.querySelectorAll<HTMLElement>('.witem.sel .nm');
  if (items[0]) {
    items[0].innerHTML =
      esc(w.name) + (w.proposed ? '<span class="badge-new">NEW</span>' : '<span class="badge-live">LIVE</span>');
  }
}

// ── Energy economy: the unlock ladder + a totals table ──────────────────────────────────────────
function buildEconomy(): HTMLElement {
  const sec = el('div');
  sec.appendChild(sectionTitle('Energy economy'));
  const grid = el('div', { class: 'grid2' });

  // ladder editor
  const lp = el('div', { class: 'panel' });
  lp.appendChild(el('h2', {}, 'Unlock cost ladder (by purchase order)'));
  lp.appendChild(el('div', { class: 'hint' },
    'Unlock cost depends on how many powers you already own, not which one — exactly like the game. ' +
    `If there are more weapons than rungs, extras cost the last rung.`));
  const li = el('div', { id: 'ladder-inputs', class: 'row3', style: 'margin-top:8px' });
  cat.unlockLadder.forEach((rung, i) => {
    const wrap = el('div');
    wrap.appendChild(el('label', {}, `#${i + 1} unlock`));
    const inp = el('input', { type: 'number', step: '1', value: String(rung), 'data-k': `ladder:${i}` }) as HTMLInputElement;
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) {
        cat.unlockLadder[i] = v;
        save();
        patchComputed();
        // unlock cost shown in the sidebar list won't auto-patch; refresh it lazily on blur
      }
    };
    inp.onchange = renderSide;
    wrap.appendChild(inp);
    li.appendChild(wrap);
  });
  lp.appendChild(li);
  const ladderBtns = el('div', { class: 'btns', style: 'margin-top:8px' });
  const addRung = el('button', { class: 'ghost tiny' }, '+ rung');
  addRung.onclick = () => {
    const last = cat.unlockLadder[cat.unlockLadder.length - 1] || 1000;
    cat.unlockLadder.push(Math.round(last * 2.5));
    save();
    rerender();
  };
  const delRung = el('button', { class: 'ghost tiny' }, '− rung');
  delRung.onclick = () => {
    if (cat.unlockLadder.length > 1) cat.unlockLadder.pop();
    save();
    rerender();
  };
  ladderBtns.append(addRung, delRung);
  lp.appendChild(ladderBtns);
  grid.appendChild(lp);

  // totals table (computed)
  const tp = el('div', { class: 'panel' });
  tp.appendChild(el('h2', {}, 'Cost to unlock &amp; max each weapon'));
  tp.appendChild(el('div', { id: 'econ-totals' }));
  grid.appendChild(tp);

  sec.appendChild(grid);
  return sec;
}
function econTotalsHtml(): string {
  let rows = '<table class="tracks"><thead><tr><th>Weapon</th><th>Unlock</th><th>Max tracks</th><th>Unlock+Max</th></tr></thead><tbody>';
  let grand = 0;
  cat.weapons.forEach((w, i) => {
    const unlock = unlockCostAt(cat, i);
    const maxT = w.tracks.reduce((s, t) => s + trackTotalCost(t), 0);
    const total = unlock + maxT;
    grand += total;
    rows +=
      `<tr><td>${weaponArt(w.art, 16)} ${esc(w.name)}</td>` +
      `<td class="cost-val">${abbr(unlock)}</td><td class="cost-val">${abbr(maxT)}</td>` +
      `<td class="cost-val"><b>${abbr(total)}</b></td></tr>`;
  });
  rows += `<tr><td><b>Everything</b></td><td></td><td></td><td class="cost-val"><b>${abbr(grand)}</b></td></tr>`;
  rows += '</tbody></table>';
  return rows;
}

// ── suggest upgrades: the planner ─────────────────────────────────────────────────────────────────
function buildPlanner(): HTMLElement {
  const sec = el('div');
  sec.appendChild(sectionTitle('Suggest upgrades'));
  const panel = el('div', { class: 'panel' });

  const controls = el('div', { id: 'plan-controls' });
  const top = el('div', { class: 'row3' });
  const bWrap = el('div');
  bWrap.appendChild(el('label', {}, 'Energy budget'));
  const budget = el('input', { type: 'number', step: '1000', value: String(planBudget), 'data-k': 'budget' }) as HTMLInputElement;
  budget.oninput = () => {
    const v = parseFloat(budget.value);
    if (!isNaN(v)) {
      planBudget = v;
      const pr = document.getElementById('plan-results');
      if (pr) pr.innerHTML = planResultsHtml();
    }
  };
  bWrap.appendChild(budget);
  top.appendChild(bWrap);

  const sWrap = el('div');
  sWrap.appendChild(el('label', {}, 'Strategy'));
  const ssel = el('select') as HTMLSelectElement;
  ([['breadth', 'unlock all, then level'], ['cheapest', 'cheapest first (deepen)']] as [Strategy, string][]).forEach(
    ([v, lab]) => ssel.appendChild(el('option', { value: v, ...(v === planStrategy ? { selected: 'selected' } : {}) }, lab)));
  ssel.onchange = () => {
    planStrategy = ssel.value as Strategy;
    const pr = document.getElementById('plan-results');
    if (pr) pr.innerHTML = planResultsHtml();
  };
  sWrap.appendChild(ssel);
  top.appendChild(sWrap);

  const quick = el('div');
  quick.appendChild(el('label', {}, 'Quick budgets'));
  const qb = el('div', { class: 'btns' });
  [['10k', 10_000], ['100k', 100_000], ['1M', 1_000_000], ['10M', 10_000_000]].forEach(([lab, v]) => {
    const b = el('button', { class: 'ghost tiny' }, String(lab));
    b.onclick = () => { planBudget = v as number; rerender(); };
    qb.appendChild(b);
  });
  quick.appendChild(qb);
  top.appendChild(quick);
  controls.appendChild(top);

  controls.appendChild(el('label', { style: 'margin-top:10px' }, 'Include weapons (catalog order = purchase priority)'));
  const chips = el('div', { class: 'btns' });
  cat.weapons.forEach((w) => {
    const on = planInclude.has(w.id);
    const b = el('button', { class: on ? '' : 'ghost', style: 'font-size:12px;padding:4px 9px' });
    b.innerHTML = `${weaponArt(w.art, 14)} ${esc(w.name)}`;
    b.onclick = () => {
      if (planInclude.has(w.id)) planInclude.delete(w.id);
      else planInclude.add(w.id);
      rerender();
    };
    chips.appendChild(b);
  });
  controls.appendChild(chips);
  panel.appendChild(controls);

  panel.appendChild(el('div', { id: 'plan-results', style: 'margin-top:12px' }));
  sec.appendChild(panel);
  return sec;
}
function planResultsHtml(): string {
  const res = planUpgrades(cat, planBudget, planStrategy, planInclude);
  let html =
    `<div class="summary">` +
    `<span>spend <b class="e">${abbr(res.spent)}</b> of ${abbr(planBudget)}</span>` +
    `<span>leftover <b class="e">${abbr(res.remaining)}</b></span>` +
    `<span>unlocks <b>${res.unlocked.length}</b></span>` +
    `<span>purchases <b>${res.steps.length}</b></span>` +
    `</div>`;

  if (!res.steps.length) {
    html += `<div class="hint">Budget too small for even the first unlock (${abbr(unlockCostAt(cat, 0))} Energy).</div>`;
  } else {
    // build summary: per included weapon, levels reached
    html += '<div class="hint" style="margin:6px 0">Resulting build:</div><div class="btns">';
    for (const w of cat.weapons) {
      if (!res.unlocked.includes(w.id)) continue;
      const lv = res.levels[w.id] || {};
      const tot = Object.values(lv).reduce((s, n) => s + n, 0);
      const maxTot = w.tracks.reduce((s, t) => s + t.max, 0);
      html += `<span class="pill">${weaponArt(w.art, 14)} <b>${esc(w.name)}</b> ${tot}/${maxTot} lvls</span>`;
    }
    html += '</div>';

    html += '<div class="plansteps" style="margin-top:10px">';
    const shown = res.steps.slice(0, 60);
    shown.forEach((s, i) => {
      const what = s.kind === 'unlock'
        ? `<span class="unlock">⚡ Unlock ${esc(s.weaponName)}</span>`
        : `${esc(s.weaponName)} · ${esc(s.trackLabel || '')} → L${s.toLevel}`;
      html +=
        `<div class="ps"><span class="ix">${i + 1}</span>` +
        `<span>${weaponArt(s.art, 14)} ${what}</span>` +
        `<span class="cost">${abbr(s.cost)}</span>` +
        `<span class="cum">Σ ${abbr(s.cumulative)}</span></div>`;
    });
    html += '</div>';
    if (res.steps.length > shown.length) {
      html += `<div class="hint">…and ${res.steps.length - shown.length} more purchases.</div>`;
    }
  }

  // efficiency aid
  const eff = valueEfficiency(cat, planInclude).slice(0, 8);
  if (eff.length) {
    const maxg = eff[0].gainPerK || 1;
    html += '<div class="sectit" style="margin-top:16px"><h3 style="font-size:12px;color:var(--dim)">Best value to move first (L0→L1)</h3><span class="ln"></span></div>';
    html += '<div class="plansteps">';
    for (const r of eff) {
      html +=
        `<div class="ps"><span class="ix"></span>` +
        `<span>${esc(r.weaponName)} · ${esc(r.trackLabel)}<div class="effbar" style="margin-top:3px"><i style="width:${((r.gainPerK / maxg) * 100).toFixed(0)}%"></i></div></span>` +
        `<span class="cost">${abbr(r.cost)}</span><span class="cum"></span></div>`;
    }
    html += '</div>';
    html += '<div class="hint">Bar = value gained per Energy (a knob that is cheap to move sits high; ' +
      'an over-priced one sits low). Use it to spot tracks that need re-pricing.</div>';
  }
  return html;
}

// ── export / import ──────────────────────────────────────────────────────────────────────────────
function buildExport(): HTMLElement {
  const sec = el('div');
  sec.appendChild(sectionTitle('Export · Import'));
  const panel = el('div', { class: 'panel' });

  const tabs = el('div', { class: 'btns' });
  const tsBtn = el('button', {}, 'superpowers.ts snippet');
  const jsonBtn = el('button', { class: 'ghost' }, 'JSON (re-importable)');
  tabs.append(tsBtn, jsonBtn);
  panel.appendChild(tabs);

  const out = el('pre', { class: 'export' });
  const copy = el('button', { class: 'ghost tiny', style: 'margin-top:8px' }, 'Copy to clipboard');
  const showTs = (): void => { out.textContent = exportTs(); };
  const showJson = (): void => { out.textContent = JSON.stringify(cat, null, 2); };
  tsBtn.onclick = showTs;
  jsonBtn.onclick = showJson;
  copy.onclick = () => {
    navigator.clipboard?.writeText(out.textContent || '').then(
      () => (copy.textContent = 'Copied!'),
      () => (copy.textContent = 'Copy failed'),
    );
    setTimeout(() => (copy.textContent = 'Copy to clipboard'), 1500);
  };
  panel.appendChild(out);
  panel.appendChild(copy);
  showTs();

  const imp = el('details', { class: 'exp', style: 'margin-top:12px' });
  imp.appendChild(el('summary', {}, 'Import a JSON catalog…'));
  const ta = el('textarea', { placeholder: 'paste a JSON catalog exported above', style: 'margin-top:6px' }) as HTMLTextAreaElement;
  imp.appendChild(ta);
  const load = el('button', { class: 'ghost tiny', style: 'margin-top:6px' }, 'Load catalog');
  load.onclick = () => {
    try {
      const parsed = JSON.parse(ta.value) as Catalog;
      if (!parsed.weapons || !Array.isArray(parsed.weapons)) throw new Error('no weapons array');
      cat = parsed;
      selId = cat.weapons[0]?.id || '';
      planInclude.clear();
      cat.weapons.forEach((w) => planInclude.add(w.id));
      save();
      rerender();
    } catch (e) {
      alert('Could not parse that JSON: ' + (e as Error).message);
    }
  };
  imp.appendChild(load);
  panel.appendChild(imp);

  sec.appendChild(panel);
  return sec;
}

const FMT_SRC: Record<Unit, string> = {
  sec: `(v) => v.toFixed(0) + 's'`,
  meters: `(v) => v.toFixed(0) + 'm'`,
  mult: `(v) => '×' + (Math.round(v * 10) / 10)`,
  pct: `(v) => Math.round(v * 100) + '%'`,
  count: `(v) => '' + Math.round(v)`,
};
// Generate a src/sim/superpowers.ts-shaped snippet: the UNLOCK_COSTS array + a SUPERPOWERS literal.
// Pasting it rebalances the existing powers verbatim and stubs out the proposed ones (their mechanics
// still need wiring in tickSuperpowers, and an `icon` must be registered in src/hud/hud.ts).
function exportTs(): string {
  const lines: string[] = [];
  lines.push('// ── generated by the Super Weapons dashboard (tools/superweapons-dashboard) ──');
  lines.push('export const UNLOCK_COSTS = [' + cat.unlockLadder.join(', ') + '];');
  lines.push('');
  lines.push('export const SUPERPOWERS = [');
  cat.weapons.forEach((w) => {
    const tag = w.proposed ? '  // PROPOSED — wire its mechanic in tickSuperpowers; register `icon` in hud.ts' : '  // currently live';
    lines.push(tag);
    lines.push('  {');
    const oneLine = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    lines.push(`    id: '${w.id}', name: '${oneLine(w.name)}', cat: '${w.cat}', icon: '${w.art}',`);
    lines.push(`    blurb: '${oneLine(w.blurb)}',`);
    lines.push('    tracks: [');
    w.tracks.forEach((t) => {
      const curve = `{ kind: 'linear', base: ${t.base}, per: ${t.per}${t.cap != null ? `, cap: ${t.cap}` : ''} }`;
      const cost = (t.costBase !== DEFAULT_COST_BASE ? `, costBase: ${t.costBase}` : '') +
        (t.costPer !== DEFAULT_COST_PER ? `, costPer: ${t.costPer}` : '');
      lines.push(
        `      { id: '${t.id}', label: '${oneLine(t.label)}', max: ${t.max}, ` +
        `curve: ${curve}, fmt: ${FMT_SRC[t.unit]}${cost} },`,
      );
    });
    lines.push('    ],');
    lines.push('  },');
  });
  lines.push('];');
  return lines.join('\n');
}

// ── shared ──────────────────────────────────────────────────────────────────────────────────────
function sectionTitle(title: string): HTMLElement {
  const d = el('div', { class: 'sectit' });
  d.appendChild(el('h3', {}, title));
  d.appendChild(el('div', { class: 'ln' }));
  return d;
}

function rerender(): void {
  renderSide();
  renderMain();
}

rerender();
