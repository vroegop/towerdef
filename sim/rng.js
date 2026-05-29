/* sim/rng.js — seeded PRNG. The whole game's determinism rests on this.
   Never use Math.random() inside the sim: it can't be reproduced offline. */
(function (A) {
  // mulberry32: tiny, fast, good enough; state is a single uint32 we can save.
  A.makeRng = function (seed) {
    let a = seed >>> 0;
    return {
      next() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      get state() { return a >>> 0; },
      set state(v) { a = v >>> 0; },
    };
  };
})(window.ARENA = window.ARENA || {});
