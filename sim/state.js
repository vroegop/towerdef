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
      difficultyMult: A.tierDifficulty((meta && meta.tier) || 1), // tier scaling, set once per run
      arena: { w: A.ARENA_W, h: A.ARENA_H },
      hero: {
        x: A.ARENA_W / 2, y: A.ARENA_H / 2, r: 16,
        hp: 1, hpMax: 1, shield: 0, shieldMax: 0, wallTimer: 0, sinceHit: 99, atkCd: 0, // shield = the Wall pool
        range: A.BASE_RANGE_M * A.PX_PER_METER, // attack radius (px), written by the sim each step
      },
      enemies: [],
      projectiles: [],
      effects: [],
      fx: [], fxSeq: 0,          // transient per-kill UI events (gold/core drops) the renderer consumes
      rewardMult: 1,
      wave: { n: 0, clock: A.WAVE.interval, toSpawn: 0, releaseTimer: 0, releaseGap: 1, count: 0, maxWave: 0 },
      econ: { gold: 0, xp: 0, level: 1, kills: 0, goldEarned: 0, bonusCores: 0 }, // bonusCores: economic core income this run
      run: { levels: {}, rapidT: 0, rapidCheckCd: A.RAPID_CHECK }, // levels + Rapid Fire burst timers (RESET each run)
      meta: meta || { cores: 0, perm: {} }, // PERMANENT (cores + permanent levels)
    };
  };
})(window.ARENA = window.ARENA || {});
