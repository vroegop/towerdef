/* src/sim/rng.ts — seeded PRNG. The whole game's determinism rests on this.
   Never use Math.random() inside the sim: it can't be reproduced offline. */
import type { Rng } from '../types';

// mulberry32: tiny, fast, good enough; state is a single uint32 we can save.
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return a >>> 0;
    },
    set state(v: number) {
      a = v >>> 0;
    },
  };
}
