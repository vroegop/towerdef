/* src/sim/state.ts — the serializable state factory. This object IS the save file and the
   contract the renderer reads. Keep everything here plain/JSON-safe (no functions). */
import type { Meta, State } from '../types';
import { tierDifficulty, WAVE } from './waves';
import { BASE_RANGE_M, PX_PER_METER, RAPID_CHECK } from './skills';

export const ARENA_W = 960;
export const ARENA_H = 640;

export function createState(seed: number, meta: Meta, firstRun?: boolean): State {
  return {
    seed: seed >>> 0,
    rng: seed >>> 0, // live PRNG state (synced on serialize)
    tick: 0,
    t: 0,
    alive: true,
    nextId: 1,
    atkMode: 'bullet', // 'bullet' (travelling projectile) | 'lightning' (instant beam, dev toggle)
    firstRun: !!firstRun, // scripted lethal intro run
    difficultyMult: tierDifficulty((meta && meta.tier) || 1), // tier scaling, set once per run
    arena: { w: ARENA_W, h: ARENA_H },
    hero: {
      x: ARENA_W / 2,
      y: ARENA_H / 2,
      r: 16,
      hp: 1,
      hpMax: 1,
      sinceHit: 99,
      atkCd: 0,
      range: BASE_RANGE_M * PX_PER_METER, // attack radius (px), written by the sim each step
    },
    enemies: [],
    projectiles: [],
    fx: [],
    fxSeq: 0, // transient per-kill UI events (gold/coin drops) the renderer consumes
    wave: { n: 0, clock: WAVE.interval, toSpawn: 0, releaseTimer: 0, releaseGap: 1, count: 0, maxWave: 0, queue: [] },
    econ: { gold: 0, xp: 0, level: 1, kills: 0, goldEarned: 0, bonusCoins: 0, hitsTaken: 0 }, // bonusCoins banked at run end
    // levels + Rapid Fire burst timers + active-card timers (ALL reset each run)
    run: { levels: {}, rapidT: 0, rapidCheckCd: RAPID_CHECK, actCd: {}, actActive: {}, secondWindUsed: false, invuln: 0, dmgBoost: 1 },
    meta: meta || ({ coins: 0, perm: {} } as Meta), // PERMANENT (coins + permanent levels)
  };
}
