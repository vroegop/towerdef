/* tools/hud-smoke.js — headless HUD integration smoke test (Node).  Usage:  node tools/hud-smoke.js
 *
 * Loads the real sim + the full HUD stack into a DOM, then drives every registered HUD
 * (classic / dnd / arcade) through its whole lifecycle against LIVE sim state:
 *   build → setMeta → showMenu (every menu tab + sub-tab) → update(s) → showOverview → host swap.
 * Asserts no throws, that the themeable core wires up, that themed skins inject their scoped
 * <style class="theme-style"> + scope class (and Classic does not), and that the in-run top bar
 * reflects live state. Exits non-zero on the first failure.
 *
 * Mirrors tools/balance.js (headless, loads sim/*.js by eval) but needs a DOM, so it uses jsdom.
 * jsdom is the one dev-only dependency; if it isn't installed this script SKIPS (exit 0) with a
 * hint, so it never blocks a checkout that doesn't have it:  npm i -D jsdom  (or: npm i jsdom). */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('SKIP hud-smoke: jsdom not installed (npm i -D jsdom to enable this test).');
  process.exit(0);
}

// Same script order as index.html.
const SCRIPTS = [
  'sim/rng.js', 'sim/registries.js', 'sim/waves.js', 'sim/skills.js', 'sim/labs.js',
  'sim/enemies.js', 'sim/abilities.js', 'sim/projectiles.js', 'sim/state.js', 'sim/core.js',
  'sim/offline.js', 'renderers/canvas2d/renderer.js',
  'hud/hud.js', 'huds/dnd.js', 'huds/arcade.js', 'hud/registry.js', 'hud/host.js', 'hud/devmenu.js',
];

const dom = new JSDOM('<!doctype html><html><body><canvas id="game"></canvas><div id="hud"></div></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
// jsdom has no canvas 2d context; stub the calls the renderer/HUD avatar make.
window.HTMLCanvasElement.prototype.getContext = () => ({
  clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
  fillText() {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {},
  set globalAlpha(v) {}, set textAlign(v) {}, set shadowBlur(v) {}, set shadowColor(v) {},
  createLinearGradient: () => ({ addColorStop() {} }),
});
window.requestAnimationFrame = () => 0;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

for (const s of SCRIPTS) {
  try { window.eval(read(s)); }
  catch (e) { console.error('LOAD FAILED at', s, '\n', e); process.exit(1); }
}

const A = window.ARENA;
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

// registry shape
if (!A.HUDS.classic || !A.HUDS.dnd || !A.HUDS.arcade) fail('HUDS missing classic/dnd/arcade');
if (A.HUDS.minimal) fail('minimal HUD should be gone');
if (A.DEFAULT_HUD !== 'classic') fail('DEFAULT_HUD should be classic');
if (typeof A.createThemedHud !== 'function') fail('A.createThemedHud missing');

// a meta that unlocks cards + labs + tier 2 so every menu tab renders real content
const meta = {
  cores: 100000, perm: { attackSpeed: 3 }, hasPlayed: true, bestWave: 60, claimedMilestones: {},
  tier: 2, tierBest: { 1: 60, 2: 40 }, tokens: 200, cards: [{ id: A.CARD_ORDER[0], stars: 7 }], cardBuys: 1,
  totalWaves: 500, labs: {}, research: [], labSlots: 2, cells: 50, lastCheckIn: Date.now() - 20 * 60 * 1000,
  ultimates: {}, ver: 99,
};
const s = A.createState(12345, meta, false);
s.wave.n = 42; s.wave.maxWave = 42; s.econ.gold = 5000; s.econ.kills = 800;
s.hero.hp = 4200; s.hero.hpMax = 6000;

// a handlers stand-in: every callback returns true (purchase "succeeds"), settings is an object
const handlers = new Proxy({ settings: {} }, { get: (t, k) => (k in t ? t[k] : () => true) });

function exercise(name) {
  const root = window.document.getElementById('hud');
  root.innerHTML = '';
  const factory = A.HUDS[name].load();
  if (typeof factory !== 'function') fail(name + ' load() did not return a factory');
  const hud = factory(root, handlers);

  if (name === 'classic') {
    if (root.querySelector('style.theme-style')) fail('classic should inject no theme style');
    if (/theme-/.test(root.className)) fail('classic should carry no theme scope class');
  } else {
    if (!root.querySelector('style.theme-style')) fail(name + ' should inject a theme-style');
    if (!root.className.includes('theme-' + name)) fail(name + ' missing scope class theme-' + name);
  }

  hud.setMeta(meta);
  hud.showMenu(meta, { earn: { cores: 120, kills: 800, wave: 42 } });
  const tabs = root.querySelectorAll('.menutabs [data-mtab]');
  if (tabs.length !== 5) fail(name + ' expected 5 menu tabs, got ' + tabs.length);
  for (const t of tabs) t.click(); // hero/upgrades/cards/labs/prestige render without throwing
  root.querySelectorAll('.menutabs [data-mtab]')[1].click();
  root.querySelectorAll('[data-uptab]').forEach((b) => b.click());
  root.querySelectorAll('.menutabs [data-mtab]')[3].click();
  root.querySelectorAll('[data-labcat]').forEach((b) => b.click());

  hud.hideMenu();
  hud.update(s);
  const wave = root.querySelector('#h-wave');
  if (!wave || wave.textContent !== '42') fail(name + ' top bar wave = ' + (wave && wave.textContent) + ' (want 42)');
  hud.showHint('hint'); hud.hideHint();
  hud.showOverview(meta, { cores: 120, kills: 800, wave: 42, tokens: 3, cells: 2 });
  if (!root.querySelector('.over-card')) fail(name + ' overview did not render');
  hud.hideOverview();
  console.log('  OK ' + name + ' — menu(5 tabs)+update(live)+overview, no throws');
}

(async () => {
  for (const name of ['classic', 'dnd', 'arcade']) exercise(name);

  // host swap across all three (the error-boundary path index.html uses)
  const hostRoot = window.document.getElementById('hud'); hostRoot.innerHTML = '';
  const host = A.createHudHost(hostRoot, handlers, { reenter: () => {} });
  for (const name of ['dnd', 'arcade', 'classic']) {
    await host.switchTo(name);
    if (host.getActiveName() !== name) fail('host.switchTo(' + name + ') active=' + host.getActiveName());
  }
  console.log('  OK host swap classic<->dnd<->arcade');
  console.log('\nALL HUD SMOKE TESTS PASSED');
})();
