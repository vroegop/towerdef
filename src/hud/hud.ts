/* src/hud/hud.ts — in-game HUD (top stats + 3-tab upgrade bar), the between-games MENU
   (5 bottom tabs), a spotlight tutorial, a milestones modal, and a settings modal.
   Handlers: onBuyRun, onBuyPerm, onClaimMilestone, onStartRun, onDev, onFF. */
import type { BulkQty, CardDef, CardDrawResult, CardInstance, Hud as HudInstance, HudFactory, HudHandlers, MenuOpts, Meta, OfflineReward, Settings, State, ThemeDef, EarnSummary, UpgradeDef } from '../types';
import { WAVE, spawnRate, tierMult, coinMult, coinsForRun, waveHp, waveDmg, waveSpeed, MAX_TIER, TIER_UNLOCK_WAVE, tierUnlocked } from '../sim/waves';
import { TYPES } from '../sim/registries';
import { spawnChances } from '../sim/enemies';
import {
  UPGRADES, UP_BY_ID, upgradesIn, boughtOf, permBought, runUpgradeCost, runAtMax, permCost, permAtMax,
  isUnlocked, SKILL_GROUPS, isGroupUnlocked, nextUnlockGroup, skillGroup,
  upgradeCap, tipOf, CARDS, CARD_INFO, MAX_STARS, CARD_ORDER, CARD_SLOTS, starSlot, buyCardCost, MILESTONES, milestoneReward,
  tierClaimableCount, TAB_DEFS, FIRST_PERM_COST, cardSlotCost, MAX_CARD_SLOTS, activeCardIds,
  availableBulkTiers, runBulkPlan, permBulkPlan, computeStats, effectiveUpgradeValue, effectiveCoinMult,
  bigGroup, bigSuffix,
} from '../sim/skills';
import {
  LABS, LAB_BY_ID, labLevel, labUnlocked, labsTabUnlocked, labCoinCost, labTimeSec, labAtMax, researchOf, researchRemaining,
  researchProgress, freeSlots, rushVialCost, labSlotCost, MAX_SLOTS, checkInPending, CHECKIN_VIALS, CHECKIN_GEMS,
  availableSpeeds, gameSpeed, speedAtLevel,
} from '../sim/labs';
import { cosmeticsOf, isCosmeticUnlocked, selectedCosmeticId, buffText, cosmeticById } from '../sim/cosmetics';
import {
  SUPERPOWERS, superUnlocked, superEnabled, superLevel, trackValue, trackCost, trackAtMax, nextUnlockCost,
} from '../sim/superpowers';
import { drawTowerSkin } from '../render/towers';

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
    cardslot: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M12 9.5v5M9.5 12h5"/>',
    // gold = two solid gold coins (currentColor, tinted by the 'gold' class). Each coin has a slight
    // shadow; the front coin's shadow is drawn after the back coin so it casts onto it at the overlap.
    coin: '<circle cx="15.3" cy="10.6" r="6" fill="rgba(8,10,16,.4)" stroke="none"/><circle cx="14.5" cy="9.5" r="6" fill="currentColor" stroke="none"/><circle cx="10.3" cy="15.6" r="6" fill="rgba(8,10,16,.4)" stroke="none"/><circle cx="9.5" cy="14.5" r="6" fill="currentColor" stroke="none"/>',
    // out-run coins = a struck COPPER coin with a star. Explicit metallic palette (copper body, dark
    // rim, lighter star) + a slight offset shadow so it reads as a real coin, not a flat outline.
    coinstar: '<circle cx="12.9" cy="12.9" r="8.5" fill="rgba(8,10,16,.28)" stroke="none"/>' +
      '<circle cx="12" cy="12" r="8.5" fill="#c47f3c" stroke="#6e3f12" stroke-width="1"/>' +
      '<path transform="translate(12 12) scale(.46) translate(-11.8 -11.4)" fill="#e8b06a" stroke="none" d="M12 2l2.9 6.3 6.8.6-5.1 4.6 1.5 6.7L12 17.3 5.9 20.8l1.5-6.7L2.3 9.5l6.8-.6z"/>',
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
    fwd: '<path d="M9 5l7 7-7 7"/>',
    ffwd: '<path d="M5 5l6 7-6 7M13 5l6 7-6 7"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    // refresh = cooldown; stopwatch = duration (both feather-style, 24×24 stroked)
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3.5v5h-5"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9"/><path d="M9.5 2h5"/><path d="M12 2v3.5"/><path d="M18.8 6.8l1.4-1.4"/>',
    crystal: '<path d="M12 2l4 6-4 14-4-14z"/><path d="M8 8h8"/>', // a tall shard, matching the Crystal Circle art
    // atom = Energy. Nucleus (static) + 3 orbit ellipses in a group that slowly spins (see .ic.atom .orbits)
    atom: '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><g class="orbits"><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></g>',
  };
  function icon(name: string, size?: number, cls?: string): string {
    size = size || 16;
    // coin glyphs get a circular backdrop-contrast lens (see .ic.coinicon in hud.css)
    const coinCls = name === 'coin' || name === 'coinstar' ? ' coinicon' : '';
    return (
      '<svg class="ic' + (cls ? ' ' + cls : '') + coinCls + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      PATHS[name] + '</svg>'
    );
  }
  const coinsIc = (size?: number): string => icon('coinstar', size || 14, 'coin');

  root.innerHTML =
    // Fixed header: game info on the left, a single menu toggle pinned right. No wrapping, so
    // the layout is identical on every device and across themes (whose fonts have varying widths).
    // Tower-style top: a currency strip (in-run gold + the banked meta currencies) on the left, the
    // menu toggle pinned right. The wave banner + our/enemy stat lines sit just below it.
    '<div class="topbar" id="h-top">' +
    '  <div class="curbar">' +
    '    <span class="cur gold" title="Gold (this run)">' + icon('coin', 15, 'gold') + '<b id="h-gold">0</b></span>' +
    '    <span class="cur" title="Coins">' + icon('coinstar', 14, 'coin') + '<b id="h-coins">0</b></span>' +
    '    <span class="cur" title="Gems">' + icon('gem', 14, 'gem') + '<b id="h-gems">0</b></span>' +
    '    <span class="cur" title="Vials">' + icon('vial', 14, 'vial') + '<b id="h-vials">0</b></span>' +
    '    <span class="cur" title="Energy (Superpowers)">' + icon('atom', 14) + '<b id="h-energy">0</b></span>' +
    '  </div>' +
    // Battle-speed toggle: cycles the selectable speeds (0.5x/1x always; faster tiers via the Game Speed lab).
    '  <button class="iconbtn speedbtn" id="h-speed" title="Battle speed">' + icon('ffwd', 15) + '<b id="h-speedval">1x</b></button>' +
    '  <button class="iconbtn menutoggle" id="h-menu-btn" title="Menu">' + icon('menu', 22) + '</button>' +
    '</div>' +
    // Persistent side menu: a narrow, one-icon-wide rail that opens from the menu toggle and stays
    // open (game interactions never auto-dismiss it). It is only as tall as its content, so it stays
    // unintrusive — each icon opens a self-dismissing modal instead of a big always-on panel.
    '<aside class="sidemenu" id="h-sidemenu">' +
    // The cog only toggles on-screen visual indicators, so it's an EYE ("what you see"), not a gear.
    '  <button class="sideitem" id="h-set" title="Display">' + icon('eye', 20) + '</button>' +
    '  <button class="sideitem" id="h-chart" title="Run Stats">' + icon('chart', 20) + '</button>' +
    '  <button class="sideitem" id="h-rail-cards" title="Cards">' + icon('cards', 20) + '</button>' +
    '  <button class="sideitem" id="h-rail-labs" title="Labs">' + icon('flask', 20) + '</button>' +
    '  <button class="sideitem danger" id="h-rail-exit" title="End run">' + icon('close', 20) + '</button>' +
    '</aside>' +
    '<div class="statswrap hide" id="h-stats"><div class="statscard" id="h-statscard"></div></div>' +
    '<div class="ghint hide" id="h-ghint"></div>' +
    // Tab dock: two stat panels (our stats | enemy stats) sit as the dock's top row, above the
    // upgrade list and tabs — each is a button that opens a details modal.
    '<div class="tabbar" id="h-tabbar">' +
    '  <div class="statline" id="h-statline">' +
    '    <button class="sl us" id="h-sl-us" title="Your stats">' +
    '      <span class="sl-grid">' +
    '        <span class="sl-row">' + icon('bow', 12) + '<b id="h-dmg">0</b></span>' +
    '        <span class="sl-row">' + icon('regen', 12) + '<b id="h-regen">0</b></span>' +
    '        <span class="sl-row">' + icon('coinstar', 12) + '<b id="h-coinmult">x1.0</b></span>' +
    '      </span>' +
    '      <span class="sl-bar"><i class="slbarfill" id="h-hpfill"></i><b id="h-hp">1</b></span>' +
    '    </button>' +
    '    <button class="sl enemy" id="h-sl-enemy" title="Enemy stats">' +
    '      <span class="sl-grid">' +
    '        <span class="sl-wave">Wave <b id="h-wave">1</b></span>' +
    '        <span class="sl-row">' + icon('bow', 12) + '<b id="h-fdmg">0</b></span>' +
    '        <span class="sl-row">' + icon('heart', 12) + '<b id="h-fhp">0</b></span>' +
    '      </span>' +
    '      <span class="sl-bar wave"><i class="slbarfill" id="h-wavefill"></i></span>' +
    '    </button>' +
    '  </div>' +
    '  <div id="h-tabcontent"></div><div class="tabs" id="h-tabs"></div>' +
    '</div>' +
    '<div class="menu" id="h-menu">' +
    '  <div class="menu-content" id="h-menu-content"></div>' +
    '  <div class="menutabs" id="h-menu-tabs"></div>' +
    '  <div class="modal hide" id="h-modal"><div class="modal-inner" id="h-modal-inner"></div></div>' +
    '</div>' +
    // In-game management modals opened from the side rail: manage active cards + research labs without
    // leaving the run. They live OUTSIDE #h-menu (which is hidden in-game) so they show during play.
    '<div class="mgmtmodal hide" id="h-cardsmodal"><div class="mgmtmodal-inner" id="h-cardsmodal-inner"></div></div>' +
    '<div class="mgmtmodal hide" id="h-labsmodal"><div class="mgmtmodal-inner" id="h-labsmodal-inner"></div></div>' +
    '<div class="setmodal hide" id="h-setmodal"><div class="setmodal-inner" id="h-setmodal-inner"></div></div>' +
    '<div class="updmodal hide" id="h-updmodal"><div class="updmodal-inner" id="h-updmodal-inner"></div></div>' +
    // End-run confirm (opened from the side-rail X). Reuses the centered setmodal shell + themed .exitrun.
    '<div class="setmodal hide" id="h-endmodal"><div class="setmodal-inner">' +
    '<div class="statshead"><h2>End run?</h2><button class="iconclose" id="h-end-close" title="Close">' + icon('close', 18) + '</button></div>' +
    '<div class="endbody">Your cores are banked. This ends the current run and returns to the Workshop.</div>' +
    '<button class="endkeep" id="h-end-cancel">Keep playing</button>' +
    '<button class="exitrun" id="h-end-yes">' + icon('close', 16) + ' End run</button>' +
    '</div></div>' +
    '<div class="over hide" id="h-over"><div class="over-card" id="h-over-card"></div></div>' +
    '<div class="tut-dim hide" id="h-spot"></div><div class="tut-thought hide" id="h-thought"></div>' +
    // Floating "Skip tutorial" button, shown for the duration of the in-run guided tutorial.
    '<button class="tut-skip hide" id="h-tutskip">' + icon('fwd', 14) + ' Skip tutorial</button>' +
    // Generic centered info modal (tutorial recap, offline-reward summary) — never auto-dismisses.
    '<div class="infomodal hide" id="h-infomodal"><div class="infomodal-card" id="h-infomodal-card"></div></div>' +
    '<div class="lk-tip hide" id="h-lktip"></div>';

  // A themed skin ships its OWN override stylesheet, injected here.
  if (th.css) root.insertAdjacentHTML('afterbegin', '<style class="theme-style">' + th.css + '</style>');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const fmt = (n: number): string => (typeof n === 'number' ? n.toLocaleString() : n);
  // Compact display: raw under 1000, dotted-grouped digits under 1e6, then the shared website-style
  // suffix ladder (K/M/B/T/q/Q/s/S/O/N/D, then aa, ab, …) — so even tier-21 HP (~1e34) renders.
  const abbr = (n: number): string => {
    n = Math.floor(n || 0);
    if (n < 1000) return String(n);
    if (n < 1e6) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const { m, group } = bigGroup(n);
    return (m < 10 ? m.toFixed(3) : m < 100 ? m.toFixed(2) : m.toFixed(1)) + bigSuffix(group);
  };
  // Compact CURRENCY display, e.g. "1.034m" / "12.3k": always suffixed from 1000 up (no dotted-digit
  // band) and lowercased for the everyday tiers (k/m/b/t = 1e3..1e12). Tiers past T keep the shared
  // ladder's case so the distinct q≠Q / s≠S suffixes never collide on huge banked totals.
  const cur = (n: number): string => {
    n = Math.floor(n || 0);
    if (n < 1000) return String(n);
    const { m, group } = bigGroup(n);
    const suf = bigSuffix(group);
    return (m < 10 ? m.toFixed(3) : m < 100 ? m.toFixed(2) : m.toFixed(1)) + (group <= 4 ? suf.toLowerCase() : suf);
  };
  const sumPerm = (meta: Meta): number => Object.values((meta && meta.perm) || {}).reduce((a, b) => a + b, 0);
  // An upgrade's DISPLAYED value as the EFFECTIVE number the sim runs on: base curve × labs × active
  // cards × cosmetics (so a Damage row reflects every multiplier, not just the raw per-level number).
  // Parity is guaranteed — effectiveUpgradeValue drives the real computeStats; no formula duplication.
  const buffedVal = (meta: Meta, up: UpgradeDef, level: number): number => effectiveUpgradeValue(meta, up.id, level);
  // The player's full coin multiplier (tier × Tier Coin lab × Coins card × coin cosmetic), rounded to
  // 2dp so lab/card fractions show. `pre` is the leading glyph ('x' or '×') matching each call site.
  const coinMultText = (meta: Meta, tier: number, pre = 'x'): string => pre + Math.round(effectiveCoinMult(meta, tier) * 100) / 100;
  // "⏸" for the 0x (pause) step, else "0.5x" / "1x" / "2.5x" — dropping the trailing ".0" on whole multipliers.
  const fmtSpeed = (v: number): string => (v === 0 ? '⏸' : (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'x');

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
    critChance: 'crit', critDamage: 'burst', gold: 'coin',
    thorns: 'shield', msChance: 'bow', bounceChance: 'arrow', rendMult: 'burst', range: 'range', interest: 'coin' };
  const STAT_LABEL: Record<string, string> = { rangedDamage: 'Damage', attackSpeed: 'Speed', health: 'HP', regen: 'Regen',
    critChance: 'Crit', critDamage: 'Crit Dmg', gold: 'Gold',
    thorns: 'Disintegrate', msChance: 'Lightning', bounceChance: 'Lightning Arc', rendMult: 'Amp', range: 'Range', interest: 'Interest' };
  // currencies shown on the Hero screen
  const CURRENCIES: { key: 'coins' | 'gems' | 'vials' | 'energy'; icon: string; cls: string }[] = [
    { key: 'coins', icon: 'coinstar', cls: 'coin' },
    { key: 'gems', icon: 'gem', cls: 'gem' },
    { key: 'vials', icon: 'vial', cls: 'vial' },
    { key: 'energy', icon: 'atom', cls: 'energy' },
  ];
  const CUR_BY_KEY: Record<string, { icon: string; cls: string }> = {};
  for (const c of CURRENCIES) CUR_BY_KEY[c.key] = { icon: c.icon, cls: c.cls };
  const curAmount = (meta: Meta, k: string): number =>
    (k === 'coins' ? meta.coins : k === 'gems' ? meta.gems : k === 'vials' ? meta.vials : k === 'energy' ? meta.energy : 0) || 0;
  // Hexagon currency chips (the home-screen gemstone style) for any set of currency keys. Each chip
  // carries a cur-<key> class so the D&D skin tints it per currency (see dnd.ts).
  function curChips(meta: Meta, keys: string[]): string {
    return '<div class="chips">' + keys.map((k) => {
      const d = CUR_BY_KEY[k];
      return '<span class="chip cur-' + k + '">' + icon(d.icon, 13, d.cls) + ' <b>' + abbr(curAmount(meta, k)) + '</b></span>';
    }).join('') + '</div>';
  }
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
  // Render a card tile. Pass `slot >= 0` for the smaller ACTIVE variant: it carries its slot index
  // (tap → free the slot) and a class the CSS scales down inside the horizontal active strip.
  function cardHtml(card: CardInstance, slot?: number, equipped?: boolean): string {
    const def = CARDS[card.id];
    if (!def) return '';
    const stars = card.stars || 0;
    const active = slot !== undefined && slot >= 0;
    return (
      '<div class="card' + (active ? ' actcard' : '') + (equipped ? ' equipped' : '') + ' tier-' + tierOf(stars) + '" data-card="' + card.id + '"' +
      (active ? ' data-aslot="' + slot + '"' : '') + ' style="--tint:' + def.tint + '">' +
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
  // An empty active slot: a card-shaped holder (like a locked card, but inviting a card in).
  function emptyHolderHtml(): string {
    return '<div class="card cardholder"><div class="card-img">' + icon('cardslot', 34) + '</div>' +
      '<div class="card-name">Empty Slot</div><div class="holder-tip">click a card to equip it</div></div>';
  }
  // A buy-slot holder: same card-holder look, but clicking it purchases another active slot for gems.
  function buySlotHolderHtml(cost: number, affordable: boolean): string {
    return '<div class="card cardholder buyslot' + (affordable ? '' : ' cant') + '" data-buyslot="1">' +
      '<div class="card-img">' + icon('gem', 30, 'gem') + '</div>' +
      '<div class="buyslot-amt">' + cost + '</div>' +
      '<div class="card-name">Buy Slot</div>' +
      '<div class="holder-tip">click to unlock a slot</div></div>';
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
      '<div class="revealcard tier-' + tierOf(after) + '" data-card="' + r.id + '" style="--tint:' + def.tint + '">' + cardInner + '</div>' +
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
    const activeIds = new Set(activeCardIds(meta)); // mark equipped cards so they read as "active"
    let h = '';
    for (let i = 0; i < CARD_SLOTS; i++) {
      const id = CARD_ORDER[i];
      const have = id && owned.find((c) => c.id === id);
      h += have ? cardHtml(have, undefined, activeIds.has(id)) : lockedCardHtml();
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
      '<div class="cmhead" data-card="' + id + '" style="--tint:' + def.tint + '">' +
      '<div class="cm-medal">' + icon(def.art, 30) + '</div>' +
      '<div class="cm-title"><b>' + def.name + '</b><span class="cm-rarity ' + def.rarity + '">' + def.rarity + '</span>' +
      (info ? '<span>' + info + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="cm-sub">Bonus per level · <b>' + stars + '</b>/' + MAX_STARS + '</div>' + rows;
    $('#h-cardmodal').classList.remove('hide');
  }

  // The ACTIVE-CARDS strip: one tile per slot. Filled slots show the equipped card (smaller, tap to
  // unequip / free the slot); empty slots show a holder. Horizontally scrollable once it overflows.
  function activeCardsHtml(meta: Meta): string {
    const slots = Math.max(1, meta.cardSlots || 1);
    const active = meta.activeCards || [];
    const owned = meta.cards || [];
    let h = '<div class="activecards">';
    for (let i = 0; i < slots; i++) {
      const id = active[i];
      const inst = id && CARDS[id] ? owned.find((c) => c.id === id) : null;
      h += inst ? cardHtml(inst, i) : emptyHolderHtml();
    }
    // trailing holder to buy another slot (until the cap), styled like an empty slot
    if (slots < MAX_CARD_SLOTS) {
      const cost = cardSlotCost(meta);
      h += buySlotHolderHtml(cost, (meta.gems || 0) >= cost);
    }
    return h + '</div>';
  }
  // Equip an owned card into the first free slot. Returns 'ok' | 'active' (already equipped) | 'full'.
  function equipCard(id: string): 'ok' | 'active' | 'full' {
    if (!lastMeta) return 'full';
    const slots = Math.max(1, lastMeta.cardSlots || 1);
    const active = (lastMeta.activeCards || []).slice(0, slots);
    if (active.indexOf(id) >= 0) return 'active'; // a card can occupy only one slot
    let free = -1;
    for (let i = 0; i < slots; i++) if (!active[i] || !CARDS[active[i]]) { free = i; break; }
    if (free < 0) return 'full';
    return handlers.onSetActiveCard && handlers.onSetActiveCard(free, id) ? 'ok' : 'full';
  }
  // Press-vs-hold gesture: a quick tap fires onTap; holding HOLD_MS opens the info popup (no tap).
  const HOLD_MS = 300;
  function bindCardPress(el: HTMLElement, onTap: () => void, onHold: () => void): void {
    let held = false;
    let timer = 0;
    const clear = (): void => { if (timer) { clearTimeout(timer); timer = 0; } };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; // primary / touch only
      held = false;
      clear();
      timer = window.setTimeout(() => { held = true; timer = 0; onHold(); }, HOLD_MS);
    });
    el.addEventListener('pointerup', () => { clear(); if (!held) onTap(); });
    el.addEventListener('pointerleave', () => { clear(); held = true; }); // sliding off cancels the tap
    el.addEventListener('pointercancel', () => { clear(); held = true; });
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press shouldn't pop the OS menu
  }

  // ---------- shared CARDS pane (the Workshop "cards" tab AND the in-game cards modal) ----------
  // One source of HTML + wiring, so managing cards mid-run behaves exactly like the menu tab.
  // `rerender` is the refresh to run after a change (renderMenu, or the modal's own re-render).
  function cardsPaneHtml(meta: Meta): string {
    const owned = meta.cards || [];
    const bc = buyCardCost(meta);
    // A draw is impossible only once every card type is owned AND maxed (the non-maxed pool is
    // empty) — mirrors buyCard()'s own guard so the button greys out instead of shaking.
    const allMaxed = Object.keys(CARDS).every((id) => {
      const c = owned.find((x) => x.id === id);
      return c && (c.stars || 0) >= MAX_STARS;
    });
    const slots = Math.max(1, meta.cardSlots || 1);
    // One centered column so the chip, headers, active strip and grid all share a left edge.
    let html = '<div class="cardspane">';
    // Top row: gem balance + slot count on the left, the Draw Card action sized to its content on the right.
    html += '<div class="cards-top">' +
      '<div class="chips">' +
        '<span class="chip cur-gems">' + icon('gem', 13, 'gem') + ' <b>' + abbr(meta.gems || 0) + '</b></span>' +
        '<span class="chip cur-slot">' + icon('cards', 13) + ' <b>' + activeCardIds(meta).length + '/' + slots + '</b></span>' +
      '</div>' +
      '<button class="cardbtn draw' + ((meta.gems || 0) < bc || allMaxed ? ' cant' : '') + '" id="h-buycard"' + (allMaxed ? ' disabled' : '') + '>' +
      '<span class="cb-ic">' + icon('cards', 24) + '</span>' +
      '<span class="cb-tx"><span class="cb-t">Draw Card</span><span class="cb-s">' + (allMaxed ? 'All maxed!' : 'New card or +1 level') + '</span></span>' +
      '<span class="cb-cost">' + bc + ' ' + icon('gem', 13, 'gem') + '</span></button>' +
      '</div>';
    // Active cards: only these affect a run. Tap a collection card to equip it into a free slot;
    // tap an active card to unequip it. Hold any card for its details. The last tile buys a slot.
    html += '<div class="cards-section-h">Active Cards <span class="ac-count">' + activeCardIds(meta).length + '/' + slots + '</span></div>';
    html += activeCardsHtml(meta);
    html += '<div class="cards-section-h">Collection</div>';
    html += '<div class="cardgrid">' + cardGridHtml(meta) + '</div>';
    html += '</div>';
    return html;
  }
  function wireCardsPane(scope: HTMLElement, rerender: () => void): void {
    const bb = scope.querySelector<HTMLElement>('#h-buycard');
    if (bb) bb.addEventListener('click', () => {
      const r = handlers.onBuyCard && handlers.onBuyCard();
      if (r) {
        rerender();
        revealCard(r);
      } else shake(bb);
    });
    // Every card tile (active strip + collection): tap acts, hold opens the info popup.
    scope.querySelectorAll<HTMLElement>('.card[data-card]').forEach((el) => {
      const id = el.dataset.card!;
      const aslot = el.dataset.aslot; // present only on ACTIVE cards
      bindCardPress(
        el,
        () => {
          if (aslot !== undefined) {
            // active card → unequip (free the slot)
            if (handlers.onSetActiveCard && handlers.onSetActiveCard(parseInt(aslot, 10), null)) rerender();
          } else {
            // collection card → equip into the first free slot
            const r = equipCard(id);
            if (r === 'ok') rerender();
            else if (r === 'full') shake(el); // no free slot — tap an active card to free one
            // 'active' → already equipped, no-op
          }
        },
        () => openCardModal(id),
      );
    });
    // Buy-slot holder: a click purchases another active slot.
    scope.querySelectorAll<HTMLElement>('[data-buyslot]').forEach((el) =>
      el.addEventListener('click', () => {
        if (handlers.onBuyCardSlot && handlers.onBuyCardSlot()) rerender();
        else shake(el);
      }),
    );
  }

  // ---------- shared LABS pane (the Workshop "labs" tab AND the in-game labs modal) ----------
  function labsPaneHtml(meta: Meta): string {
    const used = (meta.research || []).length,
      slots = meta.labSlots || 1;
    let html = '<div class="cur-with-slot">' + curChips(meta, ['coins', 'gems', 'vials']) +
      '<span class="slotchip">' + icon('flask', 13) + ' ' + used + '/' + slots + '</span></div>';
    html += '<div class="labslots">' + labSlotsHtml(meta) + '</div>';
    const sc = labSlotCost(meta),
      canSlot = slots < MAX_SLOTS;
    if (canSlot) html += '<button class="slotbtn' + ((meta.gems || 0) < sc ? ' cant' : '') + '" id="h-buyslot">+1 Slot · ' + sc + ' ' + icon('gem', 13, 'gem') + '</button>';
    return html;
  }
  function wireLabsPane(scope: HTMLElement, rerender: () => void): void {
    // Clicking an empty vial slot opens the lab picker modal.
    scope.querySelectorAll<HTMLElement>('[data-pickslot]').forEach((el) =>
      el.addEventListener('click', () => openLabPicker(rerender)),
    );
    // "Change" frees this slot (refunds the in-progress research) and opens the picker so you can
    // start a different lab — you rarely want to just STOP, you want to switch what's researching.
    scope.querySelectorAll<HTMLElement>('[data-changelab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handlers.onCancelResearch && handlers.onCancelResearch(b.dataset.changelab!)) {
          rerender();
          openLabPicker(rerender);
        }
      }),
    );
    scope.querySelectorAll<HTMLElement>('[data-rushlab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handlers.onRushResearch && handlers.onRushResearch(b.dataset.rushlab!)) rerender();
        else shake(b);
      }),
    );
    const sb = scope.querySelector<HTMLElement>('#h-buyslot');
    if (sb) sb.addEventListener('click', () => {
      if (handlers.onBuyLabSlot && handlers.onBuyLabSlot()) rerender();
      else shake(sb);
    });
  }

  // ---------- shared SUPERPOWERS pane (the Prestige tab) ----------
  // Energy chip + one panel per power: unlock button (Energy, by purchase order) when locked, else a
  // pause toggle and a row per upgrade track (live value, level, Energy cost).
  function eIc(sz = 13): string { return icon('atom', sz); }
  // Every track label rendered as an icon. "Gold/Coin ×" (ids mult/gold) → gold + coin with a +.
  function superTrackLabel(trackId: string, label: string): string {
    switch (trackId) {
      case 'cooldown': return icon('refresh', 15);
      case 'duration': return icon('stopwatch', 15);
      case 'width': return icon('ruler', 15);
      case 'count': return icon('crystal', 15);
      case 'gems': return icon('gem', 15, 'gem');
      case 'vials': return icon('vial', 15, 'vial');
      case 'energy': return icon('atom', 15);
    }
    if (label === 'Gold/Coin ×') return icon('coin', 15, 'gold') + '<span class="spt-plus">+</span>' + icon('coinstar', 14);
    return label;
  }
  function superPaneHtml(meta: Meta): string {
    const e = meta.energy || 0;
    const nextCost = nextUnlockCost(meta);
    let html = curChips(meta, ['energy']);
    html += '<div class="superlist">';
    for (const sp of SUPERPOWERS) {
      const unlocked = superUnlocked(meta, sp.id);
      html += '<div class="superpower' + (unlocked ? '' : ' locked') + '">';
      html += '<div class="sp-head">' + icon(sp.icon, 20) + '<b>' + sp.name + '</b><span class="sp-cat">' + sp.cat + '</span></div>';
      html += '<div class="sp-blurb">' + sp.blurb + '</div>';
      if (!unlocked) {
        const afford = nextCost > 0 && e >= nextCost;
        html += '<button class="slotbtn sp-unlock' + (afford ? '' : ' cant') + '" data-superunlock="' + sp.id + '">Unlock · ' + abbr(nextCost) + ' ' + eIc(13) + '</button>';
      } else {
        const on = superEnabled(meta, sp.id);
        html += '<button class="sp-toggle' + (on ? ' on' : '') + '" data-supertoggle="' + sp.id + '">' + (on ? 'Enabled' : 'Paused') + '</button>';
        html += '<div class="sp-tracks">';
        for (const tr of sp.tracks) {
          const lvl = superLevel(meta, sp.id, tr.id), val = trackValue(meta, sp.id, tr.id);
          const max = trackAtMax(meta, sp.id, tr.id), cost = trackCost(meta, sp.id, tr.id);
          html += '<div class="sp-track">' +
            '<span class="spt-label" title="' + tr.label + '">' + superTrackLabel(tr.id, tr.label) + '</span>' +
            '<span class="spt-val">' + tr.fmt(val) + '</span>' +
            '<span class="spt-lvl">' + lvl + '/' + tr.max + '</span>' +
            (max
              ? '<span class="spt-buy max">MAX</span>'
              : '<button class="spt-buy' + (e >= cost ? '' : ' cant') + '" data-supertrack="' + sp.id + '.' + tr.id + '">' + abbr(cost) + ' ' + eIc(11) + '</button>') +
            '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }
  function wireSuperPane(scope: HTMLElement, rerender: () => void): void {
    scope.querySelectorAll<HTMLElement>('[data-superunlock]').forEach((b) =>
      b.addEventListener('click', () => {
        if (handlers.onBuySuperpower && handlers.onBuySuperpower(b.dataset.superunlock!)) rerender();
        else shake(scope.querySelector('.coins-chip'));
      }),
    );
    scope.querySelectorAll<HTMLElement>('[data-supertoggle]').forEach((b) =>
      b.addEventListener('click', () => {
        if (handlers.onToggleSuperpower) handlers.onToggleSuperpower(b.dataset.supertoggle!);
        rerender();
      }),
    );
    scope.querySelectorAll<HTMLElement>('[data-supertrack]').forEach((b) =>
      b.addEventListener('click', () => {
        const [sp, tr] = b.dataset.supertrack!.split('.');
        if (handlers.onBuySuperTrack && handlers.onBuySuperTrack(sp, tr)) rerender();
        else shake(scope.querySelector('.coins-chip'));
      }),
    );
  }

  // ---------- in-game tab bar (3 icon subtabs: attack / defense / economic) ----------
  const tabsEl = $('#h-tabs'),
    contentEl = $('#h-tabcontent');
  const rowEls: Record<string, { btn: HTMLElement; cur: HTMLElement; nxt: HTMLElement; cost: HTMLElement; lv: HTMLElement; mult: HTMLElement }> = {};
  // ---- bulk-buy multiplier (the 1x/5x/25x/100x/Max toggle left of each upgrade's buy button) ----
  // Per-upgrade selected quantity, tracked separately for the in-run HUD and the Workshop menu so a
  // choice in one context doesn't leak into the other. Absent = 1x.
  const runBulkSel: Record<string, BulkQty> = {};
  const permBulkSel: Record<string, BulkQty> = {};
  const bulkLabel = (q: BulkQty): string => (q === 'max' ? 'Max' : q + 'x');
  // The selection clamped to a currently-unlocked tier (1x if it's no longer available).
  function bulkSelOf(sel: Record<string, BulkQty>, meta: Meta, id: string): BulkQty {
    const cur = sel[id] ?? 1;
    return availableBulkTiers(meta).some((t) => t.qty === cur) ? cur : 1;
  }
  // Advance an upgrade to the next unlocked tier, wrapping (1x → 5x → … → Max → 1x).
  function cycleBulk(sel: Record<string, BulkQty>, meta: Meta, id: string): void {
    const tiers = availableBulkTiers(meta);
    let i = tiers.findIndex((t) => t.qty === (sel[id] ?? 1));
    if (i < 0) i = 0;
    sel[id] = tiers[(i + 1) % tiers.length].qty;
  }
  let activeTab = TAB_DEFS[0].id,
    tabOpen = false,
    taughtTabs = false;
  // ---- in-run "temporary upgrades" tutorial (see runTut(), driven from update()) ----
  // Step the player is on, or null when inactive. While active the tab bar is locked to the step's
  // target tab and only the target upgrade is buyable; a floating "Skip tutorial" button can bail out
  // at any point. On completion a recap modal explains run-vs-Workshop permanence.
  type IrStep = 'damage' | 'health';
  let irStep: IrStep | null = null;
  const irTargetId = (): string | null => (irStep === 'damage' ? 'rangedDamage' : irStep === 'health' ? 'health' : null);
  const irTargetTab = (): string => (irStep === 'health' ? 'defense' : 'attack');
  const irLocked = (): boolean => irStep === 'damage' || irStep === 'health';
  // Does a tab have at least one buyable (unlocked) upgrade right now? Locked-only tabs (e.g. the
  // gated Utility/economic tab before it's bought in the Workshop) render empty, so we never open them.
  function tabHasContent(tab: string, meta: Meta | null): boolean {
    if (!meta) return true;
    for (const u of upgradesIn(tab)) if (isUnlocked(meta, u.id)) return true;
    return false;
  }
  TAB_DEFS.forEach((tab) => {
    const b = document.createElement('button');
    b.innerHTML = icon(tab.icon, 22);
    b.dataset.tab = tab.id;
    b.title = tab.id;
    b.addEventListener('click', () => {
      if (irLocked()) return; // locked to the tutorial's target tab while a step is in progress
      const opening = !(tabOpen && activeTab === tab.id);
      // An empty (locked-only) tab never opens — show a tip that it unlocks with coins in the Workshop.
      if (opening && !tabHasContent(tab.id, lastS ? lastS.meta : null)) {
        showUnlockTip(b, 'Unlock with ' + coinsIc(12) + ' in the Workshop');
        return;
      }
      tabOpen = opening;
      activeTab = tab.id;
      taughtTabs = true;
      $('#h-tabbar').classList.remove('pulse');
      renderTabButtons();
      renderTabContent();
    });
    tabsEl.appendChild(b);
  });
  function renderTabButtons(): void {
    const lock = irLocked(),
      tgtTab = irTargetTab();
    for (const b of Array.from(tabsEl.children) as HTMLElement[]) {
      b.classList.toggle('on', tabOpen && b.dataset.tab === activeTab);
      // during an interactive tutorial step: pulse the target tab, dim + disable the rest
      b.classList.toggle('tut', lock && b.dataset.tab === tgtTab);
      b.classList.toggle('tut-off', lock && b.dataset.tab !== tgtTab);
    }
  }
  function renderTabContent(): void {
    contentEl.innerHTML = '';
    for (const k in rowEls) delete rowEls[k];
    contentEl.className = 'tabcontent' + (tabOpen ? '' : ' collapsed');
    if (!tabOpen) return;
    // Inside a run, hide skills that aren't unlocked yet (unlocking is Workshop-only, so the locked
    // set is fixed for the whole run). Fall back to showing all only before the first frame sets meta.
    const meta = lastS ? lastS.meta : null;
    for (const u of upgradesIn(activeTab)) {
      if (meta && !isUnlocked(meta, u.id)) continue;
      const btn = document.createElement('button');
      btn.className = 'up';
      btn.innerHTML = '<span class="phead">' + icon(u.icon, 18) + '<span class="pname">' + u.label + '</span><span class="plv uplv"></span></span>' +
        '<span class="pcur"><span class="cur"></span><span class="nxt"></span></span>' +
        '<span class="pcost"><span class="bmult" role="button"></span><span class="cost"></span></span>';
      const mult = btn.querySelector('.bmult') as HTMLElement;
      // the multiplier toggle lives INSIDE the card-button, so stop the click from also buying.
      mult.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!lastS) return;
        cycleBulk(runBulkSel, lastS.meta, u.id);
        update(lastS); // reflect the new tier (label + cost + enabled state) immediately
      });
      btn.addEventListener('click', () => {
        if (!lastS) return;
        if (!isUnlocked(lastS.meta, u.id)) return; // locked skills are not buyable in-run (Workshop only)
        const qty = bulkSelOf(runBulkSel, lastS.meta, u.id);
        if (!runBulkPlan(lastS, u.id, qty).canBuy) {
          shake(root.querySelector('.stat.gold'));
          return;
        }
        handlers.onBuyRun && handlers.onBuyRun(u.id, qty);
      });
      contentEl.appendChild(btn);
      rowEls[u.id] = { btn, cur: btn.querySelector('.cur')!, nxt: btn.querySelector('.nxt')!, cost: btn.querySelector('.cost')!, lv: btn.querySelector('.uplv')!, mult };
    }
    // tutorial: spotlight + only the step's target upgrade is buyable (the rest are dimmed/inert).
    const tgt = irTargetId();
    contentEl.classList.toggle('ir-lock', !!tgt);
    if (tgt) for (const id in rowEls) rowEls[id].btn.classList.toggle('ir-target', id === tgt);
  }

  let lastS: State | null = null;
  renderTabContent();

  // Floating check-in button: fixed bottom-left, a little above the DEV toggle. Shows the pending
  // check-in reward as wrapped icon+number chips, in BOTH the menu and in-game, and is HIDDEN whenever
  // nothing is claimable (no idle "next reward in…" countdown). Clicking claims the check-in.
  const checkinFloat = document.createElement('button');
  checkinFloat.id = 'h-checkin-float';
  checkinFloat.className = 'checkin-float hide';
  root.appendChild(checkinFloat);
  checkinFloat.addEventListener('click', () => {
    if (handlers.onCheckIn && handlers.onCheckIn()) {
      refreshCheckinFloat();
      if (menuEl.classList.contains('show')) renderMenu();
    }
  });
  function refreshCheckinFloat(): void {
    const meta = boundMeta || lastMeta || (lastS ? lastS.meta : null);
    const pend = meta ? checkInPending(meta, Date.now()) : 0;
    if (pend <= 0) {
      checkinFloat.classList.add('hide');
      return;
    }
    // No label — each currency reward on its own line (icon + amount).
    checkinFloat.innerHTML =
      '<span class="cf-chip">' + icon('vial', 14, 'vial') + ' +' + pend * CHECKIN_VIALS + '</span>' +
      '<span class="cf-chip">' + icon('gem', 14, 'gem') + ' +' + pend * CHECKIN_GEMS + '</span>';
    checkinFloat.classList.remove('hide');
  }

  // ---- battle-speed toggle (top bar): cycles through the currently-selectable speeds ----
  const curMeta = (): Meta | null => boundMeta || lastMeta || (lastS ? lastS.meta : null);
  function refreshSpeedBtn(): void {
    const m = curMeta();
    const el = $('#h-speedval');
    if (m && el) el.textContent = fmtSpeed(gameSpeed(m));
  }
  $('#h-speed').addEventListener('click', () => {
    const m = curMeta();
    if (!m) return;
    const speeds = availableSpeeds(m);
    const i = speeds.indexOf(gameSpeed(m));
    const next = speeds[(i + 1) % speeds.length]; // wrap past the top back to 0x (pause)
    if (handlers.onSetGameSpeed) handlers.onSetGameSpeed(next);
    refreshSpeedBtn();
  });

  // top-bar elements are static chrome (built once); cache them instead of re-querying every frame
  let uel: Record<string, HTMLElement> | null = null;
  function shake(el: Element | null): void {
    if (!el) return;
    el.classList.remove('shake');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('shake');
  }
  // ---- in-run "temporary upgrades" tutorial (player's first NORMAL run) ----
  // Fires once, the first moment the player can afford one Damage + one Health upgrade. Forces buying
  // one of each, then explains run upgrades are temporary (the Workshop's are permanent). Persisted via
  // meta.inRunTutDone — set the instant both are bought, so a mid-run death can't make it repeat.
  let irDmgBase = 0, irHpBase = 0, irLastState: State | null = null;
  const skipBtn = $('#h-tutskip');
  skipBtn.addEventListener('click', () => skipTut());
  function updateSkipBtn(): void {
    skipBtn.classList.toggle('hide', !irLocked());
  }
  function irForceTab(tab: string): void {
    if (tabOpen && activeTab === tab) return;
    activeTab = tab;
    tabOpen = true;
    renderTabButtons();
    renderTabContent();
  }
  // Tear down the active lesson (spotlight + tab lock + skip button). `done` banks meta.inRunTutDone
  // so a skipped/finished tutorial never returns; a fresh-run abandon leaves the flag untouched.
  function endTut(done: boolean): void {
    irStep = null;
    if (done && lastS) { lastS.meta.inRunTutDone = true; handlers.onSaveMeta && handlers.onSaveMeta(); }
    setSpotlight(false);
    renderTabButtons();
    renderTabContent();
    updateSkipBtn();
  }
  function skipTut(): void {
    if (!irStep) return;
    endTut(true);
  }
  function runTut(s: State): void {
    const meta = s.meta;
    // A fresh run object means the player restarted; abandon a half-finished lesson so it can't get
    // stuck spotlighting an unaffordable upgrade. The flag stays unset, so it can fire again later.
    if (irLastState !== s) {
      irLastState = s;
      if (irStep) endTut(false);
    }
    if (!irStep) {
      if (s.firstRun || meta.inRunTutDone || settings.showTutorials === false) return;
      if (!isUnlocked(meta, 'rangedDamage') || !isUnlocked(meta, 'health')) return;
      if (runAtMax(s, 'rangedDamage') || runAtMax(s, 'health')) return;
      if (s.econ.gold < runUpgradeCost(s, 'rangedDamage') + runUpgradeCost(s, 'health')) return;
      irStep = 'damage';
      irDmgBase = boughtOf(s, 'rangedDamage');
      irHpBase = boughtOf(s, 'health');
      taughtTabs = true;
      if (uel) uel.tabbar.classList.remove('pulse');
      irForceTab('attack');
    }
    if (irStep === 'damage') {
      irForceTab('attack');
      if (boughtOf(s, 'rangedDamage') > irDmgBase) { irStep = 'health'; irForceTab('defense'); }
    }
    if (irStep === 'health') {
      irForceTab('defense');
      if (boughtOf(s, 'health') > irHpBase) {
        endTut(true); // mandatory part (buy one of each) is done — unlock, bank the flag, then recap
        showInfoModal({
          accent: 'amber',
          iconName: 'prestige',
          title: 'Run upgrades are temporary',
          body: 'Upgrades you buy <b>during a run</b> vanish when it ends. To grow <b>permanently</b>, spend your ' +
            coinsIc(14) + ' on upgrades in the <b>Workshop</b> between runs.',
          primary: 'Got it',
          dontShowAgain: { key: 'showTutorials', label: "Don't show tutorials again" },
        });
        return;
      }
    }
    updateSkipBtn();
    // spotlight the step's target upgrade every frame (so it tracks any layout shift)
    const tgt = irTargetId();
    const btn = tgt && rowEls[tgt] ? rowEls[tgt].btn : null;
    setSpotlight(!!btn, btn, irStep === 'damage'
      ? 'Buy <b>Damage</b> — upgrades bought in a run last only this game'
      : 'Now buy <b>Health</b> — these reset when the run ends');
  }

  function update(s: State): void {
    lastS = s;
    if (!uel)
      uel = {
        wave: $('#h-wave'), hp: $('#h-hp'), gold: $('#h-gold'),
        coins: $('#h-coins'), gems: $('#h-gems'), vials: $('#h-vials'), energy: $('#h-energy'),
        dmg: $('#h-dmg'), regen: $('#h-regen'), coinmult: $('#h-coinmult'), fhp: $('#h-fhp'), fdmg: $('#h-fdmg'),
        hpfill: $('#h-hpfill'), wavefill: $('#h-wavefill'), statline: $('#h-statline'),
        tabbar: $('#h-tabbar'), stats: $('#h-stats'), speedval: $('#h-speedval'),
      };
    runTut(s);
    const tier = s.meta.tier || 1;
    uel.speedval.textContent = fmtSpeed(gameSpeed(s.meta));
    uel.wave.textContent = String(s.wave.n);
    // currency strip: in-run gold + banked meta currencies.
    uel.gold.textContent = cur(s.econ.gold);
    uel.coins.textContent = cur(s.meta.coins || 0);
    uel.gems.textContent = cur(s.meta.gems || 0);
    uel.vials.textContent = cur(s.meta.vials || 0);
    uel.energy.textContent = cur(s.meta.energy || 0);
    // our live stats (damage / regen / coin multiplier) from computeStats; the baseline enemy's HP/dmg
    // from the wave-strength curve at this (tier-scaled) wave.
    const st = computeStats(s);
    uel.dmg.textContent = abbr(Math.round(st.rangedDamage));
    uel.regen.textContent = abbr(Math.round(st.regen)) + '/s';
    uel.coinmult.textContent = coinMultText(s.meta, tier);
    const tm = tierMult(tier);
    uel.fhp.textContent = abbr(Math.max(1, Math.round(TYPES.melee.hp * waveHp(s.wave.n) * tm)));
    uel.fdmg.textContent = abbr(Math.max(1, Math.round(TYPES.melee.dmg * waveDmg(s.wave.n) * tm)));
    // HP: number + an inline bar that drains as the hero is hurt (low-HP danger pulse).
    uel.hp.textContent = abbr(Math.ceil(s.hero.hp)) + '/' + abbr(Math.ceil(s.hero.hpMax));
    const hpf = s.hero.hpMax > 0 ? Math.max(0, Math.min(1, s.hero.hp / s.hero.hpMax)) : 0;
    uel.hpfill.style.width = hpf * 100 + '%';
    uel.statline.classList.toggle('low', hpf > 0 && hpf <= 0.3);
    // enemy panel's wave-cooldown bar: fills toward the next wave (respects Accelerator).
    if (!s.firstRun) {
      const effInt = WAVE.interval * (1 - (st.waveAccel || 0));
      uel.wavefill.style.width = Math.max(0, Math.min(1, s.wave.clock / Math.max(0.001, effInt))) * 100 + '%';
    }
    if (!taughtTabs && !s.firstRun && !tabOpen) {
      let min = Infinity;
      for (const u of UPGRADES) {
        if (runAtMax(s, u.id)) continue;
        min = Math.min(min, runUpgradeCost(s, u.id));
      }
      uel.tabbar.classList.toggle('pulse', s.econ.gold >= min);
    }
    if (tabOpen) {
      for (const u of upgradesIn(activeTab)) {
        const r = rowEls[u.id];
        if (!r) continue;
        const bought = boughtOf(s, u.id);
        r.cur.textContent = u.fmt(buffedVal(s.meta, u, bought));
        // LOCKED skills: disabled, lock glyph, not buyable in-run (unlock is Workshop-only).
        if (!isUnlocked(s.meta, u.id)) {
          r.lv.innerHTML = icon('lock', 13);
          r.nxt.textContent = '';
          r.cost.textContent = 'Locked';
          r.mult.style.display = 'none';
          r.btn.classList.add('cant');
          continue;
        }
        r.lv.textContent = bought + '/' + upgradeCap(s.meta, u.id);
        if (runAtMax(s, u.id)) {
          r.nxt.textContent = '';
          r.cost.textContent = 'MAX';
          r.mult.style.display = 'none';
          r.btn.classList.add('cant');
        } else {
          // the multiplier toggle shows only when more than the base 1x tier is unlocked.
          const qty = bulkSelOf(runBulkSel, s.meta, u.id);
          r.mult.style.display = availableBulkTiers(s.meta).length > 1 ? '' : 'none';
          r.mult.textContent = bulkLabel(qty);
          const plan = runBulkPlan(s, u.id, qty);
          // show the price you'd actually pay: the full batch for a fixed qty, the affordable prefix for Max.
          const shown = qty === 'max' ? plan.cost : plan.full;
          r.nxt.textContent = u.fmt(buffedVal(s.meta, u, Math.min(u.max, bought + Math.max(1, plan.count))));
          r.cost.textContent = fmt(shown) + ' g';
          r.btn.classList.toggle('cant', !plan.canBuy);
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
  // Which stats modal is open (so the per-frame refresh updates the right live values).
  let statsView: 'player' | 'enemy' | null = null;
  const strow = (l: string, v: string, id?: string, ic?: string): string =>
    '<div class="strow"><span>' + (ic ? icon(ic, 14) + ' ' : '') + l + '</span><b' +
    (id ? ' id="st-' + id + '"' : '') + '>' + v + '</b></div>';
  // Live values that tick while a modal is open (re-render would drop handlers, so we patch by id).
  function refreshStats(s: State): void {
    const set = (id: string, v: string): void => { const e = $('#st-' + id); if (e) e.textContent = v; };
    if (statsView === 'player') {
      set('kd', fmt(s.econ.killsByDamage));
      set('kr', fmt(s.econ.killsByReflect));
      set('dt', abbr(Math.round(s.econ.dmgTaken)));
      set('dd', abbr(Math.round(s.econ.dmgDealt)));
      set('rd', abbr(Math.round(s.econ.reflectDealt)));
      set('skip', fmt(s.econ.wavesSkipped || 0));
      set('gold', cur(s.econ.goldEarned));
      set('run', cur(s.firstRun ? FIRST_PERM_COST : coinsForRun(s, s.meta.tier || 1)));
    } else if (statsView === 'enemy') {
      set('active', String(s.enemies.length));
    }
  }
  // Tapping our stat panel: tier / difficulty / coin multiplier + our live combat stats + coins.
  function openPlayerStats(): void {
    const s = lastS;
    if (!s) return;
    const m = boundMeta || s.meta,
      tier = m.tier || 1;
    statsView = 'player';
    $('#h-statscard').innerHTML =
      '<div class="statshead"><h2>Your Stats</h2><button class="iconclose" id="h-stats-close" title="Close">' + icon('close', 18) + '</button></div>' +
      '<div class="statsbody">' +
      strow('Kills by damage', fmt(s.econ.killsByDamage), 'kd', 'sword') +
      strow('Kills by reflect', fmt(s.econ.killsByReflect), 'kr', 'shield') +
      strow('Damage taken', abbr(Math.round(s.econ.dmgTaken)), 'dt', 'heart') +
      strow('Hit damage dealt', abbr(Math.round(s.econ.dmgDealt)), 'dd', 'bow') +
      strow('Reflection damage dealt', abbr(Math.round(s.econ.reflectDealt)), 'rd', 'burst') +
      strow('Waves skipped', fmt(s.econ.wavesSkipped || 0), 'skip', 'ffwd') +
      strow('Gold this run', cur(s.econ.goldEarned), 'gold', 'coin') +
      strow('Coins this run', cur(s.firstRun ? FIRST_PERM_COST : coinsForRun(s, tier)), 'run', 'coinstar') +
      '</div>';
    $('#h-stats-close').addEventListener('click', () => $('#h-stats').classList.add('hide'));
    $('#h-stats').classList.remove('hide');
  }
  // Tapping the enemy panel: wave timing + a per-type spec table (spawn %, HP, ATK, speed, mass).
  const ENEMY_LABELS: Record<string, string> = { melee: 'Grunt', ranged: 'Archer', fast: 'Runner', tank: 'Tank', splitter: 'Splitter', boss: 'Boss' };
  // A small colour-coded "jelly" glyph per enemy type — the silhouette mirrors the in-game body
  // (melee=marble, fast=kite, ranged=prism, tank=halo, boss=frogspawn, splitter=trefoil) and the
  // colour is read live from the registry, so a recolour flows through to this modal automatically.
  function enemyIcon(type: string, size = 16): string {
    const c = (TYPES[type] && TYPES[type].color) || '#ff6b6b';
    const hl = '<circle cx="9" cy="9" r="2.3" fill="#fff" opacity=".6"/>';
    let body: string;
    switch (type) {
      case 'fast': // kite / rhombus
        body = '<path d="M12 2.5 20.5 12 12 21.5 3.5 12Z" fill="' + c + '"/>' + hl;
        break;
      case 'ranged': // prism / hexagon
        body = '<path d="M12 2.4 20.8 7.2V16.8L12 21.6 3.2 16.8V7.2Z" fill="' + c + '"/>' + hl;
        break;
      case 'tank': // halo / ring (even-odd punches the hole)
        body = '<path fill="' + c + '" fill-rule="evenodd" d="M3.5 12a8.5 8.5 0 1 1 17 0 8.5 8.5 0 1 1 -17 0Z M8.2 12a3.8 3.8 0 1 0 7.6 0 3.8 3.8 0 1 0 -7.6 0Z"/>' +
          '<circle cx="8.4" cy="8.4" r="1.6" fill="#fff" opacity=".55"/>';
        break;
      case 'boss': // frogspawn / bubble cluster
        body = '<circle cx="10" cy="13.5" r="6.2" fill="' + c + '"/><circle cx="16.4" cy="9" r="4.2" fill="' + c + '"/>' +
          '<circle cx="17.4" cy="16.4" r="3.4" fill="' + c + '"/><circle cx="8" cy="11" r="1.7" fill="#fff" opacity=".6"/>';
        break;
      case 'splitter': // trefoil / clover
        body = '<circle cx="12" cy="8" r="5.2" fill="' + c + '"/><circle cx="7.8" cy="15" r="5.2" fill="' + c + '"/>' +
          '<circle cx="16.2" cy="15" r="5.2" fill="' + c + '"/><circle cx="10.2" cy="6.8" r="1.6" fill="#fff" opacity=".6"/>';
        break;
      case 'melee':
      default: // marble / glass sphere
        body = '<circle cx="12" cy="12" r="8.6" fill="' + c + '"/>' + hl;
        break;
    }
    return '<svg class="eicon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' + body + '</svg>';
  }
  function openEnemyStats(): void {
    const s = lastS;
    if (!s) return;
    const tier = s.meta.tier || 1,
      tm = tierMult(tier),
      hpMult = waveHp(s.wave.n) * tm,
      dmgMult = waveDmg(s.wave.n) * tm,
      spd = waveSpeed(s.wave.n),
      ch = spawnChances(s.wave.n, (s.meta && s.meta.tier) || 1),
      st = computeStats(s);
    const waveTime = (WAVE.interval * (1 - (st.waveAccel || 0))).toFixed(1) + 's';
    const spawnRateLabel = spawnRate(s.wave.n).toFixed(1) + '/s';
    let rows = '';
    for (const t of ['melee', 'ranged', 'fast', 'tank', 'splitter', 'boss']) {
      const d = TYPES[t];
      if (!d) continue;
      rows += '<tr><td><span class="etype">' + enemyIcon(t) + ENEMY_LABELS[t] + '</span></td><td>' + Math.round((ch[t] || 0) * 100) + '%</td><td>' +
        abbr(Math.max(1, Math.round(d.hp * hpMult))) + '</td><td>' + abbr(Math.max(1, Math.round(d.dmg * dmgMult))) +
        '</td><td>' + Math.round(d.speed * spd) + '</td><td>' + d.mass + '</td></tr>';
    }
    statsView = 'enemy';
    $('#h-statscard').innerHTML =
      '<div class="statshead"><h2>Enemies · Wave ' + s.wave.n + '</h2><button class="iconclose" id="h-stats-close" title="Close">' + icon('close', 18) + '</button></div>' +
      '<div class="statsbody">' +
      strow('Wave time', waveTime) +
      strow('Active enemies', String(s.enemies.length), 'active') +
      strow('Spawn rate', spawnRateLabel) +
      '<table class="enemytbl"><thead><tr><th>Type</th><th>Spawn</th><th>HP</th><th>ATK</th><th>Spd</th><th>Mass</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      '</div>';
    $('#h-stats-close').addEventListener('click', () => $('#h-stats').classList.add('hide'));
    $('#h-stats').classList.remove('hide');
  }
  function toggleStats(open: () => void): void {
    const sw = $('#h-stats');
    if (sw.classList.contains('hide')) open();
    else sw.classList.add('hide');
  }
  $('#h-chart').addEventListener('click', () => toggleStats(openPlayerStats));
  $('#h-sl-us').addEventListener('click', () => toggleStats(openPlayerStats));
  $('#h-sl-enemy').addEventListener('click', () => toggleStats(openEnemyStats));
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
    { key: 'showTutorials', label: 'Show tutorials', icon: 'upgrades' },
    { key: 'showOfflineReward', label: 'Offline summary', icon: 'best' },
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
    // On-screen indicators (read by the renderer) + which guided popups to play. No sim state.
    setmodalInner.innerHTML =
      '<div class="statshead"><h2>Show info</h2><button class="iconclose" id="h-set-close" title="Close">' +
      icon('close', 18) + '</button></div><div class="setbody">' + settingsRowsHtml() + '</div>';
    $('#h-set-close').addEventListener('click', () => setmodal.classList.add('hide'));
    wireSettingsRows(setmodalInner);
    setmodal.classList.remove('hide');
  }
  setmodal.addEventListener('click', (e) => {
    if (e.target === setmodal) setmodal.classList.add('hide');
  });

  // ---------- generic centered info modal (tutorial recap + offline-reward summary) ----------
  // Never auto-dismisses — the player closes it with the primary button. The optional "don't show
  // again" switch flips the matching Display setting, so each popup can be re-enabled from Settings.
  const infomodal = $('#h-infomodal'),
    infocard = $('#h-infomodal-card');
  function hideInfoModal(): void {
    infomodal.classList.add('hide');
  }
  // click the dimmed backdrop (not the card) to dismiss — same idiom as the other modals
  infomodal.addEventListener('click', (e) => {
    if (e.target === infomodal) hideInfoModal();
  });
  interface InfoModalOpts {
    accent: string;     // tint class suffix for the glow/badge: 'amber' (tutorial) | 'gold' (reward)
    iconName: string;
    title: string;
    body: string;       // inner HTML
    rewards?: string;   // optional reward-chip HTML row
    primary: string;    // primary button label
    onPrimary?: () => void;
    dontShowAgain?: { key: keyof Settings; label: string };
  }
  function showInfoModal(o: InfoModalOpts): void {
    const dsa = o.dontShowAgain;
    infocard.className = 'infomodal-card im-' + o.accent;
    infocard.innerHTML =
      '<div class="im-glow"></div>' +
      '<div class="im-badge">' + icon(o.iconName, 30) + '</div>' +
      '<h2 class="im-title">' + o.title + '</h2>' +
      '<div class="im-body">' + o.body + '</div>' +
      (o.rewards ? '<div class="im-rewards">' + o.rewards + '</div>' : '') +
      (dsa ? '<button class="im-dsa" id="h-im-dsa"><span class="im-check"><i></i></span><span>' + dsa.label + '</span></button>' : '') +
      '<button class="im-ok" id="h-im-ok">' + o.primary + '</button>';
    if (dsa) {
      const b = $('#h-im-dsa');
      b.addEventListener('click', () => {
        const off = !b.classList.contains('on'); // checked = "don't show" → the setting goes OFF
        b.classList.toggle('on', off);
        settings[dsa.key] = !off;
        handlers.onSaveSettings && handlers.onSaveSettings();
      });
    }
    $('#h-im-ok').addEventListener('click', () => {
      hideInfoModal();
      o.onPrimary && o.onPrimary();
    });
    infomodal.classList.remove('hide');
  }
  // Public: the "while you were away" summary, shown once on return when a run survived offline.
  function showOfflineReward(reward: OfflineReward): void {
    const chip = (ic: string, val: string, cls?: string): string =>
      '<span class="im-chip">' + icon(ic, 18, cls) + '<b>' + val + '</b></span>';
    showInfoModal({
      accent: 'gold',
      iconName: 'best',
      title: 'While you were away',
      body: 'Your hero kept fighting in your absence and banked these spoils:',
      rewards:
        chip('coin', '+' + abbr(reward.gold || 0), 'gold') +
        chip('burst', '+' + abbr(reward.kills || 0)) +
        chip('tier', '+' + abbr(reward.waves || 0)),
      primary: 'Collect',
      dontShowAgain: { key: 'showOfflineReward', label: "Don't show this again" },
    });
  }

  // ---------- side menu: a narrow icon rail, toggled by the header button; no auto-dismiss ----------
  // Each rail icon opens a self-dismissing modal (Settings) or panel (Run Stats), so the unintrusive
  // rail can stay open without a big panel hogging the screen.
  const sidemenu = $('#h-sidemenu');

  // ---- in-game CARDS / LABS management modals (opened from the side rail) ----
  // They reuse the Workshop card/lab panes, so changing cards or steering research mid-run behaves
  // exactly like the menu — and takes effect live (computeStats re-reads meta every frame).
  const cardsModal = $('#h-cardsmodal'),
    cardsModalInner = $('#h-cardsmodal-inner'),
    labsModal = $('#h-labsmodal'),
    labsModalInner = $('#h-labsmodal-inner'),
    railLabs = $('#h-rail-labs');
  const mgmtHead = (title: string, closeId: string): string =>
    '<div class="mgmt-head"><h2>' + title + '</h2><button class="iconclose" id="' + closeId + '" title="Close">' + icon('close', 18) + '</button></div>';
  function renderCardsModal(): void {
    const meta = curMeta();
    if (!meta) return;
    lastMeta = meta; // shared card helpers (equipCard / openCardModal) read lastMeta
    cardsModalInner.innerHTML = mgmtHead('Cards', 'h-cardsmodal-close') + '<div class="mgmt-body">' + cardsPaneHtml(meta) + '</div>';
    $('#h-cardsmodal-close').addEventListener('click', () => cardsModal.classList.add('hide'));
    wireCardsPane(cardsModalInner, renderCardsModal);
  }
  function renderLabsModal(): void {
    const meta = curMeta();
    if (!meta) return;
    lastMeta = meta; // openLabPicker / labSlotsHtml read lastMeta
    labsModalInner.innerHTML = mgmtHead('Labs', 'h-labsmodal-close') + '<div class="mgmt-body">' + labsPaneHtml(meta) + '</div>';
    $('#h-labsmodal-close').addEventListener('click', () => labsModal.classList.add('hide'));
    wireLabsPane(labsModalInner, renderLabsModal);
  }
  cardsModal.addEventListener('click', (e) => { if (e.target === cardsModal) cardsModal.classList.add('hide'); });
  labsModal.addEventListener('click', (e) => { if (e.target === labsModal) labsModal.classList.add('hide'); });
  // Labs gate at wave 30 — reflect that on the rail icon whenever the rail is opened.
  function refreshRail(): void {
    const meta = curMeta();
    railLabs.classList.toggle('locked', !(meta && labsTabUnlocked(meta)));
  }

  $('#h-menu-btn').addEventListener('click', () => { refreshRail(); sidemenu.classList.toggle('open'); });
  $('#h-set').addEventListener('click', openSettings);
  $('#h-rail-cards').addEventListener('click', () => { renderCardsModal(); cardsModal.classList.remove('hide'); });
  railLabs.addEventListener('click', () => {
    const meta = curMeta();
    if (!meta || !labsTabUnlocked(meta)) { showUnlockTip(railLabs, 'Reach wave 30 to unlock Labs'); return; }
    renderLabsModal();
    labsModal.classList.remove('hide');
  });

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

  // ---------- upgrade detail modal (perm tile body click) ----------
  const updmodal = $('#h-updmodal'), updmodalInner = $('#h-updmodal-inner');
  updmodal.addEventListener('click', (e) => { if (e.target === updmodal) updmodal.classList.add('hide'); });
  function openPermModal(id: string): void {
    if (!lastMeta) return;
    const u = UP_BY_ID[id];
    if (!u) return;
    const bought = permBought(lastMeta, id);
    const maxed = permAtMax(lastMeta, id);
    const cap = upgradeCap(lastMeta, id);
    const cost = permCost(lastMeta, id);
    const afford = (lastMeta.coins || 0) >= cost;
    const locked = !isUnlocked(lastMeta, id);
    if (locked) {
      const grp = skillGroup(id),
        gcost = grp ? grp.cost : 0,
        canNow = !!grp && (nextUnlockGroup(lastMeta, grp.tab) || { id: '' }).id === grp.id,
        uafford = (lastMeta.coins || 0) >= gcost;
      updmodalInner.innerHTML =
        '<div class="upd-head">' +
          '<div class="upd-icon">' + icon(u.icon, 20) + '</div>' +
          '<div class="upd-title"><b>' + (u.name || u.label) + '</b><span>' + icon('lock', 12) + ' Locked</span></div>' +
          '<button class="iconclose" id="h-upd-close">' + icon('close', 18) + '</button>' +
        '</div>' +
        (u.tip ? '<div class="upd-tip">' + tipOf(u) + '</div>' : '') +
        '<div class="upd-tip">Unlock the ' + (grp ? grp.label : '') + ' group in the Workshop to buy ' +
          (grp && grp.skills.length > 1 ? 'its skills.' : 'it.') +
          (canNow ? '' : ' Unlock the earlier groups first.') + '</div>' +
        '<button class="upd-buy' + (canNow && uafford ? '' : ' cant') + '" id="h-upd-unlock">Unlock · ' + gcost + ' ' + coinsIc(14) + '</button>';
      $('#h-upd-close').addEventListener('click', () => updmodal.classList.add('hide'));
      $('#h-upd-unlock').addEventListener('click', () => {
        if (!grp || !canNow || !uafford) { shake($('#h-upd-unlock')); return; }
        if (handlers.onUnlockGroup && handlers.onUnlockGroup(grp.id)) {
          renderMenu();
          openPermModal(id); // refresh modal → now shows the normal buy UI
        }
      });
      updmodal.classList.remove('hide');
      return;
    }
    updmodalInner.innerHTML =
      '<div class="upd-head">' +
        '<div class="upd-icon">' + icon(u.icon, 20) + '</div>' +
        '<div class="upd-title"><b>' + (u.name || u.label) + '</b>' +
          '<span>Level ' + bought + ' / ' + cap + '</span></div>' +
        '<button class="iconclose" id="h-upd-close">' + icon('close', 18) + '</button>' +
      '</div>' +
      (u.tip ? '<div class="upd-tip">' + tipOf(u) + '</div>' : '') +
      '<div class="upd-stats">' +
        '<div class="upd-row"><span>Current</span><b>' + u.fmt(buffedVal(lastMeta, u, bought)) + '</b></div>' +
        (!maxed ? '<div class="upd-row"><span>Next level</span><b>' + u.fmt(buffedVal(lastMeta, u, bought + 1)) + '</b></div>' : '') +
        (!maxed ? '<div class="upd-row"><span>At max (' + cap + ')</span><b>' + u.fmt(buffedVal(lastMeta, u, cap)) + '</b></div>' : '') +
      '</div>' +
      '<button class="upd-buy' + (maxed ? ' maxed' : '') + (afford && !maxed ? '' : ' cant') + '" id="h-upd-buy"' + (maxed || !afford ? ' disabled' : '') + '>' +
        (maxed ? 'Maxed out' : cost + ' ' + coinsIc(14) + ' — Buy') +
      '</button>';
    $('#h-upd-close').addEventListener('click', () => updmodal.classList.add('hide'));
    const buyBtn = $('#h-upd-buy') as HTMLButtonElement;
    buyBtn.addEventListener('click', () => {
      if (maxed || !afford) { shake(buyBtn); return; }
      if (handlers.onBuyPerm && handlers.onBuyPerm(id)) {
        renderMenu();
        openPermModal(id); // refresh modal after purchase
      }
    });
    updmodal.classList.remove('hide');
  }

  // Lab picker: lists the labs you can drop into an open slot. Maxed / already-running / locked labs
  // are disabled. Each row has a Start button (coins + time); clicking anywhere else on the banner
  // expands an explanation.
  let labInfoOpen: string | null = null;
  function openLabPicker(onChange: () => void): void {
    if (!lastMeta) return;
    const meta = lastMeta;
    let rows = '';
    for (const L of LABS) {
      const lv = labLevel(meta, L.id),
        maxed = labAtMax(meta, L.id),
        unlocked = labUnlocked(meta, L.id),
        running = !!researchOf(meta, L.id);
      const cost = labCoinCost(meta, L.id),
        t = labTimeSec(meta, L.id);
      const can = unlocked && !maxed && !running && (meta.coins || 0) >= cost && freeSlots(meta) > 0;
      const disabled = !can;
      const statusTag = maxed ? 'MAX' : running ? 'Running' : !unlocked ? icon('lock', 12) + ' wave ' + L.gate.wave : '';
      const startLabel = maxed ? 'Maxed' : running ? 'In progress' : !unlocked ? 'Locked'
        : cost + ' ' + coinsIc(13) + ' · ' + (t > 0 ? fmtTime(t) : 'instant');
      // The whole banner head is the info toggle (data-info); the Start button stops propagation so a
      // start-click never also flips the info panel.
      rows += '<div class="labpick-row' + (labInfoOpen === L.id ? ' open' : '') + '">' +
        '<div class="labpick-head" data-info="' + L.id + '">' +
          '<div class="labpick-ic">' + icon(LAB_CAT_ICON[L.cat] || 'flask', 18) + '</div>' +
          '<div class="labpick-title"><b>' + L.label + '</b><span>lv ' + lv + ' / ' + L.max +
            (statusTag ? '  ·  ' + statusTag : '') + '</span></div>' +
          '<button class="labpick-start' + (disabled ? ' cant' : '') + '" data-startlab="' + L.id + '"' +
            (disabled ? ' disabled' : '') + '>' + startLabel + '</button>' +
        '</div>' +
        (labInfoOpen === L.id
          ? '<div class="labpick-detail">' + labDesc(L, lv + 1) +
            '<br>Instant-complete a running lab for 1 ' + icon('gem', 12, 'gem') + ' per minute left.</div>'
          : '') +
        '</div>';
    }
    updmodalInner.innerHTML =
      '<div class="upd-head"><div class="upd-icon">' + icon('flask', 20) + '</div>' +
        '<div class="upd-title"><b>Choose a Lab</b><span>Research scales workshop stats &amp; raises caps</span></div>' +
        '<button class="iconclose" id="h-labpick-close">' + icon('close', 18) + '</button></div>' +
      '<div class="labpick-list">' + rows + '</div>';
    $('#h-labpick-close').addEventListener('click', () => { labInfoOpen = null; updmodal.classList.add('hide'); });
    updmodalInner.querySelectorAll<HTMLElement>('[data-info]').forEach((b) =>
      b.addEventListener('click', () => { labInfoOpen = labInfoOpen === b.dataset.info ? null : b.dataset.info!; openLabPicker(onChange); }),
    );
    updmodalInner.querySelectorAll<HTMLElement>('[data-startlab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // don't let the Start click bubble to the banner's info toggle
        if (handlers.onStartResearch && handlers.onStartResearch(b.dataset.startlab!)) {
          labInfoOpen = null;
          updmodal.classList.add('hide');
          onChange();
        } else shake(b);
      }),
    );
    updmodal.classList.remove('hide');
  }

  // Dismiss every in-run modal/panel (Display, End-run confirm, Run Stats) — called when a run ends
  // or we return to the menu, so a left-open modal never lingers over the overview/menu screen.
  const closeRunModals = (): void => {
    setmodal.classList.add('hide');
    endmodal.classList.add('hide');
    cardsModal.classList.add('hide');
    labsModal.classList.add('hide');
    $('#h-stats').classList.add('hide');
    // leaving gameplay: abandon any in-progress tutorial and drop its overlays / recap modal
    irStep = null;
    setSpotlight(false);
    skipBtn.classList.add('hide');
    infomodal.classList.add('hide');
  };

  // ---------- MENU ----------
  const menuEl = $('#h-menu'),
    menuContent = $('#h-menu-content'),
    menuTabsEl = $('#h-menu-tabs');
  const tabbarEl = $('#h-tabbar'),
    topEl = $('#h-top');
  const modal = $('#h-modal'),
    modalInner = $('#h-modal-inner');
  // click the dimmed backdrop (not the card) to dismiss — same idiom as the settings/upgrade modals
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hide');
  });
  const spot = $('#h-spot'),
    thought = $('#h-thought');
  const MENU_TABS: { id: string; icon: string; gated?: boolean; locked?: boolean; unlockFn?: (m: Meta) => boolean; unlock?: string }[] = [
    { id: 'hero', icon: 'play' },
    { id: 'upgrades', icon: 'upgrades' },
    { id: 'cards', icon: 'cards' },
    { id: 'labs', icon: 'flask', gated: true, unlockFn: (m) => labsTabUnlocked(m), unlock: 'Reach wave 30 to unlock Labs' },
    { id: 'prestige', icon: 'prestige' }, // Superpowers: unlock + upgrade with Energy (earned per boss)
  ];
  let menuTab = 'hero',
    menuUpTab = 'attack',
    lastMeta: Meta | null = null;

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

  // The menu "character sheet" tower: draws the player's selected tower skin, animated via a
  // self-cancelling rAF loop (stops as soon as the canvas leaves the DOM on a re-render / tab swap).
  function drawAvatar(canvas: HTMLCanvasElement, meta: Meta): void {
    const ctx = canvas.getContext('2d')!,
      W = canvas.width,
      H = canvas.height,
      cx = W / 2,
      cy = H / 2,
      R = Math.min(W, H) * 0.34;
    const id = selectedCosmeticId(meta, 'tower');
    const start = performance.now();
    const frame = (): void => {
      if (!canvas.isConnected) return; // canvas was replaced → let this loop die
      ctx.clearRect(0, 0, W, H);
      drawTowerSkin(ctx, id, cx, cy, R, (performance.now() - start) / 1000);
      requestAnimationFrame(frame);
    };
    frame();
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
    const groups = SKILL_GROUPS.filter((g) => g.tab === menuUpTab);
    const next = nextUnlockGroup(meta, menuUpTab); // next unlockable group within THIS category
    let html = '';
    let idx = 0; // running buyable-skill index in this tab (for the first-run tutorial highlight)
    for (const g of groups) {
      // LOCKED group: out of a run we show ONLY the single next-in-sequence group (the rest stay
      // hidden until it's unlocked), with an enabled/disabled Unlock button per affordability.
      if (!isGroupUnlocked(meta, g.id)) {
        if (!next || next.id !== g.id) continue; // hide all locked groups except the next one
        const uafford = (meta.coins || 0) >= g.cost;
        const names = g.skills.map((s) => UP_BY_ID[s].label).join(' · ');
        html += '<div class="permgroup next' + (uafford ? '' : ' cant') + '">' +
          '<span class="pg-ic">' + icon('lock', 16) + '</span>' +
          '<span class="pg-tx"><b>' + g.label + '</b><span>' + names + '</span></span>' +
          '<button class="pg-act" data-unlockgroup="' + g.id + '"' + (uafford ? '' : ' disabled') + '>Unlock · ' + g.cost + ' ' + coinsIc(12) + '</button></div>';
        continue;
      }
      for (const sid of g.skills) {
        const up = UP_BY_ID[sid];
        const bought = permBought(meta, up.id);
        const cur = up.fmt(buffedVal(meta, up, bought));
        const maxed = permAtMax(meta, up.id);
        const qty = bulkSelOf(permBulkSel, meta, up.id);
        const plan = permBulkPlan(meta, up.id, qty);
        const afford = plan.canBuy; // "can buy the selected quantity"
        const multi = availableBulkTiers(meta).length > 1;
        const isTut = tutoring && menuUpTab === 'attack' && idx === 0 && bought === 0;
        idx++;
        html += '<button class="perm' + (isTut ? ' tut' : '') + (afford && !maxed ? '' : ' cant') + '" data-perm="' + up.id + '"' + (maxed ? ' disabled' : '') + '>' +
          '<span class="phead">' + icon(up.icon, 18) + '<span class="pname">' + up.label + '</span>' +
          '<span class="plv">' + bought + '/' + upgradeCap(meta, up.id) + '</span></span>' +
          '<span class="pcur">' + cur + '</span>' +
          '<span class="pcost' + (maxed ? ' maxed' : '') + '">' +
          (maxed ? 'MAX'
            : (multi ? '<span class="bmult" role="button" data-bmult="' + up.id + '">' + bulkLabel(qty) + '</span>' : '') +
              '<span class="pcval">' + (qty === 'max' ? plan.cost : plan.full) + ' ' + coinsIc(12) + '</span>') +
          '</span></button>';
      }
    }
    return html;
  }

  function fmtTime(sec: number): string {
    sec = Math.ceil(sec);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) return (sec / 3600).toFixed(1) + 'h';
    return (sec / 86400).toFixed(1) + 'd';
  }
  const LAB_CAT_ICON: Record<string, string> = { attack: 'sword', defense: 'shield', economic: 'coin', speed: 'ffwd' };
  // Human description of what a lab does at the given (reached) level. Damage/Health scale a workshop
  // stat AND raise its cap; the Game Speed lab unlocks a faster battle-speed tier; the rest scale, add,
  // or apply an out-of-run bonus described by their `unit`.
  function labDesc(L: UpgradeDef | { per: number; target: string; max: number; label?: string; unit?: string }, lv: number): string {
    const target = (L as { target: string }).target;
    const per = (L as { per: number }).per;
    const unit = (L as { unit?: string }).unit;
    const label = (L as { label?: string }).label || 'this stat';
    if (target === 'gameSpeed') {
      return 'Unlocks ' + fmtSpeed(speedAtLevel(lv)) + ' battle speed. 0.5x and 1x are always available.';
    }
    if (target === 'rangedDamage' || target === 'maxHp') {
      const stat = target === 'maxHp' ? 'Health' : 'Damage';
      return 'Raises ' + stat + ' workshop value (×' + (1 + per * lv).toFixed(2) + ' at lv ' + lv + ') and lifts its max cap.';
    }
    if (unit === 'meters') return 'Adds +' + Math.round(per * lv) + 'm attack range (+' + per + 'm per level).';
    if (unit === 'pct') return 'Adds +' + Math.round(per * lv * 100) + '% ' + label.replace(/ Lab$/, '') + ' (+' + Math.round(per * 100) + '% per level).';
    if (unit === 'gold') return 'Begin each run with +' + per * lv + ' gold (+' + per + ' per level).';
    if (unit === 'tierpct') return '+' + Math.round(per * lv * 100) + '% coins from runs (+' + Math.round(per * 100) + '% per level).';
    if (unit === 'interestcap') return 'Caps Interest income at ' + Math.round(25 * Math.pow(800, lv / 20)).toLocaleString() + ' gold/wave (25 → 20,000 across 20 levels).';
    // default: a scale lab (×multiplier on its workshop stat).
    return 'Multiplies ' + label.replace(/ Lab$/, '') + ' (×' + (1 + per * lv).toFixed(2) + ' at lv ' + lv + ').';
  }
  // Build a sideways corked flask: a glass test-tube (rounded closed end at left, cork plugged at
  // right) holding carbonated blue research fluid that turns gold left→right as the research completes.
  function vialHtml(label: string, lvText: string, prog: number, kind: 'idle' | 'running' | 'empty'): string {
    const pct = Math.max(0, Math.min(1, prog)) * 100;
    const bubbles = '<span class="bubbles"><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    return '<span class="vial vial-' + kind + '">' +
      '<span class="vtube">' +
        '<span class="vfluid"><span class="vgold" style="width:' + pct.toFixed(1) + '%"></span>' + bubbles + '</span>' +
        '<span class="vlabel"><b>' + label + '</b><span class="vlv">' + lvText + '</span></span>' +
      '</span>' +
      '<span class="vcork"></span></span>';
  }
  // Render the lab SLOTS: each running lab fills a slot; remaining unlocked slots show an empty vial
  // (click → picker modal). Locked slots show a buy-with-gems prompt.
  function labSlotsHtml(meta: Meta): string {
    const now = Date.now();
    const slots = meta.labSlots || 1;
    const running = (meta.research || []).slice();
    let h = '';
    for (let i = 0; i < slots; i++) {
      const r = running[i];
      if (r) {
        const L = LAB_BY_ID[r.id];
        const lv = labLevel(meta, r.id),
          prog = researchProgress(meta, r.id, now),
          rem = researchRemaining(meta, r.id, now);
        const gc = rushVialCost(meta, r.id, now),
          canRush = (meta.gems || 0) >= gc;
        h += '<div class="labslot running">' +
          vialHtml(L.label, 'lv ' + lv + '→' + (lv + 1), prog, 'running') +
          '<div class="labdesc">' + labDesc(L, lv + 1) + '</div>' +
          '<div class="labactions">' +
          '<span class="labrem">' + fmtTime(rem) + ' left</span>' +
          '<button class="rushlab' + (canRush ? '' : ' cant') + '" data-rushlab="' + r.id + '" title="Finish instantly with gems">' +
          icon('ffwd', 12) + ' Finish · ' + icon('gem', 12, 'gem') + ' ' + gc + '</button>' +
          '<button class="changelab" data-changelab="' + r.id + '" title="Switch to a different research">' + icon('swap', 14) + ' Change</button>' +
          '</div></div>';
      } else {
        h += '<div class="labslot empty" data-pickslot="1">' +
          vialHtml('Empty slot', 'tap to research', 0, 'empty') +
          '<div class="labdesc">Pick a lab to begin research.</div></div>';
      }
    }
    return h;
  }

  // The milestone ladder for the SELECTED tier: a gilded hexagon spine, a wax-seal "you are here" pin,
  // and one rung per milestone. Rungs pay coins / gems / vials, except the wave-1000 rung whose reward
  // IS that tier's tower skin (drawn as a live medallion). Progress + claims are per-tier.
  function renderMilestones(): void {
    const meta = lastMeta!,
      tier = meta.tier || 1,
      cl = meta.claimedMilestones || {},
      best = (meta.tierBest && meta.tierBest[tier]) || 0;
    const short = (w: number): string => (w >= 1000 ? w / 1000 + 'k' : '' + w);
    const claimable = tierClaimableCount(meta, tier);
    // A reward as a chip (currency) or a tower-skin medallion (wave 1000).
    const rewardHtml = (r: ReturnType<typeof milestoneReward>): string => {
      if (r.tower) {
        const t = cosmeticById(r.tower);
        return '<span class="mn-tower"><canvas class="mn-twc" width="60" height="60" data-twc="' + r.tower + '"></canvas>' +
          '<span class="mn-tw-tx"><b>' + (t ? t.name : 'Tower Skin') + '</b></span></span>';
      }
      if (r.gems) return '<span class="rw">+' + r.gems.toLocaleString() + ' ' + icon('gem', 13, 'gem') + '</span>';
      if (r.vials) return '<span class="rw">+' + r.vials.toLocaleString() + ' ' + icon('vial', 13, 'vial') + '</span>';
      return '<span class="rw">+' + r.coins.toLocaleString() + ' ' + coinsIc(13) + '</span>';
    };
    let rows = '';
    MILESTONES.forEach((w) => {
      const reward = milestoneReward(w, tier),
        isTower = !!reward.tower,
        claimed = !!cl[tier + ':' + w],
        reached = best >= w,
        can = reached && !claimed && !isTower;
      const cls = 'msrow' + (reached ? ' reached' : '') + (isTower ? ' tower' : '') +
        (isTower ? (reached ? ' unlocked' : ' locked') : claimed ? ' claimed' : can ? ' can' : ' locked');
      let cta: string;
      if (isTower) {
        cta = rewardHtml(reward);
      } else if (claimed) {
        cta = '<span class="mn-done">' + icon('check', 15) + ' Claimed</span>';
      } else if (can) {
        cta = '<button class="mn-claim" data-claim="' + w + '">Claim ' + rewardHtml(reward) + '</button>';
      } else {
        cta = '<span class="mn-reward locked">' + rewardHtml(reward) + '</span>';
      }
      rows += '<div class="' + cls + '">' +
        '<div class="msrail"><span class="msdot">' + (isTower ? icon('best', 15) : short(w)) + '</span></div>' +
        '<div class="mscard"><div class="mn-info"><b>Wave ' + short(w) + '</b></div>' + cta + '</div></div>';
    });
    modalInner.innerHTML =
      '<button class="close" id="h-ms-close" title="Close">' + icon('close', 18) + '</button>' +
      '<div class="ms-head"><h2>Milestones</h2>' +
      '<p class="msnote"><span class="ms-tierband">' + icon('tier', 13) + ' Tier ' + tier + '</span>' +
      (claimable > 0 ? '<b class="ms-ready">' + claimable + ' reward' + (claimable > 1 ? 's' : '') + ' ready</b>' : '<span>reach further to unlock rewards</span>') +
      '</p></div>' +
      '<div class="mspath">' + rows + '</div>';
    // Paint any tower-skin reward medallions (same skin art the picker + avatar use).
    modalInner.querySelectorAll<HTMLCanvasElement>('canvas[data-twc]').forEach((cv) => {
      drawTowerSkin(cv.getContext('2d')!, cv.dataset.twc!, cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.34, 0.7);
    });
    $('#h-ms-close').addEventListener('click', () => modal.classList.add('hide'));
    modalInner.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) =>
      b.addEventListener('click', () => {
        if (handlers.onClaimMilestone && handlers.onClaimMilestone(+b.dataset.claim!)) renderMilestones();
      }),
    );
  }

  // The tower picker: every tower skin with its always-on buff, locked until its tier milestone.
  // Selecting one is purely cosmetic — the buff already applies the moment a tower is UNLOCKED.
  function renderTowerPicker(): void {
    const meta = lastMeta!;
    const selId = selectedCosmeticId(meta, 'tower');
    // Show only what the player can actually use or buy: unlocked towers + any gem-purchasable one.
    // Tier-locked towers stay hidden until earned.
    const towers = cosmeticsOf('tower').filter((c) => isCosmeticUnlocked(meta, c.id) || (c.cost || 0) > 0);
    let tiles = '';
    for (const c of towers) {
      const unlocked = isCosmeticUnlocked(meta, c.id),
        sel = c.id === selId,
        buyable = !unlocked && (c.cost || 0) > 0;
      const buff = buffText(c.buff);
      const foot = sel
        ? '<span class="twfoot eq">' + icon('check', 13) + ' Equipped</span>'
        : unlocked
          ? '<span class="twfoot">Tap to equip</span>'
          : buyable
            ? '<button class="twbuy" data-buytw="' + c.id + '">Buy · ' + c.cost + ' ' + icon('gem', 12, 'gem') + '</button>'
            : '';
      tiles +=
        '<div class="twtile' + (sel ? ' sel' : '') + (buyable ? ' buyable' : '') + '"' +
        (unlocked ? ' data-tw="' + c.id + '" role="button" tabindex="0"' : '') + '>' +
        '<div class="twmedal"><canvas class="twthumb" width="96" height="96" data-twc="' + c.id + '"></canvas></div>' +
        '<span class="twname">' + c.name + '</span>' +
        (buff ? '<span class="twbuff">' + buff + '</span>' : '') +
        foot +
        '</div>';
    }
    modalInner.innerHTML =
      '<button class="close" id="h-tw-close" title="Close">' + icon('close', 18) + '</button>' +
      '<h2>Towers</h2>' +
      '<p class="msnote">All bonuses are always applied.</p>' +
      '<div class="twgrid">' + tiles + '</div>';
    modalInner.querySelectorAll<HTMLCanvasElement>('canvas[data-twc]').forEach((cv) => {
      const ctx = cv.getContext('2d')!;
      drawTowerSkin(ctx, cv.dataset.twc!, cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.36, 0.7);
    });
    $('#h-tw-close').addEventListener('click', () => modal.classList.add('hide'));
    const refresh = (): void => {
      renderTowerPicker(); // refresh equipped / owned state
      renderMenu(); // update the hero-tab avatar
    };
    modalInner.querySelectorAll<HTMLElement>('[data-tw]').forEach((b) =>
      b.addEventListener('click', () => {
        if (handlers.onSelectCosmetic && handlers.onSelectCosmetic('tower', b.dataset.tw!)) refresh();
      }),
    );
    modalInner.querySelectorAll<HTMLElement>('[data-buytw]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handlers.onBuyCosmetic && handlers.onBuyCosmetic(b.dataset.buytw!)) refresh();
        else shake(b);
      }),
    );
  }

  function renderMenu(): void {
    const meta = lastMeta!,
      tutoring = sumPerm(meta) === 0;
    for (const b of Array.from(menuTabsEl.children) as HTMLElement[]) {
      b.classList.toggle('on', b.dataset.mtab === menuTab);
      b.classList.toggle('tut', tutoring && b.dataset.mtab === 'upgrades' && menuTab !== 'upgrades');
      b.classList.toggle('tut-off', tutoring && b.dataset.mtab !== 'upgrades');
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
      html += curChips(meta, CURRENCIES.map((c) => c.key));
      // The check-in is surfaced by the floating #h-checkin-float button (menu + in-game), shown only
      // when a reward is claimable — so there's no inline button or idle countdown here anymore.
      html += '<div class="avatar-frame"><canvas id="h-avatar" width="200" height="200"></canvas></div>';
      const tier = meta.tier || 1,
        canUp = tier < MAX_TIER && tierUnlocked(meta, tier + 1);
      html += '<div class="tiersel">' +
        '<button class="tierstep' + (tier > 1 ? '' : ' invisible') + '" id="h-tier-down"' + (tier > 1 ? '' : ' disabled') + '>' + icon('back', 18) + '</button>' +
        '<span class="tierlabel"><span class="tl-tier">' + icon('tier', 14) + ' Tier ' + tier + '</span>' +
        '<span class="tl-coin">' + coinsIc(12) + ' <b>x' + coinMult(tier).toFixed(1) + '</b></span>' +
        '<span class="tl-max">Max. ' + ((meta.tierBest && meta.tierBest[tier]) || 0) + '</span></span>' +
        '<button class="tierstep' + (canUp ? '' : ' locked') + '" id="h-tier-up">' + icon('fwd', 18) + '</button>' +
        '</div>';
      // Milestones SECTION (replaces the old button): a clickable parchment plaque that opens the
      // per-tier ladder. Its subtitle reflects the selected tier — claimable count, next rung, or done.
      const tBest = (meta.tierBest && meta.tierBest[tier]) || 0,
        tClaim = tierClaimableCount(meta, tier),
        nextMs = MILESTONES.find((w) => w > tBest);
      const msSub = tClaim > 0
        ? tClaim + ' reward' + (tClaim > 1 ? 's' : '') + ' to claim'
        : nextMs
          ? 'Next at wave ' + (nextMs >= 1000 ? nextMs / 1000 + 'k' : nextMs)
          : 'All milestones reached';
      html += '<div class="ms-section' + (tClaim > 0 ? ' has-claim' : '') + '" id="h-ms" role="button" tabindex="0" title="Milestones">' +
        '<span class="ms-sec-ic">' + icon('best', 20) + '</span>' +
        '<span class="ms-sec-tx"><b>Milestones</b><span class="ms-sec-sub">' + msSub + '</span></span>' +
        (tClaim > 0 ? '<span class="ms-sec-badge">' + tClaim + '</span>' : '') +
        '<span class="ms-sec-arrow">' + icon('fwd', 16) + '</span></div>';
      html += '<button class="startsq" id="h-start">' + icon('play', 35, 'green') + '</button>';
    } else if (menuTab === 'upgrades') {
      // shared centered column so the coins chip, subtabs and list all share one left edge
      html += '<div class="cardspane">';
      html += curChips(meta, ['coins']);
      html += '<div class="subtabs" id="h-uptabs">';
      for (const t of TAB_DEFS) {
        html += '<button class="subtab' + (t.id === menuUpTab ? ' on' : '') + '" data-uptab="' + t.id + '" title="' + t.id + '">' + icon(t.icon, 22) + '</button>';
      }
      html += '</div>';
      html += '<div class="permlist">' + permRowsHtml(meta, tutoring) + '</div>';
      html += '</div>';
    } else if (menuTab === 'cards') {
      html += cardsPaneHtml(meta);
    } else if (menuTab === 'labs') {
      // share the centered single-column layout used by the upgrades/cards tabs
      html += '<div class="cardspane">' + labsPaneHtml(meta) + '</div>';
    } else if (menuTab === 'prestige') {
      html += '<div class="cardspane">' + superPaneHtml(meta) + '</div>';
    } else {
      html += '<div class="locked-tab">' + icon('lock', 46) + '<div class="lockmsg">Unlocks later</div></div>';
    }
    menuContent.innerHTML = html;

    if (menuTab === 'hero') {
      drawAvatar($<HTMLCanvasElement>('#h-avatar'), meta);
      const af = menuContent.querySelector<HTMLElement>('.avatar-frame');
      if (af) {
        af.classList.add('clickable');
        af.title = 'Change tower';
        af.addEventListener('click', () => {
          renderTowerPicker();
          modal.classList.remove('hide');
          setSpotlight(false);
        });
      }
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
    } else if (menuTab === 'upgrades') {
      menuContent.querySelectorAll<HTMLElement>('[data-uptab]').forEach((b) =>
        b.addEventListener('click', () => {
          menuUpTab = b.dataset.uptab!;
          renderMenu();
        }),
      );
      menuContent.querySelectorAll<HTMLElement>('[data-perm]').forEach((b) =>
        b.addEventListener('click', (e) => {
          const mult = (e.target as Element).closest('.bmult');
          const footer = (e.target as Element).closest('.pcost');
          if (mult) {
            // multiplier toggle → cycle the selected quantity, re-render the cards.
            cycleBulk(permBulkSel, lastMeta || meta, b.dataset.perm!);
            renderMenu();
          } else if (footer) {
            // footer click → buy the selected quantity (1x / 5x / 25x / 100x / Max)
            const qty = bulkSelOf(permBulkSel, lastMeta || meta, b.dataset.perm!);
            if (handlers.onBuyPerm && handlers.onBuyPerm(b.dataset.perm!, qty)) renderMenu();
            else shake(menuContent.querySelector('.coins-chip'));
          } else {
            // body/header click → detail modal
            openPermModal(b.dataset.perm!);
          }
        }),
      );
      // LOCKED group row → unlock the whole group (next-in-sequence only). Shake coins if unaffordable.
      menuContent.querySelectorAll<HTMLElement>('[data-unlockgroup]').forEach((b) =>
        b.addEventListener('click', () => {
          if (handlers.onUnlockGroup && handlers.onUnlockGroup(b.dataset.unlockgroup!)) renderMenu();
          else shake(menuContent.querySelector('.coins-chip'));
        }),
      );
    } else if (menuTab === 'cards') {
      wireCardsPane(menuContent, renderMenu);
    } else if (menuTab === 'labs') {
      wireLabsPane(menuContent, renderMenu);
    } else if (menuTab === 'prestige') {
      wireSuperPane(menuContent, renderMenu);
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
    menuTab = 'hero';
    modal.classList.add('hide');
    renderMenu();
    refreshCheckinFloat();
    menuEl.classList.add('show');
    sidemenu.classList.remove('open'); // the side menu is in-game chrome — Settings lives there, not on the menu screen
    closeRunModals();
    tabbarEl.style.display = 'none';
    topEl.style.display = 'none';
  }
  function refreshMenu(meta: Meta): void {
    if (meta) lastMeta = meta;
    if (menuEl.classList.contains('show')) renderMenu();
  }
  function hideMenu(): void {
    menuEl.classList.remove('show');
    updmodal.classList.add('hide');
    setSpotlight(false);
    tabbarEl.style.display = '';
    topEl.style.display = '';
  }

  // ---------- game-over OVERVIEW ----------
  const overEl = $('#h-over'),
    overCard = $('#h-over-card');
  // When the run ended offline (player reopened the game), the overview floats over the menu as a
  // dismissible notice — clicking the dimmed backdrop (not the card) closes it, the same idiom the
  // other modals use. In-session deaths instead get the full-screen overview with the back button.
  let overDismissible = false;
  overEl.addEventListener('click', (e) => {
    if (overDismissible && e.target === overEl) handlers.onToWorkshop && handlers.onToWorkshop();
  });
  function showOverview(meta: Meta, earn: EarnSummary, opts?: { offline?: boolean }): void {
    lastMeta = meta;
    const e = earn || {};
    const offline = !!(opts && opts.offline);
    closeRunModals(); // a run just ended — don't leave an in-run modal floating over the overview
    const tier = meta.tier || 1;
    const rew = '<div class="rew"><span>Coins</span><b>+' + (e.coins || 0) + ' ' + coinsIc(16) + '</b></div>';
    const row = (label: string, val: string): string => '<div class="strow"><span>' + label + '</span><b>' + val + '</b></div>';
    overCard.innerHTML =
      '<div class="statshead"><h2>Run Over</h2></div>' +
      // offline: the run ended while away, so spell that out — a new player who just opened the game
      // should never wonder why a finished run is greeting them.
      (offline ? '<div class="over-sub">Your hero kept fighting while you were away — this run has now ended.</div>' : '') +
      '<div class="over-rewards">' + rew + '</div>' +
      '<div class="statsbody">' +
      row('Kills', fmt(e.kills || 0)) +
      row('Wave reached', fmt(e.wave || 0)) +
      row('Coin multiplier', coinMultText(meta, tier)) +
      '</div>' +
      // offline overview is dismissed by tapping the backdrop, so it skips the back button entirely.
      (offline ? '' : '<button class="over-back" id="h-over-back">' + icon('back', 16) + ' Back to the Workshop</button>');
    if (!offline) $('#h-over-back').addEventListener('click', () => handlers.onToWorkshop && handlers.onToWorkshop());
    overDismissible = offline;
    overEl.classList.remove('hide');
    sidemenu.classList.remove('open');
    tabbarEl.style.display = 'none';
    topEl.style.display = 'none';
  }
  function hideOverview(): void {
    overDismissible = false;
    overEl.classList.add('hide');
    $('#h-stats').classList.add('hide');
  }

  // 1s tick: keep the floating check-in button current (menu AND in-game) and advance research bars on
  // the Lab tab. The Hero tab holds nothing time-driven (the avatar animates on its own rAF loop), so we
  // do NOT re-render it here — doing so rebuilt the DOM every second, flashing the UI and resetting hover.
  setInterval(() => {
    refreshCheckinFloat();
    if (!menuEl.classList.contains('show') || !lastMeta) return;
    if (menuTab === 'labs') {
      const had = (lastMeta.research || []).length;
      if (handlers.onReconcileLabs) handlers.onReconcileLabs();
      if (had) renderMenu();
    }
  }, 1000);

  return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, showOfflineReward, setMeta, root };
}

// Factory for a themed skin: same core + wiring, restyled by `theme = { cls, css }`.
export const createThemedHud = (theme: ThemeDef): HudFactory => (root, handlers) => buildHud(root, handlers, theme);
