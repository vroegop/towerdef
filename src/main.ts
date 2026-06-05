/* src/main.ts — game boot + main loop. Wires the deterministic sim to the Canvas2D renderer
   and the swappable HUD host, owns persistence (localStorage), offline catch-up, and the dev
   overlay. This is the only module that touches the browser lifecycle. */
import './hud/hud.css';
import type { EarnSummary, HudHandlers, Meta, OfflineReward, Settings, State } from './types';
import { DT, catchUp, plannedTicks } from './sim/offline';
import type { CatchUpResult } from './sim/offline';
import { Sim, tickDying } from './sim/core';
import { requestActiveSkill } from './sim/cards-active';
import { createState } from './sim/state';
import { migrateMeta, reconcileResearch, claimCheckIn, startResearch, cancelResearch, rushResearch, applyLabBoost, buyLabSlot, gameSpeed, setGameSpeed, availableSpeeds, LABS, MAX_SLOTS } from './sim/labs';
import { buyRunUpgradeBulk, buyPermBulk, unlockGroup, claimMilestone, claimAllMilestones, buyCard, buyCardSlot, setActiveCard, FIRST_PERM_COST, UPGRADES, SKILL_GROUPS, upgradeCap, CARD_ORDER, MAX_STARS, MAX_CARD_SLOTS } from './sim/skills';
import { MAX_TIER, tierUnlocked, coinsForRun } from './sim/waves';
import { selectCosmetic, buyCosmetic, type CosmeticKind } from './sim/cosmetics';
import { buySuperpower, buySuperTrack, toggleSuperpower } from './sim/superpowers';
import { makeEnemy } from './sim/enemies';
import { BULLET_SPEED, BULLET_R } from './sim/projectiles';
import { Canvas2DRenderer } from './render/canvas2d';
import { createHudHost } from './hud/host';
import { createDevMenu, savedHud } from './hud/devmenu';
import { DEFAULT_HUD, HUDS } from './hud/registry';

const SAVE = 'arena.save',
  METAK = 'arena.meta',
  SETK = 'arena.settings',
  OFFLINE_CAP = 12 * 3600;

// visual-indicator settings (default ON); shared by reference with the renderer + HUD
function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(SETK) || '{}') || {};
  } catch {
    /* ignore */
  }
  return {
    goldOnKill: s.goldOnKill !== false,
    coinOnKill: s.coinOnKill !== false,
    enemyHp: s.enemyHp !== false,
    damageNumbers: s.damageNumbers !== false,
    showTutorials: s.showTutorials !== false,
    showOfflineReward: s.showOfflineReward !== false,
    msgWaveSkip: s.msgWaveSkip !== false,
    msgInterest: s.msgInterest !== false,
    msgEnemySkip: s.msgEnemySkip !== false,
    msgDodge: s.msgDodge !== false,
    // camera zoom on the tower: clamp to the slider's range; default 1 (untouched view).
    zoom: typeof s.zoom === 'number' && isFinite(s.zoom) ? Math.min(2, Math.max(0.5, s.zoom)) : 1,
  };
}
function saveSettings(): void {
  localStorage.setItem(SETK, JSON.stringify(settings));
}

