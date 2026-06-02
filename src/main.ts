/* src/main.ts — game boot + main loop. Wires the deterministic sim to the Canvas2D renderer
   and the swappable HUD host, owns persistence (localStorage), offline catch-up, and the dev
   overlay. This is the only module that touches the browser lifecycle. */
import './hud/hud.css';
import type { EarnSummary, HudHandlers, Meta, Settings, State } from './types';
import { DT, catchUp } from './sim/offline';
import { Sim, tickDying } from './sim/core';
import { createState } from './sim/state';
import { migrateMeta, reconcileResearch, claimCheckIn, startResearch, cancelResearch, rushResearch, buyLabSlot, gameSpeed, LABS, MAX_SLOTS } from './sim/labs';
import { buyRunUpgradeBulk, buyPermBulk, unlockGroup, claimMilestone, claimAllMilestones, buyCard, buyCardSlot, setActiveCard, FIRST_PERM_COST } from './sim/skills';
import { MAX_TIER, tierUnlocked, coinsForRun } from './sim/waves';
import { selectCosmetic, type CosmeticKind } from './sim/cosmetics';
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
    labSlots: m.labSlots || 1,
    vials: m.vials || 0,
    lastCheckIn: m.lastCheckIn || Date.now(),
    cosmetics: m.cosmetics && typeof m.cosmetics === 'object' ? m.cosmetics : {},
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
    const r = claimMilestone(meta, wave);
    const got = r.coins > 0 || r.gems > 0;
    if (got) saveMeta();
    return got;
  },
  onClaimAllMilestones: () => {
    const r = claimAllMilestones(meta);
    const got = r.coins > 0 || r.gems > 0;
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
  onBuyLabSlot: () => {
    const ok = buyLabSlot(meta);
    if (ok) saveMeta();
    return ok;
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
      meta.coins = 999999;
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'gold') {
      if (sim) sim.s.econ.gold = 999999;
    } else if (kind === 'gems') {
      meta.gems = 999999;
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'vials') {
      meta.vials = 999999;
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'labs') {
      // unlock everything lab-side: clear the wave-30 gate (tab + each lab), max every lab slot,
      // complete each lab at max level, clear in-progress research.
      meta.bestWave = Math.max(meta.bestWave || 0, 30);
      meta.labs = meta.labs || {};
      for (const L of LABS) meta.labs[L.id] = L.max;
      meta.labSlots = MAX_SLOTS;
      meta.research = [];
      saveMeta();
      hud.refreshMenu(meta);
    } else if (kind === 'lightning') {
      if (sim) {
        sim.s.atkMode = sim.s.atkMode === 'lightning' ? 'bullet' : 'lightning';
        hud.setDevToggle('lightning', sim.s.atkMode === 'lightning');
      }
    } else if (kind === 'pause') {
      togglePause();
    } else if (kind === 'testbullet') {
      setupTestBullet();
    }
  },
  onFF: (sec) => {
    if (mode !== 'playing' || !sim || !sim.s.alive || paused) return;
    const r = gsCatchUp(sec, 24 * 3600);
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
  lastEarn: EarnSummary | null = null;

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
function gsCatchUp(elapsedSec: number, capSec: number): ReturnType<typeof catchUp> {
  const gs = gameSpeed(meta);
  return catchUp(sim!, elapsedSec * gs, capSec * gs);
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
function enterOverview(earn: EarnSummary): void {
  mode = 'overview';
  lastEarn = earn;
  running = false;
  clearSave();
  hud.hideHint();
  hud.showOverview(meta, earn);
}

// ---- main loop: fixed-step sim, free-rate render ----
function frame(now: number): void {
  if (!running || (mode !== 'playing' && mode !== 'dying')) return;
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
  const gs = gameSpeed(meta);
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
  if (document.hidden) {
    if (mode === 'playing' && sim && sim.s.alive) {
      hiddenAt = Date.now();
      persist();
    }
    running = false;
  } else if (mode === 'playing' && sim && sim.s.alive) {
    reconcileLabs();
    const el = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    if (el > 2 && !paused) {
      const r = gsCatchUp(el, OFFLINE_CAP);
      if (!sim.s.alive) {
        enterOverview(bankRun());
        return;
      }
      if (el > 20) {
        hud.showHint('While away: +' + r.gold + ' gold / +' + r.kills + ' kills');
        setTimeout(() => hud.hideHint(), 2500);
      }
    }
    last = performance.now();
    running = true;
    requestAnimationFrame(frame);
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
  const elapsed = (Date.now() - saved.savedAt) / 1000;
  if (elapsed > 2) {
    const r = gsCatchUp(elapsed, OFFLINE_CAP);
    if (elapsed > 20 && sim.s.alive) {
      hud.showHint('While away: +' + r.gold + ' gold / +' + r.kills + ' kills');
      setTimeout(() => hud.hideHint(), 2500);
    }
  }
  if (!sim.s.alive) enterOverview(bankRun());
  else {
    hud.hideMenu();
    last = performance.now();
    running = true;
    requestAnimationFrame(frame);
  }
} else if (!meta.hasPlayed) {
  startRun(true);
} else {
  goToMenu({});
}
