/* tools/balance.ts — headless balance harness (Node, via tsx).  Usage:  npm run balance [N]
 *
 * Measures "wall depth" — the wave a run reaches before the hero dies — for several investment
 * profiles. A naive auto-buyer greedily spends in-run gold on a fixed build priority each tick,
 * approximating a player.
 *
 * This is the sweep tool the upgrade plan assumes: change a curve/cap/lab number, rerun, and read
 * how the wall (and the lab carrot) moves. It imports the real sim modules directly. */
import type { Meta } from '../src/types';
import { Sim } from '../src/sim/core';
import { createState } from '../src/sim/state';
import { DT } from '../src/sim/offline';
import { buyRunUpgrade } from '../src/sim/skills';
import { WAVE } from '../src/sim/waves';
import { migrateMeta } from '../src/sim/labs';

// build priority the synthetic player buys into (mirrors a reasonable survival-first build)
const BUILD = ['health', 'rangedDamage', 'attackSpeed', 'regen', 'critChance', 'critDamage', 'armor', 'defPct'];
const MAX_WAVE = 600,
  SIM_CAP = 60 * 60 * 30; // give up at wave 600 or 30 sim-minutes

function simRun(meta: Meta): number {
  migrateMeta(meta);
  const sim = new Sim(createState((Math.random() * 1e9) >>> 0, meta, false));
  let g = 0;
  while (sim.s.alive && sim.s.wave.n < MAX_WAVE && g < SIM_CAP) {
    sim.step(DT);
    for (let k = 0; k < 3; k++) for (const id of BUILD) buyRunUpgrade(sim.s, id, sim.rng);
    g++;
  }
  return sim.s.wave.n;
}
function avg(meta: Meta, n: number): number {
  let w = 0;
  for (let i = 0; i < n; i++) w += simRun(JSON.parse(JSON.stringify(meta)));
  return Math.round(w / n);
}

const N = Number(process.argv[2]) || 4;
const heavyPerm = { health: 300, rangedDamage: 300, attackSpeed: 150, regen: 150, critChance: 100, critDamage: 300, armor: 200 };
const maxLabs = { dmgScale: 50, rateScale: 50, critScale: 50, hpScale: 50, regenScale: 50, coinScale: 40, gameSpeed: 10 };
const profiles: Record<string, Partial<Meta>> = {
  'fresh                ': { coins: 0, perm: {}, tier: 1, cards: [] },
  'light perm           ': { coins: 0, perm: { health: 50, rangedDamage: 50, attackSpeed: 30, regen: 30 }, tier: 1, cards: [] },
  'heavy perm           ': { coins: 0, perm: heavyPerm, tier: 1, cards: [] },
  'heavy perm + max labs': { coins: 0, perm: heavyPerm, labs: maxLabs, tier: 1, cards: [] },
};
console.log('wall depth (avg wave reached over ' + N + ' runs, expBase ' + WAVE.expBase + '):');
for (const [name, meta] of Object.entries(profiles)) console.log('  ' + name + '  ' + avg(meta as Meta, N));
