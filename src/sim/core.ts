/* src/sim/core.ts — the Sim. ONE step() drives both live play and offline catch-up.
   No DOM, no canvas, no Date.now() inside a step. Time = the tick counter only. */
import type { Enemy, Rng, State, Stats } from '../types';
import { makeRng } from './rng';
import { TIERS } from './registries';
import { ageSurvivors, makeEnemy, pickTier, pickType } from './enemies';
import { FIRST_RUN, COIN_DECAY_FACTOR, COIN_DECAY_WAVES, WAVE, waveCount } from './waves';
import { applyHit, fireProjectile, tickProjectiles } from './projectiles';
import { computeStats, PX_PER_METER, RAPID_CHECK, RAPID_MULT } from './skills';
import { ARENA_W, ARENA_H } from './state';

export class Sim {
  s: State;
  rng: Rng;
  stats: Stats;

  constructor(state: State) {
    this.s = state;
    this.rng = makeRng(0);
    this.rng.state = state.rng >>> 0;
    this.stats = computeStats(state);
    // start a fresh run at full effective HP (permanent Fortify raises this)
    if (state.tick === 0) {
      state.hero.hpMax = this.stats.maxHp;
      state.hero.hp = this.stats.maxHp;
    }
  }

  serialize(): State {
    this.s.rng = this.rng.state; // persist live PRNG position so a reload resumes the same fight
    return this.s;
  }

  // Recompute the cached stat sheet. Stats are a pure function of meta/run-levels/cards/labs —
  // none of which change mid-batch — so callers refresh ONCE per frame (and after any buy) rather
  // than paying for a full rebuild on every tick. The constructor seeds it; see step().
  refreshStats(): void {
    this.stats = computeStats(this.s);
  }

  step(dt: number): void {
    const s = this.s;
    s.tick++;
    s.t += dt;
    if (!s.alive) return;
    // NB: this.stats is refreshed once per frame by the caller (refreshStats), NOT per tick.
    // Arena scales with range so the box ALWAYS strictly contains the range ring (diameter 2·range):
    // the renderer can frame the whole ring on-screen while enemies still enter from off-screen. Uses
    // the per-frame this.stats (seeded by the constructor, refreshed once per offline batch) — range
    // only changes on a buy, so per-frame is exact. Kw=4 / Kh=3 keep the base 960×640 arena at base
    // range and clear a 16:9 viewport once range grows past it.
    s.arena.w = Math.max(ARENA_W, Math.round(this.stats.range * 4));
    s.arena.h = Math.max(ARENA_H, Math.round(this.stats.range * 3));
    this._waves(dt);
    this._hero(dt);
    this._enemies(dt);
    tickProjectiles(s, dt, this.stats, this.rng);
    this._cleanup();
  }

  private _screenCap(): number {
    return WAVE.screenCap; // concurrent cap stays fixed; wave SIZE is what upgrades grow
  }

  // Effective wave for difficulty: real wave scaled by the run's tier multiplier.
  private _effWave(n: number): number {
    return n * (this.s.difficultyMult || 1);
  }

  private _startWave(n: number): void {
    const w = this.s.wave,
      st = this.stats;
    w.n = n;
    w.maxWave = Math.max(w.maxWave, n);
    // economic per-wave income (gold is immediate; coins are banked at run end)
    if (st.goldPerWave) {
      const cw = Math.round(st.goldPerWave * (st.cashMult || 1));
      this.s.econ.gold += cw;
      this.s.econ.goldEarned += cw;
    }
    if (st.coinsPerWave) this.s.econ.bonusCoins += st.coinsPerWave;
    // Interest: gain a capped fraction of banked cash each wave.
    if (st.interest) {
      const gain = Math.min(st.maxInterest || 0, Math.floor(this.s.econ.gold * st.interest));
      if (gain > 0) {
        this.s.econ.gold += gain;
        this.s.econ.goldEarned += gain;
        this.s.fx.push({ seq: ++this.s.fxSeq, x: this.s.hero.x, y: this.s.hero.y, gold: gain });
        if (this.s.fx.length > 32) this.s.fx.shift();
      }
    }
    const eff = this._effWave(n);
    w.count = waveCount(eff);
    w.toSpawn = w.count;
    w.releaseGap = WAVE.spawnWindow / Math.max(1, w.count);
    w.releaseTimer = 0;
    ageSurvivors(this.s, eff); // survivors get stronger as the new wave begins
  }

