/* tools/sim-dashboard/main.ts — dashboard UI.
 *
 * Lets you pick/edit a player profile and launch progression runs. Each run gets its own Web Worker
 * (so the page stays responsive and many run at once) and a live card that updates ~1×/sec with the
 * current day, tier, best wave, currencies, and a growing per-tier table. The simulation logic lives
 * entirely in ../sim-engine (shared with the CLI); this file is only UI + worker orchestration. */

import { PROFILES } from './profiles';
import { fmtBig, type Profile, type ProgressEvent, type TierRow } from '../sim-engine';
import { UPGRADES } from '../../src/sim/skills';
import { MAX_TIER } from '../../src/sim/waves';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const el = (tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html) n.innerHTML = html;
  return n;
};
const skillName = (id: string): string => {
  const u = UPGRADES.find((x) => x.id === id);
  return (u && (u.name || u.label)) || id;
};

// Working copy the editor mutates; starts as a clone of the first preset.
let editing: Profile = structuredClone(PROFILES[0]);
const runs: { worker: Worker; card: HTMLElement }[] = [];

// ── editor / sidebar ───────────────────────────────────────────────────────────────────────────────
function renderSide(): void {
  const side = $('#side');
  side.innerHTML = '';

  // Preset picker
  side.appendChild(el('h2', {}, 'Profile'));
  const sel = el('select', { id: 'preset' }) as HTMLSelectElement;
  PROFILES.forEach((p, i) => sel.appendChild(el('option', { value: String(i) }, p.name)));
  sel.onchange = () => { editing = structuredClone(PROFILES[+sel.value]); renderSide(); };
  side.appendChild(sel);

  const e = editing;
  const num = (label: string, val: number | undefined, on: (v: number) => void, ph = ''): HTMLElement => {
    const wrap = el('div');
    wrap.appendChild(el('label', {}, label));
    const inp = el('input', { type: 'number', step: 'any', value: val == null ? '' : String(val), placeholder: ph }) as HTMLInputElement;
    inp.oninput = () => on(inp.value === '' ? NaN : parseFloat(inp.value));
    wrap.appendChild(inp);
    return wrap;
  };

  side.appendChild(el('label', {}, 'Name'));
  const nm = el('input', { type: 'text', value: e.name }) as HTMLInputElement;
  nm.oninput = () => { e.name = nm.value; };
  side.appendChild(nm);

  side.appendChild(el('h2', { style: 'margin-top:14px' }, 'Schedule'));
  const sched = el('div', { class: 'row2' });
  sched.appendChild(num('Sessions/day', e.sessionsPerDay, (v) => { e.sessionsPerDay = v || 1; }));
  sched.appendChild(num('Minutes/session', e.sessionMinutes, (v) => { e.sessionMinutes = v || 1; }));
  side.appendChild(sched);

  side.appendChild(el('h2', { style: 'margin-top:14px' }, 'Category weights'));
  const w = el('div', { class: 'row3' });
  (['attack', 'defense', 'economic'] as const).forEach((c) =>
    w.appendChild(num(c[0].toUpperCase() + c.slice(1), e.weights[c], (v) => { e.weights[c] = isNaN(v) ? 0 : v; })));
  side.appendChild(w);

  side.appendChild(el('h2', { style: 'margin-top:14px' }, 'Per-skill priority boosts'));
  const boostBox = el('div', { class: 'boosts', id: 'boosts' });
  const renderBoosts = (): void => {
    boostBox.innerHTML = '';
    const b = e.skillBoosts || (e.skillBoosts = {});
    for (const id of Object.keys(b)) {
      const row = el('div', { class: 'b' });
      row.appendChild(el('span', {}, skillName(id)));
      const inp = el('input', { type: 'number', step: 'any', value: String(b[id]) }) as HTMLInputElement;
      inp.oninput = () => { b[id] = parseFloat(inp.value) || 1; };
      row.appendChild(inp);
      boostBox.appendChild(row);
    }
  };
  side.appendChild(boostBox);
  const addRow = el('div', { class: 'row2', style: 'margin-top:6px' });
  const addSel = el('select') as HTMLSelectElement;
  addSel.appendChild(el('option', { value: '' }, '+ add skill boost…'));
  UPGRADES.forEach((u) => addSel.appendChild(el('option', { value: u.id }, (u.name || u.label || u.id) + ' (' + u.tab + ')')));
  addSel.onchange = () => { if (addSel.value) { (e.skillBoosts = e.skillBoosts || {})[addSel.value] = 2; addSel.value = ''; renderBoosts(); } };
  addRow.appendChild(addSel);
  const clrB = el('button', { class: 'ghost tiny' }, 'clear boosts');
  clrB.onclick = () => { e.skillBoosts = {}; renderBoosts(); };
  addRow.appendChild(clrB);
  side.appendChild(addRow);
  renderBoosts();

  side.appendChild(el('h2', { style: 'margin-top:14px' }, 'Tier advance policy'));
  side.appendChild(num('Grind each tier to wave (blank = max out)', e.advanceAtWave, (v) => { e.advanceAtWave = isNaN(v) ? undefined : v; }, 'max out'));
  side.appendChild(el('div', { class: 'hint' }, 'Blank → advance only when a tier caps out. A number → farm each tier to that wave first (min 300).'));

  side.appendChild(el('h2', { style: 'margin-top:14px' }, 'Gems'));
  const gems = el('div', { class: 'row2' });
  gems.appendChild(num('Max lab slots', e.maxLabSlots, (v) => { e.maxLabSlots = v || 1; }));
  gems.appendChild(num('Max card slots', e.maxCardSlots, (v) => { e.maxCardSlots = v || 1; }));
  side.appendChild(gems);
  side.appendChild(num('Seed', e.seed, (v) => { e.seed = v || 0; }));

  const btns = el('div', { class: 'btns' });
  const runBtn = el('button', {}, '▶ Run this config');
  runBtn.onclick = () => startRun(structuredClone(e));
  const allBtn = el('button', { class: 'ghost' }, 'Run all presets');
  allBtn.onclick = () => PROFILES.forEach((p) => startRun(structuredClone(p)));
  const stopBtn = el('button', { class: 'ghost' }, 'Stop all');
  stopBtn.onclick = stopAll;
  const clrBtn = el('button', { class: 'ghost' }, 'Clear');
  clrBtn.onclick = () => { stopAll(); $('#runs').innerHTML = ''; runs.length = 0; };
  btns.append(runBtn, allBtn, stopBtn, clrBtn);
  side.appendChild(btns);
}

