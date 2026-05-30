/* renderers/canvas2d/renderer.js — simple-shapes renderer. Reads snapshots only.
   Owns ALL decorative effects (sparks, shatter, hit vignette, screen shake) and the
   camera (zoom-on-tower); they reset on reload by design.
   draw(snapshot, alpha, paused): alpha in [0,1) interpolates between sim ticks; paused
   freezes the decorative clock so every effect holds still for inspection. */
(function (A) {
  const VIEW_MARGIN = 1.5; // how much room around the range ring to show (bigger = more zoomed out)

  function drawShape(ctx, shape, x, y, r, color, facing, flash, veteran) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(facing || 0);
    ctx.lineWidth = 2; ctx.strokeStyle = color;
    ctx.fillStyle = flash > 0 ? '#ffffff' : color + '22';
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(0, 0, r, 0, Math.PI * 2);
    else if (shape === 'square') ctx.rect(-r, -r, r * 2, r * 2);
    else if (shape === 'triangle') { ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.8); ctx.lineTo(-r * 0.9, r * 0.8); ctx.closePath(); }
    else if (shape === 'hexagon') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3, px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    if (veteran) { // UI-only marker that this survivor has been aged up
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // rounded-rect path builder (calls beginPath); falls back if ctx.roundRect is missing
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // health bar with a red→yellow→green gradient track and the HP value readable inside it.
  // (cx, topY) = horizontal centre and top edge; frac in [0,1]; label is drawn centred.
  function drawHealthBar(ctx, cx, topY, w, h, frac, label) {
    frac = Math.max(0, Math.min(1, frac));
    const x = cx - w / 2, y = topY, r = Math.min(h / 2, 4);
    // dark track behind the fill
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
    // gradient fill, clipped to the rounded track and to the current fraction
    if (frac > 0) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, r); ctx.clip();
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#e5484d'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(1, '#3fc34d');
      ctx.fillStyle = g; ctx.fillRect(x, y, w * frac, h);
      ctx.restore();
    }
    // crisp outline
    roundRectPath(ctx, x, y, w, h, r);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.stroke();
    // HP number — white with a dark stroke so it stays legible over any fill colour
    ctx.font = '700 ' + Math.round(h * 0.74) + 'px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.strokeText(label, cx, y + h / 2 + 0.5);
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, cx, y + h / 2 + 0.5);
  }

  A.Canvas2DRenderer = function (canvas, settings) {
    const ctx = canvas.getContext('2d');
    settings = settings || {};     // shared by reference with the settings modal; toggles take effect live
    let sparks = [];               // UI-only particle pool (hits)
    let shards = [];               // UI-only fragment pool (kills)
    let bolts = [];                // UI-only lightning bolts (dev lightning mode)
    let floats = [];               // UI-only floating text (damage / gold / core on-kill)
    let lastFxSeq = -1;            // highest sim fx seq already consumed
    const seen = new Map();        // track hitFlash edges → fire sparks/bolts once per hit
    const prevEnemies = new Map(); // id → last-seen {screenX, screenY, color}; a vanished id = a kill
    let prevPos = new Map();       // id → world {x,y} at the END of the previous sim tick (for interpolation)
    let curPos = new Map();        // id → world {x,y} this frame (recaptured every draw)
    let lastTick = -1;             // detect run restarts (tick backwards) / offline jumps (big forward leap)
    let heroWasAlive = true;       // edge-detect the hero's death to explode it once
    let prevHp = null;             // edge-detect hero HP drops → hit feedback
    let hurt = 0;                  // red-vignette intensity (decays on the UI clock)
    let shakeT = 0;                // screen-shake time remaining
    let lastTs = performance.now();
    const HERO_ID = 0;             // reserved key (enemy/projectile ids start at 1)

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnSparks(x, y, color) {
      for (let i = 0; i < 5; i++) { const a = Math.random() * Math.PI * 2; sparks.push({ x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.35, color }); }
    }

    function spawnShatter(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 150, life = 0.5 + Math.random() * 0.3;
        shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12, size: 3 + Math.random() * 4, life, max: life, color });
      }
    }

    // floating text that rises and fades (damage numbers, gold/core on-kill)
    function spawnFloat(x, y, text, color, size) {
      floats.push({ x, y, text, color, size: size || 13, life: 0.9, max: 0.9, vy: -42 + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 16 });
    }

    function spawnBolt(x1, y1, x2, y2) {
      const segs = 6, pts = [{ x: x1, y: y1 }], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len; // unit perpendicular for the zigzag offset
      for (let i = 1; i < segs; i++) { const t = i / segs, j = (Math.random() - 0.5) * 16; pts.push({ x: x1 + dx * t + px * j, y: y1 + dy * t + py * j }); }
      pts.push({ x: x2, y: y2 });
      bolts.push({ pts, life: 0.12, max: 0.12 });
    }

    // capture every entity's world position this frame, keyed by id (hero = HERO_ID)
    function capture(s) {
      const m = new Map();
      m.set(HERO_ID, { x: s.hero.x, y: s.hero.y });
      for (const e of s.enemies) m.set(e.id, { x: e.x, y: e.y });
      for (const p of s.projectiles) m.set(p.id, { x: p.x, y: p.y });
      return m;
    }

    function draw(s, alpha, paused) {
      const now = performance.now(), rdt = paused ? 0 : Math.min((now - lastTs) / 1000, 0.05); lastTs = now;
      if (alpha == null) alpha = 1;
      // tick going backwards = a new run; a big forward leap = offline catch-up. Either way the
      // entity set is discontinuous, so resync trackers WITHOUT shattering or interpolating across the gap.
      const tickJump = s.tick - lastTick, resync = tickJump < 0 || tickJump > 90;
      if (s.tick !== lastTick) { prevPos = curPos; lastTick = s.tick; } // shift: last frame's positions become "previous tick"
      curPos = capture(s);                                              // current positions (recaptured every draw)

      // interpolated world position for an id, falling back to (fx,fy)
      const ipos = (id, fx, fy) => {
        const cur = curPos.get(id) || { x: fx, y: fy };
        if (resync) return cur;
        const prev = prevPos.get(id);
        if (!prev) return cur;
        return { x: prev.x + (cur.x - prev.x) * alpha, y: prev.y + (cur.y - prev.y) * alpha };
      };

      const W = canvas.clientWidth, H = canvas.clientHeight;
      // ---- camera: center on the tower, zoom by range, clamp so arena edges stay off-screen ----
      const range = (s.hero && s.hero.range) || (A.BASE_RANGE_M * A.PX_PER_METER);
      const coverScale = Math.max(W / s.arena.w, H / s.arena.h); // arena always covers the screen (no letterbox; spawns off-screen)
      const rangeScale = Math.min(W, H) / (2 * range * VIEW_MARGIN); // smaller range → zoom in; bigger range → zoom out
      const scale = Math.max(coverScale, rangeScale);
      const hp = ipos(HERO_ID, s.hero.x, s.hero.y);
      // screen shake nudges the whole scene (decays on the UI clock)
      let shx = 0, shy = 0;
      if (shakeT > 0) { const amp = 9 * (shakeT / 0.35); shx = (Math.random() - 0.5) * amp; shy = (Math.random() - 0.5) * amp; shakeT = Math.max(0, shakeT - rdt); }
      let ox = W / 2 - hp.x * scale + shx, oy = H / 2 - hp.y * scale + shy;
      const minOx = W - s.arena.w * scale, minOy = H - s.arena.h * scale; // keep the view inside the arena
      ox = Math.min(0, Math.max(minOx, ox)); oy = Math.min(0, Math.max(minOy, oy));
      const tx = (x) => ox + x * scale, ty = (y) => oy + y * scale;

      // ---- floor: radial glow centered on the tower (no arena border) ----
      ctx.clearRect(0, 0, W, H);
      const hsx = tx(hp.x), hsy = ty(hp.y);
      const fg = ctx.createRadialGradient(hsx, hsy, 0, hsx, hsy, Math.max(W, H) * 0.78);
      fg.addColorStop(0, '#121826'); fg.addColorStop(0.55, '#0a0e16'); fg.addColorStop(1, '#06080d');
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);

      // black hole effects (gameplay-authored position; visual is ours)
      for (const e of s.effects) {
        if (e.kind !== 'blackhole') continue;
        const g = ctx.createRadialGradient(tx(e.x), ty(e.y), 0, tx(e.x), ty(e.y), e.r * scale);
        g.addColorStop(0, 'rgba(230,76,255,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx(e.x), ty(e.y), e.r * scale, 0, Math.PI * 2); ctx.fill();
      }

      for (const e of s.enemies) {
        const col = A.TIERS[e.tier].color;
        const ep = ipos(e.id, e.x, e.y), esx = tx(ep.x), esy = ty(ep.y);
        const rot = e.shape === 'triangle' ? e.facing + Math.PI / 2 : 0;
        drawShape(ctx, e.shape, esx, esy, e.r * scale, col, rot, e.hitFlash, e.veteran);
        const prev = seen.get(e.id) || 0;
        if (e.hitFlash > 0 && prev <= 0) {
          spawnSparks(esx, esy, col);
          if (s.atkMode === 'lightning') spawnBolt(hsx, hsy, esx, esy);
          if (settings.damageNumbers && e.hitDmg) spawnFloat(esx, esy - e.r * scale - 4, '' + e.hitDmg, '#ffffff', 13);
        }
        seen.set(e.id, e.hitFlash);
        // enemy health bar (only once damaged) — gradient track with the HP value inside
        if (settings.enemyHp && e.hp < e.hpMax && e.hp > 0) {
          const bh = 12, bw = Math.max(30, e.r * scale * 2 + 8), by = esy - e.r * scale - bh - 5;
          drawHealthBar(ctx, esx, by, bw, bh, e.hp / e.hpMax, '' + Math.ceil(e.hp));
        }
      }

      // travelling bullets — small white dots, no trail (empty in lightning mode)
      ctx.fillStyle = '#ffffff';
      for (const p of s.projectiles) {
        const pp = ipos(p.id, p.x, p.y);
        ctx.beginPath(); ctx.arc(tx(pp.x), ty(pp.y), Math.max(1.5, p.r * 0.5 * scale), 0, Math.PI * 2); ctx.fill();
      }

      // kill shatter: an id seen last frame but gone now died (enemies only leave via death)
      if (!resync) {
        const live = new Set(); for (const e of s.enemies) live.add(e.id);
        const per = Math.max(5, Math.min(15, Math.round(15 - s.enemies.length * 0.25)));
        let budget = 60; // per-frame shard cap so a mass-death frame can't tank the framerate
        for (const [id, pe] of prevEnemies) {
          if (live.has(id) || budget <= 0) continue;
          const c = Math.min(per, budget); spawnShatter(pe.x, pe.y, pe.color, c); budget -= c;
        }
      }
      prevEnemies.clear();
      for (const e of s.enemies) { const ep = ipos(e.id, e.x, e.y); prevEnemies.set(e.id, { x: tx(ep.x), y: ty(ep.y), color: A.TIERS[e.tier].color }); }

      // per-kill drop indicators (gold / core) from the sim's transient fx channel
      if (resync) lastFxSeq = s.fxSeq || 0; // skip the offline/restart backlog
      else if (s.fx && s.fx.length) {
        for (const f of s.fx) {
          if (f.seq <= lastFxSeq) continue;
          const fx = tx(f.x), fy = ty(f.y);
          if (settings.goldOnKill && f.gold) spawnFloat(fx, fy, '+' + f.gold, '#ffd24a', 12);
          if (settings.coreOnKill && f.core) spawnFloat(fx, fy - 12, '+' + f.core, '#ff2e4e', 13);
          if (f.dodge) spawnFloat(fx, fy - 18, 'Dodge', '#5fd0ff', 13);
        }
        lastFxSeq = s.fxSeq;
      }

      const h = s.hero;
      if (s.alive) {
        // range ring (decorative) — reads the true range from the snapshot
        ctx.strokeStyle = 'rgba(74,168,255,.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(hsx, hsy, range * scale, 0, Math.PI * 2); ctx.stroke();
        drawShape(ctx, 'circle', hsx, hsy, h.r * scale, '#4aa8ff', 0, 0, false);
        // hp ring
        const frac = h.hpMax > 0 ? h.hp / h.hpMax : 0;
        ctx.strokeStyle = frac > 0.3 ? '#3ddc84' : '#ff5d6c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(hsx, hsy, (h.r + 6) * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      } else if (heroWasAlive) {
        spawnShatter(hsx, hsy, '#4aa8ff', 24); // the hero "explodes" once, like an enemy but bigger
      }
      heroWasAlive = s.alive;

      // ---- hero hit feedback: edge-detect an HP drop → red vignette + screen shake ----
      if (resync || prevHp === null) prevHp = h.hp; // don't flash on first frame or after an offline jump
      else if (s.alive && h.hp < prevHp - 0.001) { hurt = 1; shakeT = 0.35; prevHp = h.hp; }
      else if (h.hp > prevHp) prevHp = h.hp; // track regen so the next drop is detected

      // sparks (advanced on the UI clock, not the sim clock)
      for (const p of sparks) { p.x += p.vx * rdt; p.y += p.vy * rdt; p.life -= rdt; ctx.globalAlpha = Math.max(0, p.life / 0.35); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
      ctx.globalAlpha = 1;
      sparks = sparks.filter((p) => p.life > 0);

      // shatter fragments (kills) — spinning triangles in the enemy's colour
      for (const sh of shards) {
        sh.x += sh.vx * rdt; sh.y += sh.vy * rdt; sh.vx *= 0.96; sh.vy *= 0.96; sh.rot += sh.vr * rdt; sh.life -= rdt;
        ctx.globalAlpha = Math.max(0, sh.life / sh.max); ctx.fillStyle = sh.color;
        ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(sh.rot);
        const r = sh.size; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, r * 0.7); ctx.lineTo(-r * 0.8, r * 0.7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      shards = shards.filter((sh) => sh.life > 0);

      // lightning bolts (dev mode) — yellow, jagged, with a glowing shine
      for (const b of bolts) {
        b.life -= rdt; ctx.globalAlpha = Math.max(0, b.life / b.max);
        ctx.beginPath(); ctx.moveTo(b.pts[0].x, b.pts[0].y);
        for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i].x, b.pts[i].y);
        ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 9; ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 3; ctx.stroke(); // glowing body
        ctx.shadowBlur = 0; ctx.strokeStyle = '#fffbe6'; ctx.lineWidth = 1; ctx.stroke();                            // bright core (shine)
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      bolts = bolts.filter((b) => b.life > 0);

      // floating text (damage numbers, gold/core on-kill) — rises and fades on the UI clock
      if (floats.length) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const f of floats) {
          f.x += f.vx * rdt; f.y += f.vy * rdt; f.life -= rdt;
          ctx.globalAlpha = Math.max(0, f.life / f.max);
          ctx.font = '700 ' + f.size + 'px system-ui, sans-serif'; ctx.fillStyle = f.color;
          ctx.fillText(f.text, f.x, f.y);
        }
        ctx.globalAlpha = 1; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        floats = floats.filter((f) => f.life > 0);
      }

      // ---- red damage vignette (drawn in screen space, unaffected by shake) ----
      if (hurt > 0) {
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
        vg.addColorStop(0, 'rgba(255,40,60,0)'); vg.addColorStop(1, 'rgba(255,40,60,' + (0.55 * hurt).toFixed(3) + ')');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
        hurt = Math.max(0, hurt - rdt * 3);
      }
    }

    resize();
    window.addEventListener('resize', resize);
    return { resize, draw };
  };
})(window.ARENA = window.ARENA || {});