  private _spawnOne(): void {
    const s = this.s,
      eff = this._effWave(s.wave.n);
    const type = pickType(this.rng, eff);
    const tier = pickTier(this.rng, eff);
    s.enemies.push(makeEnemy(s.nextId++, type, tier, eff, this.rng, s.arena, s.hero.x, s.hero.y));
  }

  // First run only: a scripted, deliberately lethal trickle of weak melee.
  private _firstRunWaves(dt: number): void {
    const s = this.s,
      w = s.wave,
      F = FIRST_RUN;
    if (w.n === 0) {
      w.n = 1;
      w.maxWave = 1;
      s.firstSpawned = 0;
      s.firstTimer = 0;
    }
    s.firstTimer = (s.firstTimer || 0) - dt;
    while ((s.firstTimer || 0) <= 0 && (s.firstSpawned || 0) < F.count) {
      const e = makeEnemy(s.nextId++, 'melee', 'weak', 1, this.rng, s.arena, s.hero.x, s.hero.y);
      const a = this.rng.next() * Math.PI * 2; // fixed-radius ring → predictable convergence
      e.x = s.hero.x + Math.cos(a) * F.radius;
      e.y = s.hero.y + Math.sin(a) * F.radius;
      e.speed = F.speed;
      s.enemies.push(e);
      s.firstSpawned = (s.firstSpawned || 0) + 1;
      s.firstTimer = (s.firstTimer || 0) + F.gap;
    }
  }

  private _waves(dt: number): void {
    if (this.s.firstRun) return this._firstRunWaves(dt);
    const s = this.s,
      w = s.wave;
    // Wave Speed upgrade shrinks the interval (kills the dead end-gap); spawnWindow is unchanged.
    const effInt = WAVE.interval - (this.stats.waveCut || 0);
    w.clock += dt;
    if (w.clock >= effInt) {
      this._startWave(w.n + 1);
      w.clock = 0;
    }
    if (w.toSpawn > 0 && w.clock <= WAVE.spawnWindow) {
      w.releaseTimer -= dt;
      let guard = 0;
      while (w.releaseTimer <= 0 && w.toSpawn > 0 && guard++ < 64) {
        if (s.enemies.length < this._screenCap()) {
          this._spawnOne();
          w.toSpawn--;
          w.releaseTimer += w.releaseGap;
        } else {
          w.releaseTimer = 0.1;
          break;
        } // arena full: retry shortly
      }
    }
  }

  private _hurtHero(amount: number, attacker?: Enemy): void {
    const h = this.s.hero,
      st = this.stats;
    // Dodge: a successful roll voids the whole hit (deterministic rng → offline-replay safe).
    if (st.dodge > 0 && this.rng.next() < st.dodge) {
      this.s.fx.push({ seq: ++this.s.fxSeq, x: h.x, y: h.y, dodge: 1 });
      if (this.s.fx.length > 32) this.s.fx.shift();
      return;
    }
    // Thorns: reflect a share of the (landed) hit back at the attacker.
    if (st.thorns && attacker) {
      attacker.hp -= amount * st.thorns;
      attacker.hitFlash = 0.12;
    }
    // Armor: a flat soak applied per hit, then Defense % scales the remainder (caps at 90%).
    const amt = (amount - (st.armor || 0)) * (1 - (st.defPct || 0));
    if (amt <= 0) return;
    h.sinceHit = 0;
    h.hp -= amt;
    if (h.hp <= 0) {
      h.hp = 0;
      this.s.alive = false;
    }
  }

  // Roll the hero's outgoing damage for one shot at a target `dist` pixels away.
  private _rollDamage(st: Stats, dist: number): number {
    let dmg = st.rangedDamage * (1 + st.dmgPerMeter * (dist / PX_PER_METER));
    let k = Math.floor(st.critChance);
    if (this.rng.next() < st.critChance - k) k++;
    // Super Crit: on a crit, a chance to apply the crit multiplier an extra time (stacks).
    if (k > 0 && st.superCrit && this.rng.next() < st.superCrit) k++;
    if (k > 0) dmg *= Math.pow(st.critMult, k);
    return dmg;
  }

