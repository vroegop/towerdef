/* src/hud/devmenu.ts — the plug-and-play DEV overlay, kept out of hud.ts so it survives HUD swaps.
   It owns its OWN DOM (appended to <body>, NOT inside the swappable HUD root that gets cleared on
   a swap). main.ts injects it only when the DEV feature flag is on. */
import type { DevMenu, HudHandlers, HudHost } from '../types';
import { HUDS } from './registry';

const HUD_KEY = 'arena.hud'; // remembered selection, re-applied on next boot

interface DevRow {
  dev: string;
  label: string;
  toggle?: boolean;
}
interface DevSection {
  title: string;
  rows?: DevRow[];
  grid?: boolean; // lay the section's rows out as a compact 2-column grid (used for the currency cheats)
  ff?: [number, string][];
  hud?: boolean;
  note?: string; // a small helper line shown under the section header
}

export function createDevMenu(cfg: { handlers?: HudHandlers; hudHost?: HudHost }): DevMenu {
  cfg = cfg || {};
  const handlers = cfg.handlers || ({} as HudHandlers);
  const hudHost = cfg.hudHost;

  const el = document.createElement('div');
  el.className = 'dev';

  const SECTIONS: DevSection[] = [
    {
      title: 'Progress',
      note: 'Instantly unlock everything for testing.',
      rows: [
        { dev: 'finishlabs', label: 'Finish all labs' },
        { dev: 'maxskills', label: 'Max all skills' },
        { dev: 'maxcards', label: 'Max all cards' },
        { dev: 'reset', label: 'Reset progress' },
      ],
    },
    {
      title: 'Currencies',
      grid: true,
      rows: [
        { dev: 'coins', label: 'Coins' },
        { dev: 'gold', label: 'Gold' },
        { dev: 'gems', label: 'Gems' },
        { dev: 'vials', label: 'Vials' },
      ],
    },
    {
      title: 'Speed',
      note: 'Turbo runs the battle at ×5 the selected speed.',
      rows: [{ dev: 'turbo', label: 'Turbo ×5', toggle: true }],
    },
    {
      title: 'Combat',
      rows: [
        { dev: 'lightning', label: 'Lightning', toggle: true },
        { dev: 'pause', label: 'Pause', toggle: true },
        { dev: 'testbullet', label: 'Test bullet' },
      ],
    },
    { title: 'Fast-forward', ff: [[30, '+30s'], [60, '+1m'], [300, '+5m'], [3600, '+60m']] },
    { title: 'HUD skin', hud: true },
  ];

  function rowBtn(r: DevRow): string {
    const lbl = r.toggle ? r.label + ': off' : r.label;
    const attrs = r.toggle ? ' data-toggle="1" data-label="' + r.label + '" id="dev-' + r.dev + '"' : '';
    return '<button data-dev="' + r.dev + '"' + attrs + '>' + lbl + '</button>';
  }
  function sectionHtml(sec: DevSection): string {
    let body = sec.note ? '<div class="devnote">' + sec.note + '</div>' : '';
    if (sec.rows) body += '<div class="devbtns' + (sec.grid ? ' grid' : '') + '">' + sec.rows.map(rowBtn).join('') + '</div>';
    else if (sec.ff) body += '<div class="ffrow">' + sec.ff.map((f) => '<button data-ff="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
    else if (sec.hud) body += '<div class="hudlist" id="dev-hudlist"></div><div class="devstatus" id="dev-status"></div>';
    return (
      '<div class="devsec">' +
      '<div class="devsec-h">' + sec.title + '</div>' +
      '<div class="devsec-b">' + body + '</div></div>'
    );
  }

  el.innerHTML =
    '<button class="devtoggle" id="dev-toggle">DEV</button>' +
    '<div class="devpanel hide" id="dev-panel">' +
    '<div class="devhead"><span class="devtitle">Developer tools</span><button class="devclose" id="dev-close" title="Close">×</button></div>' +
    SECTIONS.map(sectionHtml).join('') +
    '</div>';
  document.body.appendChild(el);

  const panel = el.querySelector('#dev-panel') as HTMLElement;
  (el.querySelector('#dev-toggle') as HTMLElement).addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('hide');
  });
  (el.querySelector('#dev-close') as HTMLElement).addEventListener('click', () => panel.classList.add('hide'));

  // auto-collapse when clicking anywhere outside the dev overlay
  document.addEventListener('mousedown', (e) => {
    if (panel.classList.contains('hide')) return;
    if (!el.contains(e.target as Node)) panel.classList.add('hide');
  });

  // cheat / combat buttons → onDev, time buttons → onFF
  panel.querySelectorAll<HTMLElement>('[data-dev]').forEach((b) => b.addEventListener('click', () => handlers.onDev && handlers.onDev(b.dataset.dev!)));
  panel.querySelectorAll<HTMLElement>('[data-ff]').forEach((b) => b.addEventListener('click', () => handlers.onFF && handlers.onFF(+b.dataset.ff!)));

  const statusEl = panel.querySelector('#dev-status') as HTMLElement | null;
  const listEl = panel.querySelector('#dev-hudlist') as HTMLElement;

  function renderList(): void {
    const active = hudHost && hudHost.getActiveName ? hudHost.getActiveName() : null;
    let h = '';
    for (const name in HUDS) {
      const on = name === active;
      h += '<button class="hudpick' + (on ? ' active' : '') + '" data-hud="' + name + '">' + '<span class="dot"></span>' + (HUDS[name].label || name) + '</button>';
    }
    listEl.innerHTML = h;
    listEl.querySelectorAll<HTMLElement>('[data-hud]').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.hud!;
        if (name === (hudHost && hudHost.getActiveName && hudHost.getActiveName())) return;
        try {
          localStorage.setItem(HUD_KEY, name);
        } catch {
          /* ignore */
        }
        if (hudHost && hudHost.switchTo) hudHost.switchTo(name);
      }),
    );
  }
  renderList();

  return {
    el,
    setToggle(kind: string, on: boolean) {
      const b = panel.querySelector('#dev-' + kind) as HTMLElement | null;
      if (!b) return;
      const base = b.dataset.label || kind.charAt(0).toUpperCase() + kind.slice(1);
      b.textContent = base + ': ' + (on ? 'on' : 'off');
      b.classList.toggle('on', !!on);
    },
    report(msg: string, isErr?: boolean) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.classList.toggle('err', !!isErr);
    },
    refresh: renderList,
    destroy() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}

// the remembered HUD selection (so a chosen skin stays selected across reloads), read by main.ts
export function savedHud(): string | null {
  try {
    return localStorage.getItem(HUD_KEY);
  } catch {
    return null;
  }
}