function loadMeta(): Meta {
  let m: Partial<Meta> = {};
  try {
    m = JSON.parse(localStorage.getItem(METAK) || '{}') || {};
  } catch {
    /* ignore */
  }
  const meta: Meta = {
    coins: m.coins || 0,
    perm: m.perm || {},
    unlocked: m.unlocked || {}, // migrateMeta seeds the starter skills
    hasPlayed: !!m.hasPlayed,
    bestWave: m.bestWave || 0,
    claimedMilestones: m.claimedMilestones || {},
    tier: m.tier || 1,
    tierBest: m.tierBest || {},
    gems: m.gems || 0,
    cards: m.cards || [],
    cardBuys: m.cardBuys || 0,
    cardSlots: m.cardSlots || 1,
    activeCards: Array.isArray(m.activeCards) ? m.activeCards : [],
    totalWaves: m.totalWaves || 0,
    labs: m.labs || {},
    research: Array.isArray(m.research) ? m.research : [],
    // per-lab speed boosts persist across reloads so auto-chained levels + offline catch-up keep honouring
    // an active boost window (their endsAt is projected against it). migrateMeta defaults this too.
    labBoosts: m.labBoosts && typeof m.labBoosts === 'object' ? m.labBoosts : {},
    labSlots: m.labSlots || 1,
    vials: m.vials || 0,
    lastCheckIn: m.lastCheckIn || Date.now(),
    energy: m.energy || 0,
    superUnlocked: m.superUnlocked && typeof m.superUnlocked === 'object' ? m.superUnlocked : {},
    superLevels: m.superLevels && typeof m.superLevels === 'object' ? m.superLevels : {},
    superEnabled: m.superEnabled && typeof m.superEnabled === 'object' ? m.superEnabled : {},
    cosmetics: m.cosmetics && typeof m.cosmetics === 'object' ? m.cosmetics : {},
    cosmeticsOwned: m.cosmeticsOwned && typeof m.cosmeticsOwned === 'object' ? m.cosmeticsOwned : {},
    gameSpeed: m.gameSpeed ?? 1,
    inRunTutDone: !!m.inRunTutDone,
    ver: m.ver || 0,
  };
  return migrateMeta(meta);
}
function saveMeta(): void {
  localStorage.setItem(METAK, JSON.stringify(meta));
}
function loadSave(): { savedAt: number; state: State } | null {
  try {
    return JSON.parse(localStorage.getItem(SAVE) || 'null');
  } catch {
    return null;
  }
}
function clearSave(): void {
  localStorage.removeItem(SAVE);
}

const meta = loadMeta();
const settings = loadSettings();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = Canvas2DRenderer(canvas, settings);

