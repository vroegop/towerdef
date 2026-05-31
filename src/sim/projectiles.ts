/* src/sim/projectiles.ts — travelling bullets. Pure sim: deterministic, no DOM/rng/Date.now,
   so it replays identically during offline catch-up. Bullets carry the damage snapshotted
   at fire time and deal it ONLY on collision; they expire after a travel-distance budget. */
import type { Enemy, Hero, Projectile, Rng, State, Stats } from '../types';
import { MAX_REND, REND_DECAY } from './skills';

export const BULLET_SPEED = 520; // px/s — well above enemy speeds, so only lateral movers dodge
export const BULLET_R = 4;

// Spawn one bullet from the hero toward a target's CURRENT position (fire-and-forget).
export function fireProjectile(state: State, hero: Hero, target: Enemy, stats: Stats, dmg: number | null, rng?: Rng): void {
  const dx = target.x - hero.x,
    dy = target.y - hero.y,
    d = Math.hypot(dx, dy) || 1;
  const bounces =
    rng && stats.bounceChance && rng.next() < stats.bounceChance ? Math.max(0, Math.floor(stats.bounceTargets || 0)) : 0;
  state.projectiles.push({
    id: state.nextId++,
    x: hero.x,
    y: hero.y,
    vx: (dx / d) * BULLET_SPEED,
    vy: (dy / d) * BULLET_SPEED,
    r: BULLET_R,
    dmg: dmg == null ? stats.rangedDamage : dmg,
    traveled: 0,
    maxDist: stats.range * 1.2,
    bounces,
    hitIds: bounces ? [] : null,
    bounceRange: stats.bounceRange || 0,
  });
}

// nearest live enemy to (x,y) within `range` whose id isn't already in `hitIds` — the next hop.
function nearestNotHit(state: State, x: number, y: number, range: number, hitIds: number[]): Enemy | null {
  let best: Enemy | null = null,
    bd = range * range;
  for (const e of state.enemies) {
    if (e.hp <= 0 || hitIds.indexOf(e.id) >= 0) continue;
    const dd = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (dd <= bd) {
      bd = dd;
      best = e;
    }
  }
  return best;
}

// Apply one hit's damage to an enemy, folding in Rend, Lifesteal, and ranged-enemy knockback.
export function applyHit(state: State, e: Enemy, baseDmg: number, stats: Stats, rng?: Rng): number {
  if (rng && stats && stats.rendChance && rng.next() < stats.rendChance) {
    e.rend = Math.min(MAX_REND, (e.rend || 0) + 1);
    e.rendT = REND_DECAY;
  }
  const dealt = baseDmg * (1 + (e.rend || 0) * ((stats && stats.rendMult) || 0)) * (1 - (e.shielded || 0));
  e.hp -= dealt;
  e.hitFlash = 0.12;
  e.hitDmg = Math.round(dealt);
  if (stats && stats.lifesteal && state.hero) state.hero.hp = Math.min(state.hero.hpMax, state.hero.hp + dealt * stats.lifesteal);
  if (e.behavior === 'bounce') e.kb = Math.max(e.kb, 0.25);
  return dealt;
}

function hitEnemy(state: State, p: Projectile): Enemy | null {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (p.hitIds && p.hitIds.indexOf(e.id) >= 0) continue; // a bouncing shot never re-hits the same enemy
    const rr = e.r + p.r;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= rr * rr) return e;
  }
  return null;
}

export function tickProjectiles(state: State, dt: number, stats: Stats, rng?: Rng): void {
  if (!state.projectiles.length) return;
  const keep: Projectile[] = [];
  for (const p of state.projectiles) {
    const stepLen = BULLET_SPEED * dt;
    const subs = Math.max(1, Math.ceil(stepLen / 8)); // sub-step so fast bullets don't tunnel small enemies
    const sdt = dt / subs;
    let dead = false;
    for (let i = 0; i < subs; i++) {
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      p.traveled += BULLET_SPEED * sdt;
      const e = hitEnemy(state, p);
      if (e) {
        applyHit(state, e, p.dmg, stats, rng);
        // Bounce Shot: ricochet to the nearest un-hit enemy within range instead of despawning.
        if ((p.bounces || 0) > 0) {
          p.hitIds!.push(e.id);
          const nxt = nearestNotHit(state, e.x, e.y, p.bounceRange || 0, p.hitIds!);
          if (nxt) {
            const dx = nxt.x - p.x,
              dy = nxt.y - p.y,
              dd = Math.hypot(dx, dy) || 1;
            p.vx = (dx / dd) * BULLET_SPEED;
            p.vy = (dy / dd) * BULLET_SPEED;
            p.bounces!--;
            p.traveled = 0;
            continue; // keep flying toward the next target
          }
        }
        dead = true;
        break;
      }
      if (p.traveled >= p.maxDist) {
        dead = true;
        break;
      }
    }
    if (!dead) keep.push(p);
  }
  state.projectiles = keep;
}
