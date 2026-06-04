/* src/sim/state.ts — the serializable state factory. This object IS the save file and the
   contract the renderer reads. Keep everything here plain/JSON-safe (no functions). */
import type { Meta, State } from '../types';
import { tierMult, WAVE } from './waves';
import { BASE_RANGE_M, PX_PER_METER, RAPID_CHECK } from './skills';
import { labStartingGold } from './labs';

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
    atkMode: 'bullet', // 'bullet' (travelling projectile) | 'lightning' (instant beam); derived from the Lightning unlock in computeStats
    firstRun: !!firstRun, // scripted lethal intro run
    difficultyMult: tierMult((meta && meta.tier) || 1), // flat HP/dmg tier multiplier, set once per run
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
    wave: { n: 0, clock: WAVE.interval, spawnTimer: 0, bossSpawned: false, maxWave: 0 },
    // gold starts at the Starting Gold lab bonus (+30/level); bonusCoins banked at run end
    econ: { gold: labStartingGold(meta || ({} as Meta)), kills: 0, goldEarned: 0, bonusCoins: 0, hitsTaken: 0, killsByDamage: 0, killsByReflect: 0, dmgTaken: 0, dmgDealt: 0, reflectDealt: 0, wavesSkipped: 0 },
    // levels + Rapid Fire burst timers + active-card timers (ALL reset each run)
    run: { levels: {}, rapidT: 0, rapidCheckCd: RAPID_CHECK, actCd: {}, actActive: {}, secondWindUsed: false, invuln: 0, dmgBoost: 1, streak: 0 },
    meta: meta || ({ coins: 0, perm: {} } as Meta), // PERMANENT (coins + permanent levels)
  };
}
