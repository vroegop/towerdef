/* sim/abilities.js — special-weapon SEAM (stub for M4).
   Abilities push timed entries into state.effects[]; tickEffects() advances them every
   step, so they replay correctly offline too. The visuals (warp, sparks) are the
   renderer's job — only the gameplay (pull, damage) lives here. Wire real abilities later. */
(function (A) {
  A.ABILITIES = {
    // cd: cooldown(s)  mk: builds an effect from (x, y, level)
    blackhole: { cd: 22, mk: (x, y, L) => ({ kind: 'blackhole', x, y, ttl: 4, r: 90, pull: 160, dps: 18 * L }) },
    meteor:    { cd: 15, mk: (x, y, L) => ({ kind: 'meteor', x, y, ttl: 1.2, r: 70, dmg: 120 * L, fuse: 1.0 }) },
    golden:    { cd: 90, mk: (x, y, L) => ({ kind: 'golden', ttl: 8, rewardMult: 3 + L }) },
  };

  A.tickEffects = function (state, dt) {
    if (!state.effects.length) return;
    state.rewardMult = 1;
    for (const e of state.effects) {
      e.ttl -= dt;
      if (e.kind === 'blackhole') {
        for (const en of state.enemies) {
          const dx = e.x - en.x, dy = e.y - en.y, d = Math.hypot(dx, dy) || 1;
          if (d < e.r) {
            const f = e.pull * (1 - d / e.r) * dt;
            en.x += dx / d * f; en.y += dy / d * f;
            en.hp -= e.dps * dt; en.hitFlash = 0.1;
          }
        }
      } else if (e.kind === 'golden') {
        state.rewardMult = e.rewardMult;
      }
      // meteor impact-on-expire handled in core cleanup hook (TODO when wired)
    }
    state.effects = state.effects.filter((e) => e.ttl > 0);
  };
})(window.ARENA = window.ARENA || {});
