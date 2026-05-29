/* sim/state.js — the serializable state factory. This object IS the save file and the
   contract the renderer reads. Keep everything here plain/JSON-safe (no functions). */
(function (A) {
  A.ARENA_W = 960;
  A.ARENA_H = 640;

  A.createState = function (seed, meta, firstRun) {
    return {
      seed: seed >>> 0,
      rng: seed >>> 0,           // live PRNG state (synced on serialize)
      tick: 0, t: 0, alive: true,
      nextId: 1,
      atkMode: 'bullet',         // 'bullet' (travelling projectile) | 'lightning' (instant beam, dev toggle)
      firstRun: !!firstRun,      // scripted lethal intro run
      arena: { w: A.ARENA_W, h: A.ARENA_H },
      hero: {
        x: A.ARENA_W / 2, y: A.ARENA_H / 2, r: 16,
        hp: 1, hpMax: 1, shield: 0, shieldMax: 0, sinceHit: 99, atkCd: 0,
      },
      enemies: [],
      projectiles: [],
      effects: [],
      rewardMult: 1,
      wave: { n: 0, clock: A.WAVE.interval, toSpawn: 0, releaseTimer: 0, releaseGap: 1, count: 0, maxWave: 0 },
      econ: { gold: 0, xp: 0, level: 1, kills: 0, goldEarned: 0 },
      run: { levels: {} },       // core-stat levels bought this run (RESET each run)
      meta: meta || { cores: 0, perm: {} }, // PERMANENT (cores + permanent levels)
    };
  };
})(window.ARENA = window.ARENA || {});
