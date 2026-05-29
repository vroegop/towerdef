/* renderers/canvas2d/renderer.js — simple-shapes renderer. Reads snapshots only.
   Owns ALL decorative effects (sparks, hero rings); they reset on reload by design. */
(function (A) {
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

  A.Canvas2DRenderer = function (canvas) {
    const ctx = canvas.getContext('2d');
    let sparks = [];               // UI-only particle pool (hits)
    let shards = [];               // UI-only fragment pool (kills)
    let bolts = [];                // UI-only lightning bolts (dev lightning mode)
    const seen = new Map();        // track hitFlash edges → fire sparks/bolts once per hit
    const prevEnemies = new Map(); // id → last-seen {screenX, screenY, color}; a vanished id = a kill
    let lastTick = -1;             // detect run restarts (tick backwards) / offline jumps (big forward leap)
    let heroWasAlive = true;       // edge-detect the hero's death to explode it once
    let lastTs = performance.now();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnSparks(x, y, color) {
      for (let i = 0; i < 5; i++) { const a = Math.random() * Math.PI * 2; sparks.push({ x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.35, color }); }
    }

    // Kill effect: shape-colored fragments that fly out, spin, and fade. `count` is chosen
    // adaptively by the caller so a crowded screen stays cheap.
    function spawnShatter(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 150, life = 0.5 + Math.random() * 0.3;
        shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12, size: 3 + Math.random() * 4, life, max: life, color });
      }
    }

    // Lightning bolt (dev mode): a jagged polyline frozen at fire time, fading fast.
    function spawnBolt(x1, y1, x2, y2) {
      const segs = 6, pts = [{ x: x1, y: y1 }], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len; // unit perpendicular for the zigzag offset
      for (let i = 1; i < segs; i++) { const t = i / segs, j = (Math.random() - 0.5) * 16; pts.push({ x: x1 + dx * t + px * j, y: y1 + dy * t + py * j }); }
      pts.push({ x: x2, y: y2 });
      bolts.push({ pts, life: 0.12, max: 0.12 });
    }

    function draw(s, paused) {
      const now = performance.now(), rdt = paused ? 0 : Math.min((now - lastTs) / 1000, 0.05); lastTs = now;
      // tick going backwards = a new run; a big forward leap = offline catch-up. Either way the
      // enemy set is discontinuous, so resync the kill-tracker WITHOUT shattering everything.
      const tickJump = s.tick - lastTick, resync = tickJump < 0 || tickJump > 90; lastTick = s.tick;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const scale = Math.min(W / s.arena.w, H / s.arena.h);
      const ox = (W - s.arena.w * scale) / 2, oy = (H - s.arena.h * scale) / 2;
      const tx = (x) => ox + x * scale, ty = (y) => oy + y * scale;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#090b11'; ctx.fillRect(ox, oy, s.arena.w * scale, s.arena.h * scale);
      ctx.strokeStyle = '#2a3350'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, s.arena.w * scale, s.arena.h * scale);

      // black hole effects (gameplay-authored position; visual is ours)
      for (const e of s.effects) {
        if (e.kind !== 'blackhole') continue;
        const g = ctx.createRadialGradient(tx(e.x), ty(e.y), 0, tx(e.x), ty(e.y), e.r * scale);
        g.addColorStop(0, 'rgba(230,76,255,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx(e.x), ty(e.y), e.r * scale, 0, Math.PI * 2); ctx.fill();
      }

      for (const e of s.enemies) {
        const col = A.TIERS[e.tier].color;
        const rot = e.shape === 'triangle' ? e.facing + Math.PI / 2 : 0;
        drawShape(ctx, e.shape, tx(e.x), ty(e.y), e.r * scale, col, rot, e.hitFlash, e.veteran);
        const prev = seen.get(e.id) || 0;
        if (e.hitFlash > 0 && prev <= 0) {
          spawnSparks(tx(e.x), ty(e.y), col);
          if (s.atkMode === 'lightning') spawnBolt(tx(s.hero.x), ty(s.hero.y), tx(e.x), ty(e.y));
        }
        seen.set(e.id, e.hitFlash);
      }

      // travelling bullets — small white dots, no trail (empty in lightning mode)
      ctx.fillStyle = '#ffffff';
      for (const p of s.projectiles) {
        ctx.beginPath(); ctx.arc(tx(p.x), ty(p.y), Math.max(1.5, p.r * 0.5 * scale), 0, Math.PI * 2); ctx.fill();
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
      for (const e of s.enemies) prevEnemies.set(e.id, { x: tx(e.x), y: ty(e.y), color: A.TIERS[e.tier].color });

      const h = s.hero;
      if (s.alive) {
        // range ring (decorative)
        ctx.strokeStyle = 'rgba(74,168,255,.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(tx(h.x), ty(h.y), 220 * scale, 0, Math.PI * 2); ctx.stroke();
        drawShape(ctx, 'circle', tx(h.x), ty(h.y), h.r * scale, '#4aa8ff', 0, 0, false);
        // hp ring
        const frac = h.hpMax > 0 ? h.hp / h.hpMax : 0;
        ctx.strokeStyle = frac > 0.3 ? '#3ddc84' : '#ff5d6c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(tx(h.x), ty(h.y), (h.r + 6) * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      } else if (heroWasAlive) {
        spawnShatter(tx(h.x), ty(h.y), '#4aa8ff', 24); // the hero "explodes" once, like an enemy but bigger
      }
      heroWasAlive = s.alive;

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
    }

    resize();
    window.addEventListener('resize', resize);
    return { resize, draw };
  };
})(window.ARENA = window.ARENA || {});