const handlers: HudHandlers = {
  settings,
  onSaveSettings: saveSettings,
  onSaveMeta: () => saveMeta(),
  onActivateSkill: (id) => {
    if (sim) requestActiveSkill(sim.s, id);
  },
  onBuyRun: (stat, qty = 1) => {
    if (sim) buyRunUpgradeBulk(sim.s, stat, qty, sim.rng);
  },
  onBuyPerm: (id, qty = 1) => {
    const ok = buyPermBulk(meta, id, qty) > 0;
    if (ok) saveMeta();
    return ok;
  },
  onUnlockGroup: (gid) => {
    const ok = unlockGroup(meta, gid);
    if (ok) {
      saveMeta();
      hud.refreshMenu(meta);
    }
    return ok;
  },
  onClaimMilestone: (wave) => {
    const r = claimMilestone(meta, meta.tier || 1, wave); // milestones are per-tier; claim the selected tier
    const got = r.coins > 0 || r.gems > 0 || r.vials > 0;
    if (got) saveMeta();
    return got;
  },
  onClaimAllMilestones: () => {
    const r = claimAllMilestones(meta);
    const got = r.coins > 0 || r.gems > 0 || r.vials > 0;
    if (got) saveMeta();
    return got;
  },
  onSetTier: (t) => {
    t = t | 0;
    if (t < 1 || t > MAX_TIER || !tierUnlocked(meta, t)) return false;
    meta.tier = t;
    saveMeta();
    return true;
  },
  onSelectCosmetic: (kind, id) => {
    if (!selectCosmetic(meta, kind as CosmeticKind, id)) return false;
    saveMeta();
    return true;
  },
  onBuyCosmetic: (id) => {
    if (!buyCosmetic(meta, id)) return false;
    saveMeta();
    return true;
  },
  onBuyCard: () => {
    const r = buyCard(meta);
    if (r) saveMeta();
    return r;
  },
  onBuyCardSlot: () => {
    const ok = buyCardSlot(meta);
    if (ok) saveMeta();
    return ok;
  },
  onSetActiveCard: (slot: number, id: string | null) => {
    const ok = setActiveCard(meta, slot, id);
    if (ok) saveMeta();
    return ok;
  },
  onStartResearch: (id) => {
    const ok = startResearch(meta, id, Date.now());
    if (ok) saveMeta();
    return ok;
  },
  onCancelResearch: (id) => {
    const ok = cancelResearch(meta, id);
    if (ok) saveMeta();
    return ok;
  },
  onRushResearch: (id) => {
    const ok = rushResearch(meta, id, Date.now());
    if (ok) saveMeta();
    return ok;
  },
  onApplyLabBoost: (id, mult, durationSec) => {
    const ok = applyLabBoost(meta, id, mult, durationSec, Date.now());
    if (ok) saveMeta();
    return ok;
  },
  onBuyLabSlot: () => {
    const ok = buyLabSlot(meta);
    if (ok) saveMeta();
    return ok;
  },
  onBuySuperpower: (id) => {
    const ok = buySuperpower(meta, id);
    if (ok) saveMeta();
    return ok;
  },
  onBuySuperTrack: (spId, trackId) => {
    const ok = buySuperTrack(meta, spId, trackId);
    if (ok) saveMeta();
    return ok;
  },
  onToggleSuperpower: (id) => {
    const ok = toggleSuperpower(meta, id);
    if (ok) saveMeta();
    return ok;
  },
  onSetGameSpeed: (speed) => {
    const v = setGameSpeed(meta, speed);
    saveMeta();
    return v; // the loop reads gameSpeed(meta) live each frame, so the change takes effect immediately
  },
  onReconcileLabs: () => reconcileLabs(),
  onCheckIn: () => {
    const r = claimCheckIn(meta, Date.now());
    if (r) saveMeta();
    return r;
  },
  onStartRun: () => startRun(false),
  onExitRun: () => {
    if (mode === 'playing' || mode === 'dying') enterOverview(bankRun());
  },
  onToWorkshop: () => {
    hud.hideOverview();
    goToMenu({});
  },
  onDev: (kind) => {
    if (kind === 'reset') {
      localStorage.clear();
      location.reload();
    } else if (kind === 'coins') {
      meta.coins = 1e12; // 1t — no hard cap on the currency; this is just the dev top-up amount
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'gold') {
      if (sim) sim.s.econ.gold = 1e12; // 1t
    } else if (kind === 'gems') {
      meta.gems = 1e6; // 1m
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'vials') {
      meta.vials = 999999;
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'energy') {
      meta.energy = 1e9; // 1b — dev top-up to test superpower unlocks/levels
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'finishlabs') {
      // finish everything lab-side: clear the wave-30 gate (tab + each lab), max every lab slot,
      // complete each lab at max level, clear in-progress research.
      meta.bestWave = Math.max(meta.bestWave || 0, 30);
      meta.labs = meta.labs || {};
      for (const L of LABS) meta.labs[L.id] = L.max;
      meta.labSlots = MAX_SLOTS;
      meta.research = [];
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'maxskills') {
      // unlock every skill group, then max each permanent upgrade to its (lab-lifted) cap.
      meta.unlocked = meta.unlocked || {};
      for (const g of SKILL_GROUPS) meta.unlocked[g.id] = true;
      meta.perm = meta.perm || {};
      for (const u of UPGRADES) meta.perm[u.id] = upgradeCap(meta, u.id);
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'maxcards') {
      // own every card at max level, unlock every active slot, and equip them all.
      meta.cards = CARD_ORDER.map((id) => ({ id, stars: MAX_STARS }));
      meta.cardSlots = MAX_CARD_SLOTS;
      meta.activeCards = CARD_ORDER.slice(0, MAX_CARD_SLOTS);
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'pause') {
      togglePause();
    } else if (kind === 'turbo') {
      turbo = !turbo;
      hud.setDevToggle('turbo', turbo);
      // surface the resulting effective speed so it's clear what's happening (the top-bar shows the
      // chosen base speed; turbo is an extra dev multiplier layered on top).
      hud.showHint(turbo ? 'Turbo ×' + TURBO_MUL + ' on — running at ' + effSpeed() + 'x' : 'Turbo off');
      setTimeout(() => hud.hideHint(), 2000);
    } else if (kind === 'testbullet') {
      setupTestBullet();
    }
  },
  onFF: (sec) => {
    if (mode !== 'playing' || !sim || !sim.s.alive || paused) return;
    const gs = effSpeed();
    const r = catchUp(sim, sec * gs, 24 * 3600 * gs);
    if (!sim.s.alive) {
      enterOverview(bankRun());
      return;
    }
    hud.showHint('Fast-forwarded ' + (sec >= 60 ? sec / 60 + 'm' : sec + 's') + ': +' + r.gold + ' gold / +' + r.kills + ' kills');
    setTimeout(() => hud.hideHint(), 2500);
  },
};

