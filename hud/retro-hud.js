/* hud/retro-hud.js — PROTOTYPE retro CRT-terminal HUD (black + phosphor green, Fallout Pip-Boy vibe).
   Drop-in replacement for hud/hud.js: same factory signature A.Hud(root, handlers) and the same
   public surface { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint,
   hideHint, setMeta, setDevToggle, root }, wired to the identical sim APIs (A.TABS, A.computeStats,
   A.runUpgradeCost, A.permVisible, A.CARDS, milestones, tiers, ...).

   Where the original is menu/button driven, this is structured like a terminal session:
   - in run: a one-line status readout (OS banner, wave, ASCII HP bar, gold) + a bottom COMMAND
     CONSOLE listing the run upgrades as numbered shell commands (click or press 1-4 to buy);
   - between runs: a ROBCO-style terminal that "boots", then exposes selectable sections
     (STATUS / PERKS / HOLOTAPES / //POWERS / //PRESTIGE) with a green vector "vault dweller"
     portrait drawn on canvas, S.P.E.C.I.A.L.-style perk lines, holotape cards, and an
     [ INITIATE COMBAT ] prompt. Number keys 1-5 switch sections; Enter launches a run. */
(function (A) {
  A.Hud = function (root, handlers) {
    handlers = handlers || {};
    root.className = 'rhud';

    // ---------- ported inline SVG icons (rendered in phosphor green via currentColor) ----------
    const PATHS = {
      hero: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.6 7-6.6s7 2.7 7 6.6"/>',
      cores: '<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18"/><path d="M5 7l7 4 7-4"/>',
      bow: '<path d="M8 3a10 10 0 0 1 0 18"/><path d="M8 3v18"/><path d="M5 12h13"/><path d="M15 9l3 3-3 3"/><path d="M5 12l2.5-2M5 12l2.5 2"/>',
      bullseye: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
      rate: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5"/><path d="M10 3h4M12 3v3"/>',
      heart: '<path d="M12 20s-6.5-4.3-6.5-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 6.5 2.7c0 5-6.5 9.3-6.5 9.3z"/>',
      regen: '<path d="M10 19s-4.8-3.2-4.8-6.7A2.6 2.6 0 0 1 10 10 2.6 2.6 0 0 1 14.8 12.3C14.8 15.8 10 19 10 19z"/><path d="M14 8.4A2.6 2.6 0 0 1 19 10.7c0 2.4-1.9 4.3-3.2 5.5"/>',
      burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3.4 3.4M18.8 5.2l-3.4 3.4M5.2 18.8l3.4-3.4M18.8 18.8l-3.4-3.4"/>',
      cards: '<rect x="3" y="7" width="12" height="14" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2"/>',
    };
    function icon(name, size) {
      size = size || 16;
      return '<svg class="ic" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (PATHS[name] || '') + '</svg>';
    }

    // ---------- formatting helpers ----------
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);
    const SUF = [[1e15, 'q'], [1e12, 't'], [1e9, 'b'], [1e6, 'm']];
    const abbr = (n) => {
      n = Math.floor(n || 0);
      if (n < 1000) return String(n);
      if (n < 1e6) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      for (const [v, s] of SUF) if (n >= v) { const m = n / v; return (m < 10 ? m.toFixed(3) : m < 100 ? m.toFixed(2) : m.toFixed(1)) + s; }
    };
    const sumPerm = (meta) => Object.values((meta && meta.perm) || {}).reduce((a, b) => a + b, 0);
    // ASCII meter: e.g. bar(.6, 10) -> "██████░░░░"
    const bar = (frac, width) => {
      width = width || 10; frac = Math.max(0, Math.min(1, frac || 0));
      const on = Math.round(frac * width);
      return '█'.repeat(on) + '░'.repeat(width - on);
    };
    const STAR = '★', STARO = '☆', CORE = '◆', TOK = '❖';
    const STAT_ICON = { rangedDamage: 'bow', attackSpeed: 'rate', health: 'heart', regen: 'regen' };

    // ---------- DOM skeleton ----------
    root.innerHTML =
      // in-run status line
      '<div class="statusline" id="r-status">' +
      '  <span class="sl-os">ROBCO ARENA-OS<span class="blip">_</span></span>' +
      '  <span class="sl-field wave"><span class="lbl">WAVE</span><span class="val" id="r-wave">0001</span></span>' +
      '  <span class="sl-field hp"><span class="lbl">VIT</span><span class="sl-bar" id="r-hpbar">' + bar(1) + '</span><span class="val" id="r-hp">1/1</span></span>' +
      '  <span class="sl-field gold"><span class="lbl">CAPS</span><span class="val" id="r-gold">0</span></span>' +
      '  <span class="sl-spacer"></span>' +
      '  <button class="sl-btn" id="r-data">[DATA]</button>' +
      '  <button class="sl-btn" id="r-cfg">[CFG]</button>' +
      '</div>' +
      '<div class="wavecol hide" id="r-wavecol"></div>' +
      // bottom command console (run upgrades)
      '<div class="console" id="r-console">' +
      '  <div class="chead"><span>&gt; UPGRADE CONSOLE</span><span class="dim" id="r-conhint">[1-4] purchase</span></div>' +
      '  <div id="r-cmds"></div>' +
      '</div>' +
      // transient hint
      '<div class="hint hide" id="r-hint"></div>' +
      // overlays
      '<div class="overlay top hide" id="r-statsov"><div class="win" id="r-statswin"></div></div>' +
      '<div class="overlay top hide" id="r-setov"><div class="win" id="r-setwin"></div></div>' +
      '<div class="overlay top hide" id="r-overov"><div class="win" id="r-overwin"></div></div>' +
      '<div class="overlay center hide" id="r-cardov"><div class="win" id="r-cardwin" style="width:min(320px,90vw)"></div></div>' +
      // menu (full terminal)
      '<div class="overlay menu" id="r-menu">' +
      '  <div class="boot hide" id="r-boot"></div>' +
      '  <div class="mhead hide" id="r-mhead"><pre class="banner" id="r-banner"></pre><div class="mnav" id="r-mnav"></div></div>' +
      '  <div class="mbody hide" id="r-mbody"></div>' +
      '</div>' +
      // milestones reuse menu-modal style via overlay
      '<div class="overlay top hide" id="r-msov"><div class="win" id="r-mswin" style="width:min(520px,94vw)"></div></div>' +
      // tutorial spotlight + tooltip
      '<div class="spot hide" id="r-spot"></div><div class="thought hide" id="r-thought"></div>' +
      '<div class="tip hide" id="r-tip"></div>' +
      // dev panel
      '<div class="dev" id="r-dev">' +
      '  <button class="devtoggle" id="r-devtoggle">DEV</button>' +
      '  <div class="devpanel hide" id="r-devpanel">' +
      '    <button data-dev="reset">Reset progress</button>' +
      '    <button data-dev="cores">Max Cores</button>' +
      '    <button data-dev="gold">Max Gold</button>' +
      '    <button data-dev="tokens">Max Tokens</button>' +
      '    <button data-dev="lightning" id="r-dev-lightning">Lightning: off</button>' +
      '    <button data-dev="pause" id="r-dev-pause">Pause: off</button>' +
      '    <button data-dev="testbullet">Test bullet</button>' +
      '    <div class="ffrow"><button data-ff="30">+30s</button><button data-ff="60">+1m</button>' +
      '      <button data-ff="300">+5m</button><button data-ff="3600">+60m</button></div>' +
      '  </div></div>' +
      // CRT dressing on top of everything
      '<div class="crtfx"></div><div class="flick"></div>';

    const $ = (sel) => root.querySelector(sel);

    // ====================================================== IN-RUN ==========
    const statusEl = $('#r-status'), consoleEl = $('#r-console'), waveColEl = $('#r-wavecol');
    const cmdsEl = $('#r-cmds');
    // flatten the tab upgrades into a single numbered command list
    const RUN_UPS = [];
    A.TABS.forEach((t) => t.ups.forEach((u) => RUN_UPS.push(u)));
    const cmdRows = {};
    RUN_UPS.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'cmd';
      b.innerHTML = '<span class="key">[' + (i + 1) + ']</span><span class="nm">' + u.label.toUpperCase() + '</span>' +
        '<span class="delta"><span class="cur"></span> <span class="arr">&gt;</span> <span class="nxt"></span></span>' +
        '<span class="sp">..........................</span><span class="cost"></span>';
      b.addEventListener('click', () => buyRun(u.stat));
      cmdsEl.appendChild(b);
      cmdRows[u.stat] = { btn: b, cur: b.querySelector('.cur'), nxt: b.querySelector('.nxt'), cost: b.querySelector('.cost') };
    });
    function buyRun(stat) {
      if (lastS && lastS.econ.gold < A.runUpgradeCost(lastS, stat)) { shake($('#r-status .gold')); return; }
      handlers.onBuyRun && handlers.onBuyRun(stat);
    }

    let lastS = null, inRun = false, taughtCon = false;
    function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

    function update(s) {
      lastS = s; inRun = true;
      $('#r-wave').textContent = String(s.wave.n).padStart(4, '0');
      const hpf = s.hero.hpMax > 0 ? Math.max(0, Math.min(1, s.hero.hp / s.hero.hpMax)) : 0;
      const hb = $('#r-hpbar');
      hb.textContent = bar(hpf, 10);
      hb.className = 'sl-bar' + (hpf <= 0.3 ? ' crit' : hpf <= 0.5 ? ' warn' : '');
      $('#r-hp').textContent = abbr(Math.ceil(s.hero.hp)) + '/' + abbr(Math.ceil(s.hero.hpMax));
      $('#r-gold').textContent = abbr(s.econ.gold);

      // wave countdown ticks (hidden during the scripted first run)
      if (s.firstRun) waveColEl.classList.add('hide');
      else {
        waveColEl.classList.remove('hide');
        const frac = Math.max(0, Math.min(1, s.wave.clock / A.WAVE.interval)), N = 12, on = Math.round(frac * N);
        if (waveColEl.childElementCount !== N) {
          waveColEl.innerHTML = ''; for (let i = 0; i < N; i++) { const d = document.createElement('div'); d.className = 'seg'; waveColEl.appendChild(d); }
        }
        [...waveColEl.children].forEach((d, i) => d.classList.toggle('on', i < on));
      }

      // command console readouts
      const lvl = A.computeStats(s).lvl;
      let minCost = Infinity;
      for (const u of RUN_UPS) {
        const r = cmdRows[u.stat]; if (!r) continue;
        r.cur.textContent = A.statDisplay(u.stat, lvl[u.stat]);
        r.nxt.textContent = A.statDisplay(u.stat, lvl[u.stat] + 1);
        const cost = A.runUpgradeCost(s, u.stat);
        r.cost.textContent = fmt(cost) + 'g';
        r.btn.classList.toggle('cant', s.econ.gold < cost);
        minCost = Math.min(minCost, cost);
      }
      // teach the console: glow once anything is first affordable
      if (!taughtCon && !s.firstRun) consoleEl.classList.toggle('pulse', s.econ.gold >= minCost);

      if (!$('#r-statsov').classList.contains('hide')) refreshStats(s);
    }

    // ---------- run stats panel ([DATA]) ----------
    let boundMeta = null;
    function setMeta(m) { boundMeta = m; }
    function refreshStats(s) {
      const m = boundMeta || {}, tier = m.tier || 1;
      const coresRun = s.firstRun ? A.FIRST_PERM_COST : Math.max(1, Math.round((Math.floor(s.econ.kills / 10) + (s.wave.maxWave || 0)) * A.coreMult(tier)));
      const set = (id, v) => { const e = $('#rst-' + id); if (e) e.textContent = v; };
      set('kills', fmt(s.econ.kills));
      set('foes', fmt(A.waveCount(s.wave.n * (s.difficultyMult || 1))));
      set('mult', 'x' + A.coreMult(tier).toFixed(1));
      set('cores', fmt(m.cores || 0));
      set('run', fmt(coresRun));
    }
    function openStats() {
      $('#r-statswin').innerHTML =
        winHead('RUN DIAGNOSTICS', 'r-stats-close') +
        '<div class="winbody">' +
        kvRow('HOSTILES NEUTRALIZED', '0', 'rst-kills') +
        kvRow('FOES / WAVE', '0', 'rst-foes') +
        kvRow('CORE MULTIPLIER', 'x1', 'rst-mult') +
        kvRow('CORES BANKED', '0', 'rst-cores') +
        kvRow('CORES THIS RUN', '0', 'rst-run') +
        '<button class="tbtn danger" id="r-stats-exit">[ ABORT RUN ]</button>' +
        '</div>';
      $('#r-stats-close').addEventListener('click', () => $('#r-statsov').classList.add('hide'));
      $('#r-stats-exit').addEventListener('click', () => { $('#r-statsov').classList.add('hide'); handlers.onExitRun && handlers.onExitRun(); });
      if (lastS) refreshStats(lastS);
      $('#r-statsov').classList.remove('hide');
    }
    $('#r-data').addEventListener('click', () => { const o = $('#r-statsov'); if (o.classList.contains('hide')) openStats(); else o.classList.add('hide'); });
    $('#r-statsov').addEventListener('click', (e) => { if (e.target.id === 'r-statsov') $('#r-statsov').classList.add('hide'); });

    function showHint(html) { const g = $('#r-hint'); g.innerHTML = html; g.classList.remove('hide'); }
    function hideHint() { $('#r-hint').classList.add('hide'); }

    // shared little builders
    function winHead(title, closeId) {
      return '<div class="winhead"><b>&gt;&gt; ' + title + '</b><button class="x" id="' + closeId + '">X</button></div>';
    }
    function kvRow(k, v, id) { return '<div class="row"><span class="k">' + k + '</span><span class="v" id="' + id + '">' + v + '</span></div>'; }

    // ---------- DEV panel ----------
    $('#r-devtoggle').addEventListener('click', () => $('#r-devpanel').classList.toggle('hide'));
    $('#r-devpanel').querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => handlers.onDev && handlers.onDev(b.dataset.dev)));
    $('#r-devpanel').querySelectorAll('[data-ff]').forEach((b) => b.addEventListener('click', () => handlers.onFF && handlers.onFF(+b.dataset.ff)));
    function setDevToggle(kind, on) {
      const b = $('#r-dev-' + kind); if (!b) return;
      b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1) + ': ' + (on ? 'on' : 'off');
      b.classList.toggle('on', !!on);
    }

    // ---------- settings ([CFG]) ----------
    const settings = handlers.settings || {};
    const SETTINGS_DEF = [
      { key: 'goldOnKill', label: 'CAPS ON KILL' },
      { key: 'coreOnKill', label: 'CORES ON KILL' },
      { key: 'enemyHp', label: 'ENEMY VIT BARS' },
      { key: 'damageNumbers', label: 'DAMAGE NUMERALS' },
    ];
    function openSettings() {
      let h = winHead('CONFIG.SYS', 'r-set-close') + '<div class="winbody">';
      for (const o of SETTINGS_DEF) {
        h += '<button class="setrow' + (settings[o.key] ? '' : ' off') + '" data-set="' + o.key + '">' +
          '<span>' + o.label + '</span><span class="box">[' + (settings[o.key] ? 'X' : ' ') + ']</span></button>';
      }
      $('#r-setwin').innerHTML = h + '</div>';
      $('#r-set-close').addEventListener('click', () => $('#r-setov').classList.add('hide'));
      $('#r-setwin').querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.set; settings[k] = !settings[k];
        b.classList.toggle('off', !settings[k]);
        b.querySelector('.box').textContent = '[' + (settings[k] ? 'X' : ' ') + ']';
        handlers.onSaveSettings && handlers.onSaveSettings();
      }));
      $('#r-setov').classList.remove('hide');
    }
    $('#r-setov').addEventListener('click', (e) => { if (e.target.id === 'r-setov') $('#r-setov').classList.add('hide'); });
    $('#r-cfg').addEventListener('click', openSettings);

    // ====================================================== MENU ============
    const menuEl = $('#r-menu'), bootEl = $('#r-boot'), mheadEl = $('#r-mhead'), mbodyEl = $('#r-mbody');
    const mnavEl = $('#r-mnav'), bannerEl = $('#r-banner');
    const spot = $('#r-spot'), thought = $('#r-thought'), tip = $('#r-tip');
    let lastMeta = null, lastOpts = {}, menuSec = 'status', booted = false, bootTimer = null;

    const BANNER =
      ' ____  ____  ____  ____  ____    ____  ____  ____ \n' +
      '||A ||||R ||||E ||||N ||||A || -- VAULT-TEC COMBAT SIM\n' +
      '||__||||__||||__||||__||||__||    ROBCO INDUSTRIES (TM)\n' +
      '|/__\\||/__\\||/__\\||/__\\||/__\\|    TERMLINK PROTOCOL';
    bannerEl.textContent = BANNER;

    const SECTIONS = [
      { id: 'status', label: 'STATUS' },
      { id: 'perks', label: 'PERKS' },
      { id: 'cards', label: 'HOLOTAPES', gated: true, unlock: 'REACH WAVE 30 TO DECRYPT' },
      { id: 'powers', label: '//POWERS', locked: true, unlock: 'CLEARANCE: TIER 2' },
      { id: 'prestige', label: '//PRESTIGE', locked: true, unlock: 'CLEARANCE: TIER 3' },
    ];
    SECTIONS.forEach((sec, i) => {
      const b = document.createElement('button');
      b.dataset.sec = sec.id;
      b.innerHTML = '<b>' + (i + 1) + '</b> ' + sec.label;
      b.addEventListener('click', () => selectSection(sec, b));
      mnavEl.appendChild(b);
    });
    function selectSection(sec, btn) {
      if (sec.locked) { showTip(btn, sec.unlock); return; }
      if (sec.gated && !A.cardsUnlocked(lastMeta)) { showTip(btn, sec.unlock); return; }
      menuSec = sec.id; $('#r-msov').classList.add('hide'); renderMenu();
    }

    // ---------- green "vault dweller" vector portrait ----------
    function drawAvatar(canvas, meta) {
      const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, cx = W / 2;
      ctx.clearRect(0, 0, W, H);
      const G = '#4dffa0';
      ctx.save();
      ctx.translate(0, 6);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // aura rings grow with permanent power
      const total = sumPerm(meta);
      for (let i = 0; i < Math.min(total, 6); i++) {
        ctx.strokeStyle = 'rgba(77,255,160,' + (0.3 - i * 0.04) + ')';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, H / 2, 70 + i * 8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = G; ctx.fillStyle = 'rgba(77,255,160,.10)'; ctx.lineWidth = 3;
      ctx.shadowColor = G; ctx.shadowBlur = 8;
      // head
      ctx.beginPath(); ctx.arc(cx, 58, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // eyes + big grin (vault-boy style)
      ctx.fillStyle = G; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(cx - 11, 52, 3.2, 0, Math.PI * 2); ctx.arc(cx + 11, 52, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, 60, 13, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      // hair tuft
      ctx.beginPath(); ctx.moveTo(cx - 4, 30); ctx.quadraticCurveTo(cx + 2, 22, cx + 8, 30); ctx.stroke();
      // body
      ctx.beginPath(); ctx.moveTo(cx - 26, 150); ctx.quadraticCurveTo(cx, 96, cx + 26, 150); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 22, 104); ctx.lineTo(cx + 22, 104); ctx.stroke();
      // thumbs-up arm
      ctx.beginPath(); ctx.moveTo(cx + 16, 110); ctx.lineTo(cx + 40, 96); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 44, 90, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 44, 83); ctx.lineTo(cx + 44, 74); ctx.stroke(); // thumb
      ctx.restore();
    }

    // ---------- tutorial spotlight ----------
    function setSpotlight(show, targetEl, text) {
      if (!show || !targetEl) { spot.classList.add('hide'); thought.classList.add('hide'); return; }
      const r = targetEl.getBoundingClientRect(), pad = 3;
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
      spot.classList.remove('hide');
      thought.innerHTML = text; thought.style.top = (r.top - 10) + 'px'; thought.classList.remove('hide');
      const margin = 8, w = thought.offsetWidth, center = r.left + r.width / 2;
      const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
      thought.style.left = left + 'px'; thought.style.setProperty('--arrow-x', (center - left) + 'px');
    }
    let tipTimer = null;
    function showTip(btn, text) {
      const r = btn.getBoundingClientRect();
      tip.textContent = '! ' + (text || 'ACCESS DENIED');
      tip.style.top = (r.top - 6) + 'px'; tip.classList.remove('hide');
      const margin = 8, w = tip.offsetWidth, center = r.left + r.width / 2;
      const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
      tip.style.left = left + 'px';
      clearTimeout(tipTimer); tipTimer = setTimeout(() => tip.classList.add('hide'), 2400);
    }

    // ---------- section renderers ----------
    function perksHtml(meta, tutoring) {
      let h = '<div class="seclabel">&gt; PERMANENT PERKS &mdash; spend <b>CORES ' + CORE + '</b>  (you have <b>' + (meta.cores || 0) + '</b>)</div><div class="perklist">';
      A.permVisible(meta).forEach((up, i) => {
        const permLvl = (meta.perm && meta.perm[up.id]) || 0;
        const eff = A.CORE[up.stat].base + permLvl;
        const cost = A.permCost(meta, up.id), afford = (meta.cores || 0) >= cost;
        const isTut = tutoring && i === 0 && permLvl === 0;
        h += '<button class="perk' + (afford ? '' : ' cant') + (isTut ? ' tut' : '') + '" data-perm="' + up.id + '">' +
          icon(STAT_ICON[up.stat] || 'burst', 16) +
          '<span class="nm">' + up.label.toUpperCase() + '</span>' +
          '<span class="lv">LVL ' + A.statDisplay(up.stat, eff) + '</span>' +
          '<span class="sp">..............</span>' +
          '<span class="cost">' + cost + ' ' + CORE + '</span></button>';
      });
      return h + '</div>';
    }
    function starStr(stars) {
      let s = '';
      for (let i = 0; i < 5; i++) {
        const slot = A.starSlot(i, stars);
        if (slot === 'empty') s += '<span class="dim">' + STARO + '</span>';
        else s += '<span class="' + slot + '">' + STAR + '</span>';
      }
      return s;
    }
    function cardCellHtml(meta, i) {
      const id = A.CARD_ORDER[i], owned = id && (meta.cards || []).find((c) => c.id === id);
      if (!owned) return '<div class="card locked"><div class="art">' + icon('cards', 32) + '</div><div class="nm">[ LOCKED ]</div></div>';
      const def = A.CARDS[id], stars = owned.stars || 0, v = def.value(stars);
      const tier = stars >= 11 ? 'chroma' : stars >= 6 ? 'gold' : '';
      return '<div class="card ' + tier + '" data-card="' + id + '"><div class="art">' + icon(def.art, 44) + '</div>' +
        '<div class="nm">' + def.name.toUpperCase() + '</div><div class="stars">' + starStr(stars) + '</div>' +
        '<div class="cval">+' + v + ' DMG</div></div>';
    }
    function cardsHtml(meta) {
      if (!A.cardsUnlocked(meta)) return '<div class="denied"><div class="big">ACCESS DENIED</div>REACH WAVE 30 TO DECRYPT HOLOTAPES</div>';
      const bc = A.buyCardCost(meta), uc = A.upgradeCost(meta), owned = meta.cards || [];
      let h = '<div class="seclabel">&gt; HOLOTAPE ARCHIVE &mdash; spend <b>TOKENS ' + TOK + '</b>  (you have <b>' + (meta.tokens || 0) + '</b>)</div>';
      h += '<div class="cardcmds">' +
        '<button class="tbtn' + ((meta.tokens || 0) < bc ? ' cant' : '') + '" id="r-buycard">[ DECRYPT TAPE :: ' + bc + ' ' + TOK + ' ]</button>' +
        '<button class="tbtn' + ((meta.tokens || 0) < uc || !owned.length ? ' cant' : '') + '" id="r-upcard"' + (!owned.length ? ' disabled' : '') + '>[ AMPLIFY :: ' + uc + ' ' + TOK + ' ]</button>' +
        '</div><div class="cardgrid">';
      for (let i = 0; i < A.CARD_SLOTS; i++) h += cardCellHtml(meta, i);
      return h + '</div>';
    }
    function statusHtml(meta, opts) {
      const tier = meta.tier || 1, canUp = tier < A.MAX_TIER && A.tierUnlocked(meta, tier + 1);
      const claim = A.claimableCount(meta);
      let h = '<div class="seclabel">&gt; OPERATOR DOSSIER</div>';
      if (opts.earn) {
        h += '<div class="combatlog"><div class="cl-t">// LAST ENGAGEMENT</div>' +
          '<div class="cl-v">+' + opts.earn.cores + ' ' + CORE + ' CORES</div>' +
          '<div class="dim">' + opts.earn.kills + ' KILLS / WAVE ' + opts.earn.wave + '</div></div>';
      }
      h += '<div class="portrait"><div class="frame"><canvas id="r-avatar" width="200" height="200"></canvas></div></div>';
      h += '<div class="statgrid">' +
        '<div class="row"><span class="k">CORES ' + CORE + '</span><span class="v">' + (meta.cores || 0) + '</span></div>' +
        '<div class="row"><span class="k">TOKENS ' + TOK + '</span><span class="v">' + (meta.tokens || 0) + '</span></div>' +
        '<div class="row"><span class="k">BEST WAVE</span><span class="v">' + (meta.bestWave || 0) + '</span></div>' +
        '<div class="row"><span class="k">PERKS OWNED</span><span class="v">' + sumPerm(meta) + '</span></div>' +
        '</div>';
      h += '<div class="tier">' +
        '<button class="step' + (tier > 1 ? '' : ' invisible') + '" id="r-tier-down"' + (tier > 1 ? '' : ' disabled') + '>&lt;</button>' +
        '<span class="tinfo">TIER <b>' + tier + '</b> &middot; <span class="mult">x' + A.coreMult(tier).toFixed(1) + '</span></span>' +
        '<button class="step' + (canUp ? '' : ' locked') + '" id="r-tier-up">&gt;</button></div>';
      h += '<button class="tbtn" id="r-ms">[ MILESTONES' + (claim > 0 ? ' :: ' + claim + ' READY' : '') + ' ]</button>';
      h += '<button class="tbtn" id="r-start">[ &#9654; INITIATE COMBAT &nbsp;&nbsp;<span class="cur"></span> ]</button>';
      return h;
    }

    function renderMenu() {
      const meta = lastMeta, opts = lastOpts, tutoring = sumPerm(meta) === 0;
      const totalStars = (meta.cards || []).reduce((a, c) => a + (c.stars || 0), 0);
      [...mnavEl.children].forEach((b) => {
        const id = b.dataset.sec;
        b.classList.toggle('on', id === menuSec);
        b.classList.toggle('tut', tutoring && id === 'perks' && menuSec !== 'perks');
        b.classList.toggle('tut-off', tutoring && id !== 'perks' && menuSec !== 'perks'); // tutorial: funnel to perks
        if (id === 'cards') { const u = A.cardsUnlocked(meta); b.classList.toggle('locked', !u); }
      });
      let html = '<div class="col">';
      if (menuSec === 'status') html += statusHtml(meta, opts);
      else if (menuSec === 'perks') html += perksHtml(meta, tutoring);
      else if (menuSec === 'cards') html += cardsHtml(meta);
      else html += '<div class="denied"><div class="big">ACCESS DENIED</div>INSUFFICIENT CLEARANCE</div>';
      mbodyEl.innerHTML = html + '</div>';

      // wire the active section
      if (menuSec === 'status') {
        drawAvatar($('#r-avatar'), meta);
        $('#r-ms').addEventListener('click', () => openMilestones());
        const td = $('#r-tier-down'); if (td) td.addEventListener('click', () => { if (handlers.onSetTier && handlers.onSetTier((meta.tier || 1) - 1)) renderMenu(); });
        $('#r-tier-up').addEventListener('click', (e) => {
          const cur = meta.tier || 1;
          if (cur >= A.MAX_TIER) return showTip(e.currentTarget, 'TIER ' + A.MAX_TIER + ' IS MAX');
          if (A.tierUnlocked(meta, cur + 1)) { if (handlers.onSetTier && handlers.onSetTier(cur + 1)) renderMenu(); }
          else showTip(e.currentTarget, 'REACH WAVE ' + A.TIER_UNLOCK_WAVE + ' IN TIER ' + cur);
        });
        $('#r-start').addEventListener('click', () => handlers.onStartRun && handlers.onStartRun());
      } else if (menuSec === 'perks') {
        mbodyEl.querySelectorAll('[data-perm]').forEach((b) => b.addEventListener('click', () => {
          if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm)) renderMenu(); else shake(b);
        }));
      } else if (menuSec === 'cards' && A.cardsUnlocked(meta)) {
        const bb = $('#r-buycard'); if (bb) bb.addEventListener('click', () => { if (handlers.onBuyCard && handlers.onBuyCard()) renderMenu(); else shake(bb); });
        const ub = $('#r-upcard'); if (ub) ub.addEventListener('click', () => { if (handlers.onUpgradeCard && handlers.onUpgradeCard()) renderMenu(); else shake(ub); });
        mbodyEl.querySelectorAll('.card[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(el.dataset.card)));
      }

      // tutorial spotlight
      let target = null, text = '';
      if (tutoring) {
        if (menuSec === 'status') { target = mnavEl.querySelector('[data-sec="perks"]'); text = 'OPEN PERKS TO SPEND CORES ' + CORE; }
        else if (menuSec === 'perks') { target = mbodyEl.querySelector('.perk.tut'); text = 'PURCHASE TO GROW STRONGER'; }
      }
      requestAnimationFrame(() => setSpotlight(!!target, target, text));
    }

    // ---------- milestones ----------
    function openMilestones() {
      const meta = lastMeta, cl = meta.claimedMilestones || {}, best = meta.bestWave || 0;
      let h = winHead('MILESTONES :: TIER ' + (meta.tier || 1), 'r-ms-close') + '<div class="winbody">' +
        '<div class="row"><span class="k">CORES BANKED</span><span class="v">' + (meta.cores || 0) + ' ' + CORE + '</span></div>';
      for (const w of A.MILESTONES) {
        const reward = A.milestoneReward(w), claimed = !!cl[w], can = best >= w && !claimed;
        const right = claimed ? '<span class="dim">[DONE]</span>'
          : can ? '<button class="tbtn" style="width:auto;margin:0;padding:4px 12px" data-claim="' + w + '">CLAIM</button>'
            : '<span class="dim">[LOCKED]</span>';
        h += '<div class="row"><span class="k' + (can ? '' : '') + '">WAVE ' + w.toLocaleString() + '</span>' +
          '<span class="v">+' + reward.toLocaleString() + ' ' + CORE + ' &nbsp; ' + right + '</span></div>';
      }
      $('#r-mswin').innerHTML = h + '</div>';
      $('#r-ms-close').addEventListener('click', () => { $('#r-msov').classList.add('hide'); });
      $('#r-mswin').querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => {
        if (handlers.onClaimMilestone && handlers.onClaimMilestone(+b.dataset.claim)) { openMilestones(); }
      }));
      $('#r-msov').classList.remove('hide');
      setSpotlight(false);
    }
    $('#r-msov').addEventListener('click', (e) => { if (e.target.id === 'r-msov') $('#r-msov').classList.add('hide'); });

    // ---------- card star-table modal ----------
    function openCardModal(id) {
      const def = A.CARDS[id]; if (!def) return;
      const owned = ((lastMeta && lastMeta.cards) || []).find((c) => c.id === id);
      const stars = owned ? (owned.stars || 0) : 0;
      let h = winHead(def.name.toUpperCase() + ' :: HOLOTAPE', 'r-card-close') + '<div class="winbody">';
      for (let s = 1; s <= A.MAX_STARS; s++) {
        const tier = s >= 11 ? 'chroma' : s >= 6 ? 'gold' : 'white';
        h += '<div class="csr' + (s <= stars ? ' have' : '') + '"><span class="st ' + tier + '">' + (s <= stars ? STAR : STARO) + '</span>' +
          '<span>+' + def.value(s) + ' DMG</span></div>';
      }
      $('#r-cardwin').innerHTML = h + '</div>';
      $('#r-card-close').addEventListener('click', () => $('#r-cardov').classList.add('hide'));
      $('#r-cardov').classList.remove('hide');
    }
    $('#r-cardov').addEventListener('click', (e) => { if (e.target.id === 'r-cardov') $('#r-cardov').classList.add('hide'); });

    // ---------- boot sequence ----------
    const BOOT_LINES = [
      'ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL',
      'INITIALIZING ARENA COMBAT SIMULATION...',
      'LOADING VAULT-TEC ASSETS .......... <span class="ok">OK</span>',
      'CALIBRATING TARGETING MATRIX ...... <span class="ok">OK</span>',
      'MOUNTING /dev/operator ............ <span class="ok">OK</span>',
      'WELCOME, OPERATOR.',
      '',
    ];
    function playBoot(done) {
      clearTimeout(bootTimer);
      bootEl.innerHTML = ''; bootEl.classList.remove('hide');
      mheadEl.classList.add('hide'); mbodyEl.classList.add('hide');
      let i = 0;
      const step = () => {
        if (i < BOOT_LINES.length) {
          bootEl.innerHTML += (BOOT_LINES[i] ? '> ' + BOOT_LINES[i] : '') + '\n';
          i++; bootTimer = setTimeout(step, 230);
        } else {
          bootEl.classList.add('hide');
          mheadEl.classList.remove('hide'); mbodyEl.classList.remove('hide');
          done && done();
        }
      };
      step();
    }

    function showMenu(meta, opts) {
      lastMeta = meta; lastOpts = opts || {}; menuSec = 'status';
      $('#r-msov').classList.add('hide');
      statusEl.style.display = 'none'; consoleEl.style.display = 'none'; waveColEl.classList.add('hide');
      menuEl.classList.add('show'); inRun = false;
      if (!booted) { booted = true; playBoot(renderMenu); }
      else { mheadEl.classList.remove('hide'); mbodyEl.classList.remove('hide'); bootEl.classList.add('hide'); renderMenu(); }
    }
    function refreshMenu(meta) { if (meta) lastMeta = meta; if (menuEl.classList.contains('show')) renderMenu(); }
    function hideMenu() {
      menuEl.classList.remove('show'); setSpotlight(false);
      statusEl.style.display = ''; consoleEl.style.display = '';
    }

    // ---------- game-over overview ----------
    function showOverview(meta, earn) {
      lastMeta = meta; const e = earn || {}, tier = meta.tier || 1;
      $('#r-statsov').classList.add('hide'); inRun = false;
      let h = winHead('RUN TERMINATED', 'r-over-close') + '<div class="winbody">' +
        '<div class="combatlog"><div class="cl-t">// SALVAGE</div>' +
        '<div class="cl-v">+' + (e.cores || 0) + ' ' + CORE + ' CORES</div>' +
        (e.tokens ? '<div class="dim">+' + e.tokens + ' ' + TOK + ' TOKENS</div>' : '') + '</div>' +
        kvRow('HOSTILES NEUTRALIZED', fmt(e.kills || 0)) +
        kvRow('WAVE REACHED', fmt(e.wave || 0)) +
        kvRow('FOES / WAVE', fmt(A.waveCount((e.wave || 1) * A.tierDifficulty(tier)))) +
        kvRow('CORE MULTIPLIER', 'x' + A.coreMult(tier).toFixed(1)) +
        kvRow('CORES BANKED', fmt(meta.cores || 0)) +
        '<button class="tbtn" id="r-over-ws">[ RETURN TO TERMINAL ]</button></div>';
      $('#r-overwin').innerHTML = h;
      const ws = () => handlers.onToWorkshop && handlers.onToWorkshop();
      $('#r-over-close').addEventListener('click', ws);
      $('#r-over-ws').addEventListener('click', ws);
      statusEl.style.display = 'none'; consoleEl.style.display = 'none'; waveColEl.classList.add('hide');
      $('#r-overov').classList.remove('hide');
    }
    function hideOverview() { $('#r-overov').classList.add('hide'); $('#r-statsov').classList.add('hide'); }

    // ---------- keyboard: terminal shortcuts ----------
    window.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      // menu open: digits switch sections, Enter starts a run from STATUS
      if (menuEl.classList.contains('show') && bootEl.classList.contains('hide')) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= SECTIONS.length) { selectSection(SECTIONS[n - 1], mnavEl.children[n - 1]); return; }
        if (e.key === 'Enter' && menuSec === 'status') { handlers.onStartRun && handlers.onStartRun(); return; }
        return;
      }
      // in a run with no overlay open: digits 1-4 buy the matching console command
      const overlayOpen = !$('#r-statsov').classList.contains('hide') || !$('#r-setov').classList.contains('hide');
      if (inRun && !overlayOpen) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= RUN_UPS.length) { buyRun(RUN_UPS[n - 1].stat); }
      }
    });

    return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, setMeta, setDevToggle, root };
  };
})(window.ARENA = window.ARENA || {});
