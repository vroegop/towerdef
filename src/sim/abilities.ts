/* src/sim/abilities.ts — special-weapon SEAM (stub for M4).
   Abilities push timed entries into state.effects[]; tickEffects() advances them every
   step, so they replay correctly offline too. The visuals (warp, sparks) are the
   renderer's job — only the gameplay (pull, damage) lives here. Wire real abilities later. */
import type { AbilityDef, State } from '../types';

export const ABILITIES: Record<string, AbilityDef> = {
  // cd: cooldown(s)  mk: builds an effect from (x, y, level)
  blackhole: { cd: 22, mk: (x, y, L) => ({ kind: 'blackhole', x, y, ttl: 4, r: 90, pull: 160, dps: 18 * L }) },
  meteor: { cd: 15, mk: (x, y, L) => ({ kind: 'meteor', x, y, ttl: 1.2, r: 70, dmg: 120 * L, fuse: 1.0 }) },
  golden: { cd: 90, mk: (_x, _y, L) => ({ kind: 'golden', ttl: 8, rewardMult: 3 + L }) },
};

export function tickEffects(state: State, dt: number): void {
  if (!state.effects.length) return;
  state.rewardMult = 1;
  for (const e of state.effects) {
    e.ttl -= dt;
    if (e.kind === 'blackhole') {
      for (const en of state.enemies) {
        const dx = (e.x || 0) - en.x,
          dy = (e.y || 0) - en.y,
          d = Math.hypot(dx, dy) || 1;
        if (d < (e.r || 0)) {
          const f = (e.pull || 0) * (1 - d / (e.r || 1)) * dt;
          en.x += (dx / d) * f;
          en.y += (dy / d) * f;
          en.hp -= (e.dps || 0) * dt;
          en.hitFlash = 0.1;
        }
      }
    } else if (e.kind === 'golden') {
      state.rewardMult = e.rewardMult || 1;
    }
    // meteor impact-on-expire handled in core cleanup hook (TODO when wired)
  }
  state.effects = state.effects.filter((e) => e.ttl > 0);
}