let sim: Sim | null = null,
  mode = 'menu',
  acc = 0,
  last = 0,
  running = false,
  hiddenAt = 0,
  paused = false,
  dyingT = 0,
  // True while a long offline catch-up is replaying on the worker: frame() bails (the canvas stays
  // frozen, no sim steps) so only the HUD's live tally updates until the replay finishes.
  offlineBusy = false,
  turbo = false, // dev cheat: when on, the loop runs the sim at gameSpeed × TURBO_MUL (bypasses the lab cap)
  lastEarn: EarnSummary | null = null;

const TURBO_MUL = 5;
// The multiplier actually fed to the sim each frame: the player-chosen speed, ×5 while dev turbo is on.
function effSpeed(): number {
  return gameSpeed(meta) * (turbo ? TURBO_MUL : 1);
}

// Re-apply the CURRENT view to a freshly-swapped HUD.
function reenter(h: { setMeta(m: Meta): void; showMenu(m: Meta, o: object): void; showOverview(m: Meta, e: EarnSummary): void; hideMenu(): void; hideOverview(): void }): void {
  h.setMeta(meta);
  if (mode === 'menu') h.showMenu(meta, {});
  else if (mode === 'overview') h.showOverview(meta, lastEarn || {});
  else {
    h.hideMenu();
    h.hideOverview();
  }
}

const hud = createHudHost(document.getElementById('hud') as HTMLElement, handlers, { reenter });
hud.setMeta(meta);

// Host-level DEV overlay — plug-and-play: append `?dev=0` to the URL to remove it entirely.
if (!/[?&]dev=0\b/.test(location.search)) {
  const devMenu = createDevMenu({ handlers, hudHost: hud });
  hud.attachDevMenu(devMenu);
  const saved = savedHud();
  if (saved && saved !== DEFAULT_HUD && HUDS[saved]) hud.switchTo(saved);
}

function reconcileLabs(): string[] {
  const done = reconcileResearch(meta, Date.now());
  if (done.length) {
    saveMeta();
    hud.refreshMenu(meta);
  }
  return done;
}
const PAUSE_PROMPT_MIN = 20; // only ask about an unintended pause once the player was away this long

// Highest battle speed the player has unlocked via the Game Speed lab (the last available step).
function maxUnlockedSpeed(): number {
  const sp = availableSpeeds(meta);
  return sp[sp.length - 1];
}

const OFFLINE_MODAL_DELAY = 180; // ms before the live "Simulating…" modal appears — skip the flash on quick tallies

// The currency chips the offline-reward modal shows, pulled from a replay result.
function rewardFrom(r: CatchUpResult): OfflineReward {
  return { gold: r.gold, coins: r.coins, kills: r.kills, waves: r.waves, gems: r.gems, vials: r.vials };
}

