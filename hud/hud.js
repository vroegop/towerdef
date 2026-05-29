/* hud/hud.js — in-game HUD (top stats + 3-tab upgrade bar), the between-games MENU
   (5 bottom tabs; Hero tab with chips/earnings/milestones/square Start; Upgrades tab),
   a spotlight tutorial, a milestones modal, and a DEV panel.
   Handlers: onBuyRun, onBuyPerm, onClaimMilestone, onStartRun, onDev, onFF. */
(function (A) {
  A.Hud = function (root, handlers) {
    handlers = handlers || {};
    root.className = 'hud';

    // ---------- inline SVG outline icons (no UTF8 glyphs anywhere in the UI) ----------
    const PATHS = {
      hero: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.6 7-6.6s7 2.7 7 6.6"/>',
      upgrades: '<path d="M12 19V9"/><path d="M7 13l5-5 5 5"/><path d="M7 5h10"/>',
      cores: '<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18"/><path d="M5 7l7 4 7-4"/>',
      best: '<path d="M7 4h10v4.5a5 5 0 0 1-10 0V4z"/><path d="M7 5.5H4.5V8a3 3 0 0 0 3 3"/><path d="M17 5.5h2.5V8a3 3 0 0 1-3 3"/><path d="M12 13.5V17"/><path d="M8.5 20h7l-1-3h-5z"/>',
      play: '<path d="M8 5l11 7-11 7z"/>',
      lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      check: '<path d="M5 13l4 4 10-10"/>',
      back: '<path d="M15 5l-7 7 7 7"/>',
      arrow: '<path d="M5 12h13"/><path d="M12 6l6 6-6 6"/>',
      chart: '<path d="M5 20V11"/><path d="M11 20V5"/><path d="M17 20v-7"/><path d="M3 20h18"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      cards: '<rect x="3" y="7" width="12" height="14" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2"/>',
      token: '<path d="M12 2.5l2.5 6.5 6.5 2.5-6.5 2.5L12 20.5 9.5 14 3 11.5 9.5 9z"/>',
      burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3.4 3.4M18.8 5.2l-3.4 3.4M5.2 18.8l3.4-3.4M18.8 18.8l-3.4-3.4"/>',
      bow: '<path d="M8 3a10 10 0 0 1 0 18"/><path d="M8 3v18"/><path d="M5 12h13"/><path d="M15 9l3 3-3 3"/><path d="M5 12l2.5-2M5 12l2.5 2"/>',
      bullseye: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
      star: '<path d="M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z"/>',
      rate: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5"/><path d="M10 3h4M12 3v3"/>',
      heart: '<path d="M12 20s-6.5-4.3-6.5-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 6.5 2.7c0 5-6.5 9.3-6.5 9.3z"/>',
      regen: '<path d="M10 19s-4.8-3.2-4.8-6.7A2.6 2.6 0 0 1 10 10 2.6 2.6 0 0 1 14.8 12.3C14.8 15.8 10 19 10 19z"/><path d="M14 8.4A2.6 2.6 0 0 1 19 10.7c0 2.4-1.9 4.3-3.2 5.5"/>',
      powers: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
      prestige: '<path d="M5 18h14"/><path d="M5 18l-1-9 4 3 4-7 4 7 4-3-1 9z"/>',
      tier: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    };
    function icon(name, size, cls) {
      size = size || 16;
      return '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        PATHS[name] + '</svg>';
    }
    const cores = (size) => icon('cores', size || 14, 'gold');

    root.innerHTML =
      '<div class="topbar" id="h-top">' +
      '  <div class="stat wave"><span class="lbl">Wave</span><b id="h-wave">1</b></div>' +
      '  <div class="stat"><span class="lbl">HP</span><b id="h-hp">1</b></div>' +
      '  <div class="stat gold"><span class="lbl">Gold</span><b id="h-gold">0</b></div>' +
      '  <button class="iconbtn" id="h-chart" title="Stats">' + icon('chart', 20) + '</button>' +
      '</div>' +
      '<div class="statswrap hide" id="h-stats"><div class="statscard" id="h-statscard"></div></div>' +
      '<div class="ghint hide" id="h-ghint"></div>' +
      '<div class="tabbar" id="h-tabbar"><div id="h-tabcontent"></div><div class="tabs" id="h-tabs"></div></div>' +
      '<div class="menu" id="h-menu">' +
      '  <div class="menu-content" id="h-menu-content"></div>' +
      '  <div class="menutabs" id="h-menu-tabs"></div>' +
      '  <div class="modal hide" id="h-modal"><div class="modal-inner" id="h-modal-inner"></div></div>' +
      '</div>' +
      '<div class="over hide" id="h-over"><div class="over-card" id="h-over-card"></div></div>' +
      '<div class="tut-dim hide" id="h-spot"></div><div class="tut-thought hide" id="h-thought"></div>' +
      '<div class="lk-tip hide" id="h-lktip"></div>' +
      '<div class="dev" id="h-dev">' +
      '  <button class="devtoggle" id="h-devtoggle">DEV</button>' +
      '  <div class="devpanel hide" id="h-devpanel">' +
      '    <button data-dev="reset">Reset progress</button>' +
      '    <button data-dev="cores">Max Cores</button>' +
      '    <button data-dev="gold">Max Gold</button>' +
      '    <button data-dev="tokens">Max Tokens</button>' +
      '    <button data-dev="lightning" id="h-dev-lightning">Lightning: off</button>' +
      '    <button data-dev="pause" id="h-dev-pause">Pause: off</button>' +
      '    <button data-dev="testbullet">Test bullet</button>' +
      '    <div class="ffrow"><button data-ff="30">+30s</button><button data-ff="60">+1m</button>' +
      '      <button data-ff="300">+5m</button><button data-ff="3600">+60m</button></div>' +
      '  </div></div>';

    const $ = (id) => root.querySelector(id);
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);
    const sumPerm = (meta) => Object.values((meta && meta.perm) || {}).reduce((a, b) => a + b, 0);

    // gradient used to fill chromatic (max-tier) stars
    root.insertAdjacentHTML('beforeend',
      '<svg width="0" height="0" style="position:absolute"><defs>' +
      '<linearGradient id="chroma" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ff5d6c"/><stop offset=".35" stop-color="#ffd24a"/>' +
      '<stop offset=".7" stop-color="#3ddc84"/><stop offset="1" stop-color="#4aa8ff"/>' +
      '</linearGradient></defs></svg>');

    // per-star card modal (no close button; click anywhere to dismiss; dark overlay behind)
    root.insertAdjacentHTML('beforeend', '<div class="cardmodal hide" id="h-cardmodal"><div class="cardmodal-inner" id="h-cardmodal-inner"></div></div>');
    root.querySelector('#h-cardmodal').addEventListener('click', () => root.querySelector('#h-cardmodal').classList.add('hide'));

    const STARP = 'M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z';
    const STAT_ICON = { rangedDamage: 'bow', attackSpeed: 'rate', health: 'heart', regen: 'regen' };
    const STAT_LABEL = { rangedDamage: 'Ranged', attackSpeed: 'Speed', health: 'Health', regen: 'Regen' };
    // currencies shown on the Hero screen — add a row here (+ a meta field) for future currencies
    const CURRENCIES = [{ key: 'cores', icon: 'cores', cls: 'gold' }, { key: 'tokens', icon: 'token', cls: 'token' }];
    function starSvg(kind) {
      const fill = kind === 'white' ? '#eef2f8' : kind === 'gold' ? '#ffd24a' : 'url(#chroma)';
      return '<svg class="star ' + kind + '" width="16" height="16" viewBox="0 0 24 24"><path fill="' + fill + '" stroke="rgba(0,0,0,.3)" stroke-width="1" d="' + STARP + '"/></svg>';
    }
    // Show only EARNED stars (up to 5 positions), fanned in an arc: middle highest, outers lower.
    function starsHtml(stars) {
      const count = Math.min(stars, 5);
      let h = '<div class="stars">';
      if (count > 0) {
        const center = (count - 1) / 2, STEP = 5;
        for (let i = 0; i < count; i++) {
          const off = Math.round(Math.abs(i - center) * STEP);
          h += '<span class="starwrap" style="transform:translateY(' + off + 'px)">' + starSvg(A.starSlot(i, stars)) + '</span>';
        }
      }
      return h + '</div>';
    }
    function cardHtml(card) {
      const def = A.CARDS[card.id]; if (!def) return '';
      const v = def.value(card.stars || 0);
      const tier = card.stars >= 11 ? 'chroma' : card.stars >= 6 ? 'gold' : 'white';
      let stats = '';
      for (const e of def.effects) {
        const ic = STAT_ICON[e.stat] || 'burst';
        stats += '<span class="cstat">' + icon(ic, 15) +
          '<span class="cl">' + (STAT_LABEL[e.stat] || e.stat) + '</span><b>+' + v + '</b></span>';
      }
      return '<div class="card tier-' + tier + '" data-card="' + card.id + '">' +
        '<div class="card-img" style="color:' + def.tint + '">' + icon(def.art, 52) + '</div>' +
        starsHtml(card.stars || 0) +
        '<div class="card-stats">' + stats + '</div></div>';
    }
    function lockedCardHtml() {
      return '<div class="card locked"><div class="card-img">' + icon('lock', 36) + '</div><div class="card-name">Locked</div></div>';
    }
    function cardGridHtml(meta) {
      const owned = meta.cards || [];
      let h = '';
      for (let i = 0; i < A.CARD_SLOTS; i++) {
        const id = A.CARD_ORDER[i];
        const have = id && owned.find((c) => c.id === id);
        h += have ? cardHtml(have) : lockedCardHtml();
      }
      return h;
    }
    // press-and-hold (~0.6s, no scroll) to open the per-star breakdown
    function attachLongPress(el, fn) {
      let t = null, sx = 0, sy = 0;
      const cancel = () => { if (t) { clearTimeout(t); t = null; } };
      el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; cancel(); t = setTimeout(() => { t = null; fn(); }, 300); });
      el.addEventListener('pointermove', (e) => { if (t && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); });
      el.addEventListener('pointerup', cancel);
      el.addEventListener('pointerleave', cancel);
      el.addEventListener('pointercancel', cancel);
    }
    function openCardModal(id) {
      const def = A.CARDS[id]; if (!def) return;
      const owned = ((lastMeta && lastMeta.cards) || []).find((c) => c.id === id);
      const stars = owned ? (owned.stars || 0) : 0;
      const e0 = def.effects[0];
      let rows = '';
      for (let s = 1; s <= A.MAX_STARS; s++) {
        const tier = s >= 11 ? 'chroma' : s >= 6 ? 'gold' : 'white';
        rows += '<div class="csr' + (s <= stars ? ' have' : '') + '">' + starSvg(tier) +
          '<span class="csv">' + icon(STAT_ICON[e0.stat] || 'burst', 14) +
          (STAT_LABEL[e0.stat] || e0.stat) + ' <b>+' + def.value(s) + '</b></span></div>';
      }
      $('#h-cardmodal-inner').innerHTML = '<div class="cmhead" style="color:' + def.tint + '">' + icon(def.art, 32) + '</div>' + rows;
      $('#h-cardmodal').classList.remove('hide');
    }

    // ---------- in-game tab bar ----------
    const tabsEl = $('#h-tabs'), contentEl = $('#h-tabcontent');
    const rowEls = {};
    let activeTab = A.TABS[0].id, tabOpen = false; // collapsed by default
    A.TABS.forEach((tab) => {
      const b = document.createElement('button');
      b.textContent = tab.label; b.dataset.tab = tab.id;
      b.addEventListener('click', () => {
        if (tabOpen && activeTab === tab.id) tabOpen = false;        // click active = close
        else { activeTab = tab.id; tabOpen = true; }                 // open / switch
        renderTabButtons(); renderTabContent();
      });
      tabsEl.appendChild(b);
    });
    function renderTabButtons() { [...tabsEl.children].forEach((b) => b.classList.toggle('on', tabOpen && b.dataset.tab === activeTab)); }
    function renderTabContent() {
      const tab = A.TABS.find((t) => t.id === activeTab);
      contentEl.innerHTML = ''; contentEl.className = 'tabcontent' + (tabOpen ? '' : ' collapsed');
      if (!tabOpen) return;
      for (const u of tab.ups) {
        const btn = document.createElement('button');
        btn.className = 'up';
        btn.innerHTML = '<span class="nm">' + u.label + '</span>' +
          '<span class="delta"><span class="cur"></span> ' + icon('arrow', 12) + ' <span class="nxt"></span></span><span class="cost"></span>';
        btn.addEventListener('click', () => handlers.onBuyRun && handlers.onBuyRun(u.stat));
        contentEl.appendChild(btn);
        rowEls[u.stat] = { btn, cur: btn.querySelector('.cur'), nxt: btn.querySelector('.nxt'), cost: btn.querySelector('.cost') };
      }
    }
    renderTabContent();

    let lastS = null;
    function update(s) {
      lastS = s;
      $('#h-wave').textContent = s.wave.n;
      $('#h-hp').textContent = Math.ceil(s.hero.hp) + ' / ' + Math.ceil(s.hero.hpMax);
      $('#h-gold').textContent = fmt(s.econ.gold);
      if (tabOpen) {
        const lvl = A.computeStats(s).lvl;
        const tab = A.TABS.find((t) => t.id === activeTab);
        for (const u of tab.ups) {
          const r = rowEls[u.stat]; if (!r) continue;
          r.cur.textContent = A.statDisplay(u.stat, lvl[u.stat]);
          r.nxt.textContent = A.statDisplay(u.stat, lvl[u.stat] + 1);
          const cost = A.runUpgradeCost(s, u.stat);
          r.cost.textContent = fmt(cost) + ' g';
          r.btn.disabled = s.econ.gold < cost;
        }
      }
      if (!$('#h-stats').classList.contains('hide')) refreshStats(s);
    }

    // ---------- in-game stats panel (chart button) ----------
    let boundMeta = null;
    function setMeta(m) { boundMeta = m; }
    function refreshStats(s) {
      const m = boundMeta || {};
      const coresRun = s.firstRun ? A.FIRST_PERM_COST : Math.max(1, Math.floor(s.econ.kills / 10) + (s.wave.maxWave || 0));
      const set = (id, v) => { const e = $('#st-' + id); if (e) e.textContent = v; };
      set('kills', fmt(s.econ.kills));
      set('foes', fmt(A.waveCount(s.wave.n)));
      set('mult', 'x' + (m.coreMult || 1));
      set('cores', fmt(m.cores || 0));
      set('run', fmt(coresRun));
    }
    function openStats(opts) {
      opts = opts || {};
      const exitBtn = opts.fromOverview ? '' : '<button class="exitrun" id="h-stats-exit">Exit run</button>';
      $('#h-statscard').innerHTML =
        '<div class="statshead"><h2>Run Stats</h2><button class="iconclose" id="h-stats-close" title="Close">' + icon('close', 18) + '</button></div>' +
        '<div class="statsbody">' +
        '<div class="strow"><span>Kills</span><b id="st-kills">0</b></div>' +
        '<div class="strow"><span>Foes per wave</span><b id="st-foes">0</b></div>' +
        '<div class="strow"><span>Core multiplier</span><b id="st-mult">x1</b></div>' +
        '<div class="strow"><span>Total cores</span><b id="st-cores">0</b></div>' +
        '<div class="strow"><span>Cores this run (so far)</span><b id="st-run">0</b></div>' +
        '</div>' + exitBtn;
      $('#h-stats-close').addEventListener('click', () => $('#h-stats').classList.add('hide')); // reveals game OR overview underneath
      const ex = $('#h-stats-exit');
      if (ex) ex.addEventListener('click', () => { $('#h-stats').classList.add('hide'); handlers.onExitRun && handlers.onExitRun(); });
      if (lastS) refreshStats(lastS);
      $('#h-stats').classList.remove('hide');
    }
    $('#h-chart').addEventListener('click', () => {
      const sw = $('#h-stats');
      if (sw.classList.contains('hide')) openStats(); else sw.classList.add('hide');
    });
    $('#h-stats').addEventListener('click', (e) => { if (e.target.id === 'h-stats') $('#h-stats').classList.add('hide'); });

    function showHint(html) { const g = $('#h-ghint'); g.innerHTML = html; g.classList.remove('hide'); }
    function hideHint() { $('#h-ghint').classList.add('hide'); }

    // ---------- DEV panel ----------
    $('#h-devtoggle').addEventListener('click', () => $('#h-devpanel').classList.toggle('hide'));
    $('#h-devpanel').querySelectorAll('[data-dev]').forEach((b) =>
      b.addEventListener('click', () => handlers.onDev && handlers.onDev(b.dataset.dev)));
    $('#h-devpanel').querySelectorAll('[data-ff]').forEach((b) =>
      b.addEventListener('click', () => handlers.onFF && handlers.onFF(+b.dataset.ff)));

    // ---------- MENU ----------
    const menuEl = $('#h-menu'), menuContent = $('#h-menu-content'), menuTabsEl = $('#h-menu-tabs');
    const tabbarEl = $('#h-tabbar'), topEl = $('#h-top');
    const modal = $('#h-modal'), modalInner = $('#h-modal-inner');
    const spot = $('#h-spot'), thought = $('#h-thought');
    const MENU_TABS = [
      { id: 'hero', icon: 'hero' }, { id: 'upgrades', icon: 'upgrades' },
      { id: 'cards', icon: 'cards', gated: true, unlock: 'Reach wave 30 to unlock Cards' }, // unlocks at wave 30
      { id: 'powers', icon: 'powers', locked: true, unlock: 'Powers unlock in Tier 2' },
      { id: 'prestige', icon: 'prestige', locked: true, unlock: 'Prestige unlocks in Tier 3' },
    ];
    let menuTab = 'hero', lastMeta = null, lastOpts = {};

    MENU_TABS.forEach((t) => {
      const b = document.createElement('button');
      b.dataset.mtab = t.id;
      if (t.locked) {                                                                          // permanently locked: show real icon + unlock tooltip on click
        b.innerHTML = icon(t.icon, 24);
        b.classList.add('locked');
        b.addEventListener('click', () => showUnlockTip(b, t.unlock));
      }
      else if (t.gated) {                                                                      // cards: unlock-gated
        b.innerHTML = icon(t.icon, 24);
        b.addEventListener('click', () => { if (A.cardsUnlocked(lastMeta)) { menuTab = t.id; modal.classList.add('hide'); renderMenu(); } else showUnlockTip(b, t.unlock); });
      } else {
        b.innerHTML = icon(t.icon, 24);
        b.addEventListener('click', () => { menuTab = t.id; modal.classList.add('hide'); renderMenu(); });
      }
      menuTabsEl.appendChild(b);
    });

    function drawAvatar(canvas, meta) {
      const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
      ctx.clearRect(0, 0, W, H);
      const total = sumPerm(meta);
      for (let i = 0; i < Math.min(total, 6); i++) {
        ctx.strokeStyle = 'rgba(74,168,255,' + (0.35 - i * 0.04) + ')';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 46 + i * 7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(74,168,255,.18)'; ctx.strokeStyle = '#4aa8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4aa8ff'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
    }

    function setSpotlight(show, targetEl, text) {
      if (!show || !targetEl) { spot.classList.add('hide'); thought.classList.add('hide'); return; }
      const r = targetEl.getBoundingClientRect();
      const pad = 3;
      spot.style.left = (r.left + pad) + 'px'; spot.style.top = (r.top + pad) + 'px';
      spot.style.width = (r.width - pad * 2) + 'px'; spot.style.height = (r.height - pad * 2) + 'px';
      spot.classList.remove('hide');
      thought.innerHTML = text;
      thought.style.top = (r.top - 10) + 'px';
      thought.classList.remove('hide');
      // clamp within the viewport, keeping the arrow over the target (same trick as the unlock tooltip)
      const margin = 8, w = thought.offsetWidth, center = r.left + r.width / 2;
      const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
      thought.style.left = left + 'px';
      thought.style.transform = 'translateY(-100%)';
      thought.style.setProperty('--arrow-x', (center - left) + 'px');
    }

    const lktip = $('#h-lktip'); let lktipTimer = null;
    function showUnlockTip(btn, text) {
      const r = btn.getBoundingClientRect();
      lktip.innerHTML = icon('lock', 13) + '<span>' + (text || 'Locked') + '</span>';
      lktip.style.top = (r.top - 6) + 'px';
      lktip.classList.remove('hide');
      // position by the tooltip's left edge (not center) so we can clamp it within the viewport
      const margin = 8, w = lktip.offsetWidth, center = r.left + r.width / 2;
      const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
      lktip.style.left = left + 'px';
      lktip.style.transform = 'translateY(-100%)';
      lktip.style.setProperty('--arrow-x', (center - left) + 'px'); // keep the arrow over the tab even when clamped
      clearTimeout(lktipTimer);
      lktipTimer = setTimeout(() => lktip.classList.add('hide'), 2600);
    }

    function permRowsHtml(meta, tutoring) {
      let html = '';
      A.permVisible(meta).forEach((up, i) => {
        const permLvl = (meta.perm && meta.perm[up.id]) || 0;
        const eff = A.CORE[up.stat].base + permLvl;
        const cur = A.statDisplay(up.stat, eff); // current effect (no increase shown)
        const cost = A.permCost(meta, up.id), afford = (meta.cores || 0) >= cost;
        const isTut = tutoring && i === 0 && permLvl === 0;
        html += '<button class="perm' + (isTut ? ' tut' : '') + '" data-perm="' + up.id + '"' + (afford ? '' : ' disabled') + '>' +
          '<span class="ptop">' + icon(STAT_ICON[up.stat] || 'burst', 18) + '<span class="pname">' + up.label + '</span></span>' +
          '<span class="pcur">' + cur + '</span>' +
          '<span class="pcost">' + cost + ' ' + cores(12) + '</span></button>';
      });
      return html;
    }

    function renderMilestones() {
      const meta = lastMeta, cl = meta.claimedMilestones || {}, best = meta.bestWave || 0;
      let html = '<button class="close" id="h-ms-close">' + icon('back', 16) + ' Back</button><h2>Milestones</h2>' +
        '<p class="msnote">Rewards for the furthest wave reached in Tier ' + (meta.tier || 1) + '.</p>' +
        '<div class="cores-chip">' + cores(15) + ' <b>' + (meta.cores || 0) + '</b></div>';
      for (const w of A.MILESTONES) {
        const reward = A.milestoneReward(w), claimed = !!cl[w], can = best >= w && !claimed;
        const cls = claimed ? 'ms claimed' : (can ? 'ms can' : 'ms locked');
        const right = claimed ? '<span class="tag">Claimed ' + icon('check', 14) + '</span>'
          : can ? '<button data-claim="' + w + '">Claim</button>'
            : '<span class="tag">' + icon('lock', 16) + '</span>';
        html += '<div class="' + cls + '"><span class="mw">Wave ' + w.toLocaleString() + '</span>' +
          '<span class="mr">+' + reward.toLocaleString() + ' ' + cores(13) + '</span>' + right + '</div>';
      }
      modalInner.innerHTML = html;
      $('#h-ms-close').addEventListener('click', () => { modal.classList.add('hide'); renderMenu(); });
      modalInner.querySelectorAll('[data-claim]').forEach((b) =>
        b.addEventListener('click', () => { if (handlers.onClaimMilestone && handlers.onClaimMilestone(+b.dataset.claim)) renderMilestones(); }));
    }

    function renderMenu() {
      const meta = lastMeta, opts = lastOpts, tutoring = sumPerm(meta) === 0;
      const totalStars = (meta.cards || []).reduce((a, c) => a + (c.stars || 0), 0);
      [...menuTabsEl.children].forEach((b) => {
        b.classList.toggle('on', b.dataset.mtab === menuTab);
        b.classList.toggle('tut', tutoring && b.dataset.mtab === 'upgrades' && menuTab !== 'upgrades');
        b.classList.toggle('tut-off', tutoring && b.dataset.mtab !== 'upgrades'); // tutorial: only the upgrades tab stays clickable
        if (b.dataset.mtab === 'cards') {
          const u = A.cardsUnlocked(meta); b.classList.toggle('locked', !u); // keep the card icon even while locked (just dimmed)
          b.innerHTML = icon('cards', 24) +
            (u && totalStars > 0 ? '<span class="tabbadge br">' + totalStars + icon('star', 11, 'gold') + '</span>' : '');
        }
      });
      menuContent.className = 'menu-content tab-' + menuTab + (tutoring && menuTab === 'hero' ? ' tut-block' : '');
      let html = '';
      if (menuTab === 'hero') {
        if (opts.earn) html += '<div class="earncard"><div class="el">Last run</div>' +
          '<div class="ev">+' + opts.earn.cores + ' ' + cores(16) + '</div>' +
          '<div class="es">' + opts.earn.kills + ' kills / wave ' + opts.earn.wave + '</div></div>';
        const curChips = CURRENCIES.map((c) => '<span class="chip">' + icon(c.icon, 13, c.cls) + ' <b>' + (meta[c.key] || 0) + '</b></span>').join('');
        html += '<div class="chips">' +
          '<span class="chip">' + icon('tier', 13) + ' <b>' + (meta.tier || 1) + '</b></span>' +
          '<span class="chip">' + cores(13) + ' <b>x' + (meta.coreMult || 1) + '</b></span>' +
          curChips +
          '<span class="chip">' + icon('best', 13) + ' <b>wave ' + (meta.bestWave || 0) + '</b></span></div>';
        html += '<div class="avatar-frame"><canvas id="h-avatar" width="200" height="200"></canvas></div>';
        const claim = A.claimableCount(meta);
        html += '<button class="msbtn" id="h-ms">Milestones' + (claim > 0 ? '<span class="badge">' + claim + '</span>' : '') + '</button>';
        html += '<button class="startsq" id="h-start">' + icon('play', 35, 'green') + '</button>';
      } else if (menuTab === 'upgrades') {
        html += '<div class="cores-chip">' + cores(15) + ' <b>' + (meta.cores || 0) + '</b></div>';
        html += '<div class="permlist">' + permRowsHtml(meta, tutoring) + '</div>';
      } else if (menuTab === 'cards') {
        if (!A.cardsUnlocked(meta)) {
          html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Reach wave 30 to unlock cards</div></div>';
        } else {
          const owned = meta.cards || [];
          html += '<div class="cores-chip">' + icon('token', 15, 'token') + ' <b>' + (meta.tokens || 0) + '</b></div>';
          const bc = A.buyCardCost(meta), uc = A.upgradeCost(meta);
          html += '<div class="cardbtns">' +
            '<button class="cardbtn" id="h-buycard" title="Buy card"' + ((meta.tokens || 0) < bc ? ' disabled' : '') + '>' + icon('cards', 26) + '<span class="ct">' + bc + ' ' + icon('token', 14, 'token') + '</span></button>' +
            '<button class="cardbtn" id="h-upcard" title="Add star"' + (((meta.tokens || 0) < uc || !owned.length) ? ' disabled' : '') + '>' + icon('star', 26, 'gold') + '<span class="ct">' + uc + ' ' + icon('token', 14, 'token') + '</span></button>' +
            '</div>';
          html += '<div class="cardgrid">' + cardGridHtml(meta) + '</div>';
        }
      } else {
        html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Unlocks later</div></div>';
      }
      menuContent.innerHTML = html;

      if (menuTab === 'hero') {
        drawAvatar($('#h-avatar'), meta);
        $('#h-ms').addEventListener('click', () => { renderMilestones(); modal.classList.remove('hide'); setSpotlight(false); });
        $('#h-start').addEventListener('click', () => handlers.onStartRun && handlers.onStartRun());
      } else if (menuTab === 'upgrades') {
        menuContent.querySelectorAll('[data-perm]').forEach((b) =>
          b.addEventListener('click', () => { if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm)) renderMenu(); }));
      } else if (menuTab === 'cards') {
        const bb = $('#h-buycard'); if (bb) bb.addEventListener('click', () => { if (handlers.onBuyCard && handlers.onBuyCard()) renderMenu(); });
        const ub = $('#h-upcard'); if (ub) ub.addEventListener('click', () => { if (handlers.onUpgradeCard && handlers.onUpgradeCard()) renderMenu(); });
        menuContent.querySelectorAll('.card[data-card]').forEach((el) => attachLongPress(el, () => openCardModal(el.dataset.card)));
      }
      // tutorial spotlight: hero step points at the upgrades tab, upgrades step points at the upgrade button
      let spotTarget = null, spotText = '';
      if (tutoring && modal.classList.contains('hide')) {
        if (menuTab === 'hero') { spotTarget = menuTabsEl.querySelector('[data-mtab="upgrades"]'); spotText = 'Spend your ' + cores(15) + ' here'; }
        else if (menuTab === 'upgrades') { spotTarget = menuContent.querySelector('.perm.tut'); spotText = 'Buy this to grow stronger, more unlock after'; }
      }
      requestAnimationFrame(() => setSpotlight(!!spotTarget, spotTarget, spotText));
    }

    function showMenu(meta, opts) {
      lastMeta = meta; lastOpts = opts || {}; menuTab = 'hero'; modal.classList.add('hide');
      renderMenu();
      menuEl.classList.add('show');
      tabbarEl.style.display = 'none'; topEl.style.display = 'none';
    }
    function refreshMenu(meta) { if (meta) lastMeta = meta; if (menuEl.classList.contains('show')) renderMenu(); }
    function hideMenu() { menuEl.classList.remove('show'); setSpotlight(false); tabbarEl.style.display = ''; topEl.style.display = ''; }

    // ---------- game-over OVERVIEW (shown after the death animation; closes to the Workshop) ----------
    const overEl = $('#h-over'), overCard = $('#h-over-card');
    function showOverview(meta, earn) {
      lastMeta = meta; const e = earn || {};
      $('#h-stats').classList.add('hide'); // start clean; Run Stats opens on top of this
      let rew = '<div class="rew"><span>Cores</span><b>+' + (e.cores || 0) + ' ' + cores(16) + '</b></div>';
      if (e.tokens) rew += '<div class="rew"><span>Tokens</span><b>+' + e.tokens + ' ' + icon('token', 15, 'token') + '</b></div>';
      overCard.innerHTML =
        '<div class="statshead"><h2>Run Over</h2><button class="iconclose" id="h-over-close" title="Workshop">' + icon('close', 18) + '</button></div>' +
        '<div class="over-rewards">' + rew + '</div>' +
        '<div class="over-sub">' + (e.kills || 0) + ' kills · wave ' + (e.wave || 0) + '</div>' +
        '<button class="over-stats" id="h-over-stats">' + icon('chart', 16) + ' Run Stats</button>';
      $('#h-over-close').addEventListener('click', () => handlers.onToWorkshop && handlers.onToWorkshop());
      $('#h-over-stats').addEventListener('click', () => openStats({ fromOverview: true }));
      overEl.classList.remove('hide');
      tabbarEl.style.display = 'none'; topEl.style.display = 'none';
    }
    function hideOverview() { overEl.classList.add('hide'); $('#h-stats').classList.add('hide'); }

    // reflect a dev toggle's state on its button label/active style
    function setDevToggle(kind, on) {
      const b = $('#h-dev-' + kind);
      if (!b) return;
      b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1) + ': ' + (on ? 'on' : 'off');
      b.classList.toggle('on', !!on);
    }

    return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, setMeta, setDevToggle, root };
  };
})(window.ARENA = window.ARENA || {});
