/* hud/hud.js — in-game HUD (top stats + 3-tab upgrade bar), the between-games MENU
   (5 bottom tabs; Hero tab with chips/earnings/milestones/square Start; Upgrades tab),
   a spotlight tutorial, a milestones modal, and a DEV panel.
   Handlers: onBuyRun, onBuyPerm, onClaimMilestone, onStartRun, onDev, onFF. */
(function (A) {
  // The HUD is a single themeable core: identical structure + wiring for every theme, restyled
  // by a scoping class (`theme.cls`) + an injected override stylesheet (`theme.css`). `A.Hud`
  // (Classic) passes no theme, so it renders + behaves exactly as before and stays the safe
  // synchronous fallback. `A.createThemedHud(theme)` produces D&D / Arcade skins from the same core.
  function buildHud(root, handlers, theme) {
    handlers = handlers || {};
    theme = theme || {};
    root.className = 'hud' + (theme.cls ? ' ' + theme.cls : '');

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
      coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2a3 3 0 0 0-2.5-1.2c-1.7 0-2.6 1-2.6 2 0 2.6 5.2 1.3 5.2 4 0 1.1-1 2-2.6 2a3 3 0 0 1-2.5-1.2M12 6.3v11.4"/>',
      burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3.4 3.4M18.8 5.2l-3.4 3.4M5.2 18.8l3.4-3.4M18.8 18.8l-3.4-3.4"/>',
      bow: '<path d="M8 3a10 10 0 0 1 0 18"/><path d="M8 3v18"/><path d="M5 12h13"/><path d="M15 9l3 3-3 3"/><path d="M5 12l2.5-2M5 12l2.5 2"/>',
      bullseye: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
      star: '<path d="M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z"/>',
      rate: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5"/><path d="M10 3h4M12 3v3"/>',
      heart: '<path d="M12 20s-6.5-4.3-6.5-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 6.5 2.7c0 5-6.5 9.3-6.5 9.3z"/>',
      regen: '<path d="M10 19s-4.8-3.2-4.8-6.7A2.6 2.6 0 0 1 10 10 2.6 2.6 0 0 1 14.8 12.3C14.8 15.8 10 19 10 19z"/><path d="M14 8.4A2.6 2.6 0 0 1 19 10.7c0 2.4-1.9 4.3-3.2 5.5"/>',
      powers: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
      prestige: '<path d="M5 18h14"/><path d="M5 18l-1-9 4 3 4-7 4 7 4-3-1 9z"/>',
      flask: '<path d="M9 3h6"/><path d="M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/>',
      cell: '<path d="M12 2l8 6v8l-8 6-8-6V8z"/><path d="M12 8v8M8 10v4M16 10v4"/>',
      tier: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
      sword: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      coins: '<path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
      ruler: '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="M7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
      range: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>',
      crit: '<path d="M12 3l1.6 5.4 5.4 1.6-5.4 1.6L12 21l-1.6-5.4L5 14l5.4-1.6z"/>',
      dodge: '<path d="M3 8h11a3 3 0 1 1-3 3M3 12h15a3 3 0 1 0-3-3M3 16h9"/>',
      fwd: '<path d="M9 5l7 7-7 7"/>',
      gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      gallery: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    };
    function icon(name, size, cls) {
      size = size || 16;
      return '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        PATHS[name] + '</svg>';
    }
    const cores = (size) => icon('cores', size || 14, 'core');

    root.innerHTML =
      // Fixed header: game info on the left, a single menu toggle pinned right. No wrapping, so
      // the layout is identical on every device and across themes (whose fonts have varying widths).
      '<div class="topbar" id="h-top">' +
      '  <div class="stat wave"><span class="lbl">Wave</span><b id="h-wave">1</b></div>' +
      '  <div class="stat hp"><span class="hpbar">' +
      '<span class="hptrail" id="h-hptrail"></span>' +
      '<span class="hpclip" id="h-hpclip"><i class="hpfill"></i></span>' +
      '<span class="hpheart">' + icon('heart', 11) + '</span>' +
      '<b class="hpnum" id="h-hp">1</b>' +
      '</span></div>' +
      '  <div class="stat gold">' + icon('coin', 15, 'gold') + '<b id="h-gold">0</b></div>' +
      '  <button class="iconbtn menutoggle" id="h-menu-btn" title="Menu">' + icon('menu', 22) + '</button>' +
      '</div>' +
      // Persistent side menu: a narrow, one-icon-wide rail that opens from the menu toggle and stays
      // open (game interactions never auto-dismiss it). It is only as tall as its content, so it stays
      // unintrusive — each icon opens a self-dismissing modal instead of a big always-on panel.
      '<aside class="sidemenu" id="h-sidemenu">' +
      '  <button class="sideitem" id="h-set" title="Settings">' + icon('gear', 20) + '</button>' +
      '  <button class="sideitem" id="h-chart" title="Run Stats">' + icon('chart', 20) + '</button>' +
      '  <a class="sideitem protolink" id="h-proto" href="huds/_prototype-hud-gallery.html" target="_blank" rel="noopener" title="Designs">' + icon('gallery', 20) + '</a>' +
      '</aside>' +
      '<div class="wavebar" id="h-wavebar" title="Next wave"><i id="h-wavefill"></i></div>' +
      '<div class="statswrap hide" id="h-stats"><div class="statscard" id="h-statscard"></div></div>' +
      '<div class="ghint hide" id="h-ghint"></div>' +
      '<div class="tabbar" id="h-tabbar"><div id="h-tabcontent"></div><div class="tabs" id="h-tabs"></div></div>' +
      '<div class="menu" id="h-menu">' +
      '  <a class="menuproto" id="h-menuproto" href="huds/_prototype-hud-gallery.html" target="_blank" rel="noopener" title="HUD design prototypes">' + icon('gallery', 20) + '<span>Designs</span></a>' +
      '  <button class="menugear" id="h-menugear" title="Settings">' + icon('gear', 22) + '</button>' +
      '  <div class="menu-content" id="h-menu-content"></div>' +
      '  <div class="menutabs" id="h-menu-tabs"></div>' +
      '  <div class="modal hide" id="h-modal"><div class="modal-inner" id="h-modal-inner"></div></div>' +
      '</div>' +
      '<div class="setmodal hide" id="h-setmodal"><div class="setmodal-inner" id="h-setmodal-inner"></div></div>' +
      '<div class="over hide" id="h-over"><div class="over-card" id="h-over-card"></div></div>' +
      '<div class="tut-dim hide" id="h-spot"></div><div class="tut-thought hide" id="h-thought"></div>' +
      '<div class="lk-tip hide" id="h-lktip"></div>';
    // NOTE: the DEV panel was lifted out to hud/devmenu.js (host-level) so it survives HUD swaps.

    // A themed skin ships its OWN override stylesheet, injected here (inside root, so the host's
    // root.innerHTML='' on swap removes it cleanly). Scoped to `.hud.<theme.cls>`, it out-specifies
    // the base hud.css without touching it. Classic passes no theme → no extra style, no scope class.
    if (theme.css) root.insertAdjacentHTML('afterbegin', '<style class="theme-style">' + theme.css + '</style>');

    const $ = (id) => root.querySelector(id);
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);
    // Compact readout that stays within ~7 chars: full dotted thousands under 1e6,
    // then a suffix per 1000x (m, b, t, q ...). e.g. 937983 → "937.983", 1.423e6 → "1.423m".
    const SUF = [[1e15, 'q'], [1e12, 't'], [1e9, 'b'], [1e6, 'm']];
    const abbr = (n) => {
      n = Math.floor(n || 0);
      if (n < 1000) return String(n);
      if (n < 1e6) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      for (const [v, s] of SUF) {
        if (n >= v) { const m = n / v; return (m < 10 ? m.toFixed(3) : m < 100 ? m.toFixed(2) : m.toFixed(1)) + s; }
      }
    };
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
    const STAT_ICON = { rangedDamage: 'bow', attackSpeed: 'rate', health: 'heart', regen: 'regen',
      critChance: 'crit', critDamage: 'burst', dodge: 'dodge', coins: 'coin',
      thorns: 'shield', msChance: 'bow', bounceChance: 'arrow', rendMult: 'burst', range: 'range', interest: 'coin' };
    const STAT_LABEL = { rangedDamage: 'Ranged', attackSpeed: 'Speed', health: 'Health', regen: 'Regen',
      critChance: 'Crit', critDamage: 'Crit Dmg', dodge: 'Dodge', coins: 'Coins',
      thorns: 'Thorns', msChance: 'Multishot', bounceChance: 'Bounce', rendMult: 'Rend', range: 'Range', interest: 'Interest' };
    const upIcon = (id) => (A.UP_BY_ID[id] && A.UP_BY_ID[id].icon) || 'burst';
    // currencies shown on the Hero screen — add a row here (+ a meta field) for future currencies
    const CURRENCIES = [{ key: 'cores', icon: 'cores', cls: 'core' }, { key: 'tokens', icon: 'token', cls: 'token' }, { key: 'cells', icon: 'cell', cls: 'cell' }];
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
          '<span class="cl">' + (STAT_LABEL[e.stat] || e.stat) + '</span><b>' + (def.fmt ? def.fmt(v) : '+' + v) + '</b></span>';
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
          (STAT_LABEL[e0.stat] || e0.stat) + ' <b>' + (def.fmt ? def.fmt(def.value(s)) : '+' + def.value(s)) + '</b></span></div>';
      }
      $('#h-cardmodal-inner').innerHTML = '<div class="cmhead" style="color:' + def.tint + '">' + icon(def.art, 32) + '</div>' + rows;
      $('#h-cardmodal').classList.remove('hide');
    }

    // ---------- in-game tab bar (3 icon subtabs: attack / defense / economic) ----------
    const tabsEl = $('#h-tabs'), contentEl = $('#h-tabcontent');
    const rowEls = {};
    let activeTab = A.TAB_DEFS[0].id, tabOpen = false, taughtTabs = false; // collapsed by default
    A.TAB_DEFS.forEach((tab) => {
      const b = document.createElement('button');
      b.innerHTML = icon(tab.icon, 22); b.dataset.tab = tab.id; b.title = tab.id;
      b.addEventListener('click', () => {
        if (tabOpen && activeTab === tab.id) tabOpen = false;        // click active = close
        else { activeTab = tab.id; tabOpen = true; }                 // open / switch
        taughtTabs = true; $('#h-tabbar').classList.remove('pulse'); // opening a tab dismisses the upgrade hint
        renderTabButtons(); renderTabContent();
      });
      tabsEl.appendChild(b);
    });
    function renderTabButtons() { [...tabsEl.children].forEach((b) => b.classList.toggle('on', tabOpen && b.dataset.tab === activeTab)); }
    function renderTabContent() {
      const tabDef = A.TAB_DEFS.find((t) => t.id === activeTab);
      const locked = tabDef.gated && lastS && !A.economyUnlocked(lastS.meta);
      contentEl.innerHTML = ''; for (const k in rowEls) delete rowEls[k];
      contentEl.className = 'tabcontent' + (tabOpen ? '' : ' collapsed');
      if (!tabOpen) return;
      if (locked) { contentEl.innerHTML = '<div class="tablock">' + icon('lock', 18) + '<span>Economic upgrades unlock in Tier 2</span></div>'; return; }
      for (const u of A.upgradesIn(activeTab)) {
        const btn = document.createElement('button');
        btn.className = 'up';
        btn.innerHTML = '<span class="nm">' + icon(u.icon, 14) + ' ' + u.label + '</span>' +
          '<span class="delta"><span class="cur"></span> ' + icon('arrow', 12) + ' <span class="nxt"></span></span><span class="cost"></span>';
        btn.addEventListener('click', () => {
          if (!lastS || A.runAtMax(lastS, u.id)) return;
          if (lastS.econ.gold < A.runUpgradeCost(lastS, u.id)) { shake(root.querySelector('.stat.gold')); return; }
          handlers.onBuyRun && handlers.onBuyRun(u.id);
        });
        contentEl.appendChild(btn);
        rowEls[u.id] = { btn, cur: btn.querySelector('.cur'), nxt: btn.querySelector('.nxt'), cost: btn.querySelector('.cost') };
      }
    }
    renderTabContent();

    let lastS = null;
    // brief shake to signal "can't afford" on a currency indicator
    function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    function update(s) {
      lastS = s;
      $('#h-wave').textContent = s.wave.n;
      $('#h-hp').textContent = abbr(Math.ceil(s.hero.hp)) + '/' + abbr(Math.ceil(s.hero.hpMax));
      $('#h-gold').textContent = abbr(s.econ.gold);
      // HP bar: a red→green gradient revealed by clipping to the current fraction (mirrors
      // the enemy bars), with a translucent "damage trail" that drains a beat behind each
      // hit and a low-HP danger pulse. The value lives inside the bar.
      const hpf = s.hero.hpMax > 0 ? Math.max(0, Math.min(1, s.hero.hp / s.hero.hpMax)) : 0;
      const hpPct = (hpf * 100) + '%';
      $('#h-hpclip').style.width = hpPct;
      $('#h-hptrail').style.width = hpPct;
      $('.stat.hp').classList.toggle('low', hpf > 0 && hpf <= 0.3);
      // wave countdown bar (hidden during the scripted first run, which has no wave clock)
      const wbar = $('#h-wavebar');
      if (s.firstRun) wbar.style.display = 'none';
      else {
        const effInt = A.WAVE.interval - (A.UP_BY_ID.waveCut ? A.UP_BY_ID.waveCut.value(A.boughtOf(s, 'waveCut')) : 0);
        wbar.style.display = ''; $('#h-wavefill').style.height = (Math.max(0, Math.min(1, s.wave.clock / effInt)) * 100) + '%';
      }
      // teach mid-run upgrades: pulse the tab bar the first time gold can afford any upgrade
      if (!taughtTabs && !s.firstRun && !tabOpen) {
        let min = Infinity;
        for (const u of A.UPGRADES) {
          if ((u.gated && !A.economyUnlocked(s.meta)) || A.runAtMax(s, u.id)) continue;
          min = Math.min(min, A.runUpgradeCost(s, u.id));
        }
        $('#h-tabbar').classList.toggle('pulse', s.econ.gold >= min);
      }
      if (tabOpen) {
        for (const u of A.upgradesIn(activeTab)) {
          const r = rowEls[u.id]; if (!r) continue;
          const bought = A.boughtOf(s, u.id);
          r.cur.textContent = u.fmt(bought);
          if (A.runAtMax(s, u.id)) {
            r.nxt.textContent = ''; r.cost.textContent = 'MAX'; r.btn.classList.add('cant');
          } else {
            r.nxt.textContent = u.fmt(Math.min(u.max, bought + 1));
            const cost = A.runUpgradeCost(s, u.id);
            r.cost.textContent = fmt(cost) + ' g';
            r.btn.classList.toggle('cant', s.econ.gold < cost);
          }
        }
      }
      if (!$('#h-stats').classList.contains('hide')) refreshStats(s);
    }

    // ---------- in-game stats panel (chart button) ----------
    let boundMeta = null;
    function setMeta(m) { boundMeta = m; }
    function refreshStats(s) {
      const m = boundMeta || {}, tier = m.tier || 1;
      const coresRun = s.firstRun ? A.FIRST_PERM_COST : Math.max(1, Math.round(((Math.floor(s.econ.kills / 10) + (s.wave.maxWave || 0)) + (s.econ.bonusCores || 0)) * A.coreMult(tier)));
      const set = (id, v) => { const e = $('#st-' + id); if (e) e.textContent = v; };
      set('kills', fmt(s.econ.kills));
      set('foes', fmt(A.waveCount(s.wave.n * (s.difficultyMult || 1))));
      set('mult', 'x' + A.coreMult(tier).toFixed(1));
      set('cores', fmt(m.cores || 0));
      set('run', fmt(coresRun));
    }
    function openStats() {
      $('#h-statscard').innerHTML =
        '<div class="statshead"><h2>Run Stats</h2><button class="iconclose" id="h-stats-close" title="Close">' + icon('close', 18) + '</button></div>' +
        '<div class="statsbody">' +
        '<div class="strow"><span>Kills</span><b id="st-kills">0</b></div>' +
        '<div class="strow"><span>Foes per wave</span><b id="st-foes">0</b></div>' +
        '<div class="strow"><span>Core multiplier</span><b id="st-mult">x1</b></div>' +
        '<div class="strow"><span>Total cores</span><b id="st-cores">0</b></div>' +
        '<div class="strow"><span>Cores this run (so far)</span><b id="st-run">0</b></div>' +
        '</div><button class="exitrun" id="h-stats-exit">Exit run</button>';
      $('#h-stats-close').addEventListener('click', () => $('#h-stats').classList.add('hide'));
      $('#h-stats-exit').addEventListener('click', () => { $('#h-stats').classList.add('hide'); handlers.onExitRun && handlers.onExitRun(); });
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

    // ---------- settings modal (visual indicators; the object is shared with the renderer) ----------
    const settings = handlers.settings || {};
    const SETTINGS_DEF = [
      { key: 'goldOnKill', label: 'Gold on kill', icon: 'coin', cls: 'gold' },
      { key: 'coreOnKill', label: 'Cores on kill', icon: 'cores', cls: 'core' },
      { key: 'enemyHp', label: 'Enemy health bars', icon: 'heart', cls: 'hp' },
      { key: 'damageNumbers', label: 'Damage numbers', icon: 'burst' },
    ];
    const setmodal = $('#h-setmodal'), setmodalInner = $('#h-setmodal-inner');
    // Toggle rows are built from one source, reused by the in-game side-rail gear and the
    // between-games menu gear (both open the same centered modal, mutating the shared `settings`).
    const settingsRowsHtml = () => SETTINGS_DEF.map((o) =>
      '<button class="setrow' + (settings[o.key] ? ' on' : '') + '" data-set="' + o.key + '">' +
      '<span class="sl">' + icon(o.icon, 16, o.cls || '') + '<span>' + o.label + '</span></span>' +
      '<span class="switch"><i></i></span></button>').join('');
    const wireSettingsRows = (el) => el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.set; settings[k] = !settings[k];
      b.classList.toggle('on', settings[k]);
      handlers.onSaveSettings && handlers.onSaveSettings();
    }));
    function openSettings() {
      setmodalInner.innerHTML = '<div class="statshead"><h2>Settings</h2><button class="iconclose" id="h-set-close" title="Close">' +
        icon('close', 18) + '</button></div><div class="setbody">' + settingsRowsHtml() + '</div>';
      $('#h-set-close').addEventListener('click', () => setmodal.classList.add('hide'));
      wireSettingsRows(setmodalInner);
      setmodal.classList.remove('hide');
    }
    setmodal.addEventListener('click', (e) => { if (e.target === setmodal) setmodal.classList.add('hide'); });
    $('#h-menugear').addEventListener('click', openSettings);

    // ---------- side menu: a narrow icon rail, toggled by the header button; no auto-dismiss ----------
    // Each rail icon opens a self-dismissing modal (Settings) or panel (Run Stats), so the unintrusive
    // rail can stay open without a big panel hogging the screen.
    const sidemenu = $('#h-sidemenu');
    $('#h-menu-btn').addEventListener('click', () => sidemenu.classList.toggle('open'));
    $('#h-set').addEventListener('click', openSettings);

    // ---------- MENU ----------
    const menuEl = $('#h-menu'), menuContent = $('#h-menu-content'), menuTabsEl = $('#h-menu-tabs');
    const tabbarEl = $('#h-tabbar'), topEl = $('#h-top');
    const modal = $('#h-modal'), modalInner = $('#h-modal-inner');
    const spot = $('#h-spot'), thought = $('#h-thought');
    const MENU_TABS = [
      { id: 'hero', icon: 'hero' }, { id: 'upgrades', icon: 'upgrades' },
      { id: 'cards', icon: 'cards', gated: true, unlockFn: (m) => A.cardsUnlocked(m), unlock: 'Reach wave 30 to unlock Cards' }, // unlocks at wave 30
      { id: 'labs', icon: 'flask', gated: true, unlockFn: (m) => A.labsTabUnlocked(m), unlock: 'Reach wave 30 to unlock Labs' }, // research: caps + scaling
      { id: 'prestige', icon: 'prestige', locked: true, unlock: 'Prestige unlocks in Tier 3' },
    ];
    let menuTab = 'hero', menuUpTab = 'attack', menuLabCat = 'attack', lastMeta = null, lastOpts = {}; // menuUpTab/menuLabCat = active subtab

    MENU_TABS.forEach((t) => {
      const b = document.createElement('button');
      b.dataset.mtab = t.id;
      if (t.locked) {                                                                          // permanently locked: show real icon + unlock tooltip on click
        b.innerHTML = icon(t.icon, 24);
        b.classList.add('locked');
        b.addEventListener('click', () => showUnlockTip(b, t.unlock));
      }
      else if (t.gated) {                                                                      // unlock-gated (cards, labs)
        b.innerHTML = icon(t.icon, 24);
        b.addEventListener('click', () => { if (t.unlockFn(lastMeta)) { menuTab = t.id; modal.classList.add('hide'); renderMenu(); } else showUnlockTip(b, t.unlock); });
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
      A.upgradesIn(menuUpTab).forEach((up, i) => {
        const bought = A.permBought(meta, up.id);
        const cur = up.fmt(bought); // current effect (no increase shown)
        const maxed = A.permAtMax(meta, up.id);
        const cost = A.permCost(meta, up.id), afford = (meta.cores || 0) >= cost;
        // tutorial highlight: the very first attack upgrade, while nothing is owned yet
        const isTut = tutoring && menuUpTab === 'attack' && i === 0 && bought === 0;
        html += '<button class="perm' + (isTut ? ' tut' : '') + ((afford && !maxed) ? '' : ' cant') + '" data-perm="' + up.id + '"' + (maxed ? ' disabled' : '') + '>' +
          '<span class="ptop">' + icon(up.icon, 18) + '<span class="pname">' + up.label + '</span></span>' +
          '<span class="pcur">' + cur + '</span>' +
          '<span class="pcost">' + (maxed ? 'MAX' : cost + ' ' + cores(12)) + '</span></button>';
      });
      return html;
    }

    const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    // compact wall-clock duration: 45s / 12m / 3.2h / 1.4d
    function fmtTime(sec) {
      sec = Math.ceil(sec);
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.round(sec / 60) + 'm';
      if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
      return (sec / 86400).toFixed(1) + 'd';
    }
    // what a lab currently grants at level `lv` (UI flavour over the neutral sim numbers)
    function labEffectDesc(L, lv) {
      if (L.kind === 'cap') return lv > 0 ? '+' + abbr(L.per * lv) + ' cap' : '+' + abbr(L.per) + ' cap / lvl';
      if (L.kind === 'scale') return '×' + (1 + L.per * lv).toFixed(2);
      if (L.target === 'gameSpeed') return '×' + (1 + L.per * lv).toFixed(1) + ' speed';
      if (L.target === 'labTime') return '-' + Math.round(Math.min(0.5, L.per * lv) * 100) + '% time';
      return '';
    }
    const LAB_CAT_ICON = { attack: 'sword', defense: 'shield', utility: 'coins' };
    function labRowsHtml(meta) {
      const now = Date.now();
      let h = '';
      for (const L of A.labsIn(menuLabCat)) {
        const lv = A.labLevel(meta, L.id), maxed = A.labAtMax(meta, L.id);
        const unlocked = A.labUnlocked(meta, L.id), researching = !!A.researchOf(meta, L.id);
        let right;
        if (researching) {
          const prog = A.researchProgress(meta, L.id, now), rem = A.researchRemaining(meta, L.id, now);
          const rc = A.rushCellCost(meta, L.id, now), canRush = (meta.cells || 0) >= rc;
          right = '<span class="labprog"><span class="mbar"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></span>' +
            '<button class="rushlab' + (canRush ? '' : ' cant') + '" data-rushlab="' + L.id + '" title="Rush with cells">' + rc + ' ' + icon('cell', 11, 'cell') + '</button>' +
            '<button class="cancellab" data-cancellab="' + L.id + '">' + fmtTime(rem) + ' ' + icon('close', 11) + '</button></span>';
        } else if (!unlocked) {
          right = '<span class="pcost">' + icon('lock', 12) + ' wave ' + L.gate.wave + '</span>';
        } else if (maxed) {
          right = '<span class="pcost">MAX</span>';
        } else {
          const cost = A.labCoinCost(meta, L.id), t = A.labTimeSec(meta, L.id);
          const can = (meta.cores || 0) >= cost && A.freeSlots(meta) > 0;
          right = '<button class="reslab' + (can ? '' : ' cant') + '" data-startlab="' + L.id + '">' +
            cost + ' ' + cores(12) + ' · ' + fmtTime(t) + '</button>';
        }
        h += '<div class="lab' + (researching ? ' active' : '') + (unlocked ? '' : ' locked') + '">' +
          '<span class="ptop">' + icon(LAB_CAT_ICON[L.cat], 18) + '<span class="pname">' + L.label + '</span>' +
          '<span class="lablv">' + lv + '/' + L.max + '</span></span>' +
          '<span class="pcur">' + labEffectDesc(L, lv) + '</span>' + right + '</div>';
      }
      return h;
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
        if (b.dataset.mtab === 'labs') {
          const u = A.labsTabUnlocked(meta); b.classList.toggle('locked', !u);
          const active = (meta.research || []).length;
          b.innerHTML = icon('flask', 24) + (u && active ? '<span class="tabbadge br">' + active + '</span>' : '');
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
          curChips +
          '<span class="chip">' + icon('best', 13) + ' <b>wave ' + (meta.bestWave || 0) + '</b></span></div>';
        // 15-minute check-in: the sole source of cells & card currency
        const pend = A.checkInPending(meta, Date.now());
        if (pend > 0) {
          html += '<button class="checkin ready" id="h-checkin">' + icon('cell', 14, 'cell') + ' Check In  +' + (pend * A.CHECKIN_CELLS) +
            ' ' + icon('cell', 12, 'cell') + '  +' + (pend * A.CHECKIN_TOKENS) + ' ' + icon('token', 12, 'token') + '</button>';
        } else {
          html += '<button class="checkin" id="h-checkin" disabled>Next reward in ' + mmss(A.checkInNextMs(meta, Date.now())) + '</button>';
        }
        html += '<div class="avatar-frame"><canvas id="h-avatar" width="200" height="200"></canvas></div>';
        const claim = A.claimableCount(meta);
        html += '<button class="msbtn" id="h-ms">Milestones' + (claim > 0 ? '<span class="badge">' + claim + '</span>' : '') + '</button>';
        const tier = meta.tier || 1, canUp = tier < A.MAX_TIER && A.tierUnlocked(meta, tier + 1);
        html += '<div class="tiersel">' +
          '<button class="tierstep' + (tier > 1 ? '' : ' invisible') + '" id="h-tier-down"' + (tier > 1 ? '' : ' disabled') + '>' + icon('back', 18) + '</button>' +
          '<span class="tierlabel"><span class="tl-tier">' + icon('tier', 14) + ' Tier ' + tier + '</span>' +
          '<span class="tl-core">' + cores(12) + ' <b>x' + A.coreMult(tier).toFixed(1) + '</b></span></span>' +
          '<button class="tierstep' + (canUp ? '' : ' locked') + '" id="h-tier-up">' + icon('fwd', 18) + '</button>' +
          '</div>';
        html += '<button class="startsq" id="h-start">' + icon('play', 35, 'green') + '</button>';
      } else if (menuTab === 'upgrades') {
        html += '<div class="cores-chip">' + cores(15) + ' <b>' + (meta.cores || 0) + '</b></div>';
        const ecoOk = A.economyUnlocked(meta);
        html += '<div class="subtabs" id="h-uptabs">';
        for (const t of A.TAB_DEFS) {
          const lk = t.gated && !ecoOk;
          html += '<button class="subtab' + (t.id === menuUpTab ? ' on' : '') + (lk ? ' locked' : '') + '" data-uptab="' + t.id + '" title="' + t.id + '">' +
            icon(t.icon, 22) + (lk ? icon('lock', 11, 'lk') : '') + '</button>';
        }
        html += '</div>';
        if (menuUpTab === 'economic' && !ecoOk) {
          html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Economic upgrades unlock in Tier 2</div></div>';
        } else {
          html += '<div class="permlist">' + permRowsHtml(meta, tutoring) + '</div>';
        }
      } else if (menuTab === 'cards') {
        if (!A.cardsUnlocked(meta)) {
          html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Reach wave 30 to unlock cards</div></div>';
        } else {
          const owned = meta.cards || [];
          const bc = A.buyCardCost(meta), uc = A.upgradeCost(meta);
          html += '<div class="cardbtns">' +
            '<button class="cardbtn' + ((meta.tokens || 0) < bc ? ' cant' : '') + '" id="h-buycard" title="Buy card">' + icon('cards', 26) + '</button>' +
            '<button class="cardbtn' + ((meta.tokens || 0) < uc ? ' cant' : '') + '" id="h-upcard" title="Add star"' + (!owned.length ? ' disabled' : '') + '>' + icon('star', 26, 'gold') + '</button>' +
            '</div>';
          html += '<div class="cardgrid">' + cardGridHtml(meta) + '</div>';
        }
      } else if (menuTab === 'labs') {
        const used = (meta.research || []).length, slots = meta.labSlots || 1;
        html += '<div class="cores-chip">' + cores(15) + ' <b>' + (meta.cores || 0) + '</b>' +
          '<span class="slotchip">' + icon('cell', 13, 'cell') + ' ' + (meta.cells || 0) + '</span>' +
          '<span class="slotchip">' + icon('flask', 13) + ' ' + used + '/' + slots + '</span></div>';
        const LCAT_ICON = { attack: 'sword', defense: 'shield', utility: 'coins' };
        html += '<div class="subtabs" id="h-labtabs">';
        for (const cat of A.LAB_CATS)
          html += '<button class="subtab' + (cat === menuLabCat ? ' on' : '') + '" data-labcat="' + cat + '" title="' + cat + '">' + icon(LCAT_ICON[cat], 22) + '</button>';
        html += '</div><div class="lablist">' + labRowsHtml(meta) + '</div>';
        const sc = A.labSlotCost(meta), canSlot = slots < A.MAX_SLOTS;
        if (canSlot) html += '<button class="slotbtn' + ((meta.tokens || 0) < sc ? ' cant' : '') + '" id="h-buyslot">+1 Slot · ' + sc + ' ' + icon('token', 13, 'token') + '</button>';
      } else {
        html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Unlocks later</div></div>';
      }
      menuContent.innerHTML = html;

      if (menuTab === 'hero') {
        drawAvatar($('#h-avatar'), meta);
        $('#h-ms').addEventListener('click', () => { renderMilestones(); modal.classList.remove('hide'); setSpotlight(false); });
        const tdn = $('#h-tier-down');
        if (tdn) tdn.addEventListener('click', () => { if (handlers.onSetTier && handlers.onSetTier((meta.tier || 1) - 1)) renderMenu(); });
        $('#h-tier-up').addEventListener('click', (e) => {
          const cur = meta.tier || 1;
          if (cur >= A.MAX_TIER) return showUnlockTip(e.currentTarget, 'Tier ' + A.MAX_TIER + ' is the highest tier');
          if (A.tierUnlocked(meta, cur + 1)) { if (handlers.onSetTier && handlers.onSetTier(cur + 1)) renderMenu(); }
          else showUnlockTip(e.currentTarget, 'Reach wave ' + A.TIER_UNLOCK_WAVE + ' in Tier ' + cur + ' to unlock Tier ' + (cur + 1));
        });
        $('#h-start').addEventListener('click', () => handlers.onStartRun && handlers.onStartRun());
        const cib = $('#h-checkin');
        if (cib && !cib.disabled) cib.addEventListener('click', () => { if (handlers.onCheckIn && handlers.onCheckIn()) renderMenu(); });
      } else if (menuTab === 'upgrades') {
        menuContent.querySelectorAll('[data-uptab]').forEach((b) =>
          b.addEventListener('click', () => {
            const t = A.TAB_DEFS.find((x) => x.id === b.dataset.uptab);
            if (t.gated && !A.economyUnlocked(meta)) { showUnlockTip(b, 'Economic upgrades unlock in Tier 2'); return; }
            menuUpTab = b.dataset.uptab; renderMenu();
          }));
        menuContent.querySelectorAll('[data-perm]').forEach((b) =>
          b.addEventListener('click', () => {
            if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm)) renderMenu();
            else shake(menuContent.querySelector('.cores-chip'));
          }));
      } else if (menuTab === 'cards') {
        const bb = $('#h-buycard'); if (bb) bb.addEventListener('click', () => { if (handlers.onBuyCard && handlers.onBuyCard()) renderMenu(); else shake(bb); });
        const ub = $('#h-upcard'); if (ub) ub.addEventListener('click', () => { if (handlers.onUpgradeCard && handlers.onUpgradeCard()) renderMenu(); else shake(ub); });
        menuContent.querySelectorAll('.card[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(el.dataset.card)));
      } else if (menuTab === 'labs') {
        menuContent.querySelectorAll('[data-labcat]').forEach((b) =>
          b.addEventListener('click', () => { menuLabCat = b.dataset.labcat; renderMenu(); }));
        menuContent.querySelectorAll('[data-startlab]').forEach((b) =>
          b.addEventListener('click', () => { if (handlers.onStartResearch && handlers.onStartResearch(b.dataset.startlab)) renderMenu(); else shake(menuContent.querySelector('.cores-chip')); }));
        menuContent.querySelectorAll('[data-cancellab]').forEach((b) =>
          b.addEventListener('click', () => { if (handlers.onCancelResearch && handlers.onCancelResearch(b.dataset.cancellab)) renderMenu(); }));
        menuContent.querySelectorAll('[data-rushlab]').forEach((b) =>
          b.addEventListener('click', () => { if (handlers.onRushResearch && handlers.onRushResearch(b.dataset.rushlab)) renderMenu(); else shake(menuContent.querySelector('.cores-chip')); }));
        const sb = $('#h-buyslot'); if (sb) sb.addEventListener('click', () => { if (handlers.onBuyLabSlot && handlers.onBuyLabSlot()) renderMenu(); else shake(sb); });
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
      sidemenu.classList.remove('open'); // the side menu is in-game chrome; the menu screen has its own gear
      tabbarEl.style.display = 'none'; topEl.style.display = 'none';
    }
    function refreshMenu(meta) { if (meta) lastMeta = meta; if (menuEl.classList.contains('show')) renderMenu(); }
    function hideMenu() { menuEl.classList.remove('show'); setSpotlight(false); tabbarEl.style.display = ''; topEl.style.display = ''; }

    // ---------- game-over OVERVIEW (shown after the death animation; closes to the Workshop) ----------
    const overEl = $('#h-over'), overCard = $('#h-over-card');
    function showOverview(meta, earn) {
      lastMeta = meta; const e = earn || {};
      $('#h-stats').classList.add('hide');
      const tier = meta.tier || 1;
      let rew = '<div class="rew"><span>Cores</span><b>+' + (e.cores || 0) + ' ' + cores(16) + '</b></div>';
      if (e.tokens) rew += '<div class="rew"><span>Tokens</span><b class="tok">+' + e.tokens + ' ' + icon('token', 15, 'token') + '</b></div>';
      if (e.cells) rew += '<div class="rew"><span>Cells</span><b class="cell">+' + e.cells + ' ' + icon('cell', 15, 'cell') + '</b></div>';
      const row = (label, val) => '<div class="strow"><span>' + label + '</span><b>' + val + '</b></div>';
      overCard.innerHTML =
        '<div class="statshead"><h2>Run Over</h2><button class="iconclose" id="h-over-close" title="Workshop">' + icon('close', 18) + '</button></div>' +
        '<div class="over-rewards">' + rew + '</div>' +
        '<div class="statsbody">' +
        row('Kills', fmt(e.kills || 0)) +
        row('Wave reached', fmt(e.wave || 0)) +
        row('Foes per wave', fmt(A.waveCount((e.wave || 1) * A.tierDifficulty(tier)))) +
        row('Core multiplier', 'x' + A.coreMult(tier).toFixed(1)) +
        row('Total cores', fmt(meta.cores || 0)) +
        '</div>';
      $('#h-over-close').addEventListener('click', () => handlers.onToWorkshop && handlers.onToWorkshop());
      overEl.classList.remove('hide');
      sidemenu.classList.remove('open');
      tabbarEl.style.display = 'none'; topEl.style.display = 'none';
    }
    function hideOverview() { overEl.classList.add('hide'); $('#h-stats').classList.add('hide'); }

    // 1s tick: advance research bars on the Lab tab; tick the check-in countdown on the Hero tab.
    setInterval(() => {
      if (!menuEl.classList.contains('show') || !lastMeta) return;
      if (menuTab === 'labs') {
        const had = (lastMeta.research || []).length;
        if (handlers.onReconcileLabs) handlers.onReconcileLabs();
        if (had) renderMenu();
      } else if (menuTab === 'hero') {
        renderMenu(); // keeps the "Next reward in mm:ss" countdown live
      }
    }, 1000);

    return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, setMeta, root };
  }

  // Classic: the original, un-themed HUD. Synchronous, always-available, the host's crash fallback.
  A.Hud = function (root, handlers) { return buildHud(root, handlers, null); };
  // Factory for a themed skin: same core + wiring, restyled by `theme = { cls, css }`.
  A.createThemedHud = function (theme) { return function (root, handlers) { return buildHud(root, handlers, theme); }; };
})(window.ARENA = window.ARENA || {});