// Spin up the dedicated catch-up worker (module worker, bundled by Vite). Returns null if the
// environment can't host one, so the caller can fall back to a blocking replay.
function makeOfflineWorker(): Worker | null {
  try {
    return new Worker(new URL('./sim/offline.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

// Finish a SYNCHRONOUS (blocking) replay — used when no worker can be spawned or the worker errored
// mid-flight. The live sim was mutated in place. Returns true if the hero died (overview shown).
function finishOfflineSync(r: CatchUpResult, elapsedSec: number, surface: boolean, modalHandled: boolean): boolean {
  if (r.died) {
    enterOverview(bankRun(), true);
    return true;
  }
  if (!modalHandled && surface && elapsedSec > 20 && settings.showOfflineReward) hud.showOfflineReward(rewardFrom(r));
  return false;
}

// Replay the offline window at `speed`× and bank the result. Resolves true if the hero died during
// the replay (the overview is already shown), false otherwise — the caller then restarts the loop.
//
// Long windows run the replay on a WORKER so the main thread is free: the canvas stays frozen
// (offlineBusy gates frame()) while the HUD's "while you were away" tally ticks up live and Collect
// stays disabled until the sim finishes. Quick windows (or a missing worker) replay inline.
function applyOfflineCatchUp(elapsedSec: number, speed: number, surface: boolean): Promise<boolean> {
  if (speed <= 0 || elapsedSec <= 0 || !sim) return Promise.resolve(false);
  const simSeconds = elapsedSec * speed;
  const capSeconds = OFFLINE_CAP * speed;
  if (plannedTicks(simSeconds, capSeconds) <= 0) return Promise.resolve(false);

  const worker = makeOfflineWorker();
  if (!worker) {
    const r = catchUp(sim, simSeconds, capSeconds);
    return Promise.resolve(finishOfflineSync(r, elapsedSec, surface, false));
  }

  offlineBusy = true; // freeze frame(): no sim steps, no canvas draws until the worker reports done
  running = false;
  let modalShown = false;

  return new Promise<boolean>((resolve) => {
    const showTimer = surface
      ? window.setTimeout(() => {
          modalShown = true;
          hud.showOfflineReward({ gold: 0, coins: 0, kills: 0, waves: 0, gems: 0, vials: 0 }, { computing: true });
        }, OFFLINE_MODAL_DELAY)
      : 0;

    const cleanup = (): void => {
      clearTimeout(showTimer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      offlineBusy = false;
    };

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; result: CatchUpResult; state?: State };
      if (msg.type === 'progress') {
        if (modalShown) hud.updateOfflineReward!(rewardFrom(msg.result), false);
        return;
      }
      // type === 'done'
      const r = msg.result;
      const newState = msg.state as State;
      // The worker mutated a structured-clone of meta, so fold its currency GAINS (deltas) into our
      // live meta — additively, so a lab payout that landed during the replay isn't clobbered — then
      // reattach it so the rebuilt sim shares our single live meta object (matches the boot path's
      // `saved.state.meta = meta`).
      meta.energy = (meta.energy || 0) + (r.energy || 0);
      meta.gems = (meta.gems || 0) + (r.gems || 0);
      meta.vials = (meta.vials || 0) + (r.vials || 0);
      newState.meta = meta;
      sim = new Sim(newState);
      saveMeta();
      cleanup();
      if (r.died) {
        if (modalShown) hud.hideOfflineReward!();
        enterOverview(bankRun(), true);
        resolve(true);
        return;
      }
      if (modalShown) hud.updateOfflineReward!(rewardFrom(r), true); // enable Collect on the live modal
      else if (surface && elapsedSec > 20 && settings.showOfflineReward) hud.showOfflineReward(rewardFrom(r));
      persist(); // the caller restarts the loop next; bank the caught-up state now in case it doesn't
      resolve(false);
    };

    worker.onerror = () => {
      // Worker failed mid-replay: fall back to a blocking replay on the live sim so the player is
      // never stranded on a frozen screen.
      cleanup();
      const r = catchUp(sim!, simSeconds, capSeconds);
      if (modalShown) {
        if (r.died) hud.hideOfflineReward!();
        else hud.updateOfflineReward!(rewardFrom(r), true);
      }
      resolve(finishOfflineSync(r, elapsedSec, surface, modalShown));
    };

    worker.postMessage({ state: sim!.serialize(), elapsedSec: simSeconds, maxSec: capSeconds });
  });
}

// The run sat idle while PAUSED, so it earned nothing. Ask whether that was intentional; if not,
// fast-forward the missed time at the player's fastest unlocked speed and resume the run there.
function promptOfflinePause(elapsedSec: number): void {
  const speed = maxUnlockedSpeed();
  hud.showPausePrompt({ awaySec: Math.min(elapsedSec, OFFLINE_CAP), speed }, () => {
    paused = false;
    setGameSpeed(meta, speed);
    hud.setDevToggle('pause', false);
    applyOfflineCatchUp(elapsedSec, speed, true).then((died) => {
      if (died) return; // hero died catching up → overview already shown
      saveMeta();
      last = performance.now(); // the long real gap is consumed; don't feed it to the next frame
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    });
  });
}

function togglePause(on?: boolean): void {
  if (mode !== 'playing' || !sim) return;
  paused = on === undefined ? !paused : !!on;
  hud.setDevToggle('pause', paused);
}

// dev: overwrite the live state with a deterministic 1-enemy + 1-bullet frame, then pause.
function setupTestBullet(): void {
  if (!sim) return;
  const s = sim.s,
    hx = s.hero.x,
    hy = s.hero.y;
  s.atkMode = 'bullet';
  const e = makeEnemy(s.nextId++, 'melee', Math.max(1, s.wave.n), sim.rng, s.arena);
  e.x = hx + 140;
  e.y = hy;
  e.hitFlash = 0;
  e.kb = 0;
  s.enemies = [e];
  s.projectiles = [{ id: s.nextId++, x: hx + 70, y: hy, vx: BULLET_SPEED, vy: 0, r: BULLET_R, dmg: 1, traveled: 70, maxDist: 1000 }];
  togglePause(true);
  renderer.draw(s, 0, true);
}

// ---- input ----
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    togglePause();
  }
});