  private _hero(dt: number): void {
    const h = this.s.hero,
      st = this.stats,
      s = this.s;
    // hero is stationary at its spawn point — combat is positioning-free
    h.range = st.range;
    h.hpMax = st.maxHp;
    if (h.hp > h.hpMax) h.hp = h.hpMax;
    h.sinceHit += dt;
    if (st.regen > 0 && h.hp < h.hpMax) h.hp = Math.min(h.hpMax, h.hp + st.regen * dt);
    // Rapid Fire: every RAPID_CHECK seconds, a chance to start a timed high-firerate burst.
    if (st.rapidChance) {
      s.run.rapidCheckCd = (s.run.rapidCheckCd || 0) - dt;
      if (s.run.rapidCheckCd <= 0) {
        s.run.rapidCheckCd = RAPID_CHECK;
        if (this.rng.next() < st.rapidChance) s.run.rapidT = st.rapidDuration;
      }
    }
    if (s.run.rapidT > 0) s.run.rapidT -= dt;
    const burst = s.run.rapidT > 0;
    // auto-attack the nearest enemies in range. Multishot can fan the shot to extra targets.
    h.atkCd -= dt;
    if (h.atkCd <= 0 && s.enemies.length) {
      const maxExtra = st.msChance ? Math.max(0, Math.floor(st.msTargets || 0)) : 0;
      const targets = this._nearestN(1 + maxExtra, st.range);
      if (targets.length) {
        let shots = 1;
        if (st.msChance && this.rng.next() < st.msChance) shots = Math.min(targets.length, 1 + maxExtra);
        for (let i = 0; i < shots; i++) {
          const t = targets[i];
          const dmg = this._rollDamage(st, Math.hypot(t.x - h.x, t.y - h.y)); // each shot rolls its own crit
          if (s.atkMode === 'lightning') applyHit(s, t, dmg, st, this.rng);
          else fireProjectile(s, h, t, st, dmg, this.rng); // travelling bullet: damage lands on impact
        }
        h.atkCd = 1 / Math.max(0.1, st.fireRate * (burst ? RAPID_MULT : 1));
      }
    }
  }

