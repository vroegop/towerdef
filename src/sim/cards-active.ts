/* src/sim/cards-active.ts — the ACTIVE-CARD subsystem.

   Owned cards do nothing; only cards placed in an active slot (see activeCardIds in skills.ts) have
   effect. Their magnitudes are surfaced on the cached `Stats` sheet by computeStats:
     superTower  (×dmg while active)    secondWind  (shield seconds; auto-revive once/run)
     demonMode   (invincible seconds)   plasmaCanon (boss max-HP fraction per shot)
     waveSkip / waveAccel / criticalCoin / enemyBalance  (mechanic hooks, applied elsewhere)

   This module owns the timed actives (Super Tower, Demon Mode, Plasma Canon) plus the Second Wind
   revive. Timers live in run.actCd / run.actActive (keyed by card id) and tick inside step(), so the
   sim stays deterministic (PRNG-driven, no wall clock). Run.dmgBoost is the transient outgoing-damage
   multiplier the hero applies; Run.invuln is the seconds the hero ignores damage. */
import type { Rng, State, Stats } from '../types';
import { firePlasma } from './projectiles';

// fixed cooldowns/durations not data-driven by the card value table (those values ARE the magnitude).
export const SUPER_TOWER_DUR = 15;   // seconds Super Tower stays up
export const SUPER_TOWER_CD = 30;    // seconds between Super Tower activations
export const DEMON_MODE_DMG = 3;     // Dark Wiz (Demon Mode) multiplies outgoing damage by 3

// Advance every active-card timer for one tick and apply their continuous effects. Must run BEFORE
// the hero attacks so run.dmgBoost is current for this tick's shots. _rng_ is the seeded Sim PRNG.
export function tickActiveCards(s: State, dt: number, st: Stats, _rng: Rng): void {
  const run = s.run;
  run.actCd = run.actCd || {};
  run.actActive = run.actActive || {};
  let dmgBoost = 1;
  let invuln = (run.invuln || 0) > 0 ? run.invuln! : 0;

  // ---- Super Tower: auto-activates when ready; ×dmg for 15s, then 30s cooldown. ----
  if (st.superTower > 0) {
    const dur = run.actActive.superTower || 0;
    const cd = run.actCd.superTower || 0;
    if (cd <= 0 && dur <= 0) run.actActive.superTower = SUPER_TOWER_DUR; // ready → fire this tick
    if ((run.actActive.superTower || 0) > 0) {
      dmgBoost *= st.superTower;
      run.actActive.superTower = Math.max(0, (run.actActive.superTower || 0) - dt);
      if (run.actActive.superTower <= 0) run.actCd.superTower = SUPER_TOWER_CD;
    } else if (cd > 0) {
      run.actCd.superTower = Math.max(0, cd - dt);
    }
  }

  // ---- Dark Wiz (Demon Mode): PLAYER-TRIGGERED, ONCE PER RUN. ×3 dmg + invincible for [value]s.
  // The HUD sets run.demonReq when the player taps the button; we consume it here so activation stays
  // inside the deterministic tick. No cooldown — it simply can't fire again once used this run. ----
  if (st.demonMode > 0) {
    if (run.demonReq && !run.demonUsed && (run.actActive.demonMode || 0) <= 0) {
      run.actActive.demonMode = st.demonMode; // value = duration in seconds
      run.demonUsed = true;
    }
    if ((run.actActive.demonMode || 0) > 0) {
      dmgBoost *= DEMON_MODE_DMG;
      invuln = Math.max(invuln, run.actActive.demonMode || 0);
      run.actActive.demonMode = Math.max(0, (run.actActive.demonMode || 0) - dt);
    }
  }
  run.demonReq = false; // a tap with nothing to fire (wrong state / not equipped) is simply dropped

  // ---- Plasma Canon: when a boss appears, lob ONE homing plasma orb at it for a share of its MAX
  // hp. Each boss is struck exactly once in its lifetime (tracked in run.plasmaDone). ----
  if (st.plasmaCanon > 0) {
    const done = run.plasmaDone || (run.plasmaDone = []);
    for (const e of s.enemies) {
      if (e.type !== 'boss' || e.hp <= 0 || done.indexOf(e.id) >= 0) continue;
      firePlasma(s, s.hero, e, st.plasmaCanon);
      done.push(e.id);
    }
  }

  // Second Wind's own shield timer (started on revive) decays here; the revive itself is in onHeroLethal.
  if ((run.actActive.secondWind || 0) > 0) {
    run.actActive.secondWind = Math.max(0, run.actActive.secondWind! - dt);
    invuln = Math.max(invuln, run.actActive.secondWind!);
  }

  if (invuln > 0) run.invuln = Math.max(0, invuln - dt);
  run.dmgBoost = dmgBoost;
}

// Called when a hit would drop the hero to 0 HP. If Second Wind is active and unused this run,
// revives to half HP and grants its shield, returning true (the killing blow is cancelled).
export function trySecondWind(s: State, st: Stats): boolean {
  if (st.secondWind <= 0 || s.run.secondWindUsed) return false;
  s.run.secondWindUsed = true;
  s.hero.hp = Math.max(1, Math.floor(s.hero.hpMax / 2));
  s.run.actActive = s.run.actActive || {};
  s.run.actActive.secondWind = st.secondWind; // shield seconds
  s.run.invuln = Math.max(s.run.invuln || 0, st.secondWind);
  return true;
}

// Is the hero currently invincible (Demon Mode or Second Wind shield)?
export const heroInvuln = (s: State): boolean => (s.run.invuln || 0) > 0;

// Player requested an active skill from the HUD. Only Dark Wiz (Demon Mode) is manually triggered;
// the request is a flag consumed on the next deterministic tick (see tickActiveCards).
export function requestActiveSkill(s: State, id: string): void {
  if (id === 'demonMode') s.run.demonReq = true;
}
