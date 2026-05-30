/* hud/devmenu.js — the plug-and-play DEV overlay, lifted out of hud.js so it survives HUD swaps.
   It owns its OWN DOM (appended to <body>, NOT inside the swappable HUD root that gets cleared on
   a swap). index.html injects it only when the DEV feature flag is on, so removing it is a one-line
   change with no effect on the game.

   Organized into collapsible submenus: Cheats / Combat / Time / HUD (the live switcher).

   createDevMenu({ handlers, hudHost }) → { setToggle, report, refresh, destroy, el }
   - setToggle(kind,on)  reflect a lightning/pause toggle (called via hudHost.setDevToggle)
   - report(msg,isErr)   surface a host message (load/build failures, reverts) in the panel
   - refresh()           re-render the HUD list (active marker) after a swap */
(function (A) {
  const HUD_KEY = 'arena.hud'; // remembered selection, re-applied on next boot

  A.createDevMenu = function (cfg) {
    cfg = cfg || {};
    const handlers = cfg.handlers || {};
    const hudHost = cfg.hudHost;

    const el = document.createElement('div');
    el.className = 'dev';

    const SECTIONS = [
      { title: 'Cheats', rows: [
        { dev: 'reset', label: 'Reset progress' },
        { dev: 'cores', label: 'Max Cores' },
        { dev: 'gold', label: 'Max Gold' },
        { dev: 'tokens', label: 'Max Tokens' },
      ] },
      { title: 'Combat', rows: [
        { dev: 'lightning', label: 'Lightning', toggle: true },
        { dev: 'pause', label: 'Pause', toggle: true },
        { dev: 'testbullet', label: 'Test bullet' },
      ] },
      { title: 'Time', ff: [[30, '+30s'], [60, '+1m'], [300, '+5m'], [3600, '+60m']] },
      { title: 'HUD', hud: true },
    ];

    function rowBtn(r) {
      const lbl = r.toggle ? (r.label + ': off') : r.label;
      return '<button data-dev="' + r.dev + '"' + (r.toggle ? ' data-toggle="1" id="dev-' + r.dev + '"' : '') + '>' + lbl + '</button>';
    }
    function sectionHtml(sec, i) {
      let body = '';
      if (sec.rows) body = sec.rows.map(rowBtn).join('');
      else if (sec.ff) body = '<div class="ffrow">' + sec.ff.map((f) => '<button data-ff="' + f[0] + '">' + f[1] + '</button>').join('') + '</div>';
      else if (sec.hud) body = '<div class="hudlist" id="dev-hudlist"></div><div class="devstatus" id="dev-status"></div>';
      return '<div class="devsec' + (i === 0 ? ' open' : '') + '">' +
        '<button class="devsec-h" data-sec="' + i + '">' + sec.title + '<span class="caret">›</span></button>' +
        '<div class="devsec-b">' + body + '</div></div>';
    }

    el.innerHTML =
      '<button class="devtoggle" id="dev-toggle">DEV</button>' +
      '<div class="devpanel hide" id="dev-panel">' + SECTIONS.map(sectionHtml).join('') + '</div>';
    document.body.appendChild(el);

    const panel = el.querySelector('#dev-panel');
    el.querySelector('#dev-toggle').addEventListener('click', () => panel.classList.toggle('hide'));

    // collapsible submenus
    panel.querySelectorAll('[data-sec]').forEach((h) =>
      h.addEventListener('click', () => h.parentNode.classList.toggle('open')));

    // cheat / combat buttons → onDev, time buttons → onFF
    panel.querySelectorAll('[data-dev]').forEach((b) =>
      b.addEventListener('click', () => handlers.onDev && handlers.onDev(b.dataset.dev)));
    panel.querySelectorAll('[data-ff]').forEach((b) =>
      b.addEventListener('click', () => handlers.onFF && handlers.onFF(+b.dataset.ff)));

    const statusEl = panel.querySelector('#dev-status');
    const listEl = panel.querySelector('#dev-hudlist');

    function renderList() {
      const active = hudHost && hudHost.getActiveName ? hudHost.getActiveName() : null;
      let h = '';
      for (const name in A.HUDS) {
        const on = name === active;
        h += '<button class="hudpick' + (on ? ' active' : '') + '" data-hud="' + name + '">' +
          '<span class="dot"></span>' + (A.HUDS[name].label || name) + '</button>';
      }
      listEl.innerHTML = h;
      listEl.querySelectorAll('[data-hud]').forEach((b) =>
        b.addEventListener('click', () => {
          const name = b.dataset.hud;
          if (name === (hudHost && hudHost.getActiveName && hudHost.getActiveName())) return;
          try { localStorage.setItem(HUD_KEY, name); } catch (e) {}
          if (hudHost && hudHost.switchTo) hudHost.switchTo(name);
        }));
    }
    renderList();

    return {
      el,
      setToggle(kind, on) {
        const b = panel.querySelector('#dev-' + kind);
        if (!b) return;
        b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1) + ': ' + (on ? 'on' : 'off');
        b.classList.toggle('on', !!on);
      },
      report(msg, isErr) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('err', !!isErr);
      },
      refresh: renderList,
      destroy() { if (el.parentNode) el.parentNode.removeChild(el); },
    };
  };

  // the remembered HUD selection (so a prototype stays selected across reloads), read by index.html
  A.savedHud = function () { try { return localStorage.getItem(HUD_KEY); } catch (e) { return null; } };
})(window.ARENA = window.ARENA || {});