// ---- states ----
function startRun(firstRun: boolean): void {
  const seed = (Math.random() * 4294967296) >>> 0;
  sim = new Sim(createState(seed, meta, firstRun));
  // Always open a run at the fastest battle speed the player has unlocked (the last available step).
  const sp = availableSpeeds(meta);
  setGameSpeed(meta, sp[sp.length - 1]);
  saveMeta();
  mode = 'playing';
  hud.hideMenu();
  hud.hideOverview();
  hud.hideHint();
  acc = 0;
  last = performance.now();
  running = true;
  togglePause(false);
  requestAnimationFrame(frame);
}

function goToMenu(opts: object): void {
  mode = 'menu';
  running = false;
  clearSave();
  hud.hideHint();
  hud.showMenu(meta, opts || {});
}

// Bank end-of-run rewards into meta; returns the earn summary the overview shows.
function bankRun(): EarnSummary {
  const firstRunJustEnded = !meta.hasPlayed;
  const s = sim!.s;
  const wave = s.wave.maxWave || s.wave.n;
  const coins = firstRunJustEnded ? FIRST_PERM_COST : coinsForRun(s, meta.tier || 1);
  meta.coins = (meta.coins || 0) + coins;
  meta.bestWave = Math.max(meta.bestWave || 0, wave);
  const runTier = meta.tier || 1;
  meta.tierBest = meta.tierBest || {};
  meta.tierBest[runTier] = Math.max(meta.tierBest[runTier] || 0, wave);
  meta.totalWaves = (meta.totalWaves || 0) + wave;
  if (firstRunJustEnded) meta.hasPlayed = true;
  saveMeta();
  return { coins, kills: s.econ.kills, wave };
}

function startDying(): void {
  mode = 'dying';
  dyingT = 0;
  running = true;
  hud.hideOverview();
  hud.hideHint();
  last = performance.now();
  requestAnimationFrame(frame);
}
// `offline` = the run ended while the game ran in the background (reopen / tab return), not from a
// death the player just watched. In that case we land on the menu and float the summary over it as a
// dismissible notice, so the screen behind isn't blank and the player sees where they actually are.
function enterOverview(earn: EarnSummary, offline = false): void {
  lastEarn = earn;
  running = false;
  clearSave();
  hud.hideHint();
  if (offline) {
    mode = 'menu';
    hud.showMenu(meta, {});
    hud.showOverview(meta, earn, { offline: true });
  } else {
    mode = 'overview';
    hud.showOverview(meta, earn);
  }
}

