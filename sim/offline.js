/* sim/offline.js — "battles continue while the screen was off".
   We don't run in the background; on resume we replay the elapsed time by calling the
   SAME step() in a tight, render-free loop. Stops the moment the hero dies. */
(function (A) {
  A.DT = 1 / 30;

  // elapsedSec: real seconds the app was away.  maxSec: cap (default 12h).
  A.catchUp = function (sim, elapsedSec, maxSec) {
    const cap = Math.min(elapsedSec, maxSec || 12 * 3600);
    const ticks = Math.max(0, Math.floor(cap / A.DT));
    const before = {
      gold: sim.s.econ.goldEarned, kills: sim.s.econ.kills,
      wave: sim.s.wave.n, level: sim.s.econ.level,
    };
    sim.s.hero.intent.x = 0; sim.s.hero.intent.y = 0; // no input while away
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let ran = 0;
    for (let i = 0; i < ticks; i++) {
      if (!sim.s.alive) break;
      sim.step(A.DT); ran++;
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return {
      ranTicks: ran,
      simSeconds: ran * A.DT,
      computeMs: ms,
      gold: sim.s.econ.goldEarned - before.gold,
      kills: sim.s.econ.kills - before.kills,
      waves: sim.s.wave.n - before.wave,
      levels: sim.s.econ.level - before.level,
      died: !sim.s.alive,
    };
  };
})(window.ARENA = window.ARENA || {});
