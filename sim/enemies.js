/* sim/enemies.js — spawning, per-enemy stats, and the HYBRID aging rule.
   Aging (chosen design): when a new wave starts, every survivor becomes
   max(its own value × 1.1, 1.1 × a fresh same-tier enemy this wave) for BOTH
   strength and speed. So survivors compound while never dropping below 1.1× the
   current baseline — hoarding a ball of enemies becomes lethal over time. */
(function (A) {
  A.pickType = function (rng, n) {
    if (n % 10 === 0 && rng.next() < 0.2) return 'boss';
    return rng.next() < 0.55 ? 'melee' : 'ranged';
  };

  A.pickTier = function (rng, n) {
    const r = rng.next();
    if (r < Math.min(0.15, 0.015 * n)) return 'elite';
    if (r < Math.min(0.45, 0.05 + 0.03 * n)) return 'hard';
    if (r < 0.9) return 'average';
    return 'weak';
  };

  const ihp = (base, mult) => Math.max(1, Math.round(base * mult));

  A.makeEnemy = function (id, type, tier, waveN, rng, arena) {
    const def = A.TYPES[type], tg = A.TIERS[tier];
    const strMult = A.waveStr(waveN) * tg.stat;
    const speed = def.speed * A.waveSpeed(waveN);
    const m = 30; let x, y; const edge = (rng.next() * 4) | 0;
    if (edge === 0) { x = rng.next() * arena.w; y = -m; }
    else if (edge === 1) { x = arena.w + m; y = rng.next() * arena.h; }
    else if (edge === 2) { x = rng.next() * arena.w; y = arena.h + m; }
    else { x = -m; y = rng.next() * arena.h; }
    const hp = ihp(def.hp, strMult), dmg = ihp(def.dmg, strMult);
    return {
      id, type, tier, shape: def.shape, behavior: def.behavior, r: def.r,
      x, y, vx: 0, vy: 0, facing: 0,
      strMult, hpMax: hp, hp, dmg,
      speed, range: def.range, state: 'approach', atkCd: 0, kb: 0, hitFlash: 0, hitDmg: 0,
      rend: 0, rendT: 0, // Rend stacks + decay timer (Rend Armor upgrade)
      bornWave: waveN, veteran: false, agedWaves: 0, // agedWaves: waves survived (drives coin decay)
    };
  };

  A.ageSurvivors = function (state, newWaveN) {
    const baseStr = A.waveStr(newWaveN), baseSpd = A.waveSpeed(newWaveN);
    for (const e of state.enemies) {
      const def = A.TYPES[e.type], tg = A.TIERS[e.tier];
      const ratio = e.hpMax > 0 ? e.hp / e.hpMax : 1;
      const freshStr = baseStr * tg.stat;
      e.strMult = Math.max(e.strMult * 1.1, 1.1 * freshStr);
      e.hpMax = ihp(def.hp, e.strMult);
      e.hp = Math.max(1, e.hpMax * ratio);
      e.dmg = ihp(def.dmg, e.strMult);
      const freshSpd = def.speed * baseSpd;
      e.speed = Math.max(e.speed * 1.1, 1.1 * freshSpd);
      e.veteran = true; e.agedWaves = (e.agedWaves || 0) + 1;
    }
  };
})(window.ARENA = window.ARENA || {});