function stopAll(): void {
  for (const r of runs) { r.worker.terminate(); r.card.querySelector('.st')!.textContent = 'stopped'; }
}

// ── run cards ────────────────────────────────────────────────────────────────────────────────────
const COLS: [string, (r: TierRow) => string][] = [
  ['Tier', (r) => String(r.tier)],
  ['Day', (r) => r.reachedDay.toFixed(0)],
  ['Cap', (r) => r.capWave + (r.guard ? '+' : '')],
  ['Runs', (r) => String(r.runs)],
  ['Days', (r) => r.daysInTier.toFixed(1)],
  ['Coins', (r) => fmtBig(r.coins)],
  ['Gems', (r) => fmtBig(r.gems)],
  ['Vials', (r) => fmtBig(r.vials)],
  ['Atk', (r) => String(r.permA)],
  ['Def', (r) => String(r.permD)],
  ['Eco', (r) => String(r.permE)],
  ['Spd', (r) => r.speed + 'x'],
  ['Next?', (r) => (r.advanced ? 'advance' : 'WALL')],
];

function startRun(profile: Profile): void {
  const card = el('div', { class: 'card' });
  card.innerHTML =
    `<div class="hd"><span class="nm"></span><span class="st">starting…</span>` +
    `<button class="ghost tiny stop">stop</button></div>` +
    `<div class="bar"><i></i></div><div class="meta"></div>` +
    `<table><thead></thead><tbody></tbody></table>`;
  (card.querySelector('.nm') as HTMLElement).textContent = profile.name;
  const bar = card.querySelector('.bar > i') as HTMLElement;
  const st = card.querySelector('.st') as HTMLElement;
  const meta = card.querySelector('.meta') as HTMLElement;
  const thead = card.querySelector('thead') as HTMLElement;
  const tbody = card.querySelector('tbody') as HTMLElement;
  thead.innerHTML = '<tr>' + COLS.map(([h]) => `<th>${h}</th>`).join('') + '</tr>';
  $('#runs').prepend(card);

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const entry = { worker, card };
  runs.push(entry);
  (card.querySelector('.stop') as HTMLElement).onclick = () => { worker.terminate(); st.textContent = 'stopped'; };

  const render = (e: ProgressEvent): void => {
    bar.style.width = Math.min(100, (e.tier / MAX_TIER) * 100).toFixed(1) + '%';
    meta.innerHTML =
      `day <b>${e.day.toFixed(1)}</b> · tier <b>${e.tier}</b> · best wave <b>${e.tierBest}</b> · ` +
      `runs <b>${e.totalRuns}</b> · <b>${e.speed}x</b> · coins <b>${fmtBig(e.coins)}</b> · ` +
      `gems <b>${fmtBig(e.gems)}</b> · vials <b>${fmtBig(e.vials)}</b>`;
    tbody.innerHTML = e.rows.map((r) =>
      `<tr class="${r.advanced ? '' : 'wall'}">` + COLS.map(([, f]) => `<td>${f(r)}</td>`).join('') + '</tr>').join('');
  };

  worker.onmessage = (ev: MessageEvent) => {
    const e = ev.data as ProgressEvent | { kind: 'error'; message: string };
    if (e.kind === 'error') { st.textContent = 'error'; card.classList.add('err'); meta.textContent = (e as { message: string }).message; return; }
    render(e);
    if (e.kind === 'progress') st.textContent = 'running…';
    if (e.kind === 'done') {
      const walled = e.rows.length && !e.rows[e.rows.length - 1].advanced;
      st.textContent = `done · tier ${e.tier} · ${e.day.toFixed(0)}d`;
      card.classList.add(walled ? 'wall' : 'done');
      bar.style.width = '100%';
      worker.terminate();
    }
  };
  worker.postMessage({ profile });
}

renderSide();
