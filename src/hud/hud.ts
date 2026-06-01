/* src/hud/hud.ts — in-game HUD (top stats + 3-tab upgrade bar), the between-games MENU
   (5 bottom tabs), a spotlight tutorial, a milestones modal, and a settings modal.
   Handlers: onBuyRun, onBuyPerm, onClaimMilestone, onStartRun, onDev, onFF. */
import type { CardDef, CardDrawResult, CardInstance, Hud as HudInstance, HudFactory, HudHandlers, MenuOpts, Meta, Settings, State, ThemeDef, EarnSummary, UpgradeDef } from '../types';
import { WAVE, waveCount, tierDifficulty, coinMult, coinsForRun, MAX_TIER, TIER_UNLOCK_WAVE, tierUnlocked } from '../sim/waves';
import {
  UPGRADES, UP_BY_ID, upgradesIn, economyUnlocked, boughtOf, permBought, runUpgradeCost, runAtMax, permCost, permAtMax,
  upgradeCap, CARDS, CARD_INFO, MAX_STARS, CARD_ORDER, CARD_SLOTS, starSlot, buyCardCost, cardsUnlocked, MILESTONES, milestoneReward,
  claimableCount, TAB_DEFS, FIRST_PERM_COST,
} from '../sim/skills';
import {
  labsIn, LAB_CATS, labLevel, labUnlocked, labsTabUnlocked, labCoinCost, labTimeSec, labAtMax, researchOf, researchRemaining,
  researchProgress, freeSlots, rushVialCost, labSlotCost, MAX_SLOTS, checkInPending, checkInNextMs, CHECKIN_VIALS, CHECKIN_GEMS,
} from '../sim/labs';

