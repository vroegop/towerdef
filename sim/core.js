/* sim/core.js — the Sim. ONE step() drives both live play and offline catch-up.
   No DOM, no canvas, no Date.now() inside a step. Time = the tick counter only. */
(function (A) {
  function Sim(state) {
    this.s = state;
    this.rng = A.makeRng(0);
    this.rng.state = state.rng >>> 0;
    this.stats = A.computeStats(state);
    // start a fresh run at full effective HP (permanent Fortify raises this)
    if (state.tick === 0) { state.hero.hpMax = this.stats.maxHp; state.hero.hp = this.stats.maxHp; }
  }

  Sim.prototype.serialize = function () {
    this.s.rng = this.rng.state; // persist live PRNG position so a reload resumes the same fight
    return this.s;
  };

  Sim.prototype.snapshot = function () { return this.s; };

  Sim.prototype.step = function (dt) {
    const s = this.s;
    s.tick++; s.t += dt;
    if (!s.alive) return;
    this.stats = A.computeStats(s);
    this._waves(dt);
    this._hero(dt);
    this._enemies(dt);
    A.tickProjectiles(s, dt, this.stats, this.rng);
    A.tickEffects(s, dt);
    this._cleanup();
  };

  Sim.prototype._screenCap = function () {
    return A.WAVE.screenCap; // concurrent cap stays fixed; wave SIZE is what upgrades grow
  };

  // Effective wave for difficulty: real wave scaled by the run's tier multiplier. The real
  // counter (w.n) still drives display, spawn timing, and milestones.
  Sim.prototype._effWave = function (n) { return n * (this.s.difficultyMult || 1); };

  Sim.prototype._startWave = function (n) {
    const w = this.s.wave, st = this.stats;
    w.n = n; w.maxWave = Math.max(w.maxWave, n);
    // economic per-wave income (gold is immediate; cores are banked at run end)
    if (st.coinsPerWave) { const cw = Math.round(st.coinsPerWave * (st.cashMult || 1)); this.s.econ.gold += cw; this.s.econ.goldEarned += cw; }
    if (st.coresPerWave) this.s.econ.bonusCores += st.coresPerWave;
    // Interest: gain a capped fraction of banked cash each wave — rewards saving for big buys.
    if (st.interest) {
      const gain = Math.min(st.maxInterest || 0, Math.floor(this.s.econ.gold * st.interest));
      if (gain > 0) {
        this.s.econ.gold += gain; this.s.econ.goldEarned += gain;
        this.s.fx.push({ seq: ++this.s.fxSeq, x: this.s.hero.x, y: this.s.hero.y, gold: gain });
        if (this.s.fx.length > 32) this.s.fx.shift();
      }
    }
    const eff = this._effWave(n);
    w.count = A.waveCount(eff);
    w.toSpawn = w.count;
    w.releaseGap = A.WAVE.spawnWindow / Math.max(1, w.count);
    w.releaseTimer = 0;
    A.ageSurvivors(this.s, eff); // survivors get stronger as the new wave begins
  };

  Sim.prototype._spawnOne = function () {
    const s = this.s, eff = this._effWave(s.wave.n);
    const type = A.pickType(this.rng, eff);
    const tier = A.pickTier(this.rng, eff);
    s.enemies.push(A.makeEnemy(s.nextId++, type, tier, eff, this.rng, s.arena));
  };

  // First run only: a scripted, deliberately lethal trickle of weak melee so a
  // 1/1/1 hero dies at ~10s (tuned via A.FIRST_RUN).
  Sim.prototype._firstRunWaves = function (dt) {
    const s = this.s, w = s.wave, F = A.FIRST_RUN;
    if (w.n === 0) { w.n = 1; w.maxWave = 1; s.firstSpawned = 0; s.firstTimer = 0; }
    s.firstTimer -= dt;
    while (s.firstTimer <= 0 && s.firstSpawned < F.count) {
      const e = A.makeEnemy(s.nextId++, 'melee', 'weak', 1, this.rng, s.arena);
      const a = this.rng.next() * Math.PI * 2; // fixed-radius ring → predictable convergence
      e.x = s.arena.w / 2 + Math.cos(a) * F.radius;
      e.y = s.arena.h / 2 + Math.sin(a) * F.radius;
      e.speed = F.speed;
      s.enemies.push(e);
      s.firstSpawned++; s.firstTimer += F.gap;
    }
  };

  Sim.prototype._waves = function (dt) {
    if (this.s.firstRun) return this._firstRunWaves(dt);
    const s = this.s, w = s.wave;
    // Wave Speed upgrade shrinks the interval (kills the dead end-gap); spawnWindow is unchanged
    // since the interval never drops below it, so waves just come back-to-back at max.
    const effInt = A.WAVE.interval - (this.stats.waveCut || 0);
    w.clock += dt;
    if (w.clock >= effInt) { this._startWave(w.n + 1); w.clock = 0; }
    if (w.toSpawn > 0 && w.clock <= A.WAVE.spawnWindow) {
      w.releaseTimer -= dt;
      let guard = 0;
      while (w.releaseTimer <= 0 && w.toSpawn > 0 && guard++ < 64) {
        if (s.enemies.length < this._screenCap()) {
          this._spawnOne(); w.toSpawn--; w.releaseTimer += w.releaseGap;
        } else { w.releaseTimer = 0.1; break; } // arena full: retry shortly
      }
    }
  };

  Sim.prototype._hurtHero = function (amount, attacker) {
    const h = this.s.hero, st = this.stats;
    // Dodge: a successful roll voids the whole hit (deterministic rng → offline-replay safe).
    if (st.dodge > 0 && this.rng.next() < st.dodge) {
      this.s.fx.push({ seq: ++this.s.fxSeq, x: h.x, y: h.y, dodge: 1 });
      if (this.s.fx.length > 32) this.s.fx.shift();
      return;
    }
    // Thorns: reflect a share of the (landed) hit back at the attacker. Reflected kills die in
    // _cleanup and pay out like any kill. Only hits that land reflect — a dodged hit does not.
    if (st.thorns && attacker) {
      attacker.hp -= amount * st.thorns;
      attacker.hitFlash = 0.12;
    }
    // Armor: a flat soak applied per hit, then Defense % scales the remainder (caps at 90%).
    let amt = (amount - (st.armor || 0)) * (1 - (st.defPct || 0));
    if (amt <= 0) return;
    h.sinceHit = 0;
    h.hp -= amt;
    if (h.hp <= 0) { h.hp = 0; this.s.alive = false; }
  };

  // Roll the hero's outgoing damage for one shot at a target `dist` pixels away:
  // base × (1 + dmg-per-metre × metres) × critMult^k, where k crits stack (k≥2 when crit
  // chance is over 100% — the excess is the chance to multiply the crit by itself again).
  Sim.prototype._rollDamage = function (st, dist) {
    let dmg = st.rangedDamage * (1 + st.dmgPerMeter * (dist / A.PX_PER_METER));
    let k = Math.floor(st.critChance);
    if (this.rng.next() < st.critChance - k) k++;
    // Super Crit: on a crit, a chance to apply the crit multiplier an extra time (stacks).
    if (k > 0 && st.superCrit && this.rng.next() < st.superCrit) k++;
    if (k > 0) dmg *= Math.pow(st.critMult, k);
    return dmg;
  };

  Sim.prototype._hero = function (dt) {
    const h = this.s.hero, st = this.stats, s = this.s;
    // hero is stationary at its spawn point — combat is positioning-free
    h.range = st.range; // surfaced in the snapshot so the renderer/camera read the true range
    // derived max + regen
    h.hpMax = st.maxHp; if (h.hp > h.hpMax) h.hp = h.hpMax;
    h.sinceHit += dt;
    if (st.regen > 0 && h.hp < h.hpMax) h.hp = Math.min(h.hpMax, h.hp + st.regen * dt);
    // Rapid Fire: every RAPID_CHECK seconds, a chance to start a timed high-firerate burst.
    if (st.rapidChance) {
      s.run.rapidCheckCd = (s.run.rapidCheckCd || 0) - dt;
      if (s.run.rapidCheckCd <= 0) {
        s.run.rapidCheckCd = A.RAPID_CHECK;
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
        // roll Multishot only when something is in range, so empty ticks don't consume the rng
        let shots = 1;
        if (st.msChance && this.rng.next() < st.msChance) shots = Math.min(targets.length, 1 + maxExtra);
        for (let i = 0; i < shots; i++) {
          const t = targets[i];
          const dmg = this._rollDamage(st, Math.hypot(t.x - h.x, t.y - h.y)); // each shot rolls its own crit
          if (s.atkMode === 'lightning') A.applyHit(s, t, dmg, st, this.rng);
          else A.fireProjectile(s, h, t, st, dmg, this.rng); // travelling bullet: damage lands on impact
        }
        h.atkCd = 1 / Math.max(0.1, st.fireRate * (burst ? A.RAPID_MULT : 1));
      }
    }
  };

  // up to `n` nearest enemies within `range`, sorted nearest-first (deterministic order).
  Sim.prototype._nearestN = function (n, range) {
    const h = this.s.hero, arr = [];
    for (const e of this.s.enemies) { const d = Math.hypot(e.x - h.x, e.y - h.y); if (d < range) arr.push([d, e]); }
    arr.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
    const out = []; for (let i = 0; i < n && i < arr.length; i++) out.push(arr[i][1]); return out;
  };

  Sim.prototype._enemies = function (dt) {
    const h = this.s.hero, st = this.stats;
    // Protector aura: reset, then each protector grants nearby enemies damage reduction (not itself,
    // so focus-firing the protector removes the shield). Only runs when a protector is alive.
    let hasProt = false;
    for (const e of this.s.enemies) { e.shielded = 0; if (e.aura > 0) hasProt = true; }
    if (hasProt) {
      for (const p of this.s.enemies) {
        if (p.aura <= 0) continue;
        const rr = p.auraR * p.auraR;
        for (const e of this.s.enemies) { if (e === p) continue; const dx = e.x - p.x, dy = e.y - p.y; if (dx * dx + dy * dy <= rr) e.shielded = Math.max(e.shielded, p.aura); }
      }
    }
    for (const e of this.s.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.rend > 0) { e.rendT -= dt; if (e.rendT <= 0) e.rend = 0; } // Rend stacks decay over time
      const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.facing = Math.atan2(dy, dx);
      const touch = h.r + e.r;
      // damage now comes ONLY from bullets/lightning — no contact aura
      if (e.kb > 0) { // knocked back (ranged bounce)
        e.kb -= dt; e.state = 'bounce';
        e.x -= dx / d * e.speed * 1.8 * dt; e.y -= dy / d * e.speed * 1.8 * dt;
        continue;
      }
      if (e.behavior === 'bounce') {
        if (d < touch) { e.kb = 0.25; continue; }      // hero rammed into it → bounce next ticks
        if (d > e.range) { e.state = 'approach'; e.x += dx / d * e.speed * dt; e.y += dy / d * e.speed * dt; }
        else { e.state = 'attack'; e.atkCd -= dt; if (e.atkCd <= 0) { this._hurtHero(e.dmg, e); e.atkCd = 1.2; } }
      } else { // stick
        if (d > touch) { e.state = 'approach'; e.x += dx / d * e.speed * dt; e.y += dy / d * e.speed * dt; }
        else { // resolve overlap, cling to hero, gnaw
          e.state = 'stuck';
          e.x = h.x - dx / d * touch; e.y = h.y - dy / d * touch;
          e.atkCd -= dt; if (e.atkCd <= 0) { this._hurtHero(e.dmg, e); if (e.vamp) e.hp = Math.min(e.hpMax, e.hp + e.dmg * e.vamp); e.atkCd = 0.8; }
        }
      }
    }
  };

  Sim.prototype._xpNeed = function () { return Math.round(20 * Math.pow(this.s.econ.level, 1.5)); };

  Sim.prototype._cleanup = function () {
    const s = this.s, keep = [], spawned = [];
    for (const e of s.enemies) {
      if (e.hp <= 0) {
        s.econ.kills++;
        const tg = A.TIERS[e.tier];
        const decay = (e.agedWaves || 0) >= A.COIN_DECAY_WAVES ? A.COIN_DECAY_FACTOR : 1; // anti-kite
        const g = Math.round(tg.reward * this.stats.goldFind * e.strMult * (s.rewardMult || 1) * (this.stats.cashMult || 1) * decay);
        s.econ.gold += g; s.econ.goldEarned += g;
        if (this.stats.coresPerKill) s.econ.bonusCores += this.stats.coresPerKill; // economic per-kill cores
        // Cells (farmed lab-fuel currency) faucet: bosses/vampires/splitters/elites drop the most.
        if (e.type === 'boss') { s.econ.bonusCells += 3; s.econ.bossKills++; }
        else if (e.type === 'vampire') s.econ.bonusCells += 2;
        else if (e.type === 'splitter' || e.tier === 'elite') s.econ.bonusCells += 1;
        // Splitter: spawn weaker children on death (capped so a mass-death can't explode the arena).
        if (e.splits > 0 && s.enemies.length + spawned.length < A.WAVE.screenCap) {
          for (let i = 0; i < e.splits; i++) {
            const c = A.makeEnemy(s.nextId++, 'melee', e.tier, e.bornWave, this.rng, s.arena);
            const a = this.rng.next() * Math.PI * 2;
            c.x = e.x + Math.cos(a) * 14; c.y = e.y + Math.sin(a) * 14;
            c.strMult = e.strMult * 0.35; c.hpMax = Math.max(1, Math.round(c.hpMax * 0.35)); c.hp = c.hpMax;
            c.dmg = Math.max(1, Math.round(c.dmg * 0.35)); c.r = 8; c.agedWaves = e.agedWaves;
            spawned.push(c);
          }
        }
        s.econ.xp += Math.round(2 * tg.reward * e.strMult * this.stats.xpGain);
        // UI-facing transient kill events (consumed by the renderer). cores accrue at the
        // banked rate of 1 per 10 kills, surfaced here as a per-kill drop. Capped so a
        // render-free offline replay can't grow it unbounded.
        const core = (s.econ.kills % 10 === 0) ? 1 : 0;
        s.fx.push({ seq: ++s.fxSeq, x: e.x, y: e.y, gold: g, core });
        if (s.fx.length > 32) s.fx.shift();
      } else keep.push(e);
    }
    s.enemies = spawned.length ? keep.concat(spawned) : keep;
    let need = this._xpNeed();
    while (s.econ.xp >= need) { s.econ.xp -= need; s.econ.level++; need = this._xpNeed(); }
  };

  // LIVE-ONLY death flourish (NOT part of the deterministic step / offline replay): after the
  // hero falls, enemies keep drifting toward where it died for ~1s. No damage, no spawns, no aging.
  A.tickDying = function (state, dt) {
    const h = state.hero;
    for (const e of state.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.facing = Math.atan2(dy, dx);
      e.x += dx / d * e.speed * dt; e.y += dy / d * e.speed * dt;
    }
  };

  A.Sim = Sim;
})(window.ARENA = window.ARENA || {});
