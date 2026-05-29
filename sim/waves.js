/* sim/waves.js — wave scheduling & difficulty curves (pure functions of wave number).
   A wave starts every WAVE.interval seconds; its enemies spawn over the first spawnWindow
   seconds. screenCap limits CONCURRENT enemies, so a bigger wave only adds pressure when
   the arena isn't already full. Strength/speed baselines rise with wave number. */
(function (A) {
  A.WAVE = {
    interval: 30,     // seconds between wave starts
    spawnWindow: 25,  // a wave's enemies all spawn within this many seconds of its start
    screenCap: 200,   // max concurrent enemies alive (the "screen cap" — stays fixed)
    baseCount: 8,     // enemies in wave 1
    perWave: 5,       // added per wave...
    maxCount: 140,    // ...up to this ceiling (the upgradable "spawn cap")
    strPerWave: 0.08, // +8% baseline strength per wave
    speedPerWave: 0.02,
  };

  // First-run script: spawn a cluster on a fixed-radius ring so they converge together and a
  // no-input 1/1/1/1 hero dies at ~10s (deterministic across seeds). Tuned via headless harness.
  A.FIRST_RUN = { count: 10, gap: 0.05, speed: 42, radius: 500 };

  A.waveCount = function (n) {
    return Math.min(A.WAVE.maxCount, A.WAVE.baseCount + A.WAVE.perWave * (n - 1));
  };
  A.waveStr = function (n) { return 1 + A.WAVE.strPerWave * (n - 1); };
  A.waveSpeed = function (n) { return 1 + A.WAVE.speedPerWave * (n - 1); };
})(window.ARENA = window.ARENA || {});