// ---- main loop: fixed-step sim, free-rate render ----
function frame(now: number): void {
  // offlineBusy: a worker catch-up is replaying — keep the canvas frozen (no steps, no draw) and let
  // the loop die; applyOfflineCatchUp re-kicks it once the replay is done.
  if (!running || offlineBusy || (mode !== 'playing' && mode !== 'dying')) return;
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (mode === 'dying') {
    dyingT += dt;
    tickDying(sim!.s, dt);
    renderer.draw(sim!.s, 1, false);
    if (dyingT >= 1) {
      enterOverview(bankRun());
      return;
    }
    requestAnimationFrame(frame);
    return;
  }
  sim!.refreshStats(); // recompute stats + sync hero.range/arena every frame, including while paused
  if (paused) {
    renderer.draw(sim!.s, 0, true);
    hud.update(sim!.s);
    requestAnimationFrame(frame);
    return;
  }
  const gs = effSpeed(); // 0 while paused-via-speed: no sim steps run, but we still render/refresh below
  acc += dt * gs;
  let g = 0;
  const maxSteps = Math.ceil(8 * gs);
  while (acc >= DT && g++ < maxSteps) {
    sim!.step(DT);
    acc -= DT;
  }
  renderer.draw(sim!.s, acc / DT, false);
  hud.update(sim!.s);
  if (!sim!.s.alive) {
    startDying();
    return;
  }
  requestAnimationFrame(frame);
}

// ---- persistence (only a mid-run is ever saved) ----
function persist(): void {
  if (sim) localStorage.setItem(SAVE, JSON.stringify({ savedAt: Date.now(), state: sim.serialize() }));
}
document.addEventListener('visibilitychange', () => {
  if (offlineBusy) return; // a catch-up worker is already running — don't double-replay or persist a stale state
  if (document.hidden) {
    if (mode === 'playing' && sim && sim.s.alive) {
      hiddenAt = Date.now();
      persist();
    }
    running = false;
  } else if (mode === 'playing' && sim && sim.s.alive) {
    reconcileLabs();
    const el = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    // A paused run (speed 0, or the dev/space pause) earns nothing while away — ask if that was
    // intentional instead of silently dropping the time. Otherwise replay at the current speed.
    const wasPaused = paused || gameSpeed(meta) === 0;
    const resume = (): void => {
      last = performance.now();
      running = true;
      requestAnimationFrame(frame);
      if (el > PAUSE_PROMPT_MIN && wasPaused) promptOfflinePause(el);
    };
    if (el > 2 && !wasPaused) {
      // Replay off the main thread; the canvas stays frozen until done, then we resume the loop.
      applyOfflineCatchUp(el, effSpeed(), true).then((died) => {
        if (!died) resume(); // hero died catching up → overview already shown
      });
    } else {
      resume();
    }
  } else {
    reconcileLabs();
  }
});
window.addEventListener('pagehide', () => {
  if (mode === 'playing' && sim && sim.s.alive) persist();
});
setInterval(() => {
  if (mode === 'playing' && running && sim && sim.s.alive) persist();
}, 10000);
setInterval(reconcileLabs, 5000);

// ---- boot ----
reconcileLabs();
const saved = loadSave();
if (saved && saved.state) {
  saved.state.meta = meta;
  sim = new Sim(saved.state);
  mode = 'playing';
  hud.hideMenu();
  const elapsed = (Date.now() - saved.savedAt) / 1000;
  // A run saved while paused (speed 0) earned nothing — we'll ask about it below rather than replay.
  const wasPaused = gameSpeed(meta) === 0;
  const resume = (): void => {
    last = performance.now();
    running = true;
    requestAnimationFrame(frame);
    if (elapsed > PAUSE_PROMPT_MIN && wasPaused) promptOfflinePause(elapsed);
  };
  if (elapsed > 2 && !wasPaused) {
    // The catch-up runs on a worker: the canvas holds (black is fine — nothing has drawn yet) while
    // the live "while you were away" tally fills in, then the loop starts on the caught-up state.
    applyOfflineCatchUp(elapsed, effSpeed(), true).then((ended) => {
      if (!ended) resume(); // hero died catching up → overview already shown
    });
  } else {
    resume();
  }
} else if (!meta.hasPlayed) {
  startRun(true);
} else {
  goToMenu({});
}