  // up to `n` nearest enemies within `range`, sorted nearest-first (deterministic order).
  private _nearestN(n: number, range: number): Enemy[] {
    const h = this.s.hero,
      arr: [number, Enemy][] = [];
    for (const e of this.s.enemies) {
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d < range) arr.push([d, e]);
    }
    arr.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
    const out: Enemy[] = [];
    for (let i = 0; i < n && i < arr.length; i++) out.push(arr[i][1]);
    return out;
  }

  private _enemies(dt: number): void {
    const h = this.s.hero;
    // Protector aura: reset, then each protector grants nearby enemies damage reduction.
    let hasProt = false;
    for (const e of this.s.enemies) {
      e.shielded = 0;
      if (e.aura > 0) hasProt = true;
    }
    if (hasProt) {
      for (const p of this.s.enemies) {
        if (p.aura <= 0) continue;
        const rr = p.auraR * p.auraR;
        for (const e of this.s.enemies) {
          if (e === p) continue;
          const dx = e.x - p.x,
            dy = e.y - p.y;
          if (dx * dx + dy * dy <= rr) e.shielded = Math.max(e.shielded, p.aura);
        }
      }
    }
    for (const e of this.s.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.rend > 0) {
        e.rendT -= dt;
        if (e.rendT <= 0) e.rend = 0;
      } // Rend stacks decay over time
      const dx = h.x - e.x,
        dy = h.y - e.y,
        d = Math.hypot(dx, dy) || 1;
      e.facing = Math.atan2(dy, dx);
      const touch = h.r + e.r;
      // damage now comes ONLY from bullets/lightning — no contact aura
      if (e.kb > 0) {
        // knocked back (ranged bounce)
        e.kb -= dt;
        e.state = 'bounce';
        e.x -= (dx / d) * e.speed * 1.8 * dt;
        e.y -= (dy / d) * e.speed * 1.8 * dt;
        continue;
      }
      if (e.behavior === 'bounce') {
        if (d < touch) {
          e.kb = 0.25;
          continue;
        } // hero rammed into it → bounce next ticks
        if (d > e.range) {
          e.state = 'approach';
          e.x += (dx / d) * e.speed * dt;
          e.y += (dy / d) * e.speed * dt;
        } else {
          e.state = 'attack';
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            this._hurtHero(e.dmg, e);
            e.atkCd = 1.2;
          }
        }
      } else {
        // stick
        if (d > touch) {
          e.state = 'approach';
          e.x += (dx / d) * e.speed * dt;
          e.y += (dy / d) * e.speed * dt;
        } else {
          // resolve overlap, cling to hero, gnaw
          e.state = 'stuck';
          e.x = h.x - (dx / d) * touch;
          e.y = h.y - (dy / d) * touch;
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            this._hurtHero(e.dmg, e);
            if (e.vamp) e.hp = Math.min(e.hpMax, e.hp + e.dmg * e.vamp);
            e.atkCd = 0.8;
          }
        }
      }
    }
  }

  private _xpNeed(): number {
    return Math.round(20 * Math.pow(this.s.econ.level, 1.5));
  }

  private _cleanup(): void {
    const s = this.s,
      keep: Enemy[] = [],
      spawned: Enemy[] = [];
    for (const e of s.enemies) {
      if (e.hp <= 0) {
        s.econ.kills++;
        const tg = TIERS[e.tier];
        const decay = (e.agedWaves || 0) >= COIN_DECAY_WAVES ? COIN_DECAY_FACTOR : 1; // anti-kite
        const g = Math.round(tg.reward * this.stats.goldFind * e.strMult * (this.stats.cashMult || 1) * decay);
        s.econ.gold += g;
        s.econ.goldEarned += g;
        if (this.stats.coinsPerKill) s.econ.bonusCoins += this.stats.coinsPerKill; // economic per-kill coins
        // Splitter: spawn weaker children on death (capped so a mass-death can't explode the arena).
        // Gate on the ALIVE count (keep), not s.enemies.length — the latter still includes the
        // corpses being processed this tick, which would suppress splits before the real cap.
        if (e.splits > 0 && keep.length + spawned.length < WAVE.screenCap) {
          for (let i = 0; i < e.splits; i++) {
            const c = makeEnemy(s.nextId++, 'melee', e.tier, e.bornWave, this.rng, s.arena);
            const a = this.rng.next() * Math.PI * 2;
            c.x = e.x + Math.cos(a) * 14;
            c.y = e.y + Math.sin(a) * 14;
            c.strMult = e.strMult * 0.35;
            c.hpMax = Math.max(1, Math.round(c.hpMax * 0.35));
            c.hp = c.hpMax;
            c.dmg = Math.max(1, Math.round(c.dmg * 0.35));
            c.r = 8;
            c.agedWaves = e.agedWaves;
            spawned.push(c);
          }
        }
        s.econ.xp += Math.round(2 * tg.reward * e.strMult * this.stats.xpGain);
        // UI-facing transient kill events (consumed by the renderer).
        const coin = s.econ.kills % 10 === 0 ? 1 : 0;
        s.fx.push({ seq: ++s.fxSeq, x: e.x, y: e.y, gold: g, coin });
        if (s.fx.length > 32) s.fx.shift();
      } else keep.push(e);
    }
    s.enemies = spawned.length ? keep.concat(spawned) : keep;
    let need = this._xpNeed();
    while (s.econ.xp >= need) {
      s.econ.xp -= need;
      s.econ.level++;
      need = this._xpNeed();
    }
  }
}

// LIVE-ONLY death flourish (NOT part of the deterministic step / offline replay): after the
// hero falls, enemies keep drifting toward where it died for ~1s. No damage, no spawns, no aging.
export function tickDying(state: State, dt: number): void {
  const h = state.hero;
  for (const e of state.enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
    const dx = h.x - e.x,
      dy = h.y - e.y,
      d = Math.hypot(dx, dy) || 1;
    e.facing = Math.atan2(dy, dx);
    e.x += (dx / d) * e.speed * dt;
    e.y += (dy / d) * e.speed * dt;
  }
}
