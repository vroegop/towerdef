/* src/sim/projectiles.ts — travelling bullets. Pure sim: deterministic, no DOM/rng/Date.now,
   so it replays identically during offline catch-up. Bullets carry the damage snapshotted
   at fire time and deal it ONLY on collision; they expire after a travel-distance budget. */
import type { Enemy, Hero, Projectile, Rng, State, Stats } from '../types';
import { MAX_REND, REND_DECAY, PX_PER_METER, FROST_DURATION, POISON_DURATION, STUN_DURATION, SPLASH_RADIUS } from './skills';
import { chronoOnHit } from './superpowers';

export const BULLET_SPEED = 416; // px/s — ~20% slower than the old 520 so the shot's travel reads clearly; still well above enemy speeds so only lateral movers slip past
export const BULLET_R = 4;
export const PLASMA_SPEED = 300; // px/s — slower than a bullet so the lobbed arc reads clearly
export const PLASMA_R = 7;
export const KNOCKBACK_MAX_M = 5; // a push can shove an enemy back at most this many metres
export const KNOCKBACK_SLOW_DUR = 1.5; // seconds a too-heavy enemy stays slowed after a knockback proc

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

// Plasma Cannon: lob a homing orb from the hero at a boss. Damage is snapshotted at fire time
// (bossHpMax × frac) so offline catch-up replays identically — the orb only applies it on impact.
// Ignores the hero's range gate; it always travels until it hits its boss or that boss dies.
export function firePlasma(state: State, hero: Hero, boss: Enemy, frac: number): void {
  const dx = boss.x - hero.x,
    dy = boss.y - hero.y,
    d = Math.hypot(dx, dy) || 1;
  state.projectiles.push({
    id: state.nextId++,
    x: hero.x,
    y: hero.y,
    vx: (dx / d) * PLASMA_SPEED,
    vy: (dy / d) * PLASMA_SPEED,
    r: PLASMA_R,
    dmg: boss.hpMax * frac,
    traveled: 0,
    maxDist: Infinity, // homing: no travel-distance expiry
    kind: 'plasma',
    targetId: boss.id,
    dist0: d,
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

// Apply one hit's damage to an enemy, folding in Amp (rend), Lifesteal, Knockback, and the
// ranged-enemy ram-bounce. dirX/dirY (optional) is the projectile's travel direction at impact, so
// knockback shoves along the shot's path — a bounced enemy gets pushed away from the enemy the shot
// just ricocheted off (which can send it sideways). Lightning (no projectile) omits it and falls
// back to away-from-hero.
export function applyHit(state: State, e: Enemy, baseDmg: number, stats: Stats, rng?: Rng, dirX?: number, dirY?: number): number {
  if (rng && stats && stats.rendChance && rng.next() < stats.rendChance) {
    e.rend = Math.min(MAX_REND, (e.rend || 0) + 1);
    e.rendT = REND_DECAY;
  }
  // Ambush card: a full-HP enemy (still untouched, so hp == hpMax) takes bonus damage on this hit.
  const ambush = stats && stats.ambush > 0 && e.hp >= e.hpMax ? 1 + stats.ambush : 1;
  const dealt = baseDmg * (1 + (e.rend || 0) * ((stats && stats.rendMult) || 0)) * ambush;
  e.hp -= dealt;
  e.lastHurt = 'dmg';
  state.econ.dmgDealt += dealt;
  e.hitFlash = 0.12;
  e.hitDmg = Math.round(dealt);
  // Chrono Field: a tower hit can strip the enemy of levels while the time window holds (no-op + no
  // RNG draw otherwise, so non-Chrono runs keep the exact legacy stream).
  chronoOnHit(state, e, rng);
  // Execute card: a surviving non-boss left below a fraction of its max HP is finished instantly.
  if (stats && stats.execute > 0 && e.type !== 'boss' && e.hp > 0 && e.hp <= e.hpMax * stats.execute) {
    state.econ.dmgDealt += e.hp;
    e.hp = 0;
  }
  if (stats && stats.lifesteal && state.hero) state.hero.hp = Math.min(state.hero.hpMax, state.hero.hp + dealt * stats.lifesteal);
  // ---- on-hit status effects: Frostbite (slow), Poison (DoT), Stun (freeze), Splash (collateral) ----
  // Frostbite: each hit chills the target, slowing it for FROST_DURATION (strongest chill + longest timer win).
  if (stats && stats.frostbite > 0) {
    const f = 1 - stats.frostbite;
    if ((e.slowT || 0) > 0) {
      if (f < e.slow) e.slow = f;
      if (FROST_DURATION > e.slowT) e.slowT = FROST_DURATION;
    } else {
      e.slow = f;
      e.slowT = FROST_DURATION;
    }
  }
  // Poison: refresh a venom burning (poison × this hit's damage)/s for POISON_DURATION; the strongest hit wins.
  if (stats && stats.poison > 0 && dealt > 0) {
    e.poison = Math.max(e.poison || 0, dealt * stats.poison);
    e.poisonT = POISON_DURATION;
  }
  // Stun: a chance each hit freezes the enemy (no move/attack) for STUN_DURATION. Bosses are immune.
  if (rng && stats && stats.stun > 0 && e.type !== 'boss' && rng.next() < stats.stun) e.stunT = STUN_DURATION;
  // Splash: deal (splash × this hit's damage) to OTHER enemies within SPLASH_RADIUS (direct, no re-procs).
  if (stats && stats.splash > 0 && dealt > 0) {
    const sd = dealt * stats.splash,
      r2 = SPLASH_RADIUS * SPLASH_RADIUS;
    for (const o of state.enemies) {
      if (o === e || o.hp <= 0) continue;
      if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= r2) {
        o.hp -= sd;
        o.lastHurt = 'dmg';
        o.hitFlash = 0.1;
        o.hitDmg = Math.round(sd);
        state.econ.dmgDealt += sd;
        if (stats.lifesteal && state.hero) state.hero.hp = Math.min(state.hero.hpMax, state.hero.hp + sd * stats.lifesteal);
      }
    }
  }
  applyKnockback(state, e, stats, rng, dirX, dirY);
  if (e.behavior === 'bounce') e.kb = Math.max(e.kb, 0.25);
  return dealt;
}

// Knockback: on a chance proc, FORCE fights the enemy's MASS. force > mass → shove the enemy back
// (up to KNOCKBACK_MAX_M metres, scaled by 1 − mass/force). Otherwise it's too heavy to move, so it
// is slowed instead (speed × force/mass — e.g. mass = 2·force ⇒ ×0.5). No minimum: heavier = slower.
function applyKnockback(state: State, e: Enemy, stats: Stats, rng?: Rng, dirX?: number, dirY?: number): void {
  if (e.type === 'boss') return; // bosses are immovable — they shrug off every knockback (but still collide)
  const force = (stats && stats.knockbackForce) || 0;
  if (!rng || !stats || !stats.knockbackChance || force <= 0) return;
  if (rng.next() >= stats.knockbackChance) return;
  const mass = e.mass || 1;
  if (force > mass) {
    const pushM = KNOCKBACK_MAX_M * (1 - mass / force); // 0 at force=mass → 5m as force≫mass
    // Push along the shot's travel direction when we have it (bounced shots send enemies sideways);
    // lightning/no-direction falls back to straight away from the hero.
    let dx: number, dy: number;
    if (dirX !== undefined && dirY !== undefined && (dirX || dirY)) {
      dx = dirX;
      dy = dirY;
    } else {
      const hx = state.hero ? state.hero.x : e.x,
        hy = state.hero ? state.hero.y : e.y;
      dx = e.x - hx;
      dy = e.y - hy;
    }
    const d = Math.hypot(dx, dy) || 1;
    e.x += (dx / d) * pushM * PX_PER_METER;
    e.y += (dy / d) * pushM * PX_PER_METER;
  } else {
    e.slow = force / mass; // ≤1: the heavier the enemy, the slower it crawls
    e.slowT = KNOCKBACK_SLOW_DUR;
  }
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

// Advance a homing plasma orb one tick. Returns true when the orb is spent (impact or fizzle) and
// should be dropped. Passes over every non-target enemy; only its boss takes the (pure %-HP) hit.
function tickPlasma(state: State, p: Projectile, dt: number): boolean {
  const target = state.enemies.find((e) => e.id === p.targetId && e.hp > 0);
  if (!target) return true; // boss already dead → fizzle, no damage
  const dx = target.x - p.x,
    dy = target.y - p.y,
    d = Math.hypot(dx, dy) || 1;
  const step = PLASMA_SPEED * dt;
  if (d <= target.r + p.r || step >= d) {
    target.hp -= p.dmg; // pure % max-HP; no rend/lifesteal/knockback
    target.lastHurt = 'dmg'; // plasma is the hero's damage → killing blows attribute to damage
    state.econ.dmgDealt += p.dmg;
    target.hitFlash = 0.18;
    target.hitDmg = Math.round(p.dmg);
    return true; // consumed on impact
  }
  p.vx = (dx / d) * PLASMA_SPEED; // re-aim toward the boss's current position
  p.vy = (dy / d) * PLASMA_SPEED;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.traveled += step;
  return false;
}

export function tickProjectiles(state: State, dt: number, stats: Stats, rng?: Rng): void {
  if (!state.projectiles.length) return;
  const keep: Projectile[] = [];
  for (const p of state.projectiles) {
    if (p.kind === 'plasma') {
      if (!tickPlasma(state, p, dt)) keep.push(p); // false = still in flight
      continue;
    }
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
        applyHit(state, e, p.dmg, stats, rng, p.vx, p.vy); // p.vx/vy still the incoming dir (re-aim happens below)
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
