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
    A.tickProjectiles(s, dt);
    A.tickEffects(s, dt);
    this._cleanup();
  };

  Sim.prototype._screenCap = function () {
    return A.WAVE.screenCap; // concurrent cap stays fixed; wave SIZE is what upgrades grow
  };

  Sim.prototype._startWave = function (n) {
    const w = this.s.wave;
    w.n = n; w.maxWave = Math.max(w.maxWave, n);
    w.count = A.waveCount(n);
    w.toSpawn = w.count;
    w.releaseGap = A.WAVE.spawnWindow / Math.max(1, w.count);
    w.releaseTimer = 0;
    A.ageSurvivors(this.s, n); // survivors get stronger as the new wave begins
  };

  Sim.prototype._spawnOne = function () {
    const s = this.s;
    const type = A.pickType(this.rng, s.wave.n);
    const tier = A.pickTier(this.rng, s.wave.n);
    s.enemies.push(A.makeEnemy(s.nextId++, type, tier, s.wave.n, this.rng, s.arena));
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
    w.clock += dt;
    if (w.clock >= A.WAVE.interval) { this._startWave(w.n + 1); w.clock = 0; }
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

  Sim.prototype._hurtHero = function (amount) {
    const h = this.s.hero;
    h.sinceHit = 0;
    h.hp -= amount; // integer model: no armor/shield mitigation
    if (h.hp <= 0) { h.hp = 0; this.s.alive = false; }
  };

  Sim.prototype._hero = function (dt) {
    const h = this.s.hero, st = this.stats, s = this.s;
    // hero is stationary at its spawn point — combat is positioning-free
    // derived max + regen
    h.hpMax = st.maxHp; if (h.hp > h.hpMax) h.hp = h.hpMax;
    h.sinceHit += dt;
    if (st.regen > 0 && h.hp < h.hpMax) h.hp = Math.min(h.hpMax, h.hp + st.regen * dt);
    // auto-attack nearest in range
    h.atkCd -= dt;
    if (h.atkCd <= 0 && s.enemies.length) {
      let best = null, bd = st.range;
      for (const e of s.enemies) { const d = Math.hypot(e.x - h.x, e.y - h.y); if (d < bd) { bd = d; best = e; } }
      if (best) {
        if (s.atkMode === 'lightning') { // dev: original instant hitscan, drawn as a beam
          best.hp -= st.rangedDamage; best.hitFlash = 0.12;
          if (best.behavior === 'bounce') best.kb = Math.max(best.kb, 0.25);
        } else {
          A.fireProjectile(s, h, best, st); // travelling bullet: damage lands on impact
        }
        h.atkCd = 1 / Math.max(0.1, st.fireRate);
      }
    }
  };

  Sim.prototype._enemies = function (dt) {
    const h = this.s.hero, st = this.stats;
    for (const e of this.s.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
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
        else { e.state = 'attack'; e.atkCd -= dt; if (e.atkCd <= 0) { this._hurtHero(e.dmg); e.atkCd = 1.2; } }
      } else { // stick
        if (d > touch) { e.state = 'approach'; e.x += dx / d * e.speed * dt; e.y += dy / d * e.speed * dt; }
        else { // resolve overlap, cling to hero, gnaw
          e.state = 'stuck';
          e.x = h.x - dx / d * touch; e.y = h.y - dy / d * touch;
          e.atkCd -= dt; if (e.atkCd <= 0) { this._hurtHero(e.dmg); e.atkCd = 0.8; }
        }
      }
    }
  };

  Sim.prototype._xpNeed = function () { return Math.round(20 * Math.pow(this.s.econ.level, 1.5)); };

  Sim.prototype._cleanup = function () {
    const s = this.s, keep = [];
    for (const e of s.enemies) {
      if (e.hp <= 0) {
        s.econ.kills++;
        const tg = A.TIERS[e.tier];
        const g = Math.round(tg.reward * this.stats.goldFind * e.strMult * (s.rewardMult || 1));
        s.econ.gold += g; s.econ.goldEarned += g;
        s.econ.xp += Math.round(2 * tg.reward * e.strMult * this.stats.xpGain);
      } else keep.push(e);
    }
    s.enemies = keep;
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
