/* src/hud/hud.ts — in-game HUD (top stats + 3-tab upgrade bar), the between-games MENU
   (5 bottom tabs), a spotlight tutorial, a milestones modal, and a settings modal.
   Handlers: onBuyRun, onBuyPerm, onClaimMilestone, onStartRun, onDev, onFF. */
import type { BulkQty, CardDef, CardDrawResult, CardInstance, Hud as HudInstance, HudFactory, HudHandlers, LabDef, MenuOpts, Meta, OfflineReward, Settings, State, ThemeDef, EarnSummary, UpgradeDef } from '../types';
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
  availableSpeeds, gameSpeed, speedAtLevel, SPEED_LAB,
  labBoostMult, labBoostRemaining, labBoostCost, MAX_BOOST_MULT, MAX_BOOST_DAYS,
} from '../sim/labs';
import { cosmeticsOf, isCosmeticUnlocked, selectedCosmeticId, buffText, cosmeticById } from '../sim/cosmetics';
import {
  SUPERPOWERS, superUnlocked, superEnabled, superLevel, trackValue, trackCost, trackAtMax, nextUnlockCost,
} from '../sim/superpowers';
import { drawTowerSkin } from '../render/towers';
import { attachOverscrollBounce, attachOverscrollBounceAll } from './overscroll';
import { cardArt } from './card-art';
import type { UpdateInfo } from '../version';

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
    // arrowup = the "an update is available" rail button + update-modal badge
    arrowup: '<path d="M12 19V6"/><path d="M6 12l6-6 6 6"/>',
    chart: '<path d="M5 20V11"/><path d="M11 20V5"/><path d="M17 20v-7"/><path d="M3 20h18"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    cards: '<rect x="3" y="7" width="12" height="14" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2"/>',
    cardslot: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M12 9.5v5M9.5 12h5"/>',
    // gold = two solid gold coins (currentColor, tinted by the 'gold' class). Each coin has a slight
    // shadow; the front coin's shadow is drawn after the back coin so it casts onto it at the overlap.
    coin: '<g class="ccspin"><circle cx="15.3" cy="10.6" r="6" fill="rgba(8,10,16,.4)" stroke="none"/><circle cx="14.5" cy="9.5" r="6" fill="currentColor" stroke="none"/><circle cx="10.3" cy="15.6" r="6" fill="rgba(8,10,16,.4)" stroke="none"/><circle cx="9.5" cy="14.5" r="6" fill="currentColor" stroke="none"/></g>',
    // out-run coins = a struck COPPER coin stamped with a COMPASS ROSE (matching the spoils letter's
    // emblem): copper body + dark rim, a thin bezel ring, a long cardinal star over a shorter darker
    // intercardinal star, and a hub. A slight offset shadow gives it real-coin depth.
    coinstar: '<g class="ccspin"><circle cx="12.9" cy="12.9" r="8.5" fill="rgba(8,10,16,.28)" stroke="none"/>' +
      '<circle cx="12" cy="12" r="8.5" fill="#c47f3c" stroke="#6e3f12" stroke-width="1"/>' +
      '<circle cx="12" cy="12" r="6.7" fill="none" stroke="#6e3f12" stroke-width=".7" stroke-opacity=".6"/>' +
      '<path transform="rotate(45 12 12)" fill="#a9692e" stroke="none" d="M12 7.4 L12.95 11.05 L16.6 12 L12.95 12.95 L12 16.6 L11.05 12.95 L7.4 12 L11.05 11.05 Z"/>' +
      '<path fill="#e8b06a" stroke="none" d="M12 5 L13.5 10.5 L19 12 L13.5 13.5 L12 19 L10.5 13.5 L5 12 L10.5 10.5 Z"/>' +
      '<circle cx="12" cy="12" r="1" fill="#6e3f12" stroke="none"/></g>',
    // gems = faceted brilliant-cut gem (card currency)
    // gems = faceted brilliant-cut gem + a sparkle that glimmers (see .ic .gemtw)
    gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>' +
      '<g class="gemtw"><path d="M18.4 2.4l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z" fill="currentColor" stroke="none"/></g>',
    // vials = erlenmeyer flask with liquid level (lab currency) + carbonation bubbles rising (.ic .vb)
    vial: '<path d="M9 2h6"/><path d="M15 2v8l4 9q0 2-3 2H8q-3 0-3-2l4-9V2"/><path d="M7.5 16h9"/>' +
      '<g class="vbubs"><circle class="vb vb1" cx="11" cy="17.6" r="1" fill="currentColor" stroke="none"/>' +
      '<circle class="vb vb2" cx="13.2" cy="18.2" r=".8" fill="currentColor" stroke="none"/>' +
      '<circle class="vb vb3" cx="12" cy="16.6" r=".7" fill="currentColor" stroke="none"/></g>',
    burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5.2 5.2l3.4 3.4M18.8 5.2l-3.4 3.4M5.2 18.8l3.4-3.4M18.8 18.8l-3.4-3.4"/>',
    bow: '<path d="M8 3a10 10 0 0 1 0 18"/><path d="M8 3v18"/><path d="M5 12h13"/><path d="M15 9l3 3-3 3"/><path d="M5 12l2.5-2M5 12l2.5 2"/>',
    // bolt = a forked lightning strike (the Multi-hit / Max-Bolts skill icon, replacing the old bow)
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
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
    // zoom = magnifying glass with a + lens (the camera-zoom Settings slider)
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6M11 8v6"/>',
    // treasure chest = the check-in reward coffer (domed lid, seam, lock plate)
    chest: '<path d="M3 11v7a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-7"/><path d="M3 11a9 9 0 0 1 18 0"/><path d="M3 11h18"/><path d="M11 10.5h2v3.5h-2z"/>',
    // compassHand = a hand-drawn compass ROSE just for the spoils LETTER, echoing the treasure-map look:
    // an outer ring, a long 4-point cardinal star, a shorter intercardinal star (rotated 45°), and a
    // hub. Paired with the #cr-rough ink filter for a sketched waver — see the .cr-emblem CSS.
    compassHand: '<circle cx="12" cy="12" r="9.6"/>' +
      '<path d="M12 2.8 L13.5 10.5 L21.2 12 L13.5 13.5 L12 21.2 L10.5 13.5 L2.8 12 L10.5 10.5 Z"/>' +
      '<g transform="rotate(45 12 12)"><path d="M12 5.6 L12.9 11.1 L18.4 12 L12.9 12.9 L12 18.4 L11.1 12.9 L5.6 12 L11.1 11.1 Z"/></g>' +
      '<circle cx="12" cy="12" r="1.3"/>',
    // refresh = cooldown; stopwatch = duration (both feather-style, 24×24 stroked)
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3.5v5h-5"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9"/><path d="M9.5 2h5"/><path d="M12 2v3.5"/><path d="M18.8 6.8l1.4-1.4"/>',
    crystal: '<path d="M12 2l4 6-4 14-4-14z"/><path d="M8 8h8"/>', // a tall shard, matching the Crystal Circle art
    // atom = Energy. Nucleus (static) + 3 orbit ellipses in a group that slowly spins (see .ic.atom .orbits)
    atom: '<circle class="nuc" cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><g class="orbits"><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></g>',
    // ---- new mechanic-skill glyphs (Frostbite / Poison / Splash / Dodge / Stun) ----
    // frost = a 6-spoke snowflake (vertical + two diagonals) with chevron barbs top & bottom
    frost: 'M12 2v20 M3.34 7l17.32 10 M20.66 7l-17.32 10 M9 5l3-2 3 2 M9 19l3 2 3-2',
    // poison = a venom droplet with two little X "eyes"
    poison: 'M12 3c0 0 5.5 6.5 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3 12 3z M9.5 12l1.8 1.8 M11.3 12l-1.8 1.8 M12.7 12l1.8 1.8 M14.5 12l-1.8 1.8',
    // splash = an upward spray over two concentric ripple arcs
    splash: 'M12 9V6 M12 9l2.6-1.6 M12 9l-2.6-1.6 M6 13a6 6 0 0 0 12 0 M3 13a9 9 0 0 0 18 0',
    // dodge = a double chevron leaning aside (evading)
    dodge: 'M15 4l-7 8 7 8 M10 4l-7 8 7 8',
    // stun = a dazed face: head ring, two X eyes, a wavy mouth
    stun: 'M12 12 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M8.5 10.5l2 1.5-2 1.5 M15.5 10.5l-2 1.5 2 1.5 M9 16q3 2 6 0',
    // ---- new superpower icons (Prestige tab); Frost Nova reuses the `frost` snowflake above ----
    tesla: 'M13 2 5 13h4.4l-1.8 9 9.4-12.4H12z',
    inferno: 'M12 2c1.2 4 4.2 5.2 4.2 9.2a4.2 4.2 0 0 1-8.4 0c0-2 1-3.2 2-4.4.6 2.2 2.2 2.2 2.2 4.4',
    singularity: 'M12 12 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M5 7.5c3.2-2.2 7.4-1.2 8.4 3 M19 16.5c-3.2 2.2-7.4 1.2-8.4-3',
    chrono: 'M12 12 m-8.2 0 a8.2 8.2 0 1 0 16.4 0 a8.2 8.2 0 1 0 -16.4 0 M12 7.5V12l3.2 2',
    sentry: 'M8 21v-6l4-3 4 3v6z M12 12V6.5 M12 5.4 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0',
    aegis: 'M12 3l7 2.6v5.2C19 16.4 15.6 19.4 12 21 8.4 19.4 5 16.4 5 10.8V5.6z M9 12l2 2 4-4.2',
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
    // Active-skill rail: equipped active cards surface here during a run (auto ones as status chips,
    // Dark Wiz as a tap-to-fire button, Revive as an armed/used indicator). Empty → hidden.
    '<div class="actives hide" id="h-actives"></div>' +
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

  // Turbulence-displacement SVG filters for the spoils letter, defined once here (after the root HTML is
  // built, so they aren't wiped) so the url(#...) references resolve. Harmless if a swapped-in theme adds
  // them again. #cr-rough: a gentle waver on the hand-drawn chest strokes (see .cr-chest CSS).
  // #cr-paper: a much stronger, low-frequency displacement that tears the parchment SHEET's edges into an
  // organic, hand-torn outline (applied to .checkin-reward::before, behind the crisp content).
  root.insertAdjacentHTML('beforeend',
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
    '<filter id="cr-rough" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>' +
    '<filter id="cr-paper" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.013 0.018" numOctaves="3" seed="11" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter></svg>');

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
    thorns: 'shield', msChance: 'bolt', bounceChance: 'arrow', rendMult: 'burst', range: 'range', interest: 'coin',
    ambush: 'burst', lastStand: 'heart', berserk: 'rate', execute: 'crit', detonate: 'burst', aegis: 'shield',
    vengeance: 'burst', ascetic: 'heart' };
  const STAT_LABEL: Record<string, string> = { rangedDamage: 'Damage', attackSpeed: 'Speed', health: 'HP', regen: 'Regen',
    critChance: 'Crit', critDamage: 'Crit Dmg', gold: 'Gold',
    thorns: 'Disintegrate', msChance: 'Multi hit', bounceChance: 'Lightning Arc', rendMult: 'Amp', range: 'Range', interest: 'Interest',
    ambush: 'Ambush', lastStand: 'Last Stand', berserk: 'Berserk', execute: 'Execute', detonate: 'Detonate', aegis: 'Shield',
    vengeance: 'Vengeance', ascetic: 'Max HP/wave' };
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
  function curChips(meta: Meta, keys: string[], extra?: string): string {
    return '<div class="chips">' + keys.map((k) => {
      const d = CUR_BY_KEY[k];
      return '<span class="chip cur-' + k + '">' + icon(d.icon, 13, d.cls) + ' <b>' + abbr(curAmount(meta, k)) + '</b></span>';
    }).join('') + (extra || '') + '</div>';
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
  // one-line readable effect for a card at its current stars (e.g. "+10% attack speed").
  // Active-ability cards that recharge append their cooldown (data-driven from def.active.cooldown,
  // so any card that defines one shows it — currently just Super Tower's 30s).
  function cardDescText(def: CardDef, stars: number): string {
    const v = def.value(stars || 0);
    const base = def.desc ? def.desc(v) : def.fmt ? def.fmt(v) : '+' + v;
    const cd = def.active && def.active.cooldown;
    return cd ? base + ' · ' + cd + 's cooldown' : base;
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
      '<div class="card-img">' + cardArt(card.id, 50) + '</div>' +
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
      '<div class="rc-img">' + cardArt(r.id, 84) + '</div>' +
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
      '<div class="cm-medal">' + cardArt(id, 30) + '</div>' +
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
    // The active-labs/slots indicator is a slot chip carved into the same currency-chip frame as the
    // card-slot indicator (a hexagon in the D&D skin), so the two read as the same kind of counter.
    const slotChip = '<span class="chip cur-slot">' + icon('flask', 13) + ' <b>' + used + '/' + slots + '</b></span>';
    let html = '<div class="cur-with-slot">' + curChips(meta, ['coins', 'gems', 'vials'], slotChip) + '</div>';
    html += '<div class="labslots">' + labSlotsHtml(meta) + '</div>';
    const sc = labSlotCost(meta),
      canSlot = slots < MAX_SLOTS;
    if (canSlot) html += '<button class="slotbtn' + ((meta.gems || 0) < sc ? ' cant' : '') + '" id="h-buyslot">+1 Slot · ' + sc + ' ' + icon('gem', 13, 'gem') + '</button>';
    return html;
  }
  function wireLabsPane(scope: HTMLElement, rerender: () => void): void {
    // Clicking an empty vial slot opens the lab picker modal.
    scope.querySelectorAll<HTMLElement>('[data-pickslot]').forEach((el) =>
      el.addEventListener('click', () => openLabPickerFor(rerender, null)),
    );
    // "Change" does NOT stop the running lab — it just opens the picker in replace mode. The lab keeps
    // researching unless the player actually picks a DIFFERENT one, which swaps it in place.
    scope.querySelectorAll<HTMLElement>('[data-changelab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openLabPickerFor(rerender, b.dataset.changelab!);
      }),
    );
    scope.querySelectorAll<HTMLElement>('[data-rushlab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handlers.onRushResearch && handlers.onRushResearch(b.dataset.rushlab!)) rerender();
        else shake(b);
      }),
    );
    // per-lab "Speed Up": open the boost modal scoped to this lab.
    scope.querySelectorAll<HTMLElement>('[data-boostlab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openLabBoostModal(rerender, b.dataset.boostlab!);
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
  attachOverscrollBounce(contentEl); // rubber-band overscroll on the upgrade dock
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
  // ---- battle-speed → Game Speed lab tutorial (see runSpeedTut(), driven from update()) ----
  // Fires once, the first time the player taps the battle-speed button. A spotlight walks them to the
  // menu button → Labs rail icon → the Game Speed lab, deriving the current target purely from which
  // panels are open (so backing out never gets stuck). Persisted via meta.speedTutDone.
  let speedTut = false;
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

  // Check-in REWARD LETTER: a fixed parchment note that floats over the game (menu + in-game), shown
  // ONLY when a reward is actually claimable. It reads as a pinned letter on the board — just the
  // treasure-chest seal and the spoils it holds, no heading and no button — so the whole letter is the
  // affordance: clicking it claims the banked spoils, after which it hides itself again. There is no
  // idle countdown; the 15-minute cadence lives entirely in the sim (checkInPending).
  const checkinFloat = document.createElement('button');
  checkinFloat.id = 'h-checkin-float';
  checkinFloat.className = 'checkin-reward hide';
  checkinFloat.title = 'Claim your spoils';
  root.appendChild(checkinFloat);
  checkinFloat.addEventListener('click', () => {
    if (checkinFloat.classList.contains('cr-leaving')) return; // already claimed → mid fly-out
    if (handlers.onCheckIn && handlers.onCheckIn()) {
      // claimed: zoom the letter back out through the left, then hide (see playCheckinExit).
      playCheckinExit();
      lastCheckinPend = 0; // a later accrual re-triggers the fly-in
      if (menuEl.classList.contains('show')) renderMenu();
    }
  });
  // Entrance/exit motion: the letter flies IN from the left while growing (as if the paper came sailing
  // in from behind), then settles into its idle bob; claiming flies it back OUT through the left while
  // shrinking. Driven by the cr-entering / cr-leaving classes (keyframes in hud.css). A timer (rather
  // than animationend) drives the handoff so prefers-reduced-motion — which disables the keyframes —
  // still cleans up and hides.
  let crMotionTimer = 0;
  function playCheckinEnter(): void {
    clearTimeout(crMotionTimer);
    checkinFloat.classList.remove('cr-leaving', 'hide');
    checkinFloat.classList.add('cr-entering');
    crMotionTimer = window.setTimeout(() => checkinFloat.classList.remove('cr-entering'), 600);
  }
  function playCheckinExit(): void {
    clearTimeout(crMotionTimer);
    checkinFloat.classList.remove('cr-entering');
    checkinFloat.classList.add('cr-leaving');
    crMotionTimer = window.setTimeout(() => {
      checkinFloat.classList.add('hide');
      checkinFloat.classList.remove('cr-leaving');
    }, 460);
  }
  // Cache the last-rendered pending count: the letter is refreshed on a 1s tick but its contents only
  // change every 15 minutes, so we rebuild the DOM only when the count actually changes — otherwise the
  // glow/bob animations would restart every second and flicker.
  let lastCheckinPend = -1;
  function refreshCheckinFloat(): void {
    const meta = boundMeta || lastMeta || (lastS ? lastS.meta : null);
    const pend = meta ? checkInPending(meta, Date.now()) : 0;
    if (pend <= 0) {
      if (checkinFloat.classList.contains('cr-leaving')) return; // let the fly-out finish — it hides itself
      checkinFloat.classList.add('hide');
      lastCheckinPend = 0;
      return;
    }
    if (pend === lastCheckinPend && !checkinFloat.classList.contains('hide')) return; // unchanged → no rebuild
    const reappearing = checkinFloat.classList.contains('hide'); // hidden → now claimable: play the fly-in
    lastCheckinPend = pend;
    // The letter holds only a compass-rose seal and the spoils chips — no title, no claim button.
    checkinFloat.innerHTML =
      '<span class="cr-glow" aria-hidden="true"></span>' +
      '<span class="cr-emblem">' + icon('compassHand', 30) + '</span>' +
      '<span class="cr-loot">' +
        '<span class="cr-chip">' + icon('vial', 13, 'vial') + '<b>+' + pend * CHECKIN_VIALS + '</b></span>' +
        '<span class="cr-chip">' + icon('gem', 13, 'gem') + '<b>+' + pend * CHECKIN_GEMS + '</b></span>' +
      '</span>';
    checkinFloat.classList.remove('hide');
    if (reappearing) playCheckinEnter();
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
    maybeStartSpeedTut(); // first tap → guide the player to the Game Speed lab
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
    skipBtn.classList.toggle('hide', !irLocked() && !speedTut);
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
    if (speedTut) { endSpeedTut(true); return; }
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

  // Has the player already engaged with the Game Speed lab (a level done or one researching)? Then they
  // understand the mechanic — the tutorial is pointless and is marked done so it never fires.
  function speedLabEngaged(m: Meta): boolean {
    return labLevel(m, SPEED_LAB) > 0 || !!researchOf(m, SPEED_LAB);
  }
  function endSpeedTut(done: boolean): void {
    speedTut = false;
    const m = curMeta();
    if (done && m) { m.speedTutDone = true; handlers.onSaveMeta && handlers.onSaveMeta(); }
    setSpotlight(false);
    updateSkipBtn();
  }
  // Begin the tutorial the first time the speed button is tapped — unless tutorials are off, it's been
  // shown, another tutorial is running, or the player already gets the Game Speed lab.
  function maybeStartSpeedTut(): void {
    if (speedTut || irStep) return;
    if (settings.showTutorials === false) return;
    if (menuEl.classList.contains('show')) return; // only in-run, where update() drives the spotlight
    const m = curMeta();
    if (!m || m.speedTutDone) return;
    if (speedLabEngaged(m)) { m.speedTutDone = true; handlers.onSaveMeta && handlers.onSaveMeta(); return; }
    speedTut = true;
    updateSkipBtn();
    runSpeedTut();
  }
  // Spotlight the NEXT thing to tap, derived purely from which panels are open: closed → the menu
  // button; rail open → the Labs flask; Labs open → an empty research slot; picker open → the Game
  // Speed row. Each bubble explains the WHY, not just the next tap, and the final step walks the
  // player all the way to pressing Start. Starting/owning the lab ends the lesson. Re-run every frame
  // from update() so the highlight tracks layout and the player can never get wedged by backing out.
  function runSpeedTut(): void {
    if (!speedTut) return;
    const m = curMeta();
    if (!m) return;
    if (speedLabEngaged(m)) { endSpeedTut(true); return; }
    const pickerOpen = !updmodal.classList.contains('hide');
    const labsOpen = !labsModal.classList.contains('hide');
    const menuOpen = sidemenu.classList.contains('open');
    if (pickerOpen) {
      const el = updmodalInner.querySelector('[data-startlab="' + SPEED_LAB + '"]') as HTMLElement | null;
      const cost = labCoinCost(m, SPEED_LAB);
      const afford = (m.coins || 0) >= cost;
      setSpotlight(!!el, el, '<b>Game Speed</b> permanently raises the battle speeds you can pick (2×, 3× …), so every run finishes faster. ' +
        (afford
          ? 'Tap <b>Start</b> (' + cost + ' ' + coinsIc(12) + ') to begin researching — it finishes on a timer, even while you\'re away.'
          : 'It costs ' + cost + ' ' + coinsIc(12) + ' to start — earn a little more and come back to research it.'));
    } else if (labsOpen) {
      const el = labsModalInner.querySelector('.labslot.empty') as HTMLElement | null;
      setSpotlight(!!el, el, 'Labs research one upgrade per slot over real time — they keep working between runs. Tap an empty slot to pick <b>Game Speed</b>.');
    } else if (menuOpen) {
      setSpotlight(true, railLabs, '<b>Labs</b> hold permanent upgrades, including faster battle speed. Open it to research them.');
    } else {
      setSpotlight(true, $('#h-menu-btn'), 'Faster battle speed isn\'t a button — it\'s unlocked in <b>Labs</b>. Open the menu to get there.');
    }
  }

  // In-run active-skill rail. Surfaces each EQUIPPED active card as a status chip; only Dark Wiz is
  // tappable (it's the lone manually-triggered skill). Rebuilds only when the rail's content actually
  // changes (tracked via a signature) so taps aren't interrupted by per-frame DOM churn.
  const ACTIVE_RAIL = ['superTower', 'plasmaCanon', 'secondWind', 'demonMode'];
  let lastActivesSig = '';
  function activeChip(id: string, s: State): { cls: string; label: string } {
    const run = s.run || ({} as State['run']);
    const act = (run.actActive || {})[id] || 0;
    const cd = (run.actCd || {})[id] || 0;
    const ceil = (v: number): string => Math.ceil(v) + 's';
    if (id === 'demonMode') {
      if (act > 0) return { cls: 'active', label: ceil(act) };
      if (run.demonUsed) return { cls: 'spent', label: 'Used' };
      return { cls: 'armed', label: 'Activate' };
    }
    if (id === 'secondWind') {
      if (act > 0) return { cls: 'active', label: 'Shield ' + ceil(act) };
      if (run.secondWindUsed) return { cls: 'spent', label: 'Used' };
      return { cls: 'ready', label: 'Armed' };
    }
    if (id === 'superTower') {
      if (act > 0) return { cls: 'active', label: ceil(act) };
      if (cd > 0) return { cls: 'cooldown', label: ceil(cd) };
      return { cls: 'ready', label: 'Ready' };
    }
    return { cls: 'ready', label: 'Auto' }; // plasmaCanon: fires automatically when a boss appears
  }
  function renderActives(s: State): void {
    const equipped = activeCardIds(s.meta).filter((id) => ACTIVE_RAIL.includes(id));
    equipped.sort((a, b) => ACTIVE_RAIL.indexOf(a) - ACTIVE_RAIL.indexOf(b));
    if (!equipped.length) {
      if (!activesEl.classList.contains('hide')) activesEl.classList.add('hide');
      return;
    }
    const chips = equipped.map((id) => ({ id, def: CARDS[id], ...activeChip(id, s) }));
    const sig = chips.map((c) => c.id + ':' + c.cls + ':' + c.label).join('|');
    if (sig !== lastActivesSig) {
      lastActivesSig = sig;
      activesEl.innerHTML = chips
        .map(
          (c) =>
            '<button class="actchip ' + c.cls + '" data-skill="' + c.id + '" title="' + (c.def ? c.def.name : c.id) + '">' +
            '<span class="ac-ic" style="--tint:' + (c.def ? c.def.tint : '#9b8cff') + '">' + cardArt(c.id, 24) + '</span>' +
            '<span class="ac-s">' + c.label + '</span></button>',
        )
        .join('');
    }
    activesEl.classList.remove('hide');
  }

  function update(s: State): void {
    lastS = s;
    renderActives(s);
    if (!uel)
      uel = {
        wave: $('#h-wave'), hp: $('#h-hp'), gold: $('#h-gold'),
        coins: $('#h-coins'), gems: $('#h-gems'), vials: $('#h-vials'), energy: $('#h-energy'),
        dmg: $('#h-dmg'), regen: $('#h-regen'), coinmult: $('#h-coinmult'), fhp: $('#h-fhp'), fdmg: $('#h-fdmg'),
        hpfill: $('#h-hpfill'), wavefill: $('#h-wavefill'), statline: $('#h-statline'),
        tabbar: $('#h-tabbar'), stats: $('#h-stats'), speedval: $('#h-speedval'),
      };
    if (speedTut) runSpeedTut();
    else runTut(s);
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
  type SetRow = { key: keyof Settings; label: string; icon: string; cls?: string };
  // Grouped into titled sections (the modal renders one block per section, in a compact 2-col grid).
  const SETTINGS_SECTIONS: { title: string; rows: SetRow[] }[] = [
    { title: 'On-screen', rows: [
      { key: 'goldOnKill', label: 'Gold on kill', icon: 'coin', cls: 'gold' },
      { key: 'coinOnKill', label: 'Coins on kill', icon: 'coinstar', cls: 'coin' },
      { key: 'enemyHp', label: 'Enemy HP bars', icon: 'heart', cls: 'hp' },
      { key: 'damageNumbers', label: 'Damage numbers', icon: 'burst' },
      { key: 'msgDodge', label: 'Dodge', icon: 'dodge', cls: 'cyan' },
    ] },
    { title: 'Wave messages', rows: [
      { key: 'msgWaveSkip', label: 'Wave skipped', icon: 'arrow', cls: 'cyan' },
      { key: 'msgInterest', label: 'Interest gained', icon: 'coin', cls: 'gold' },
      { key: 'msgEnemySkip', label: 'Enemy level skipped', icon: 'shield', cls: 'green' },
    ] },
    { title: 'Guidance', rows: [
      { key: 'showTutorials', label: 'Show tutorials', icon: 'upgrades' },
      { key: 'showOfflineReward', label: 'Offline summary', icon: 'best' },
    ] },
  ];
  const setmodal = $('#h-setmodal'),
    setmodalInner = $('#h-setmodal-inner');
  // Toggle rows are built from one source, reused by the in-game side-rail gear and the
  // between-games menu gear (both open the same centered modal, mutating the shared `settings`).
  const settingsRowHtml = (o: SetRow): string =>
    '<button class="setrow' + (settings[o.key] ? ' on' : '') + '" data-set="' + o.key + '">' +
    '<span class="sl">' + icon(o.icon, 15, o.cls || '') + '<span>' + o.label + '</span></span>' +
    '<span class="switch"><i></i></span></button>';
  const settingsRowsHtml = (): string =>
    SETTINGS_SECTIONS.map(
      (sec) =>
        '<div class="set-sec"><div class="set-sec-t">' + sec.title + '</div>' +
        '<div class="set-grid">' + sec.rows.map(settingsRowHtml).join('') + '</div></div>',
    ).join('');
  // Camera-zoom slider: a continuous control (not a toggle) read live by the renderer. <1 pulls back to
  // reveal more of the field; >1 magnifies the tower. The shared `settings` object IS the renderer's,
  // so moving the slider re-frames the live view immediately.
  const ZOOM_MIN = 0.5, ZOOM_MAX = 2;
  const zoomVal = (): number => {
    const z = typeof settings.zoom === 'number' ? settings.zoom : 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  };
  const settingsSliderHtml = (): string => {
    const z = zoomVal();
    return '<div class="set-sec"><div class="set-sec-t">Camera</div>' +
      '<div class="set-slider"><span class="ss-ic">' + icon('zoom', 16) + '</span>' +
      '<span class="ss-label">Tower zoom</span>' +
      '<input class="ss-range" type="range" id="h-zoom" min="' + ZOOM_MIN + '" max="' + ZOOM_MAX + '" step="0.1" value="' + z + '">' +
      '<span class="ss-val" id="h-zoomval">' + z.toFixed(1) + 'x</span></div></div>';
  };
  const wireSettingsRows = (el: HTMLElement): void => {
    el.querySelectorAll<HTMLElement>('[data-set]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.set as keyof Settings;
        // toggle rows only ever target boolean settings; treat as a boolean record for the write.
        (settings as Record<string, boolean>)[k] = !settings[k];
        b.classList.toggle('on', !!settings[k]);
        handlers.onSaveSettings && handlers.onSaveSettings();
      }),
    );
    const zr = el.querySelector<HTMLInputElement>('#h-zoom');
    const zv = el.querySelector<HTMLElement>('#h-zoomval');
    if (zr) zr.addEventListener('input', () => {
      const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zr.value) || 1));
      settings.zoom = v;
      if (zv) zv.textContent = v.toFixed(1) + 'x';
      handlers.onSaveSettings && handlers.onSaveSettings();
    });
  };
  function openSettings(): void {
    // On-screen indicators (read by the renderer) + which guided popups to play + camera zoom. No sim state.
    setmodalInner.innerHTML =
      '<div class="statshead"><h2>Show info</h2><button class="iconclose" id="h-set-close" title="Close">' +
      icon('close', 18) + '</button></div><div class="setbody">' + settingsRowsHtml() + settingsSliderHtml() + '</div>';
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
  // While the offline catch-up is still computing the modal is "locked": no backdrop-dismiss, so the
  // player can't tap past the in-progress tally before the sim has finished and Collect is enabled.
  let infoLocked = false;
  function hideInfoModal(): void {
    infoLocked = false;
    infomodal.classList.add('hide');
  }
  // click the dimmed backdrop (not the card) to dismiss — same idiom as the other modals
  infomodal.addEventListener('click', (e) => {
    if (e.target === infomodal && !infoLocked) hideInfoModal();
  });
  interface InfoModalOpts {
    accent: string;     // tint class suffix for the glow/badge: 'amber' (tutorial) | 'gold' (reward)
    iconName: string;
    title: string;
    body: string;       // inner HTML
    rewards?: string;   // optional reward-chip HTML row
    primary: string;    // primary button label
    primaryDisabled?: boolean; // render the primary button disabled (e.g. while an offline tally runs)
    onPrimary?: () => void;
    secondary?: string;     // optional second (subdued) button below the primary
    onSecondary?: () => void;
    dontShowAgain?: { key: keyof Settings; label: string };
  }
  function showInfoModal(o: InfoModalOpts): void {
    infoLocked = false; // a fresh modal starts unlocked; showOfflineReward re-locks if it's still computing
    const dsa = o.dontShowAgain;
    infocard.className = 'infomodal-card im-' + o.accent;
    infocard.innerHTML =
      '<div class="im-glow"></div>' +
      '<div class="im-badge">' + icon(o.iconName, 30) + '</div>' +
      '<h2 class="im-title">' + o.title + '</h2>' +
      '<div class="im-body">' + o.body + '</div>' +
      (o.rewards ? '<div class="im-rewards">' + o.rewards + '</div>' : '') +
      (dsa ? '<button class="im-dsa" id="h-im-dsa"><span class="im-check"><i></i></span><span>' + dsa.label + '</span></button>' : '') +
      '<button class="im-ok" id="h-im-ok"' + (o.primaryDisabled ? ' disabled' : '') + '>' + o.primary + '</button>' +
      (o.secondary ? '<button class="im-secondary" id="h-im-sec">' + o.secondary + '</button>' : '');
    if (o.secondary) {
      $('#h-im-sec').addEventListener('click', () => {
        hideInfoModal();
        o.onSecondary && o.onSecondary();
      });
    }
    if (dsa) {
      const b = $('#h-im-dsa');
      b.addEventListener('click', () => {
        const off = !b.classList.contains('on'); // checked = "don't show" → the setting goes OFF
        b.classList.toggle('on', off);
        // "don't show again" only flips boolean settings; treat as a boolean record for the write.
        (settings as Record<string, boolean>)[dsa.key] = !off;
        handlers.onSaveSettings && handlers.onSaveSettings();
      });
    }
    $('#h-im-ok').addEventListener('click', () => {
      if ((($('#h-im-ok') as HTMLButtonElement).disabled)) return; // still computing → ignore
      hideInfoModal();
      o.onPrimary && o.onPrimary();
    });
    infomodal.classList.remove('hide');
  }
  // Spoils are the CURRENCIES the run banked while away, each as a gemstone hexagon (matching the
  // home-screen currency chips). Only non-zero gains appear; kills/waves are progress, not loot,
  // so they're not shown here. gold is the in-run purse (cur-gold tint); the rest are meta coins,
  // and gems/vials when a superpower minted them mid-replay. While still computing we keep a faint
  // placeholder so the chip row doesn't pop in empty.
  function offlineChipsHtml(reward: OfflineReward, computing: boolean): string {
    const specs: { key: string; ic: string; cls: string; amt: number }[] = [
      { key: 'gold', ic: 'coin', cls: 'gold', amt: reward.gold || 0 },
      { key: 'coins', ic: 'coinstar', cls: 'coin', amt: reward.coins || 0 },
      { key: 'gems', ic: 'gem', cls: 'gem', amt: reward.gems || 0 },
      { key: 'vials', ic: 'vial', cls: 'vial', amt: reward.vials || 0 },
    ];
    const chips = specs
      .filter((s) => s.amt > 0)
      .map((s) => '<span class="chip cur-' + s.key + '">' + icon(s.ic, 13, s.cls) + ' <b>+' + abbr(s.amt) + '</b></span>')
      .join('');
    return chips || (computing ? '<span class="chip cur-gold im-pending">' + icon('coin', 13, 'gold') + ' <b>+0</b></span>' : '');
  }
  // Public: the "while you were away" summary. With opts.computing it opens LIVE — the offline sim is
  // still running on the worker, so the totals tick up via updateOfflineReward() and Collect stays
  // disabled (and the backdrop locked) until the replay finishes.
  function showOfflineReward(reward: OfflineReward, opts?: { computing?: boolean }): void {
    const computing = !!(opts && opts.computing);
    showInfoModal({
      accent: 'gold',
      iconName: 'best',
      title: 'While you were away',
      body: computing
        ? 'Your hero is still fighting through the time you were gone — tallying the spoils&hellip;'
        : 'Your hero kept fighting in your absence and banked these spoils:',
      rewards:
        '<div class="chips" id="h-off-chips">' + offlineChipsHtml(reward, computing) + '</div>' +
        (computing ? '<div class="im-progress" id="h-off-prog"><span class="im-spin"></span><span>Simulating&hellip;</span></div>' : ''),
      primary: computing ? 'Simulating&hellip;' : 'Collect',
      primaryDisabled: computing,
      dontShowAgain: { key: 'showOfflineReward', label: "Don't show this again" },
    });
    infoLocked = computing; // lock the backdrop until the tally completes
  }
  // Public: refresh the live totals on an open computing modal. `done` finishes it: enable Collect,
  // unlock the backdrop and drop the "Simulating…" row. No-op if no offline modal is showing.
  function updateOfflineReward(reward: OfflineReward, done: boolean): void {
    const chips = root.querySelector('#h-off-chips');
    if (!chips) return; // not the offline modal (or already collected)
    chips.innerHTML = offlineChipsHtml(reward, !done);
    if (done) {
      infoLocked = false;
      const ok = root.querySelector('#h-im-ok') as HTMLButtonElement | null;
      if (ok) {
        ok.disabled = false;
        ok.textContent = 'Collect';
      }
      const prog = root.querySelector('#h-off-prog');
      if (prog) prog.remove();
    }
  }
  // Public: dismiss the offline modal outright (e.g. the hero died catching up).
  function hideOfflineReward(): void {
    if (root.querySelector('#h-off-chips')) hideInfoModal();
  }
  // Public: shown on return when the run was left PAUSED (so it earned nothing). Asks whether the
  // pause was intentional; "collect" lets the caller fast-forward the missed time at the player's
  // fastest unlocked speed, while "I paused on purpose" simply dismisses and leaves the run paused.
  function showPausePrompt(info: { awaySec: number; speed: number }, onCollect: () => void, onKeepPaused?: () => void): void {
    showInfoModal({
      accent: 'amber',
      iconName: 'ffwd',
      title: 'Were you paused on purpose?',
      body: 'Your run sat <b>paused</b> for about <b>' + fmtTime(info.awaySec) + '</b>, so it earned nothing while you were away. ' +
        'If you didn\'t mean to pause, collect what you\'d have made running at <b>' + fmtSpeed(info.speed) + '</b> — your fastest unlocked speed.',
      primary: 'Collect at ' + fmtSpeed(info.speed),
      onPrimary: onCollect,
      secondary: 'I paused on purpose',
      onSecondary: onKeepPaused,
    });
  }

  // ---------- PWA update prompt + workshop-rail "upgrade" button ----------
  // The rail button (an up-arrow appended to the menu tab bar) is wired in the MENU_TABS section below;
  // these refs let setUpdateAvailable() reveal it and bind its click without rebuilding the rail.
  let updateRailBtn: HTMLButtonElement | null = null;
  let onUpdateClick: (() => void) | null = null;
  // The on-return / on-boot update modal: shows the player's version vs the server's, warns when the
  // jump will reset a pre-alpha save, and offers Update now / Keep playing.
  function showUpdatePrompt(info: UpdateInfo, onUpdate: () => void, onKeep?: () => void): void {
    const warn = info.breaksSave
      ? '<div class="im-warn">' + icon('best', 15) +
        ' This update changes the save format. Your current progress <b>will be reset</b> when you update.</div>'
      : '';
    showInfoModal({
      accent: 'amber',
      iconName: 'arrowup',
      title: 'Update available',
      body:
        'You\'re playing <b>' + info.current + '</b>.<br>' +
        'The latest version is <b>' + info.latest + '</b>.' +
        warn,
      primary: 'Update now',
      onPrimary: onUpdate,
      secondary: 'Keep playing',
      onSecondary: onKeep,
    });
  }
  // Reveal (or hide) the up-arrow upgrade button in the workshop tab rail and bind what it does. Shown
  // after the player chose "Keep playing" so they can still update later from the menu at any time.
  function setUpdateAvailable(on: boolean, onUpdate?: () => void): void {
    onUpdateClick = on ? onUpdate || null : null;
    if (updateRailBtn) updateRailBtn.classList.toggle('hide', !on);
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
    attachOverscrollBounceAll(cardsModalInner, '.mgmt-body');
    wireCardsPane(cardsModalInner, renderCardsModal);
  }
  function renderLabsModal(): void {
    const meta = curMeta();
    if (!meta) return;
    lastMeta = meta; // openLabPicker / labSlotsHtml read lastMeta
    labsModalInner.innerHTML = mgmtHead('Labs', 'h-labsmodal-close') + '<div class="mgmt-body">' + labsPaneHtml(meta) + '</div>';
    $('#h-labsmodal-close').addEventListener('click', () => labsModal.classList.add('hide'));
    attachOverscrollBounceAll(labsModalInner, '.mgmt-body');
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
    // Labs are always open now (the Game Speed lab is researchable from the start; the rest of the
    // tier-1 ladder is gated per-lab inside the picker). So the rail always opens the modal.
    if (!curMeta()) return;
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

  // Lab picker: lists the labs you can drop into a slot, grouped under section headers. Maxed /
  // already-running / locked labs are disabled. Rows start collapsed (the modal opens that way every
  // time); a head-click expands one description, "Expand all" opens them all at once. When CHANGING a
  // running lab (labReplacing set), picking a different lab swaps it in place — see the Start handler.
  const LAB_SECTIONS: { label: string; icon: string; cats: string[] }[] = [
    { label: 'Attack', icon: 'sword', cats: ['attack'] },
    { label: 'Defense', icon: 'shield', cats: ['defense'] },
    { label: 'Utility', icon: 'coin', cats: ['economic'] },
    { label: 'Superpowers', icon: 'prestige', cats: ['speed'] },
  ];
  const labInfoOpen = new Set<string>(); // individually-expanded rows
  let labExpandAll = false;              // "Expand all" → every row's detail open at once
  let labReplacing: string | null = null; // the running lab being swapped (Change), or null for an empty slot
  // Open the picker fresh: collapse everything (default) and remember which slot we're filling.
  function openLabPickerFor(onChange: () => void, replacingId: string | null): void {
    labReplacing = replacingId;
    labInfoOpen.clear();
    labExpandAll = false;
    openLabPicker(onChange);
  }
  function openLabPicker(onChange: () => void): void {
    if (!lastMeta) return;
    const meta = lastMeta;
    const replacing = labReplacing != null;
    const rowHtml = (L: LabDef): string => {
      const lv = labLevel(meta, L.id),
        maxed = labAtMax(meta, L.id),
        unlocked = labUnlocked(meta, L.id),
        running = !!researchOf(meta, L.id),
        current = L.id === labReplacing;
      const cost = labCoinCost(meta, L.id),
        t = labTimeSec(meta, L.id);
      // When swapping, the slot we'd free counts as available so the target isn't blocked on slots.
      const can = unlocked && !maxed && !running && (meta.coins || 0) >= cost && (freeSlots(meta) > 0 || replacing);
      const disabled = !can;
      const open = labExpandAll || labInfoOpen.has(L.id);
      const statusTag = maxed ? 'MAX' : current ? 'Current' : running ? 'Running'
        : !unlocked ? icon('lock', 12) + ' wave ' + L.gate.wave : '';
      const startLabel = maxed ? 'Maxed' : current ? 'Current' : running ? 'In progress' : !unlocked ? 'Locked'
        : (replacing ? 'Switch · ' : '') + cost + ' ' + coinsIc(13) + ' · ' + (t > 0 ? fmtTime(t) : 'instant');
      // The whole banner head is the info toggle (data-info); the Start button stops propagation so a
      // start-click never also flips the info panel.
      return '<div class="labpick-row' + (open ? ' open' : '') + '">' +
        '<div class="labpick-head" data-info="' + L.id + '">' +
          '<div class="labpick-ic">' + icon(LAB_CAT_ICON[L.cat] || 'flask', 18) + '</div>' +
          '<div class="labpick-title"><b>' + L.label + '</b><span>lv ' + lv + ' / ' + L.max +
            (statusTag ? '  ·  ' + statusTag : '') + '</span></div>' +
          '<button class="labpick-start' + (disabled ? ' cant' : '') + '" data-startlab="' + L.id + '"' +
            (disabled ? ' disabled' : '') + '>' + startLabel + '</button>' +
        '</div>' +
        (open
          ? '<div class="labpick-detail">' + labDesc(L, lv + 1) +
            '<br>Instant-complete a running lab for 1 ' + icon('gem', 12, 'gem') + ' per minute left.</div>'
          : '') +
        '</div>';
    };
    let body = '';
    for (const sec of LAB_SECTIONS) {
      const inSec = LABS.filter((L) => sec.cats.includes(L.cat));
      if (!inSec.length) continue;
      body += '<div class="labpick-section">' + icon(sec.icon, 13) + ' <span>' + sec.label + '</span></div>';
      for (const L of inSec) body += rowHtml(L);
    }
    const title = replacing ? 'Switch Lab' : 'Choose a Lab';
    const sub = replacing
      ? 'Pick a new lab — the current one keeps running until you do'
      : 'Research scales workshop stats &amp; raises caps';
    updmodalInner.innerHTML =
      '<div class="upd-head"><div class="upd-icon">' + icon('flask', 20) + '</div>' +
        '<div class="upd-title"><b>' + title + '</b><span>' + sub + '</span></div>' +
        '<button class="labpick-expand" id="h-labpick-expand">' + (labExpandAll ? 'Collapse all' : 'Expand all') + '</button>' +
        '<button class="iconclose" id="h-labpick-close">' + icon('close', 18) + '</button></div>' +
      '<div class="labpick-list">' + body + '</div>';
    attachOverscrollBounceAll(updmodalInner, '.labpick-list');
    $('#h-labpick-close').addEventListener('click', () => updmodal.classList.add('hide'));
    $('#h-labpick-expand').addEventListener('click', () => {
      labExpandAll = !labExpandAll;
      labInfoOpen.clear();
      openLabPicker(onChange);
    });
    updmodalInner.querySelectorAll<HTMLElement>('[data-info]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.info!;
        // Toggling a single row while "expand all" is on: switch to per-row mode with every row open,
        // then collapse just the one clicked — so one click never hides everything.
        if (labExpandAll) { labExpandAll = false; for (const L of LABS) labInfoOpen.add(L.id); }
        if (labInfoOpen.has(id)) labInfoOpen.delete(id); else labInfoOpen.add(id);
        openLabPicker(onChange);
      }),
    );
    updmodalInner.querySelectorAll<HTMLElement>('[data-startlab]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // don't let the Start click bubble to the banner's info toggle
        const id = b.dataset.startlab!;
        // Swapping: free the running lab first (refunds its in-progress coins) so a slot opens for the
        // new pick. Refund-then-charge keeps an affordable row affordable across the swap.
        if (replacing && id !== labReplacing && handlers.onCancelResearch) handlers.onCancelResearch(labReplacing!);
        if (handlers.onStartResearch && handlers.onStartResearch(id)) {
          updmodal.classList.add('hide');
          onChange();
        } else shake(b);
      }),
    );
    updmodal.classList.remove('hide');
  }

  // ---- "Speed Up" modal: buy a timed boost for ONE lab (duration × multiplier, paid in vials) ----
  const BOOST_DURATIONS: { label: string; sec: number }[] = [
    { label: '1h', sec: 3600 }, { label: '6h', sec: 6 * 3600 }, { label: '12h', sec: 12 * 3600 },
    { label: '1d', sec: 86400 }, { label: '2d', sec: 2 * 86400 }, { label: '3d', sec: 3 * 86400 },
    { label: '5d', sec: 5 * 86400 }, { label: '7d', sec: MAX_BOOST_DAYS * 86400 },
  ];
  let boostDurSel = 86400;   // default 1 day
  let boostMultSel = 2;      // default 2×
  function openLabBoostModal(onChange: () => void, labId: string): void {
    if (!lastMeta) return;
    const meta = lastMeta;
    const now = Date.now();
    const L = LAB_BY_ID[labId];
    const labName = L ? L.label : 'Lab';
    // Already boosting THIS lab? Show the live status and bail (no stacking on the same lab).
    if (labBoostMult(meta, labId, now) > 1) {
      updmodalInner.innerHTML =
        '<div class="upd-head"><div class="upd-icon">' + icon('ffwd', 20) + '</div>' +
          '<div class="upd-title"><b>' + labName + ' Boosted</b><span>' + fmtSpeed(labBoostMult(meta, labId, now)) +
            ' speed · ' + fmtTime(labBoostRemaining(meta, labId, now)) + ' left</span></div>' +
          '<button class="iconclose" id="h-boost-close">' + icon('close', 18) + '</button></div>' +
        '<div class="boost-body"><p class="boost-note">This lab is already boosted. Wait for it to finish before boosting it again.</p></div>';
      $('#h-boost-close').addEventListener('click', () => updmodal.classList.add('hide'));
      updmodal.classList.remove('hide');
      return;
    }
    const render = (): void => {
      const cost = labBoostCost(boostMultSel, boostDurSel);
      const afford = (meta.vials || 0) >= cost;
      const durChips = BOOST_DURATIONS.map((d) =>
        '<button class="boost-chip' + (d.sec === boostDurSel ? ' on' : '') + '" data-dur="' + d.sec + '">' + d.label + '</button>').join('');
      const multChips = [];
      for (let m = 2; m <= MAX_BOOST_MULT; m++)
        multChips.push('<button class="boost-chip' + (m === boostMultSel ? ' on' : '') + '" data-mult="' + m + '">' + m + 'x</button>');
      updmodalInner.innerHTML =
        '<div class="upd-head"><div class="upd-icon">' + icon('ffwd', 20) + '</div>' +
          '<div class="upd-title"><b>Speed Up ' + labName + '</b><span>This lab runs faster for a fixed time</span></div>' +
          '<button class="iconclose" id="h-boost-close">' + icon('close', 18) + '</button></div>' +
        '<div class="boost-body">' +
          '<div class="boost-sec">' + icon('stopwatch', 13) + ' <span>Duration</span></div>' +
          '<div class="boost-chips">' + durChips + '</div>' +
          '<div class="boost-sec">' + icon('ffwd', 13) + ' <span>Speed</span></div>' +
          '<div class="boost-chips">' + multChips.join('') + '</div>' +
          '<p class="boost-note">Banks <b>' + fmtTime(boostDurSel * boostMultSel) + '</b> of lab time over ' +
            '<b>' + fmtTime(boostDurSel) + '</b> of real time.</p>' +
        '</div>' +
        '<button class="boost-buy' + (afford ? '' : ' cant') + '" id="h-boost-buy"' + (afford ? '' : ' disabled') + '>' +
          'Boost · ' + cost.toLocaleString() + ' ' + icon('vial', 14, 'vial') + '</button>';
      $('#h-boost-close').addEventListener('click', () => updmodal.classList.add('hide'));
      updmodalInner.querySelectorAll<HTMLElement>('[data-dur]').forEach((b) =>
        b.addEventListener('click', () => { boostDurSel = Number(b.dataset.dur); render(); }));
      updmodalInner.querySelectorAll<HTMLElement>('[data-mult]').forEach((b) =>
        b.addEventListener('click', () => { boostMultSel = Number(b.dataset.mult); render(); }));
      const buy = $('#h-boost-buy');
      buy.addEventListener('click', () => {
        if (handlers.onApplyLabBoost && handlers.onApplyLabBoost(labId, boostMultSel, boostDurSel)) {
          updmodal.classList.add('hide');
          onChange();
        } else shake(buy);
      });
    };
    render();
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
    speedTut = false;
    setSpotlight(false);
    skipBtn.classList.add('hide');
    infomodal.classList.add('hide');
  };

  // ---------- MENU ----------
  const menuEl = $('#h-menu'),
    menuContent = $('#h-menu-content'),
    menuTabsEl = $('#h-menu-tabs');
  const tabbarEl = $('#h-tabbar'),
    topEl = $('#h-top'),
    activesEl = $('#h-actives');
  // Tap-to-fire delegation for active-skill buttons (only Dark Wiz is manually triggered today).
  activesEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-skill]') as HTMLElement | null;
    if (!btn || !btn.classList.contains('armed')) return;
    handlers.onActivateSkill && handlers.onActivateSkill(btn.dataset.skill!);
  });
  const modal = $('#h-modal'),
    modalInner = $('#h-modal-inner');
  attachOverscrollBounce(menuContent); // rubber-band overscroll on the between-games menu body
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

  // ---- menu (Workshop) tutorial spotlight ----
  // The first-purchase guide (sumPerm === 0): point the player to the Upgrades tab, then to the first
  // permanent upgrade. Unlike the in-run tutorial — which update() repositions every frame — the menu
  // has no per-frame loop, so a one-shot rAF snapshot would freeze the highlight at a stale rect
  // (any reflow from the avatar canvas, scroll, or content shift left it mispositioned / invisible).
  // A dedicated rAF ticker re-acquires + repositions the live target while the menu is shown.
  let menuSpotTarget: HTMLElement | null = null,
    menuSpotText = '',
    menuSpotRaf = 0;
  function tickMenuSpot(): void {
    const shown = menuEl.classList.contains('show');
    const tgt = shown && menuSpotTarget && menuSpotTarget.isConnected ? menuSpotTarget : null;
    if (!tgt) { menuSpotRaf = 0; setSpotlight(false); return; } // nothing to track → stop (renderMenu restarts)
    // Hide behind any open modal (detail / milestones / picker, all z-index > the spotlight) so the
    // highlight never floats over a dialog; it re-appears the moment the modal closes — but keep
    // ticking so it tracks the live rect the whole time the menu tutorial is active.
    const clear = modal.classList.contains('hide') && updmodal.classList.contains('hide');
    setSpotlight(clear, tgt, menuSpotText);
    menuSpotRaf = requestAnimationFrame(tickMenuSpot);
  }
  function startMenuSpot(): void { if (!menuSpotRaf) menuSpotRaf = requestAnimationFrame(tickMenuSpot); }
  function stopMenuSpot(): void {
    if (menuSpotRaf) cancelAnimationFrame(menuSpotRaf);
    menuSpotRaf = 0;
    menuSpotTarget = null;
    setSpotlight(false);
  }

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

  // The "upgrade available" button: an up-arrow pinned to the end of the tab rail, hidden until the
  // PWA update check (via setUpdateAvailable) finds a newer server build. Clicking it updates the game.
  updateRailBtn = document.createElement('button');
  updateRailBtn.className = 'mtab-update hide';
  updateRailBtn.title = 'Update available';
  updateRailBtn.innerHTML = icon('arrowup', 24);
  updateRailBtn.addEventListener('click', () => onUpdateClick && onUpdateClick());
  menuTabsEl.appendChild(updateRailBtn);

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
    thought.classList.remove('hide');
    const margin = 8,
      w = thought.offsetWidth,
      h = thought.offsetHeight,
      center = r.left + r.width / 2;
    const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - margin - w));
    thought.style.left = left + 'px';
    thought.style.setProperty('--arrow-x', center - left + 'px');
    // Default above the target; flip BELOW when there isn't room above (top-anchored targets like the
    // menu button or the Labs rail icon would otherwise push the bubble off the top of the viewport).
    const below = r.top - 10 - h < margin;
    thought.classList.toggle('below', below);
    thought.style.top = (below ? r.bottom + 10 : r.top - 10) + 'px';
    thought.style.transform = below ? 'translateY(0)' : 'translateY(-100%)';
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
      if (r && r.waiting) {
        // The next level auto-started but the player can't afford it yet: the slot stays ASSIGNED to
        // this lab (never idle) and resumes automatically once coins are available.
        const L = LAB_BY_ID[r.id];
        const lv = labLevel(meta, r.id),
          need = labCoinCost(meta, r.id);
        h += '<div class="labslot running waiting">' +
          vialHtml(L.label, 'lv ' + lv + '→' + (lv + 1), 0, 'running') +
          '<div class="labdesc">' + labDesc(L, lv + 1) + '</div>' +
          '<div class="labactions">' +
          '<span class="labrem">Need ' + abbr(need) + ' ' + coinsIc(12) + ' to continue</span>' +
          '<button class="changelab" data-changelab="' + r.id + '" title="Switch to a different research">' + icon('swap', 14) + ' Change</button>' +
          '</div></div>';
      } else if (r) {
        const L = LAB_BY_ID[r.id];
        const lv = labLevel(meta, r.id),
          prog = researchProgress(meta, r.id, now),
          rem = researchRemaining(meta, r.id, now);
        const gc = rushVialCost(meta, r.id, now),
          canRush = (meta.gems || 0) >= gc;
        const bm = labBoostMult(meta, r.id, now);
        // Per-lab "Speed Up": a compact button per running lab, or a live boost chip while one is active.
        const boostCtl = bm > 1
          ? '<span class="labboost-active" title="This lab is boosted">' + icon('ffwd', 12) + ' ' + fmtSpeed(bm) +
            ' · <b class="lab-boost-rem">' + fmtTime(labBoostRemaining(meta, r.id, now)) + '</b></span>'
          : '<button class="labboost-btn" data-boostlab="' + r.id + '" title="Speed up this lab">' + icon('ffwd', 12) + ' Speed Up</button>';
        h += '<div class="labslot running" data-lab="' + r.id + '">' +
          vialHtml(L.label, 'lv ' + lv + '→' + (lv + 1), prog, 'running') +
          '<div class="labdesc">' + labDesc(L, lv + 1) + '</div>' +
          '<div class="labactions">' +
          '<span class="labrem">' + fmtTime(rem) + ' left</span>' +
          boostCtl +
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
        isLab = !!reward.lab,
        special = isTower || isLab, // progress-tracked rungs (never "claimed")
        claimed = !!cl[tier + ':' + w],
        reached = best >= w,
        can = reached && !claimed && !special;
      const cls = 'msrow' + (reached ? ' reached' : '') + (isTower ? ' tower' : '') + (isLab ? ' lab' : '') +
        (special ? (reached ? ' unlocked' : ' locked') : claimed ? ' claimed' : can ? ' can' : ' locked');
      // The lab-unlock rung is intentionally bare — just the flask dot, the wave number, and a short
      // "Unlocks labs" chip (no per-lab list, which overflowed into the neighbouring rungs).
      let cta: string;
      if (isTower) {
        cta = rewardHtml(reward);
      } else if (isLab) {
        cta = '<span class="mn-reward lab ' + (reached ? 'unlocked' : 'locked') + '">' +
          icon(reached ? 'flask' : 'lock', 14) + ' ' + (reached ? 'Labs unlocked' : 'Unlocks labs') + '</span>';
      } else if (claimed) {
        cta = '<span class="mn-done">' + icon('check', 15) + ' Claimed</span>';
      } else if (can) {
        cta = '<button class="mn-claim" data-claim="' + w + '">Claim ' + rewardHtml(reward) + '</button>';
      } else {
        cta = '<span class="mn-reward locked">' + rewardHtml(reward) + '</span>';
      }
      rows += '<div class="' + cls + '">' +
        '<div class="msrail"><span class="msdot">' + (isLab ? icon('flask', 14) : isTower ? icon('best', 15) : short(w)) + '</span></div>' +
        '<div class="mscard"><div class="mn-info"><b>Wave ' + short(w) + '</b></div>' + cta + '</div></div>';
    });
    modalInner.innerHTML =
      '<button class="close" id="h-ms-close" title="Close">' + icon('close', 18) + '</button>' +
      '<div class="ms-head"><h2>Milestones</h2>' +
      '<p class="msnote"><span class="ms-tierband">' + icon('tier', 13) + ' Tier ' + tier + '</span>' +
      (claimable > 0 ? '<b class="ms-ready">' + claimable + ' reward' + (claimable > 1 ? 's' : '') + ' ready</b>' : '<span>reach further to unlock rewards</span>') +
      '</p></div>' +
      '<div class="mspath">' + rows + '</div>';
    attachOverscrollBounceAll(modalInner, '.mspath');
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
      // The check-in is surfaced by the fixed #h-checkin-float reward coffer (menu + in-game), shown
      // only when spoils are claimable — so there's no inline button or idle countdown here.
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
    attachOverscrollBounceAll(menuContent, '.activecards', { alwaysBounce: false }); // horizontal rubber-band on the equipped-cards strip (only when it actually overflows)

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
    // Tutorial spotlight: record the live target; the menu-spot ticker repositions it every frame
    // (and hides it behind any open modal). Cleared as soon as the player owns a permanent upgrade.
    menuSpotTarget = null;
    menuSpotText = '';
    if (tutoring) {
      if (menuTab === 'hero') {
        menuSpotTarget = menuTabsEl.querySelector('[data-mtab="upgrades"]');
        menuSpotText = 'Your ' + coinsIc(15) + ' buy <b>permanent</b> upgrades that carry into every future run. Open Upgrades to spend them.';
      } else if (menuTab === 'upgrades') {
        menuSpotTarget = menuContent.querySelector('.perm.tut');
        menuSpotText = 'Buy your first upgrade — unlike in-run boosts, these are <b>permanent</b>, and each purchase unlocks more to choose from.';
      }
    }
    // Record the labs structure we just rendered, so the 1s tick can patch progress in place (instead
    // of a full re-render that resets the currency + vial-bubble animations) until the structure changes.
    lastLabsSig = menuTab === 'labs' ? labsSig(meta) : '';
    startMenuSpot();
  }

  // ---- labs tab: cheap "structure" signature + in-place progress patcher (see the 1s tick below) ----
  // A renderMenu is only needed when the labs STRUCTURE changes (a level completes, a slot resumes from
  // waiting, a boost starts/expires). The signature captures exactly that; everything else (the fill
  // bars, time-left and boost countdowns) is patched in place so the animated UI never flickers.
  let lastLabsSig = '';
  function labsSig(meta: Meta): string {
    const now = Date.now();
    const r = (meta.research || []).map((x) =>
      x.id + ':' + labLevel(meta, x.id) + ':' + (x.waiting ? 'w' : 'r') + ':' + (labBoostMult(meta, x.id, now) > 1 ? 'b' : ''),
    ).join('|');
    return (meta.labSlots || 1) + ';' + r;
  }
  function patchLabProgress(meta: Meta): void {
    const now = Date.now();
    menuContent.querySelectorAll<HTMLElement>('.labslot.running[data-lab]').forEach((el) => {
      const id = el.dataset.lab!;
      const r = researchOf(meta, id);
      if (!r || r.waiting) return;
      const gold = el.querySelector<HTMLElement>('.vgold');
      if (gold) gold.style.width = (researchProgress(meta, id, now) * 100).toFixed(1) + '%';
      const rem = el.querySelector<HTMLElement>('.labrem');
      if (rem) rem.textContent = fmtTime(researchRemaining(meta, id, now)) + ' left';
      const brem = el.querySelector<HTMLElement>('.lab-boost-rem');
      if (brem) brem.textContent = fmtTime(labBoostRemaining(meta, id, now));
    });
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
    activesEl.classList.add('hide');
  }
  function refreshMenu(meta: Meta): void {
    if (meta) lastMeta = meta;
    if (menuEl.classList.contains('show')) renderMenu();
  }
  function hideMenu(): void {
    menuEl.classList.remove('show');
    updmodal.classList.add('hide');
    stopMenuSpot();
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
    activesEl.classList.add('hide');
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

  // 1s tick: keep the check-in reward letter current (menu AND in-game) and advance research bars on
  // the Lab tab. The Hero tab holds nothing time-driven (the avatar animates on its own rAF loop), so we
  // do NOT re-render it here. The Lab tab only re-renders when its STRUCTURE changes — otherwise we patch
  // the fill bars + countdowns in place, so the currency chips and rising vial bubbles never reset.
  setInterval(() => {
    refreshCheckinFloat();
    if (!menuEl.classList.contains('show') || !lastMeta) return;
    if (menuTab === 'labs') {
      if (handlers.onReconcileLabs) handlers.onReconcileLabs(); // a completed level re-renders via refreshMenu
      if (menuTab !== 'labs') return; // (reconcile may have navigated away)
      if (labsSig(lastMeta) !== lastLabsSig) renderMenu(); // structure changed (resume / boost edge) → full render
      else patchLabProgress(lastMeta); // steady state → just advance the bars + timers
    }
  }, 1000);

  return { update, showMenu, refreshMenu, hideMenu, showOverview, hideOverview, showHint, hideHint, showOfflineReward, updateOfflineReward, hideOfflineReward, showPausePrompt, showUpdatePrompt, setUpdateAvailable, setMeta, root };
}

// Factory for a themed skin: same core + wiring, restyled by `theme = { cls, css }`.
export const createThemedHud = (theme: ThemeDef): HudFactory => (root, handlers) => buildHud(root, handlers, theme);