// The HUD is a single themeable core: identical structure + wiring for every theme, restyled
// by a scoping class (`theme.cls`) + an injected override stylesheet (`theme.css`).
function buildHud(root: HTMLElement, handlers: HudHandlers, theme: ThemeDef | null): HudInstance {
  handlers = handlers || {};
  const th: ThemeDef = theme || {};
  root.className = 'hud' + (th.cls ? ' ' + th.cls : '');

  // ---------- inline SVG outline icons (no UTF8 glyphs anywhere in the UI) ----------
  const PATHS: Record<string, string> = {
    hero: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.6 7-6.6s7 2.7 7 6.6"/>',
    upgrades: '<path d="M12 19V9"/><path d="M7 13l5-5 5 5"/><path d="M7 5h10"/>',
    best: '<path d="M7 4h10v4.5a5 5 0 0 1-10 0V4z"/><path d="M7 5.5H4.5V8a3 3 0 0 0 3 3"/><path d="M17 5.5h2.5V8a3 3 0 0 1-3 3"/><path d="M12 13.5V17"/><path d="M8.5 20h7l-1-3h-5z"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    check: '<path d="M5 13l4 4 10-10"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    arrow: '<path d="M5 12h13"/><path d="M12 6l6 6-6 6"/>',
    chart: '<path d="M5 20V11"/><path d="M11 20V5"/><path d="M17 20v-7"/><path d="M3 20h18"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    cards: '<rect x="3" y="7" width="12" height="14" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2"/>',
    // gold = two solid coins (no star); a dark rim on the front coin separates the pair on dark UI
    coin: '<circle cx="14.5" cy="9.5" r="6" fill="currentColor" stroke="none"/><circle cx="9.5" cy="14.5" r="6" fill="currentColor" stroke="rgba(8,10,16,.55)" stroke-width="1.5"/>',
    // out-run coins = a coin with a star struck into it
    coinstar: '<circle cx="12" cy="12" r="9"/><path transform="translate(12 12) scale(.42) translate(-11.8 -11.4)" fill="currentColor" stroke="none" d="M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z"/>',
    // gems = faceted brilliant-cut gem (card currency)
    gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    // vials = erlenmeyer flask with liquid level (lab currency)
    vial: '<path d="M9 2h6"/><path d="M15 2v8l4 9q0 2-3 2H8q-3 0-3-2l4-9V2"/><path d="M7.5 16h9"/>',
    burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3.4 3.4M18.8 5.2l-3.4 3.4M5.2 18.8l3.4-3.4M18.8 18.8l-3.4-3.4"/>',
    bow: '<path d="M8 3a10 10 0 0 1 0 18"/><path d="M8 3v18"/><path d="M5 12h13"/><path d="M15 9l3 3-3 3"/><path d="M5 12l2.5-2M5 12l2.5 2"/>',
    bullseye: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
    rate: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5"/><path d="M10 3h4M12 3v3"/>',
    heart: '<path d="M12 20s-6.5-4.3-6.5-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 6.5 2.7c0 5-6.5 9.3-6.5 9.3z"/>',
    regen: '<path d="M10 19s-4.8-3.2-4.8-6.7A2.6 2.6 0 0 1 10 10 2.6 2.6 0 0 1 14.8 12.3C14.8 15.8 10 19 10 19z"/><path d="M14 8.4A2.6 2.6 0 0 1 19 10.7c0 2.4-1.9 4.3-3.2 5.5"/>',
    powers: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    prestige: '<path d="M5 18h14"/><path d="M5 18l-1-9 4 3 4-7 4 7 4-3-1 9z"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 14h9"/>',
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
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  };
  function icon(name: string, size?: number, cls?: string): string {
    size = size || 16;
    return (
      '<svg class="ic' + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      PATHS[name] + '</svg>'
    );
  }
  const coinsIc = (size?: number): string => icon('coinstar', size || 14, 'coin');

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
    // The cog only toggles on-screen visual indicators, so it's an EYE ("what you see"), not a gear.
    '  <button class="sideitem" id="h-set" title="Display">' + icon('eye', 20) + '</button>' +
    '  <button class="sideitem" id="h-chart" title="Run Stats">' + icon('chart', 20) + '</button>' +
    '  <button class="sideitem danger" id="h-rail-exit" title="End run">' + icon('close', 20) + '</button>' +
    '</aside>' +
    '<div class="wavebar" id="h-wavebar" title="Next wave"><i id="h-wavefill"></i></div>' +
    '<div class="statswrap hide" id="h-stats"><div class="statscard" id="h-statscard"></div></div>' +
    '<div class="ghint hide" id="h-ghint"></div>' +
    '<div class="tabbar" id="h-tabbar"><div id="h-tabcontent"></div><div class="tabs" id="h-tabs"></div></div>' +
    '<div class="menu" id="h-menu">' +
    '  <button class="menugear" id="h-menugear" title="Settings">' + icon('gear', 22) + '</button>' +
    '  <div class="menu-content" id="h-menu-content"></div>' +
    '  <div class="menutabs" id="h-menu-tabs"></div>' +
    '  <div class="modal hide" id="h-modal"><div class="modal-inner" id="h-modal-inner"></div></div>' +
    '</div>' +
    '<div class="setmodal hide" id="h-setmodal"><div class="setmodal-inner" id="h-setmodal-inner"></div></div>' +
    // End-run confirm (opened from the side-rail X). Reuses the centered setmodal shell + themed .exitrun.
    '<div class="setmodal hide" id="h-endmodal"><div class="setmodal-inner">' +
    '<div class="statshead"><h2>End run?</h2><button class="iconclose" id="h-end-close" title="Close">' + icon('close', 18) + '</button></div>' +
    '<div class="endbody">Your cores are banked. This ends the current run and returns to the Workshop.</div>' +
    '<button class="endkeep" id="h-end-cancel">Keep playing</button>' +
    '<button class="exitrun" id="h-end-yes">' + icon('close', 16) + ' End run</button>' +
    '</div></div>' +
    '<div class="over hide" id="h-over"><div class="over-card" id="h-over-card"></div></div>' +
    '<div class="tut-dim hide" id="h-spot"></div><div class="tut-thought hide" id="h-thought"></div>' +
    '<div class="lk-tip hide" id="h-lktip"></div>';

  // A themed skin ships its OWN override stylesheet, injected here.
  if (th.css) root.insertAdjacentHTML('afterbegin', '<style class="theme-style">' + th.css + '</style>');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const fmt = (n: number): string => (typeof n === 'number' ? n.toLocaleString() : n);
  const SUF: [number, string][] = [[1e15, 'q'], [1e12, 't'], [1e9, 'b'], [1e6, 'm']];
  const abbr = (n: number): string => {
    n = Math.floor(n || 0);
    if (n < 1000) return String(n);
    if (n < 1e6) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    for (const [v, s] of SUF) {
      if (n >= v) {
        const m = n / v;
        return (m < 10 ? m.toFixed(3) : m < 100 ? m.toFixed(2) : m.toFixed(1)) + s;
      }
    }
    return String(n);
  };
  const sumPerm = (meta: Meta): number => Object.values((meta && meta.perm) || {}).reduce((a, b) => a + b, 0);

  // gradient used to fill chromatic (max-tier) stars
  root.insertAdjacentHTML(
    'beforeend',
    '<svg width="0" height="0" style="position:absolute"><defs>' +
      '<linearGradient id="chroma" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ff5d6c"/><stop offset=".35" stop-color="#ffd24a"/>' +
      '<stop offset=".7" stop-color="#3ddc84"/><stop offset="1" stop-color="#4aa8ff"/>' +
      '</linearGradient></defs></svg>',
  );

  // per-star card modal (no close button; click anywhere to dismiss)
  root.insertAdjacentHTML('beforeend', '<div class="cardmodal hide" id="h-cardmodal"><div class="cardmodal-inner" id="h-cardmodal-inner"></div></div>');
  $('#h-cardmodal').addEventListener('click', () => $('#h-cardmodal').classList.add('hide'));

  // card REVEAL overlay — the "what did I get?" theatre played after a draw/upgrade (flip + star fly-in /
  // gold glow / chroma spin). Click anywhere to dismiss; the grid underneath has already re-rendered.
  root.insertAdjacentHTML('beforeend', '<div class="reveal hide" id="h-reveal"><div class="reveal-stage" id="h-reveal-stage"></div></div>');
  let revealTimers: ReturnType<typeof setTimeout>[] = [];
  $('#h-reveal').addEventListener('click', () => {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    $('#h-reveal').classList.add('hide');
  });

  const STARP = 'M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z';
  const STAT_ICON: Record<string, string> = { rangedDamage: 'bow', attackSpeed: 'rate', health: 'heart', regen: 'regen',
    critChance: 'crit', critDamage: 'burst', dodge: 'dodge', gold: 'coin',
    thorns: 'shield', msChance: 'bow', bounceChance: 'arrow', rendMult: 'burst', range: 'range', interest: 'coin' };
  const STAT_LABEL: Record<string, string> = { rangedDamage: 'Ranged', attackSpeed: 'Speed', health: 'Health', regen: 'Regen',
    critChance: 'Crit', critDamage: 'Crit Dmg', dodge: 'Dodge', gold: 'Gold',
    thorns: 'Thorns', msChance: 'Multishot', bounceChance: 'Bounce', rendMult: 'Rend', range: 'Range', interest: 'Interest' };
  // currencies shown on the Hero screen
  const CURRENCIES: { key: 'coins' | 'gems' | 'vials'; icon: string; cls: string }[] = [{ key: 'coins', icon: 'coinstar', cls: 'coin' }, { key: 'gems', icon: 'gem', cls: 'gem' }, { key: 'vials', icon: 'vial', cls: 'vial' }];
  function starSvg(kind: string): string {
    const fill = kind === 'white' ? '#eef2f8' : kind === 'gold' ? '#ffd24a' : 'url(#chroma)';
    return '<svg class="star ' + kind + '" width="16" height="16" viewBox="0 0 24 24"><path fill="' + fill + '" stroke="rgba(0,0,0,.3)" stroke-width="1" d="' + STARP + '"/></svg>';
  }
  function starsHtml(stars: number): string {
    const count = Math.min(stars, 5);
    let h = '<div class="stars">';
    if (count > 0) {
      const center = (count - 1) / 2,
        STEP = 5;
      for (let i = 0; i < count; i++) {
        const off = Math.round(Math.abs(i - center) * STEP);
        h += '<span class="starwrap" style="transform:translateY(' + off + 'px)">' + starSvg(starSlot(i, stars)) + '</span>';
      }
    }
    return h + '</div>';
  }
  const tierOf = (stars: number): string => (stars >= 11 ? 'chroma' : stars >= 6 ? 'gold' : 'white');
  // one-line readable effect for a card at its current stars (e.g. "+10% attack speed")
  function cardDescText(def: CardDef, stars: number): string {
    const v = def.value(stars || 0);
    return def.desc ? def.desc(v) : def.fmt ? def.fmt(v) : '+' + v;
  }
  function cardHtml(card: CardInstance): string {
    const def = CARDS[card.id];
    if (!def) return '';
    const stars = card.stars || 0;
    return (
      '<div class="card tier-' + tierOf(stars) + '" data-card="' + card.id + '" style="--tint:' + def.tint + '">' +
      '<div class="card-band"></div>' +
      '<div class="card-name">' + def.name + '</div>' +
      '<div class="card-img">' + icon(def.art, 50) + '</div>' +
      starsHtml(stars) +
      '<div class="card-desc">' + cardDescText(def, stars) + '</div></div>'
    );
  }
  function lockedCardHtml(): string {
    return '<div class="card locked"><div class="card-img">' + icon('lock', 34) + '</div><div class="card-name">Locked</div></div>';
  }
  // a fixed 5-slot star row for the reveal theatre. `change` marks the ONE slot mid-transition
  // (white fly-in / white→gold / gold→chroma); the rest are drawn at their final tier.
  function revealStarSlots(stars: number, change: { idx: number; type: string } | null): string {
    let h = '<div class="rc-stars">';
    for (let i = 0; i < 5; i++) {
      const t = starSlot(i, stars); // 'empty' | 'white' | 'gold' | 'chroma'
      if (change && i === change.idx) {
        if (change.type === 'white') {
          h += '<span class="rstar fly">' + starSvg('white') + '</span>';
        } else {
          const from = change.type === 'gold' ? 'white' : 'gold';
          h += '<span class="rstar morph to-' + change.type + '">' +
            '<span class="glow"></span>' +
            '<span class="sf from">' + starSvg(from) + '</span>' +
            '<span class="sf to">' + starSvg(change.type) + '</span></span>';
        }
      } else if (t === 'empty') {
        h += '<span class="rstar empty">' + starSvg('white') + '</span>';
      } else {
        h += '<span class="rstar">' + starSvg(t) + '</span>';
      }
    }
    return h + '</div>';
  }
  // Play the reveal for a buy/upgrade RESULT { id, before, after, unlocked }. Detects which star slot
  // changed and to what tier, then sequences: (optional) locked-card flip → the matching star animation
  // → (at 15 stars) the whole card going chromatic while its stats fade.
  function revealCard(r: CardDrawResult): void {
    if (!r || !r.id) return;
    const def = CARDS[r.id];
    if (!def) return;
    const before = r.before | 0,
      after = r.after | 0,
      unlocked = !!r.unlocked;
    let change: { idx: number; type: string } | null = null;
    if (after > before) {
      if (after <= 5) change = { idx: after - 1, type: 'white' };
      else if (after <= 10) change = { idx: after - 6, type: 'gold' };
      else change = { idx: after - 11, type: 'chroma' };
    }
    const full = after >= MAX_STARS && after > before; // reached the 5th chrome star this draw
    const banner = full
      ? 'Fully Chromatic!'
      : unlocked
        ? 'New Card!'
        : change && change.type === 'gold'
          ? 'Gold Star!'
          : change && change.type === 'chroma'
            ? 'Chromatic Star!'
            : change
              ? 'Star Up!'
              : def.name;

    const front =
      '<div class="rc-face rc-front">' +
      '<div class="card-band"></div>' +
      '<div class="rc-name">' + def.name + '</div>' +
      '<div class="rc-img">' + icon(def.art, 84) + '</div>' +
      revealStarSlots(after, change) +
      '<div class="rc-desc">' + cardDescText(def, after) + '</div>' +
      '<div class="rc-info">' + (CARD_INFO[r.id] || '') + '</div>' +
      '</div>';
    const cardInner = unlocked
      ? '<div class="rc-flip"><div class="rc-face rc-back">' + icon('lock', 56) + '<span>Locked</span></div>' + front + '</div>'
      : front;

    const stage = $('#h-reveal-stage');
    stage.innerHTML =
      '<div class="reveal-banner">' + banner + '</div>' +
      '<div class="revealcard tier-' + tierOf(after) + '" style="--tint:' + def.tint + '">' + cardInner + '</div>' +
      '<div class="reveal-hint">Tap to continue</div>';
    $('#h-reveal').classList.remove('hide');

    const rc = stage.querySelector('.revealcard') as HTMLElement,
      frontEl = stage.querySelector('.rc-front') as HTMLElement;
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    const at = (ms: number, fn: () => void): number => revealTimers.push(setTimeout(fn, ms));
    // the star animations are gated behind `.go` so they hold until the card is face-up
    const go = (): void => {
      frontEl.classList.add('go');
      // chromatic morph runs ~1.2s; only then does a maxed card dissolve its stats and turn chromatic
      if (full) at(change && change.type === 'chroma' ? 1250 : 950, () => rc.classList.add('full'));
    };
    if (unlocked) {
      at(500, () => (stage.querySelector('.rc-flip') as HTMLElement).classList.add('flipped')); // flip after half a second
      at(500 + 680, go); // ...then, once face-up, fly the first star in
    } else {
      requestAnimationFrame(() => requestAnimationFrame(go));
    }
  }
  function cardGridHtml(meta: Meta): string {
    const owned = meta.cards || [];
    let h = '';
    for (let i = 0; i < CARD_SLOTS; i++) {
      const id = CARD_ORDER[i];
      const have = id && owned.find((c) => c.id === id);
      h += have ? cardHtml(have) : lockedCardHtml();
    }
    return h;
  }
  function openCardModal(id: string): void {
    const def = CARDS[id];
    if (!def) return;
    const owned = ((lastMeta && lastMeta.cards) || []).find((c) => c.id === id);
    const stars = owned ? owned.stars || 0 : 0;
    const e0 = def.effects[0];
    let rows = '';
    for (let s = 1; s <= MAX_STARS; s++) {
      const tier = s >= 11 ? 'chroma' : s >= 6 ? 'gold' : 'white';
      rows += '<div class="csr' + (s <= stars ? ' have' : '') + '">' + starSvg(tier) +
        '<span class="csv">' + icon(STAT_ICON[e0.stat] || 'burst', 14) +
        (STAT_LABEL[e0.stat] || e0.stat) + ' <b>' + (def.fmt ? def.fmt(def.value(s)) : '+' + def.value(s)) + '</b></span></div>';
    }
    const info = CARD_INFO[id] || '';
    $('#h-cardmodal-inner').innerHTML =
      '<div class="cmhead" style="--tint:' + def.tint + '">' +
      '<div class="cm-medal">' + icon(def.art, 30) + '</div>' +
      '<div class="cm-title"><b>' + def.name + '</b>' + (info ? '<span>' + info + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="cm-sub">Bonus per star · <b>' + stars + '</b>/' + MAX_STARS + '</div>' + rows;
    $('#h-cardmodal').classList.remove('hide');
  }

  // ---------- in-game tab bar (3 icon subtabs: attack / defense / economic) ----------
  const tabsEl = $('#h-tabs'),
    contentEl = $('#h-tabcontent');
  const rowEls: Record<string, { btn: HTMLElement; cur: HTMLElement; nxt: HTMLElement; cost: HTMLElement; lv: HTMLElement }> = {};
  let activeTab = TAB_DEFS[0].id,
    tabOpen = false,
    taughtTabs = false;
  TAB_DEFS.forEach((tab) => {
    const b = document.createElement('button');
    b.innerHTML = icon(tab.icon, 22);
    b.dataset.tab = tab.id;
    b.title = tab.id;
    b.addEventListener('click', () => {
      if (tabOpen && activeTab === tab.id) tabOpen = false;
      else {
        activeTab = tab.id;
        tabOpen = true;
      }
      taughtTabs = true;
      $('#h-tabbar').classList.remove('pulse');
      renderTabButtons();
      renderTabContent();
    });
    tabsEl.appendChild(b);
  });
  function renderTabButtons(): void {
    for (const b of Array.from(tabsEl.children) as HTMLElement[]) b.classList.toggle('on', tabOpen && b.dataset.tab === activeTab);
  }
  function renderTabContent(): void {
    const tabDef = TAB_DEFS.find((t) => t.id === activeTab)!;
    const locked = tabDef.gated && lastS && !economyUnlocked(lastS.meta);
    contentEl.innerHTML = '';
    for (const k in rowEls) delete rowEls[k];
    contentEl.className = 'tabcontent' + (tabOpen ? '' : ' collapsed');
    if (!tabOpen) return;
    if (locked) {
      contentEl.innerHTML = '<div class="tablock">' + icon('lock', 18) + '<span>Economic upgrades unlock in Tier 2</span></div>';
      return;
    }
    for (const u of upgradesIn(activeTab)) {
      const btn = document.createElement('button');
      btn.className = 'up';
      btn.innerHTML = '<span class="nm">' + icon(u.icon, 14) + ' ' + u.label + ' <span class="uplv"></span></span>' +
        '<span class="delta"><span class="cur"></span> ' + icon('arrow', 12) + ' <span class="nxt"></span></span><span class="cost"></span>';
      btn.addEventListener('click', () => {
        if (!lastS || runAtMax(lastS, u.id)) return;
        if (lastS.econ.gold < runUpgradeCost(lastS, u.id)) {
          shake(root.querySelector('.stat.gold'));
          return;
        }
        handlers.onBuyRun && handlers.onBuyRun(u.id);
      });
      contentEl.appendChild(btn);
      rowEls[u.id] = { btn, cur: btn.querySelector('.cur')!, nxt: btn.querySelector('.nxt')!, cost: btn.querySelector('.cost')!, lv: btn.querySelector('.uplv')! };
    }
  }
  renderTabContent();

  let lastS: State | null = null;
  // top-bar elements are static chrome (built once); cache them instead of re-querying every frame
  let uel: Record<string, HTMLElement> | null = null;
  function shake(el: Element | null): void {
    if (!el) return;
    el.classList.remove('shake');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('shake');
  }
  function update(s: State): void {
    lastS = s;
    if (!uel)
      uel = {
        wave: $('#h-wave'), hp: $('#h-hp'), gold: $('#h-gold'), hpclip: $('#h-hpclip'), hptrail: $('#h-hptrail'),
        hpstat: $('.stat.hp'), wavebar: $('#h-wavebar'), wavefill: $('#h-wavefill'), tabbar: $('#h-tabbar'), stats: $('#h-stats'),
      };
    uel.wave.textContent = String(s.wave.n);
    uel.hp.textContent = abbr(Math.ceil(s.hero.hp)) + '/' + abbr(Math.ceil(s.hero.hpMax));
    uel.gold.textContent = abbr(s.econ.gold);
    // HP bar: a red→green gradient revealed by clipping to the current fraction (mirrors the enemy
    // bars), with a translucent "damage trail" that drains a beat behind each hit and a low-HP danger
    // pulse. The value lives inside the bar.
    const hpf = s.hero.hpMax > 0 ? Math.max(0, Math.min(1, s.hero.hp / s.hero.hpMax)) : 0;
    const hpPct = hpf * 100 + '%';
    uel.hpclip.style.width = hpPct;
    uel.hptrail.style.width = hpPct;
    uel.hpstat.classList.toggle('low', hpf > 0 && hpf <= 0.3);
    const wbar = uel.wavebar;
    if (s.firstRun) wbar.style.display = 'none';
    else {
      const effInt = WAVE.interval - (UP_BY_ID.waveCut ? UP_BY_ID.waveCut.value(boughtOf(s, 'waveCut')) : 0);
      wbar.style.display = '';
      uel.wavefill.style.height = Math.max(0, Math.min(1, s.wave.clock / effInt)) * 100 + '%';
    }
    if (!taughtTabs && !s.firstRun && !tabOpen) {
      let min = Infinity;
      for (const u of UPGRADES) {
        if ((u.gated && !economyUnlocked(s.meta)) || runAtMax(s, u.id)) continue;
        min = Math.min(min, runUpgradeCost(s, u.id));
      }
      uel.tabbar.classList.toggle('pulse', s.econ.gold >= min);
    }
    if (tabOpen) {
      for (const u of upgradesIn(activeTab)) {
        const r = rowEls[u.id];
        if (!r) continue;
        const bought = boughtOf(s, u.id);
        r.cur.textContent = u.fmt(bought);
        r.lv.textContent = bought + '/' + upgradeCap(s.meta, u.id);
        if (runAtMax(s, u.id)) {
          r.nxt.textContent = '';
          r.cost.textContent = 'MAX';
          r.btn.classList.add('cant');
        } else {
          r.nxt.textContent = u.fmt(Math.min(u.max, bought + 1));
          const cost = runUpgradeCost(s, u.id);
          r.cost.textContent = fmt(cost) + ' g';
          r.btn.classList.toggle('cant', s.econ.gold < cost);
        }
      }
    }
    if (!uel.stats.classList.contains('hide')) refreshStats(s);
  }

  // ---------- in-game stats panel (chart button) ----------
  let boundMeta: Meta | null = null;
  function setMeta(m: Meta): void {
    boundMeta = m;
  }
  function refreshStats(s: State): void {
    const m = boundMeta || ({} as Meta),
      tier = m.tier || 1;
    const coinsRun = s.firstRun ? FIRST_PERM_COST : coinsForRun(s, tier);
    const set = (id: string, v: string): void => {
      const e = $('#st-' + id);
      if (e) e.textContent = v;
    };
    set('kills', fmt(s.econ.kills));
    set('foes', fmt(waveCount(s.wave.n * (s.difficultyMult || 1))));
    set('mult', 'x' + coinMult(tier).toFixed(1));
    set('coins', fmt(m.coins || 0));
    set('run', fmt(coinsRun));
  }
  function openStats(): void {
    $('#h-statscard').innerHTML =
      '<div class="statshead"><h2>Run Stats</h2><button class="iconclose" id="h-stats-close" title="Close">' + icon('close', 18) + '</button></div>' +
      '<div class="statsbody">' +
      '<div class="strow"><span>Kills</span><b id="st-kills">0</b></div>' +
      '<div class="strow"><span>Foes per wave</span><b id="st-foes">0</b></div>' +
      '<div class="strow"><span>Coin multiplier</span><b id="st-mult">x1</b></div>' +
      '<div class="strow"><span>Total coins</span><b id="st-coins">0</b></div>' +
      '<div class="strow"><span>Coins this run (so far)</span><b id="st-run">0</b></div>' +
      '</div>'; // Run Stats is purely informational now; ending a run lives in the side-rail End-run X.
    $('#h-stats-close').addEventListener('click', () => $('#h-stats').classList.add('hide'));
    if (lastS) refreshStats(lastS);
    $('#h-stats').classList.remove('hide');
  }
  $('#h-chart').addEventListener('click', () => {
    const sw = $('#h-stats');
    if (sw.classList.contains('hide')) openStats();
    else sw.classList.add('hide');
  });
  $('#h-stats').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'h-stats') $('#h-stats').classList.add('hide');
  });

  function showHint(html: string): void {
    const g = $('#h-ghint');
    g.innerHTML = html;
    g.classList.remove('hide');
  }
  function hideHint(): void {
    $('#h-ghint').classList.add('hide');
  }

  // ---------- settings modal (visual indicators; the object is shared with the renderer) ----------
  const settings: Partial<Settings> = handlers.settings || {};
  const SETTINGS_DEF: { key: keyof Settings; label: string; icon: string; cls?: string }[] = [
    { key: 'goldOnKill', label: 'Gold on kill', icon: 'coin', cls: 'gold' },
    { key: 'coinOnKill', label: 'Coins on kill', icon: 'coinstar', cls: 'coin' },
    { key: 'enemyHp', label: 'Enemy health bars', icon: 'heart', cls: 'hp' },
    { key: 'damageNumbers', label: 'Damage numbers', icon: 'burst' },
  ];
  const setmodal = $('#h-setmodal'),
    setmodalInner = $('#h-setmodal-inner');
  // Toggle rows are built from one source, reused by the in-game side-rail gear and the
  // between-games menu gear (both open the same centered modal, mutating the shared `settings`).
  const settingsRowsHtml = (): string =>
    SETTINGS_DEF.map(
      (o) =>
        '<button class="setrow' + (settings[o.key] ? ' on' : '') + '" data-set="' + o.key + '">' +
        '<span class="sl">' + icon(o.icon, 16, o.cls || '') + '<span>' + o.label + '</span></span>' +
        '<span class="switch"><i></i></span></button>',
    ).join('');
  const wireSettingsRows = (el: HTMLElement): void =>
    el.querySelectorAll<HTMLElement>('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.set as keyof Settings;
        settings[k] = !settings[k];
        b.classList.toggle('on', !!settings[k]);
        handlers.onSaveSettings && handlers.onSaveSettings();
      }),
    );
  function openSettings(): void {
    // "Display" = on-screen visual indicators only (the renderer reads these); no sim/persisted state.
    setmodalInner.innerHTML =
      '<div class="statshead"><h2>Display</h2><button class="iconclose" id="h-set-close" title="Close">' +
      icon('close', 18) + '</button></div><div class="setbody">' + settingsRowsHtml() + '</div>';
    $('#h-set-close').addEventListener('click', () => setmodal.classList.add('hide'));
    wireSettingsRows(setmodalInner);
    setmodal.classList.remove('hide');
  }
  setmodal.addEventListener('click', (e) => {
    if (e.target === setmodal) setmodal.classList.add('hide');
  });

  // ---------- side menu: a narrow icon rail, toggled by the header button; no auto-dismiss ----------
  // Each rail icon opens a self-dismissing modal (Settings) or panel (Run Stats), so the unintrusive
  // rail can stay open without a big panel hogging the screen.
  const sidemenu = $('#h-sidemenu');
  $('#h-menu-btn').addEventListener('click', () => sidemenu.classList.toggle('open'));
  $('#h-set').addEventListener('click', openSettings);

  // End-run X (side rail) → confirm modal → onExitRun (banks the run, shows the overview).
  const endmodal = $('#h-endmodal');
  const hideEnd = (): void => endmodal.classList.add('hide');
  $('#h-rail-exit').addEventListener('click', () => endmodal.classList.remove('hide'));
  $('#h-end-close').addEventListener('click', hideEnd);
  $('#h-end-cancel').addEventListener('click', hideEnd);
  $('#h-end-yes').addEventListener('click', () => {
    hideEnd();
    handlers.onExitRun && handlers.onExitRun();
  });
  endmodal.addEventListener('click', (e) => {
    if (e.target === endmodal) hideEnd();
  });

  // ---------- MENU ----------
  const menuEl = $('#h-menu'),
    menuContent = $('#h-menu-content'),
    menuTabsEl = $('#h-menu-tabs');
  const tabbarEl = $('#h-tabbar'),
    topEl = $('#h-top');
  const modal = $('#h-modal'),
    modalInner = $('#h-modal-inner');
  const spot = $('#h-spot'),
    thought = $('#h-thought');
  const MENU_TABS: { id: string; icon: string; gated?: boolean; locked?: boolean; unlockFn?: (m: Meta) => boolean; unlock?: string }[] = [
    { id: 'hero', icon: 'hero' },
    { id: 'upgrades', icon: 'upgrades' },
    { id: 'cards', icon: 'cards', gated: true, unlockFn: (m) => cardsUnlocked(m), unlock: 'Reach wave 30 to unlock Cards' },
    { id: 'labs', icon: 'flask', gated: true, unlockFn: (m) => labsTabUnlocked(m), unlock: 'Reach wave 30 to unlock Labs' },
    { id: 'prestige', icon: 'prestige', locked: true, unlock: 'Prestige unlocks in Tier 3' },
  ];
  let menuTab = 'hero',
    menuUpTab = 'attack',
    menuLabCat = 'attack',
    lastMeta: Meta | null = null,
    lastOpts: MenuOpts = {};

  MENU_TABS.forEach((t) => {
    const b = document.createElement('button');
    b.dataset.mtab = t.id;
    if (t.locked) {
      b.innerHTML = icon(t.icon, 24);
      b.classList.add('locked');
      b.addEventListener('click', () => showUnlockTip(b, t.unlock || 'Locked'));
    } else if (t.gated) {
      b.innerHTML = icon(t.icon, 24);
      b.addEventListener('click', () => {
        if (lastMeta && t.unlockFn!(lastMeta)) {
          menuTab = t.id;
          modal.classList.add('hide');
          renderMenu();
        } else showUnlockTip(b, t.unlock || 'Locked');
      });
    } else {
      b.innerHTML = icon(t.icon, 24);
      b.addEventListener('click', () => {
        menuTab = t.id;
        modal.classList.add('hide');
        renderMenu();
      });
    }
    menuTabsEl.appendChild(b);
  });

  function drawAvatar(canvas: HTMLCanvasElement, meta: Meta): void {
    const ctx = canvas.getContext('2d')!,
      W = canvas.width,
      H = canvas.height,
      cx = W / 2,
      cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    const total = sumPerm(meta);
    for (let i = 0; i < Math.min(total, 6); i++) {
      ctx.strokeStyle = 'rgba(74,168,255,' + (0.35 - i * 0.04) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 46 + i * 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(74,168,255,.18)';
    ctx.strokeStyle = '#4aa8ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4aa8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  function setSpotlight(show: boolean, targetEl?: HTMLElement | null, text?: string): void {
    if (!show || !targetEl) {
      spot.classList.add('hide');
      thought.classList.add('hide');
      return;
    }
    const r = targetEl.getBoundingClientRect();
    const pad = 3;
    spot.style.left = r.left + pad + 'px';
    spot.style.top = r.top + pad + 'px';
    spot.style.width = r.width - pad * 2 + 'px';
    spot.style.height = r.height - pad * 2 + 'px';
    spot.classList.remove('hide');
    thought.innerHTML = text || '';
    thought.style.top = r.top - 10 + 'px';
    thought.classList.remove('hide');
    const margin = 8,
      w = thought.offsetWidth,
      center = r.left + r.width / 2;
    const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
    thought.style.left = left + 'px';
    thought.style.transform = 'translateY(-100%)';
    thought.style.setProperty('--arrow-x', center - left + 'px');
  }

  const lktip = $('#h-lktip');
  let lktipTimer: ReturnType<typeof setTimeout> | null = null;
  function showUnlockTip(btn: HTMLElement, text: string): void {
    const r = btn.getBoundingClientRect();
    lktip.innerHTML = icon('lock', 13) + '<span>' + (text || 'Locked') + '</span>';
    lktip.style.top = r.top - 6 + 'px';
    lktip.classList.remove('hide');
    const margin = 8,
      w = lktip.offsetWidth,
      center = r.left + r.width / 2;
    const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
    lktip.style.left = left + 'px';
    lktip.style.transform = 'translateY(-100%)';
    lktip.style.setProperty('--arrow-x', center - left + 'px');
    if (lktipTimer) clearTimeout(lktipTimer);
    lktipTimer = setTimeout(() => lktip.classList.add('hide'), 2600);
  }

  function permRowsHtml(meta: Meta, tutoring: boolean): string {
    let html = '';
    upgradesIn(menuUpTab).forEach((up: UpgradeDef, i: number) => {
      const bought = permBought(meta, up.id);
      const cur = up.fmt(bought);
      const maxed = permAtMax(meta, up.id);
      const cost = permCost(meta, up.id),
        afford = (meta.coins || 0) >= cost;
      const isTut = tutoring && menuUpTab === 'attack' && i === 0 && bought === 0;
      html += '<button class="perm' + (isTut ? ' tut' : '') + (afford && !maxed ? '' : ' cant') + '" data-perm="' + up.id + '"' + (maxed ? ' disabled' : '') + '>' +
        '<span class="ptop">' + icon(up.icon, 18) + '<span class="pname">' + up.label + '</span>' +
        '<span class="plv">' + bought + '/' + upgradeCap(meta, up.id) + '</span></span>' +
        '<span class="pcur">' + cur + '</span>' +
        '<span class="pcost">' + (maxed ? 'MAX' : cost + ' ' + coinsIc(12)) + '</span></button>';
    });
    return html;
  }

  const mmss = (ms: number): string => {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  function fmtTime(sec: number): string {
    sec = Math.ceil(sec);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
    return (sec / 86400).toFixed(1) + 'd';
  }
  function labEffectDesc(L: { kind: string; per: number; target: string }, lv: number): string {
    if (L.kind === 'cap') return lv > 0 ? '+' + abbr(L.per * lv) + ' cap' : '+' + abbr(L.per) + ' cap / lvl';
    if (L.kind === 'scale') return '×' + (1 + L.per * lv).toFixed(2);
    if (L.target === 'gameSpeed') return '×' + (1 + L.per * lv).toFixed(1) + ' speed';
    if (L.target === 'labTime') return '-' + Math.round(Math.min(0.5, L.per * lv) * 100) + '% time';
    return '';
  }
  const LAB_CAT_ICON: Record<string, string> = { attack: 'sword', defense: 'shield', utility: 'coins' };
  function labRowsHtml(meta: Meta): string {
    const now = Date.now();
    let h = '';
    for (const L of labsIn(menuLabCat)) {
      const lv = labLevel(meta, L.id),
        maxed = labAtMax(meta, L.id);
      const unlocked = labUnlocked(meta, L.id),
        researching = !!researchOf(meta, L.id);
      let right: string;
      if (researching) {
        const prog = researchProgress(meta, L.id, now),
          rem = researchRemaining(meta, L.id, now);
        const rc = rushVialCost(meta, L.id, now),
          canRush = (meta.vials || 0) >= rc;
        right = '<span class="labprog"><span class="mbar"><i style="width:' + (prog * 100).toFixed(1) + '%"></i></span>' +
          '<button class="rushlab' + (canRush ? '' : ' cant') + '" data-rushlab="' + L.id + '" title="Rush with vials">' + rc + ' ' + icon('vial', 11, 'vial') + '</button>' +
          '<button class="cancellab" data-cancellab="' + L.id + '">' + fmtTime(rem) + ' ' + icon('close', 11) + '</button></span>';
      } else if (!unlocked) {
        right = '<span class="pcost">' + icon('lock', 12) + ' wave ' + L.gate.wave + '</span>';
      } else if (maxed) {
        right = '<span class="pcost">MAX</span>';
      } else {
        const cost = labCoinCost(meta, L.id),
          t = labTimeSec(meta, L.id);
        const can = (meta.coins || 0) >= cost && freeSlots(meta) > 0;
        right = '<button class="reslab' + (can ? '' : ' cant') + '" data-startlab="' + L.id + '">' + cost + ' ' + coinsIc(12) + ' · ' + fmtTime(t) + '</button>';
      }
      h += '<div class="lab' + (researching ? ' active' : '') + (unlocked ? '' : ' locked') + '">' +
        '<span class="ptop">' + icon(LAB_CAT_ICON[L.cat], 18) + '<span class="pname">' + L.label + '</span>' +
        '<span class="lablv">' + lv + '/' + L.max + '</span></span>' +
        '<span class="pcur">' + labEffectDesc(L, lv) + '</span>' + right + '</div>';
    }
    return h;
  }

  function renderMilestones(): void {
    const meta = lastMeta!,
      cl = meta.claimedMilestones || {},
      best = meta.bestWave || 0;
    let html = '<button class="close" id="h-ms-close">' + icon('back', 16) + ' Back</button><h2>Milestones</h2>' +
      '<p class="msnote">Rewards for the furthest wave reached in Tier ' + (meta.tier || 1) + '.</p>';
    for (const w of MILESTONES) {
      const reward = milestoneReward(w),
        claimed = !!cl[w],
        can = best >= w && !claimed;
      const cls = claimed ? 'ms claimed' : can ? 'ms can' : 'ms locked';
      const right = claimed
        ? '<span class="tag">Claimed ' + icon('check', 14) + '</span>'
        : can
          ? '<button data-claim="' + w + '">Claim</button>'
          : '<span class="tag">' + icon('lock', 16) + '</span>';
      html += '<div class="' + cls + '"><span class="mw">Wave ' + w.toLocaleString() + '</span>' +
        '<span class="mr">+' + reward.toLocaleString() + ' ' + coinsIc(13) + '</span>' + right + '</div>';
    }
    modalInner.innerHTML = html;
    $('#h-ms-close').addEventListener('click', () => {
      modal.classList.add('hide');
      renderMenu();
    });
    modalInner.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) =>
      b.addEventListener('click', () => {
        if (handlers.onClaimMilestone && handlers.onClaimMilestone(+b.dataset.claim!)) renderMilestones();
      }),
    );
  }

  function renderMenu(): void {
    const meta = lastMeta!,
      opts = lastOpts,
      tutoring = sumPerm(meta) === 0;
    for (const b of Array.from(menuTabsEl.children) as HTMLElement[]) {
      b.classList.toggle('on', b.dataset.mtab === menuTab);
      b.classList.toggle('tut', tutoring && b.dataset.mtab === 'upgrades' && menuTab !== 'upgrades');
      b.classList.toggle('tut-off', tutoring && b.dataset.mtab !== 'upgrades');
      if (b.dataset.mtab === 'cards') {
        b.classList.toggle('locked', !cardsUnlocked(meta));
        b.innerHTML = icon('cards', 24);
      }
      if (b.dataset.mtab === 'labs') {
        const u = labsTabUnlocked(meta);
        b.classList.toggle('locked', !u);
        const active = (meta.research || []).length;
        b.innerHTML = icon('flask', 24) + (u && active ? '<span class="tabbadge br">' + active + '</span>' : '');
      }
    }
    menuContent.className = 'menu-content tab-' + menuTab + (tutoring && menuTab === 'hero' ? ' tut-block' : '');
    let html = '';
    if (menuTab === 'hero') {
      if (opts.earn)
        html += '<div class="earncard"><div class="el">Last run</div>' +
          '<div class="ev">+' + opts.earn.coins + ' ' + coinsIc(16) + '</div>' +
          '<div class="es">' + opts.earn.kills + ' kills / wave ' + opts.earn.wave + '</div></div>';
      const curChips = CURRENCIES.map((c) => '<span class="chip">' + icon(c.icon, 13, c.cls) + ' <b>' + (meta[c.key] || 0) + '</b></span>').join('');
      html += '<div class="chips">' + curChips + '<span class="chip">' + icon('best', 13) + ' <b>wave ' + (meta.bestWave || 0) + '</b></span></div>';
      // Only surface the check-in when a reward is actually claimable — no idle "Next reward in…" row.
      const pend = checkInPending(meta, Date.now());
      if (pend > 0) {
        html += '<button class="checkin ready" id="h-checkin">' + icon('vial', 14, 'vial') + ' Check In  +' + pend * CHECKIN_VIALS +
          ' ' + icon('vial', 12, 'vial') + '  +' + pend * CHECKIN_GEMS + ' ' + icon('gem', 12, 'gem') + '</button>';
      } else {
        html += '<button class="checkin" id="h-checkin" disabled>Next reward in ' + mmss(checkInNextMs(meta, Date.now())) + '</button>';
      }
      html += '<div class="avatar-frame"><canvas id="h-avatar" width="200" height="200"></canvas></div>';
      const claim = claimableCount(meta);
      html += '<button class="msbtn" id="h-ms">Milestones' + (claim > 0 ? '<span class="badge">' + claim + '</span>' : '') + '</button>';
      const tier = meta.tier || 1,
        canUp = tier < MAX_TIER && tierUnlocked(meta, tier + 1);
      html += '<div class="tiersel">' +
        '<button class="tierstep' + (tier > 1 ? '' : ' invisible') + '" id="h-tier-down"' + (tier > 1 ? '' : ' disabled') + '>' + icon('back', 18) + '</button>' +
        '<span class="tierlabel"><span class="tl-tier">' + icon('tier', 14) + ' Tier ' + tier + '</span>' +
        '<span class="tl-coin">' + coinsIc(12) + ' <b>x' + coinMult(tier).toFixed(1) + '</b></span></span>' +
        '<button class="tierstep' + (canUp ? '' : ' locked') + '" id="h-tier-up">' + icon('fwd', 18) + '</button>' +
        '</div>';
      html += '<button class="startsq" id="h-start">' + icon('play', 35, 'green') + '</button>';
    } else if (menuTab === 'upgrades') {
      html += '<div class="coins-chip">' + coinsIc(15) + ' <b>' + (meta.coins || 0) + '</b></div>';
      const ecoOk = economyUnlocked(meta);
      html += '<div class="subtabs" id="h-uptabs">';
      for (const t of TAB_DEFS) {
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
      if (!cardsUnlocked(meta)) {
        html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Reach wave 30 to unlock cards</div></div>';
      } else {
        const owned = meta.cards || [];
        const bc = buyCardCost(meta);
        // A draw is impossible only once every card type is owned AND maxed (the non-maxed pool is
        // empty) — mirrors buyCard()'s own guard so the button greys out instead of shaking.
        const allMaxed = Object.keys(CARDS).every((id) => {
          const c = owned.find((x) => x.id === id);
          return c && (c.stars || 0) >= MAX_STARS;
        });
        html += '<div class="coins-chip gem-chip">' + icon('gem', 15, 'gem') + ' <b>' + (meta.gems || 0) + '</b></div>';
        html += '<div class="cardbtns">' +
          '<button class="cardbtn draw' + ((meta.gems || 0) < bc || allMaxed ? ' cant' : '') + '" id="h-buycard"' + (allMaxed ? ' disabled' : '') + '>' +
          '<span class="cb-ic">' + icon('cards', 26) + '</span>' +
          '<span class="cb-tx"><span class="cb-t">Draw Card</span><span class="cb-s">' + (allMaxed ? 'Every card maxed!' : 'New card, or +1 star on one you own') + '</span></span>' +
          '<span class="cb-cost">' + bc + ' ' + icon('gem', 13, 'gem') + '</span></button>' +
          '</div>';
        html += '<div class="cardgrid">' + cardGridHtml(meta) + '</div>';
      }
    } else if (menuTab === 'labs') {
      const used = (meta.research || []).length,
        slots = meta.labSlots || 1;
      html += '<div class="coins-chip">' + coinsIc(15) + ' <b>' + (meta.coins || 0) + '</b>' +
        '<span class="slotchip">' + icon('vial', 13, 'vial') + ' ' + (meta.vials || 0) + '</span>' +
        '<span class="slotchip">' + icon('flask', 13) + ' ' + used + '/' + slots + '</span></div>';
      html += '<div class="subtabs" id="h-labtabs">';
      for (const cat of LAB_CATS)
        html += '<button class="subtab' + (cat === menuLabCat ? ' on' : '') + '" data-labcat="' + cat + '" title="' + cat + '">' + icon(LAB_CAT_ICON[cat], 22) + '</button>';
      html += '</div><div class="lablist">' + labRowsHtml(meta) + '</div>';
      const sc = labSlotCost(meta),
        canSlot = slots < MAX_SLOTS;
      if (canSlot) html += '<button class="slotbtn' + ((meta.gems || 0) < sc ? ' cant' : '') + '" id="h-buyslot">+1 Slot · ' + sc + ' ' + icon('gem', 13, 'gem') + '</button>';
    } else {
      html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Unlocks later</div></div>';
    }
    menuContent.innerHTML = html;

    if (menuTab === 'hero') {
      drawAvatar($<HTMLCanvasElement>('#h-avatar'), meta);
      $('#h-ms').addEventListener('click', () => {
        renderMilestones();
        modal.classList.remove('hide');
        setSpotlight(false);
      });
      const tdn = $('#h-tier-down');
      if (tdn) tdn.addEventListener('click', () => {
        if (handlers.onSetTier && handlers.onSetTier((meta.tier || 1) - 1)) renderMenu();
      });
      $('#h-tier-up').addEventListener('click', (e) => {
        const cur = meta.tier || 1;
        if (cur >= MAX_TIER) return showUnlockTip(e.currentTarget as HTMLElement, 'Tier ' + MAX_TIER + ' is the highest tier');
        if (tierUnlocked(meta, cur + 1)) {
          if (handlers.onSetTier && handlers.onSetTier(cur + 1)) renderMenu();
        } else showUnlockTip(e.currentTarget as HTMLElement, 'Reach wave ' + TIER_UNLOCK_WAVE + ' in Tier ' + cur + ' to unlock Tier ' + (cur + 1));
      });
      $('#h-start').addEventListener('click', () => handlers.onStartRun && handlers.onStartRun());
      const cib = $<HTMLButtonElement>('#h-checkin');
      if (cib && !cib.disabled) cib.addEventListener('click', () => {
        if (handlers.onCheckIn && handlers.onCheckIn()) renderMenu();
      });
    } else if (menuTab === 'upgrades') {
      menuContent.querySelectorAll<HTMLElement>('[data-uptab]').forEach((b) =>
        b.addEventListener('click', () => {
          const t = TAB_DEFS.find((x) => x.id === b.dataset.uptab);
          if (t && t.gated && !economyUnlocked(meta)) {
            showUnlockTip(b, 'Economic upgrades unlock in Tier 2');
            return;
          }
          menuUpTab = b.dataset.uptab!;
          renderMenu();
        }),
      );
      menuContent.querySelectorAll<HTMLElement>('[data-perm]').forEach((b) =>
        b.addEventListener('click', () => {
          if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm!)) renderMenu();
          else shake(menuContent.querySelector('.coins-chip'));
        }),
      );
    } else if (menuTab === 'cards') {
      const bb = $('#h-buycard');
      if (bb) bb.addEventListener('click', () => {
        const r = handlers.onBuyCard && handlers.onBuyCard();
        if (r) {
          renderMenu();
          revealCard(r);
        } else shake(bb);
      });
      menuContent.querySelectorAll<HTMLElement>('.card[data-card]').forEach((el) => el.addEventListener('click', () => openCardModal(el.dataset.card!)));
    } else if (menuTab === 'labs') {
      menuContent.querySelectorAll<HTMLElement>('[data-labcat]').forEach((b) =>
        b.addEventListener('click', () => {
          menuLabCat = b.dataset.labcat!;
          renderMenu();
        }),
      );
      menuContent.querySelectorAll<HTMLElement>('[data-startlab]').forEach((b) =>
        b.addEventListener('click', () => {
          if (handlers.onStartResearch && handlers.onStartResearch(b.dataset.startlab!)) renderMenu();
          else shake(menuContent.querySelector('.coins-chip'));
        }),
      );
      menuContent.querySelectorAll<HTMLElement>('[data-cancellab]').forEach((b) =>
        b.addEventListener('click', () => {
          if (handlers.onCancelResearch && handlers.onCancelResearch(b.dataset.cancellab!)) renderMenu();
        }),
      );
      menuContent.querySelectorAll<HTMLElement>('[data-rushlab]').forEach((b) =>
        b.addEventListener('click', () => {
          if (handlers.onRushResearch && handlers.onRushResearch(b.dataset.rushlab!)) renderMenu();
          else shake(menuContent.querySelector('.coins-chip'));
        }),
      );
      const sb = $('#h-buyslot');
      if (sb) sb.addEventListener('click', () => {
        if (handlers.onBuyLabSlot && handlers.onBuyLabSlot()) renderMenu();
        else shake(sb);
      });
    }
    // tutorial spotlight
    let spotTarget: HTMLElement | null = null,
      spotText = '';
    if (tutoring && modal.classList.contains('hide')) {
      if (menuTab === 'hero') {
        spotTarget = menuTabsEl.querySelector('[data-mtab="upgrades"]');
        spotText = 'Spend your ' + coinsIc(15) + ' here';
      } else if (menuTab === 'upgrades') {
        spotTarget = menuContent.querySelector('.perm.tut');
        spotText = 'Buy this to grow stronger, more unlock after';
      }
    }
    requestAnimationFrame(() => setSpotlight(!!spotTarget, spotTarget, spotText));
  }

  function showMenu(meta: Meta, opts: MenuOpts): void {
    lastMeta = meta;
    lastOpts = opts || {};
    menuTab = 'hero';
    modal.classList.add('hide');
    renderMenu();
    menuEl.classList.add('show');
    sidemenu.classList.remove('open'); // the side menu is in-game chrome — Settings lives there, not on the menu screen
    tabbarEl.style.display = 'none';
    topEl.style.display = 'none';
  }
  function refreshMenu(meta: Meta): void {
    if (meta) lastMeta = meta;
    if (menuEl.classList.contains('show')) renderMenu();
  }
  function hideMenu(): void {
    menuEl.classList.remove('show');
    setSpotlight(false);
    tabbarEl.style.display = '';
    topEl.style.display = '';
  }

  // ---------- game-over OVERVIEW ----------
  const overEl = $('#h-over'),
    overCard = $('#h-over-card');
  function showOverview(meta: Meta, earn: EarnSummary): void {
    lastMeta = meta;
    const e = earn || {};
    $('#h-stats').classList.add('hide');
    const tier = meta.tier || 1;
    const rew = '<div class="rew"><span>Coins</span><b>+' + (e.coins || 0) + ' ' + coinsIc(16) + '</b></div>';
    const row = (label: string, val: string): string => '<div class="strow"><span>' + label + '</span><b>' + val + '</b></div>';
    overCard.innerHTML =
      '<div class="statshead"><h2>Run Over</h2></div>' +
      '<div class="over-rewards">' + rew + '</div>' +
      '<div class="statsbody">' +
      row('Kills', fmt(e.kills || 0)) +
      row('Wave reached', fmt(e.wave || 0)) +
      row('Foes per wave', fmt(waveCount((e.wave || 1) * tierDifficulty(tier)))) +
      row('Coin multiplier', 'x' + coinMult(tier).toFixed(1)) +
      row('Total coins', fmt(meta.coins || 0)) +
      '</div>' +
      '<button class="over-back" id="h-over-back">' + icon('back', 16) + ' Back to the Workshop</button>';
    $('#h-over-back').addEventListener('click', () => handlers.onToWorkshop && handlers.onToWorkshop());
    overEl.classList.remove('hide');
    sidemenu.classList.remove('open');
    tabbarEl.style.display = 'none';
    topEl.style.display = 'none';
  }
  function hideOverview(): void {
    overEl.classList.add('hide');
    $('#h-stats').classList.add('hide');
  }

  // 1s tick: advance research bars on the Lab tab; tick the check-in countdown on the Hero tab.
  setInterval(() => {
    if (!menuEl.classList.contains('show') || !lastMeta) return;
    if (menuTab === 'labs') {
      const had = (lastMeta.research || []).length;
      if (handlers.onReconcileLabs) handlers.onReconcileLabs();
      if (had) renderMenu();
    } else if (menuTab === 'hero') {
      renderMenu();
    }
  }, 1000);

  return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, setMeta, root };
}

// Classic: the original, un-themed HUD. Synchronous, always-available, the host's crash fallback.
export const Hud: HudFactory = (root, handlers) => buildHud(root, handlers, null);
// Factory for a themed skin: same core + wiring, restyled by `theme = { cls, css }`.
export const createThemedHud = (theme: ThemeDef): HudFactory => (root, handlers) => buildHud(root, handlers, theme);
