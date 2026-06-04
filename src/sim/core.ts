/* src/sim/core.ts — the Sim. ONE step() drives both live play and offline catch-up.
   No DOM, no canvas, no Date.now() inside a step. Time = the tick counter only. */
import type { Enemy, FxEvent, Rng, State, Stats } from '../types';
import { makeRng } from './rng';
import { ageSurvivors, makeEnemy } from './enemies';
import { TYPES } from './registries';
import { FIRST_RUN, COIN_DECAY_FACTOR, COIN_DECAY_WAVES, WAVE, concurrentCap, spawnRate, lullDuration, rollEnemyType, isBossWave } from './waves';
import { applyHit, fireProjectile, tickProjectiles } from './projectiles';
import { computeStats, PX_PER_METER, RAPID_CHECK, RAPID_MULT } from './skills';
import { tickActiveCards, trySecondWind, heroInvuln } from './cards-active';
import { tickSuperpowers, moatSlowFactor, bossEnergy, crystalKillMult } from './superpowers';
import { ARENA_W, ARENA_H } from './state';

// Detonate card: blast radius (px) of the on-death eruption. ~half the base range ring, so it
// clears a tight cluster without nuking the whole screen.
const DETONATE_RADIUS = 60;

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
    // Sync range-dependent state immediately so the renderer always sees current values,
    // even between steps and when paused.
    this.s.hero.range = this.stats.range;
    this.s.arena.w = Math.max(ARENA_W, Math.round(this.stats.range * 4));
    this.s.arena.h = Math.max(ARENA_H, Math.round(this.stats.range * 3));
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
    tickActiveCards(s, dt, this.stats, this.rng); // active-card timers; sets run.dmgBoost / run.invuln
    tickSuperpowers(s, dt, this.rng); // superpower timers: golden window, moat water, crystal orbit/shatter
    this._waves(dt);
    this._hero(dt);
    this._enemies(dt);
    this._separate();
    tickProjectiles(s, dt, this.stats, this.rng);
    this._cleanup();
  }

  // Max enemies alive at once: the wave's ramp cap, scaled by the Enemy Balance card (which lets
  // more bodies coexist), still hard-clamped at WAVE.maxCount. This is what continuous top-up fills
  // toward and what bounds splitter offspring.
  private _screenCap(): number {
    const eb = this.stats.enemyBalance > 1 ? this.stats.enemyBalance : 1;
    return Math.min(WAVE.maxCount, Math.round(concurrentCap(this.s.wave.n) * eb));
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
    // Interest: gain a fraction of banked cash each wave, clamped to a per-wave gold ceiling
    // (interestCap: 25/wave base, raised to 20k/wave by the Interest Cap lab).
    if (st.interest) {
      const raw = Math.floor(this.s.econ.gold * st.interest);
      const gain = st.interestCap > 0 ? Math.min(raw, st.interestCap) : raw;
      if (gain > 0) {
        this.s.econ.gold += gain;
        this.s.econ.goldEarned += gain;
        this._note('interest', gain);
      }
    }
    // Skip Enemy Health / Attack utilities: roll ONCE per stat at each wave start (only when the skill
    // is owned, so players without it keep the exact legacy spawn stream). A hit drops that stat's
    // effective wave by one for the rest of the run and posts a note. Deterministic (seeded rng).
    const run = this.s.run;
    if (st.skipEnemyHp > 0 && this.rng.next() < st.skipEnemyHp) {
      run.hpSkip = (run.hpSkip || 0) + 1;
      this._note('hpskip', run.hpSkip);
    }
    if (st.skipEnemyDmg > 0 && this.rng.next() < st.skipEnemyDmg) {
      run.dmgSkip = (run.dmgSkip || 0) + 1;
      this._note('dmgskip', run.dmgSkip);
    }
    // Aegis card: each wave begins with a damage-soaking shield = a fraction of max HP. Refreshed
    // (never shrunk) at every wave start so a fresh wave always opens fully shielded.
    if (st.aegis > 0) run.shield = Math.max(run.shield || 0, st.maxHp * st.aegis);
    // Ascetic card: a wave with no in-run gold/free-up buy is "frugal" and grows max HP. The counter
    // freezes for the rest of the run once an in-run upgrade is bought (run.asceticBroken).
    if (!run.asceticBroken) run.asceticWaves = (run.asceticWaves || 0) + 1;
    // Continuous top-up: no roster is built. The wave is a difficulty/composition window — its
    // size emerges from concurrentCap(n) (alive cap) × spawnRate(n) (release rate) over time.
    // Reset the per-wave spawn pacing and the boss-once flag; the first spawn fires immediately.
    w.spawnTimer = 0;
    w.bossSpawned = false;
    ageSurvivors(this.s, n); // survivors get stronger as the new wave begins (reads tier mult itself)
  }

  // Push a transient per-wave info note (rendered as on-screen text, gated by a Display toggle).
  private _note(note: NonNullable<FxEvent['note']>, val: number): void {
    this.s.fx.push({ seq: ++this.s.fxSeq, x: this.s.hero.x, y: this.s.hero.y, note, noteVal: val });
    if (this.s.fx.length > 32) this.s.fx.shift();
  }

  // Wave Skip: cancel this wave's pending spawns and bank a reward = the wave's expected spoils ×1.10
  // (coins + cash). Uses the wave's enemy count × the current per-kill economy as the estimate.
  private _skipWave(): void {
    const s = this.s,
      w = s.wave,
      st = this.stats;
    // No fixed batch any more: estimate the wave's kills as spawnRate × the active spawning window
    // (interval minus the end-of-wave lull). `w.n` is already the just-started wave here.
    const accel = Math.max(0.1, 1 - (st.waveAccel || 0));
    const effInt = WAVE.interval * accel;
    const effLull = Math.min(lullDuration(st.lullReduce || 0), effInt);
    const n = Math.round(spawnRate(w.n) * Math.max(0, effInt - effLull));
    const waveStepCoins = Math.ceil(w.n / Math.max(1, WAVE.coinStep));
    const coins = Math.round(n * waveStepCoins * (st.coinsPerKill || 1) * 1.1);
    // Gold mirrors the coin basis (same linear wave-step) so a skipped wave's gold tracks its coins.
    const gold = Math.round(n * waveStepCoins * (st.goldFind || 1) * (st.cashMult || 1) * (st.enemyBalance || 1) * 1.1);
    s.econ.wavesSkipped = (s.econ.wavesSkipped || 0) + 1;
    if (coins > 0) s.econ.bonusCoins += coins;
    if (gold > 0) {
      s.econ.gold += gold;
      s.econ.goldEarned += gold;
      s.fx.push({ seq: ++s.fxSeq, x: s.hero.x, y: s.hero.y, gold, coin: coins });
      if (s.fx.length > 32) s.fx.shift();
    }
    this._note('waveskip', w.n); // "Wave N skipped"
  }

  private _spawnOne(): void {
    const s = this.s,
      w = s.wave;
    const tier = (s.meta && s.meta.tier) || 1;
    // Boss priority: while a boss wave hasn't placed its boss yet, the next spawn IS the boss
    // (bypassing the normal roll), so it can never be starved out by a short or accelerated wave.
    const bossPending = isBossWave(w.n) && !w.bossSpawned;
    const type = rollEnemyType(this.rng, w.n, tier, bossPending);
    if (type === 'boss') w.bossSpawned = true;
    // Stats scale with the REAL wave × the tier's flat HP/damage multiplier (s.difficultyMult), minus
    // any enemy-skip levels accrued this run (HP and attack scale down independently).
    s.enemies.push(makeEnemy(s.nextId++, type, w.n, this.rng, s.arena, s.hero.x, s.hero.y, s.difficultyMult || 1, this.stats.range * 1.4, s.run.hpSkip || 0, s.run.dmgSkip || 0));
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
      const e = makeEnemy(s.nextId++, 'melee', 1, this.rng, s.arena, s.hero.x, s.hero.y);
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
    // Wave Accelerator card: shorten the time between waves by a fraction (clamped so it never hits 0).
    const accel = Math.max(0.1, 1 - (this.stats.waveAccel || 0));
    const effInt = WAVE.interval * accel;
    w.clock += dt;
    if (w.clock >= effInt) {
      this._startWave(w.n + 1);
      w.clock = 0;
      // Wave Skip card: a chance, at the start of a wave, to instantly clear it and bank a reward
      // equal to the just-passed wave's spoils ×1.10 (coins + cash), skipping its spawns.
      if (this.stats.waveSkip > 0 && this.rng.next() < this.stats.waveSkip) this._skipWave();
    }
    // Continuous top-up: spawn at spawnRate(n)/sec while the arena isn't at the alive cap, EXCEPT
    // during the end-of-wave lull (the last effLull seconds before the next wave starts).
    const effLull = Math.min(lullDuration(this.stats.lullReduce || 0), effInt);
    const spawning = w.clock < effInt - effLull;
    if (spawning) {
      const gap = 1 / spawnRate(w.n);
      w.spawnTimer -= dt;
      let guard = 0;
      while (w.spawnTimer <= 0 && guard++ < 64) {
        if (s.enemies.length < this._screenCap()) {
          this._spawnOne();
          w.spawnTimer += gap;
        } else {
          w.spawnTimer = 0.1;
          break;
        } // arena full: retry shortly — a kill frees a slot
      }
    }
  }

  private _hurtHero(amount: number, attacker?: Enemy): void {
    const h = this.s.hero,
      st = this.stats;
    // Disintegrate: an attacker that hits the tower loses a fraction of its OWN max HP (not the
    // incoming damage). Fires on every landed hit, melee and ranged alike. Capped at 99% by the curve.
    if (st.thorns && attacker) {
      const refl = attacker.hpMax * st.thorns;
      attacker.hp -= refl;
      attacker.lastHurt = 'reflect';
      attacker.hitFlash = 0.12;
      this.s.econ.reflectDealt += refl;
    }
    // Demon Mode / Second Wind shield: ignore all incoming damage while invincible.
    if (heroInvuln(this.s)) return;
    // Defense % scales the hit FIRST, then Armor soaks a flat amount off the remainder (so flat
    // armor is more effective, not less). Never below 0.
    let amt = amount * (1 - (st.defPct || 0)) - (st.armor || 0);
    if (amt <= 0) return;
    // Aegis shield (refreshed each wave) soaks damage before it reaches HP. A fully-absorbed hit
    // costs no HP and is NOT counted as damage taken, so it can't feed Vengeance.
    if ((this.s.run.shield || 0) > 0) {
      const soak = Math.min(this.s.run.shield!, amt);
      this.s.run.shield! -= soak;
      amt -= soak;
      if (amt <= 0) return;
    }
    this.s.econ.hitsTaken++; // instrumentation: a hit that actually dealt damage
    this.s.econ.dmgTaken += amt;
    h.sinceHit = 0;
    h.hp -= amt;
    if (h.hp <= 0) {
      // Second Wind: auto-revive at half HP once per run (cancels the killing blow).
      if (trySecondWind(this.s, st)) return;
      h.hp = 0;
      this.s.alive = false;
    }
  }

  // Roll the hero's outgoing damage for one shot at a target `dist` pixels away.
  private _rollDamage(st: Stats, dist: number): number {
    let dmg = st.rangedDamage * (1 + st.dmgPerMeter * (dist / PX_PER_METER));
    let k = Math.floor(st.critChance);
    if (this.rng.next() < st.critChance - k) k++;
    if (k > 0) dmg *= Math.pow(st.critMult, k);
    // Super Crit: on a crit, a chance to additionally multiply damage by the Super Crit multiplier.
    if (k > 0 && st.superCrit && this.rng.next() < st.superCrit) dmg *= st.superCritMult || 1;
    // Active-ability damage boost (Super Tower ×dmg, Demon Mode ×3) applied to every shot.
    const boost = this.s.run.dmgBoost || 1;
    if (boost !== 1) dmg *= boost;
    // Last Stand card: the more HP you are missing, the harder you hit (peaks near death).
    if (st.lastStand > 0) {
      const h = this.s.hero,
        missing = h.hpMax > 0 ? 1 - h.hp / h.hpMax : 0;
      if (missing > 0) dmg *= 1 + st.lastStand * missing;
    }
    // Vengeance card: cumulative damage taken fuels offense — +1% dmg per 1% of max HP suffered,
    // capped so the total multiplier never exceeds st.vengeance (e.g. ×3.0 at max level).
    if (st.vengeance > 1) {
      const amp = Math.min(st.vengeance - 1, (this.s.econ.dmgTaken || 0) / (this.s.hero.hpMax || 1));
      if (amp > 0) dmg *= 1 + amp;
    }
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
        // Berserk card: attack speed climbs with the crowd. Per-enemy rate is the cap/50, so it
        // reaches the cap (st.berserk) at ~50 foes inside range — both scale together with level.
        let speedMult = burst ? RAPID_MULT : 1;
        if (st.berserk > 0) {
          let crowd = 0;
          const rr = h.range * h.range;
          for (const e of s.enemies) {
            const dx = e.x - h.x,
              dy = e.y - h.y;
            if (dx * dx + dy * dy <= rr) crowd++;
          }
          speedMult *= 1 + Math.min(st.berserk, (st.berserk / 50) * crowd);
        }
        h.atkCd = 1 / Math.max(0.1, st.fireRate * speedMult);
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
    for (const e of this.s.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.rend > 0) {
        e.rendT -= dt;
        if (e.rendT <= 0) e.rend = 0;
      } // Amp stacks decay over time
      if (e.slowT > 0) e.slowT -= dt; // knockback slow on a too-heavy enemy wears off
      const dx = h.x - e.x,
        dy = h.y - e.y,
        d = Math.hypot(dx, dy) || 1;
      // Slow Aura card: enemies within the hero's range crawl at ×(1 − aura%).
      const aura = this.stats.slowAura > 0 && d <= h.range ? 1 - this.stats.slowAura : 1;
      const spd = e.speed * (e.slowT > 0 ? e.slow : 1) * aura * moatSlowFactor(this.s, e);
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
        // Ranged standoff is pinned to 80% of the hero's CURRENT range, so the hero always
        // out-ranges ranged enemies (they advance into kill range instead of plinking from
        // outside it). Tracks live range upgrades; ignores the per-type def.range baseline.
        const eRange = h.range * 0.8;
        if (d < touch) {
          e.kb = 0.25;
          continue;
        } // hero rammed into it → bounce next ticks
        if (d > eRange) {
          e.state = 'approach';
          e.x += (dx / d) * spd * dt;
          e.y += (dy / d) * spd * dt;
        } else {
          e.state = 'attack';
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            this._hurtHero(e.dmg * Math.pow(1.04, e.heat), e); // heat-up: compounding +4% per landed hit
            e.heat++;
            e.atkCd = 1.2;
          }
        }
      } else {
        // stick
        if (d > touch) {
          e.state = 'approach';
          e.x += (dx / d) * spd * dt;
          e.y += (dy / d) * spd * dt;
        } else {
          // resolve overlap, cling to hero, gnaw
          e.state = 'stuck';
          e.x = h.x - (dx / d) * touch;
          e.y = h.y - (dy / d) * touch;
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            this._hurtHero(e.dmg * Math.pow(1.04, e.heat), e); // heat-up: compounding +4% per landed hit
            e.heat++;
            e.atkCd = 0.8;
          }
        }
      }
    }
  }

  // Enemy-vs-enemy collision. After movement, push overlapping bodies apart so the horde can't
  // stack on one point and a knocked-back enemy physically shoves the crowd. Deterministic: a
  // uniform spatial grid keyed by integer cell (built in array order), pairs resolved once from
  // the lower index (Gauss–Seidel) — O(n) typical, so offline catch-up stays fast.
  private _separate(): void {
    const es = this.s.enemies;
    const n = es.length;
    if (n < 2) return;
    const CELL = 40; // ≥ largest enemy diameter (boss r 19.8), so an overlapping pair is always within 1 cell
    const cellX = new Int32Array(n),
      cellY = new Int32Array(n);
    const grid = new Map<number, number[]>();
    const keyOf = (cx: number, cy: number): number => (cx & 0xffff) * 0x10000 + (cy & 0xffff);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(es[i].x / CELL),
        cy = Math.floor(es[i].y / CELL);
      cellX[i] = cx;
      cellY[i] = cy;
      const k = keyOf(cx, cy);
      let b = grid.get(k);
      if (!b) grid.set(k, (b = []));
      b.push(i);
    }
    for (let i = 0; i < n; i++) {
      const a = es[i];
      for (let gx = cellX[i] - 1; gx <= cellX[i] + 1; gx++) {
        for (let gy = cellY[i] - 1; gy <= cellY[i] + 1; gy++) {
          const bucket = grid.get(keyOf(gx, gy));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            if (j <= i) continue; // resolve each unordered pair exactly once
            const e2 = es[j];
            let dx = e2.x - a.x,
              dy = e2.y - a.y;
            const min = a.r + e2.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) {
              // exactly coincident → deterministic nudge so the resolve has a direction
              dx = ((i + j) & 1) === 0 ? 1 : -1;
              dy = 0;
              d = 1;
            }
            const overlap = min - d,
              nx = dx / d,
              ny = dy / d;
            // A knocked-back / bouncing enemy (kb>0) is treated as immovable, so it plows through
            // and shoves the others instead of being absorbed by the crowd.
            const aLock = a.kb > 0,
              bLock = e2.kb > 0;
            let wa = 0.5,
              wb = 0.5;
            if (aLock && !bLock) { wa = 0; wb = 1; }
            else if (bLock && !aLock) { wa = 1; wb = 0; }
            else if (aLock && bLock) { wa = 0; wb = 0; }
            a.x -= nx * overlap * wa;
            a.y -= ny * overlap * wa;
            e2.x += nx * overlap * wb;
            e2.y += ny * overlap * wb;
          }
        }
      }
    }
    // Don't let the shoving push a body inside the hero avatar.
    const h = this.s.hero;
    for (let i = 0; i < n; i++) {
      const e = es[i];
      const dx = e.x - h.x,
        dy = e.y - h.y,
        min = h.r + e.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1;
        e.x = h.x + (dx / d) * min;
        e.y = h.y + (dy / d) * min;
      }
    }
  }


  private _cleanup(): void {
    const s = this.s,
      keep: Enemy[] = [],
      spawned: Enemy[] = [];
    const det = this.stats.detonate || 0; // Detonate card: on-death blast fraction (0 = no card)
    const blasts: { x: number; y: number; dmg: number }[] = [];
    for (const e of s.enemies) {
      if (e.hp <= 0) {
        s.econ.kills++;
        // Detonate card: the slain enemy erupts for a share of its OWN max HP onto nearby foes.
        if (det > 0) blasts.push({ x: e.x, y: e.y, dmg: e.hpMax * det });
        if (e.lastHurt === 'reflect') s.econ.killsByReflect++;
        else s.econ.killsByDamage++;
        const decay = (e.agedWaves || 0) >= COIN_DECAY_WAVES ? COIN_DECAY_FACTOR : 1; // anti-kite
        // Per-kill reward BASIS, shared by coins AND gold so the two currencies scale together: the
        // enemy's per-type coinValue (melee 1, fast/ranged 2, tank/splitter 4, boss 5), scaled by the
        // wave coin-step (1× for waves 1–10, 2× for 11–20, …) and the anti-kite decay.
        const waveStepCoins = Math.ceil(s.wave.n / Math.max(1, WAVE.coinStep));
        const type = TYPES[e.type];
        const rewardBase = waveStepCoins * (type ? type.coinValue : 1) * decay;
        // Gold = the shared (LINEAR) basis × the gold-only multipliers. It deliberately no longer scales
        // with the enemy's EXPONENTIAL wave-strength (e.strMult) — that exponent made late-wave gold
        // explode past coins. The gold-only bonuses (Gold/Kill via goldFind, Gold Bonus, Enemy Balance,
        // and the Gold card folded into goldFind) are what let gold still outpace coins.
        const ebMult = this.stats.enemyBalance || 1;
        // Superpower reward ×: Golden Lightning window (all kills) × Crystal gold track (crystal kills
        // only). Both gold AND coins ride it, so "all numbers multiply" holds end-to-end.
        const superMult = (s.run.goldenMult || 1) * (e.lastHurt === 'crystal' ? crystalKillMult(s.meta) : 1);
        const g = Math.round(rewardBase * this.stats.goldFind * (this.stats.cashMult || 1) * ebMult * superMult);
        s.econ.gold += g;
        s.econ.goldEarned += g;
        const coinMult = this.stats.coinsPerKill || 1; // Coins/Kill upgrade is a global ×multiplier
        let killCoins = Math.round(rewardBase * coinMult * superMult);
        // Energy income: +1 per boss kill (× the Moat boss-Energy track if it died in the water).
        if (e.type === 'boss') s.meta.energy = (s.meta.energy || 0) + bossEnergy(s, e);
        // Critical Coin card: a chance per kill to drop bonus coins = base coins × crit damage mult.
        if (this.stats.criticalCoin > 0 && this.rng.next() < this.stats.criticalCoin) {
          killCoins += Math.round(killCoins * (this.stats.critMult || 1));
        }
        s.econ.bonusCoins += killCoins;
        // Splitter: on death, split into TWO halves. e.splits is the remaining number of generations
        // (4 on a fresh splitter); each child halves the parent's hp/dmg and decrements splits, so a
        // line stops after 4 splits. Capped so a mass-death can't explode the arena. Gate on the
        // ALIVE count (keep), not s.enemies.length — the latter still includes corpses being
        // processed this tick, which would suppress splits before the real cap.
        if (e.splits > 0 && keep.length + spawned.length < this._screenCap()) {
          for (let i = 0; i < 2; i++) {
            const c = makeEnemy(s.nextId++, e.type, e.bornWave, this.rng, s.arena); // stats are copied from the parent below, so spawn args don't matter
            const a = this.rng.next() * Math.PI * 2;
            c.x = e.x + Math.cos(a) * 14;
            c.y = e.y + Math.sin(a) * 14;
            c.strMult = e.strMult;
            c.dmgMult = e.dmgMult;
            c.hpMax = Math.max(1, Math.round(e.hpMax * 0.5));
            c.hp = c.hpMax;
            c.dmg = Math.max(1, Math.round(e.dmg * 0.5));
            c.r = Math.max(1.2, e.r * 0.8); // children a bit smaller than the parent (no integer floor: bodies are tiny now)
            c.mass = e.mass;
            c.agedWaves = e.agedWaves;
            c.splits = e.splits - 1; // one fewer generation than the parent
            spawned.push(c);
          }
        }
        // UI-facing transient kill events (consumed by the renderer).
        s.fx.push({ seq: ++s.fxSeq, x: e.x, y: e.y, gold: g, coin: killCoins });
        if (s.fx.length > 32) s.fx.shift();
      } else keep.push(e);
    }
    const out = spawned.length ? keep.concat(spawned) : keep;
    // Apply Detonate blasts to the survivors. Damage lands now; anything pushed to ≤0 HP dies on the
    // next tick's cleanup (paying its rewards and, if Detonate is up, chaining its own blast).
    if (blasts.length) {
      const r2 = DETONATE_RADIUS * DETONATE_RADIUS;
      for (const b of blasts) {
        for (const e of out) {
          if (e.hp <= 0 || e.type === 'boss') continue; // bosses shrug off the blast
          const dx = e.x - b.x,
            dy = e.y - b.y;
          if (dx * dx + dy * dy <= r2) {
            e.hp -= b.dmg;
            e.lastHurt = 'dmg';
            e.hitFlash = 0.12;
            s.econ.dmgDealt += b.dmg;
          }
        }
      }
    }
    s.enemies = out;
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
