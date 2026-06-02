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
  ff?: [number, string][];
  hud?: boolean;
  links?: { href: string; label: string }[];
}

export function createDevMenu(cfg: { handlers?: HudHandlers; hudHost?: HudHost }): DevMenu {
  cfg = cfg || {};
  const handlers = cfg.handlers || ({} as HudHandlers);
  const hudHost = cfg.hudHost;

  const el = document.createElement('div');
  el.className = 'dev';

  const SECTIONS: DevSection[] = [
    {
      title: 'Cheats',
      rows: [
        { dev: 'reset', label: 'Reset progress' },
        { dev: 'coins', label: 'Max Coins' },
        { dev: 'gold', label: 'Max Gold' },
        { dev: 'gems', label: 'Max Gems' },
        { dev: 'vials', label: 'Max Vials' },
        { dev: 'labs', label: 'Unlock Labs' },
      ],
    },
    {
      title: 'Combat',
      rows: [
        { dev: 'lightning', label: 'Lightning', toggle: true },
        { dev: 'pause', label: 'Pause', toggle: true },
        { dev: 'testbullet', label: 'Test bullet' },
      ],
    },
    { title: 'Time', ff: [[30, '+30s'], [60, '+1m'], [300, '+5m'], [3600, '+60m']] },
    { title: 'HUD', hud: true },
    {
      title: 'Prototypes',
      links: [{ href: './proto/orcs.html', label: '⚔️ Orc sprite prototype' }],
    },
  ];

  function rowBtn(r: DevRow): string {
    const lbl = r.toggle ? r.label + ': off' : r.label;
    return '<button data-dev="' + r.dev + '"' + (r.toggle ? ' data-toggle="1" id="dev-' + r.dev + '"' : '') + '>' + lbl + '</button>';
  }
  function sectionHtml(sec: DevSection, i: number): string {
    let body = '';
    if (sec.rows) body = sec.rows.map(rowBtn).join('');
    else if (sec.ff) body = '<div class="ffrow">' + sec.ff.map((f) => '<button data-ff="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
    else if (sec.hud) body = '<div class="hudlist" id="dev-hudlist"></div><div class="devstatus" id="dev-status"></div>';
    else if (sec.links) body = sec.links.map((l) => '<a class="devlink" href="' + l.href + '" target="_blank" rel="noopener">' + l.label + '</a>').join('');
    return (
      '<div class="devsec' + (i === 0 ? ' open' : '') + '">' +
      '<button class="devsec-h" data-sec="' + i + '">' + sec.title + '<span class="caret">›</span></button>' +
      '<div class="devsec-b">' + body + '</div></div>'
    );
  }

  el.innerHTML =
    '<button class="devtoggle" id="dev-toggle">DEV</button>' +
    '<div class="devpanel hide" id="dev-panel">' + SECTIONS.map(sectionHtml).join('') + '</div>';
  document.body.appendChild(el);

  const panel = el.querySelector('#dev-panel') as HTMLElement;
  (el.querySelector('#dev-toggle') as HTMLElement).addEventListener('click', () => panel.classList.toggle('hide'));

  // collapsible submenus
  panel.querySelectorAll<HTMLElement>('[data-sec]').forEach((h) => h.addEventListener('click', () => (h.parentNode as HTMLElement).classList.toggle('open')));

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
      b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1) + ': ' + (on ? 'on' : 'off');
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
