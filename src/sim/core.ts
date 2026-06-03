/* src/sim/core.ts — the Sim. ONE step() drives both live play and offline catch-up.
   No DOM, no canvas, no Date.now() inside a step. Time = the tick counter only. */
import type { Enemy, Rng, State, Stats } from '../types';
import { makeRng } from './rng';
import { ageSurvivors, makeEnemy } from './enemies';
import { TYPES } from './registries';
import { FIRST_RUN, COIN_DECAY_FACTOR, COIN_DECAY_WAVES, WAVE, waveCount, waveRoster } from './waves';
import { applyHit, fireProjectile, tickProjectiles } from './projectiles';
import { computeStats, PX_PER_METER, RAPID_CHECK, RAPID_MULT } from './skills';
import { tickActiveCards, trySecondWind, heroInvuln } from './cards-active';
import { labInterestCap } from './labs';
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
    this._waves(dt);
    this._hero(dt);
    this._enemies(dt);
    this._separate();
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
    // Interest: gain a fraction of banked cash each wave, capped per wave (base 100 gold, lifted by the
    // Interest Cap lab up to 200k) so it can't compound into a runaway hoard.
    if (st.interest) {
      const gain = Math.min(labInterestCap(this.s.meta), Math.floor(this.s.econ.gold * st.interest));
      if (gain > 0) {
        this.s.econ.gold += gain;
        this.s.econ.goldEarned += gain;
        this.s.fx.push({ seq: ++this.s.fxSeq, x: this.s.hero.x, y: this.s.hero.y, gold: gain });
        if (this.s.fx.length > 32) this.s.fx.shift();
      }
    }
    const eff = this._effWave(n);
    // Enemy Balance card: more enemies per wave (cash/kill ×mult applied on kill in _cleanup).
    const eb = this.stats.enemyBalance > 1 ? this.stats.enemyBalance : 1;
    const want = Math.round(waveCount(eff) * eb);
    // Composition is gated by the REAL wave number + tier (unlocks/boss cadence), while the wave
    // SIZE scales with the effective wave. The roster (an ordered type list) is the deterministic,
    // resume-safe source of truth for what spawns; caps may make it shorter than `want`.
    const tier = (this.s.meta && this.s.meta.tier) || 1;
    w.queue = waveRoster(this.rng, n, tier, want);
    w.count = w.queue.length;
    w.toSpawn = w.count;
    w.releaseGap = WAVE.spawnWindow / Math.max(1, w.count);
    w.releaseTimer = 0;
    ageSurvivors(this.s, eff); // survivors get stronger as the new wave begins
  }

  // Wave Skip: cancel this wave's pending spawns and bank a reward = the wave's expected spoils ×1.10
  // (coins + cash). Uses the wave's enemy count × the current per-kill economy as the estimate.
  private _skipWave(): void {
    const s = this.s,
      w = s.wave,
      st = this.stats;
    const n = w.toSpawn; // enemies that would have spawned this wave
    w.toSpawn = 0; // skip the spawns
    if (w.queue) w.queue.length = 0;
    const waveStepCoins = Math.ceil(w.n / Math.max(1, WAVE.coinStep));
    const coins = Math.round(n * waveStepCoins * (st.coinsPerKill || 1) * 1.1);
    // Gold mirrors the coin basis (same linear wave-step) so a skipped wave's gold tracks its coins.
    const gold = Math.round(n * waveStepCoins * (st.goldFind || 1) * (st.cashMult || 1) * (st.enemyBalance || 1) * 1.1);
    if (coins > 0) s.econ.bonusCoins += coins;
    if (gold > 0) {
      s.econ.gold += gold;
      s.econ.goldEarned += gold;
      s.fx.push({ seq: ++s.fxSeq, x: s.hero.x, y: s.hero.y, gold, coin: coins });
      if (s.fx.length > 32) s.fx.shift();
    }
  }

  private _spawnOne(): void {
    const s = this.s,
      eff = this._effWave(s.wave.n);
    // Pop the next planned type from the wave roster; stats still scale with the effective wave.
    const type = (s.wave.queue && s.wave.queue.shift()) || 'melee';
    s.enemies.push(makeEnemy(s.nextId++, type, eff, this.rng, s.arena, s.hero.x, s.hero.y));
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
    // Reflect: send a share of the (landed) hit back at the attacker.
    if (st.thorns && attacker) {
      attacker.hp -= amount * st.thorns;
      attacker.hitFlash = 0.12;
    }
    // Demon Mode / Second Wind shield: ignore all incoming damage while invincible.
    if (heroInvuln(this.s)) return;
    // Defense % scales the hit FIRST, then Armor soaks a flat amount off the remainder (so flat
    // armor is more effective, not less). Never below 0.
    const amt = amount * (1 - (st.defPct || 0)) - (st.armor || 0);
    if (amt <= 0) return;
    this.s.econ.hitsTaken++; // instrumentation: a hit that actually dealt damage
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
      const spd = e.speed * (e.slowT > 0 ? e.slow : 1) * aura;
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
        const g = Math.round(rewardBase * this.stats.goldFind * (this.stats.cashMult || 1) * ebMult);
        s.econ.gold += g;
        s.econ.goldEarned += g;
        const coinMult = this.stats.coinsPerKill || 1; // Coins/Kill upgrade is a global ×multiplier
        let killCoins = Math.round(rewardBase * coinMult);
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
        if (e.splits > 0 && keep.length + spawned.length < WAVE.screenCap) {
          for (let i = 0; i < 2; i++) {
            const c = makeEnemy(s.nextId++, e.type, e.bornWave, this.rng, s.arena);
            const a = this.rng.next() * Math.PI * 2;
            c.x = e.x + Math.cos(a) * 14;
            c.y = e.y + Math.sin(a) * 14;
            c.strMult = e.strMult;
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
        s.econ.xp += Math.round(2 * e.strMult * this.stats.xpGain);
        // UI-facing transient kill events (consumed by the renderer).
        s.fx.push({ seq: ++s.fxSeq, x: e.x, y: e.y, gold: g, coin: killCoins });
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
