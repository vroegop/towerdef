/* sim/projectiles.js — travelling bullets. Pure sim: deterministic, no DOM/rng/Date.now,
   so it replays identically during offline catch-up. Bullets carry the damage snapshotted
   at fire time and deal it ONLY on collision; they expire after a travel-distance budget. */
(function (A) {
  A.BULLET_SPEED = 520; // px/s — well above enemy speeds, so only lateral movers dodge
  A.BULLET_R = 4;

  // Spawn one bullet from the hero toward a target's CURRENT position (fire-and-forget,
  // so fast/strafing enemies can dodge). Damage is locked in now (crit + range bonus
  // already folded in by the sim and passed as `dmg`), not at impact.
  A.fireProjectile = function (state, hero, target, stats, dmg) {
    const dx = target.x - hero.x, dy = target.y - hero.y, d = Math.hypot(dx, dy) || 1;
    state.projectiles.push({
      id: state.nextId++,
      x: hero.x, y: hero.y,
      vx: dx / d * A.BULLET_SPEED, vy: dy / d * A.BULLET_SPEED,
      r: A.BULLET_R, dmg: dmg == null ? stats.rangedDamage : dmg,
      traveled: 0, maxDist: stats.range * 1.2,
    });
  };

  // Apply one hit's damage to an enemy, folding in Rend (stack + scale), Lifesteal, and the
  // ranged-enemy knockback. Shared by bullets and the lightning beam so both behave identically.
  // `rng` (the sim PRNG) is optional; it drives the Rend stack roll for deterministic replay.
  A.applyHit = function (state, e, baseDmg, stats, rng) {
    if (rng && stats && stats.rendChance && rng.next() < stats.rendChance) {
      e.rend = Math.min(A.MAX_REND, (e.rend || 0) + 1); e.rendT = A.REND_DECAY;
    }
    const dealt = baseDmg * (1 + (e.rend || 0) * ((stats && stats.rendMult) || 0));
    e.hp -= dealt; e.hitFlash = 0.12; e.hitDmg = Math.round(dealt);
    if (stats && stats.lifesteal && state.hero) state.hero.hp = Math.min(state.hero.hpMax, state.hero.hp + dealt * stats.lifesteal);
    if (e.behavior === 'bounce') e.kb = Math.max(e.kb, 0.25);
    return dealt;
  };

  function hitEnemy(state, p) {
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const rr = e.r + p.r;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) return e;
    }
    return null;
  }

  A.tickProjectiles = function (state, dt, stats, rng) {
    if (!state.projectiles.length) return;
    const keep = [];
    for (const p of state.projectiles) {
      const stepLen = A.BULLET_SPEED * dt;
      const subs = Math.max(1, Math.ceil(stepLen / 8)); // sub-step so fast bullets don't tunnel small enemies
      const sdt = dt / subs;
      let dead = false;
      for (let i = 0; i < subs; i++) {
        p.x += p.vx * sdt; p.y += p.vy * sdt; p.traveled += A.BULLET_SPEED * sdt;
        const e = hitEnemy(state, p);
        if (e) { A.applyHit(state, e, p.dmg, stats, rng); dead = true; break; }
        if (p.traveled >= p.maxDist) { dead = true; break; }
      }
      if (!dead) keep.push(p);
    }
    state.projectiles = keep;
  };
})(window.ARENA = window.ARENA || {});
