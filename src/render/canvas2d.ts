/* src/render/canvas2d.ts — simple-shapes renderer. Reads snapshots only.
   Owns ALL decorative effects (sparks, shatter, hit vignette, screen shake) and the
   camera (zoom-on-tower); they reset on reload by design.
   draw(snapshot, alpha, paused): alpha in [0,1) interpolates between sim ticks; paused
   freezes the decorative clock so every effect holds still for inspection. */
import type { Settings, State } from '../types';
import { BASE_RANGE_M, PX_PER_METER } from '../sim/skills';
import { selectedCosmeticId } from '../sim/cosmetics';
import { drawTowerSkin } from './towers';
import { drawEnemy } from './enemies';

const RANGE_PAD = 0.1; // fraction of range kept as padding outside the ring so bounced enemies stay visible
const BOTTOM_MARGIN = 0.4; // bottom 40% of the screen is reserved (upgrade menus) — tower stays in the top 60%
const TRAIL_LIFE = 0.32; // seconds a slime-trail dab lingers behind a moving enemy before it fully fades

type Ctx = CanvasRenderingContext2D;
interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; life: number; max: number; color: string }
interface Bolt { pts: { x: number; y: number }[]; life: number; max: number }
interface Float { x: number; y: number; text: string; color: string; size: number; life: number; max: number; vy: number; vx: number }
interface Pos { x: number; y: number }

export interface Renderer {
  resize(): void;
  draw(s: State, alpha: number, paused: boolean): void;
}

// thin health bar: solid red for current HP, white for the HP lost. No number, no gradient.
function drawHealthBar(ctx: Ctx, cx: number, topY: number, w: number, h: number, frac: number): void {
  frac = Math.max(0, Math.min(1, frac));
  const x = cx - w / 2;
  // white track = the HP that has been lost
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, topY, w, h);
  // solid red = the HP that remains
  if (frac > 0) {
    ctx.fillStyle = '#e5484d';
    ctx.fillRect(x, topY, w * frac, h);
  }
}

// Soft contact shadow under a token — the main cue that sells "3D body on a flat map".
function drawShadow(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(40,28,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.55, r * 1.05, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function Canvas2DRenderer(canvas: HTMLCanvasElement, settings?: Partial<Settings>): Renderer {
  const ctx = canvas.getContext('2d') as Ctx;
  const cfg: Partial<Settings> = settings || {};
  let sparks: Spark[] = [];
  let shards: Shard[] = [];
  let bolts: Bolt[] = [];
  let floats: Float[] = [];
  let lastFxSeq = -1;
  const seen = new Map<number, number>();
  const prevEnemies = new Map<number, { x: number; y: number; color: string }>();
  const trails = new Map<number, { x: number; y: number; born: number }[]>();
  let prevPos = new Map<number, Pos>();
  let curPos = new Map<number, Pos>();
  let lastTick = -1;
  let heroWasAlive = true;
  let prevHp: number | null = null;
  let hurt = 0;
  let shakeT = 0;
  let animClock = 0; // render-only clock for cosmetic effects (orbiting motes, wind, core pulse)
  let lastTs = performance.now();
  const HERO_ID = 0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnSparks(x: number, y: number, color: string): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      sparks.push({ x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.35, color });
    }
  }

  function spawnShatter(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        sp = 90 + Math.random() * 150,
        life = 0.5 + Math.random() * 0.3;
      shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12, size: 3 + Math.random() * 4, life, max: life, color });
    }
  }

  function spawnFloat(x: number, y: number, text: string, color: string, size?: number): void {
    floats.push({ x, y, text, color, size: size || 13, life: 0.9, max: 0.9, vy: -42 + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 16 });
  }

  function spawnBolt(x1: number, y1: number, x2: number, y2: number): void {
    const segs = 6,
      pts = [{ x: x1, y: y1 }],
      dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy) || 1;
    const px = -dy / len,
      py = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs,
        j = (Math.random() - 0.5) * 16;
      pts.push({ x: x1 + dx * t + px * j, y: y1 + dy * t + py * j });
    }
    pts.push({ x: x2, y: y2 });
    bolts.push({ pts, life: 0.12, max: 0.12 });
  }

  function capture(s: State): Map<number, Pos> {
    const m = new Map<number, Pos>();
    m.set(HERO_ID, { x: s.hero.x, y: s.hero.y });
    for (const e of s.enemies) m.set(e.id, { x: e.x, y: e.y });
    for (const p of s.projectiles) m.set(p.id, { x: p.x, y: p.y });
    return m;
  }

  function draw(s: State, alpha: number, paused: boolean): void {
    const now = performance.now(),
      rdt = paused ? 0 : Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;
    animClock += rdt;
    if (alpha == null) alpha = 1;
    const tickJump = s.tick - lastTick,
      resync = tickJump < 0 || tickJump > 90;
    if (s.tick !== lastTick) {
      prevPos = curPos;
      lastTick = s.tick;
    }
    curPos = capture(s);

    const ipos = (id: number, fx: number, fy: number): Pos => {
      const cur = curPos.get(id) || { x: fx, y: fy };
      if (resync) return cur;
      const prev = prevPos.get(id);
      if (!prev) return cur;
      return { x: prev.x + (cur.x - prev.x) * alpha, y: prev.y + (cur.y - prev.y) * alpha };
    };

    const W = canvas.clientWidth,
      H = canvas.clientHeight;
    const range = (s.hero && s.hero.range) || BASE_RANGE_M * PX_PER_METER;
    // The bottom 40% of the screen is reserved as margin (the upgrade menus live there), so the
    // tower never sits down among them. We fit the range ring + 10% padding into the width AND the
    // TOP 60% of the height, then centre the tower within that top band. Slight ring overlap into
    // the bottom band is fine; the tower body stays up top.
    const availH = H * (1 - BOTTOM_MARGIN);
    const scale = Math.min(W, availH) / (2 * range * (1 + RANGE_PAD));
    const hp = ipos(HERO_ID, s.hero.x, s.hero.y);
    let shx = 0,
      shy = 0;
    if (shakeT > 0) {
      const amp = 9 * (shakeT / 0.35);
      shx = (Math.random() - 0.5) * amp;
      shy = (Math.random() - 0.5) * amp;
      shakeT = Math.max(0, shakeT - rdt);
    }
    // Hero is a stationary tower at the arena centre, and the arena always exceeds the viewport, so
    // no edge-clamping is needed — we just centre horizontally and within the top 60% vertically.
    const ox = W / 2 - hp.x * scale + shx,
      oy = availH / 2 - hp.y * scale + shy;
    const tx = (x: number): number => ox + x * scale,
      ty = (y: number): number => oy + y * scale;

    ctx.clearRect(0, 0, W, H);
    const hsx = tx(hp.x),
      hsy = ty(hp.y);
    // Dark void beyond the map edges.
    ctx.fillStyle = '#0b0d0a';
    ctx.fillRect(0, 0, W, H);
    // Parchment battle-map: the arena rect (world 0..w, 0..h) painted as worn parchment with a
    // warm glow under the hero, a faint grid, and an inked border. Everything is clipped to the
    // arena so the surrounding void stays dark.
    const aL = tx(0),
      aT = ty(0),
      aW = s.arena.w * scale,
      aH = s.arena.h * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(aL, aT, aW, aH);
    ctx.clip();
    const fg = ctx.createRadialGradient(hsx, hsy, 0, hsx, hsy, Math.max(aW, aH) * 0.75);
    fg.addColorStop(0, '#ecdcb6');
    fg.addColorStop(0.55, '#dcc596');
    fg.addColorStop(1, '#b89a62');
    ctx.fillStyle = fg;
    ctx.fillRect(aL, aT, aW, aH);
    const GRID = 48; // world units between grid lines
    ctx.strokeStyle = 'rgba(90,60,25,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= s.arena.w + 0.5; gx += GRID) {
      const X = tx(gx);
      ctx.moveTo(X, aT);
      ctx.lineTo(X, aT + aH);
    }
    for (let gy = 0; gy <= s.arena.h + 0.5; gy += GRID) {
      const Y = ty(gy);
      ctx.moveTo(aL, Y);
      ctx.lineTo(aL + aW, Y);
    }
    ctx.stroke();
    // Inked inner border / map vignette.
    ctx.strokeStyle = 'rgba(60,40,15,.55)';
    ctx.lineWidth = 6;
    ctx.strokeRect(aL + 3, aT + 3, aW - 6, aH - 6);
    ctx.restore();

    // Slime trails — a quick-fading smear of colour behind each moving enemy, drawn UNDER the
    // bodies. Per-id screen-space history; each dab fades out over TRAIL_LIFE seconds (frozen on pause).
    for (const e of s.enemies) {
      const ep = ipos(e.id, e.x, e.y),
        sx = tx(ep.x),
        sy = ty(ep.y),
        er = e.r * scale;
      let tr = trails.get(e.id);
      if (!tr) trails.set(e.id, (tr = []));
      const last = tr[tr.length - 1];
      if (!last || Math.hypot(sx - last.x, sy - last.y) > Math.max(er * 0.5, 3)) tr.push({ x: sx, y: sy, born: animClock });
      while (tr.length && animClock - tr[0].born > TRAIL_LIFE) tr.shift();
      for (const p of tr) {
        const frac = 1 - (animClock - p.born) / TRAIL_LIFE; // newest ≈ 1
        if (frac <= 0) continue;
        const rr = Math.max(er, 4) * (0.28 + 0.5 * frac);
        ctx.globalAlpha = 0.3 * frac;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rr, rr * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const id of trails.keys()) if (!curPos.has(id)) trails.delete(id);

    for (const e of s.enemies) {
      const col = e.color;
      const ep = ipos(e.id, e.x, e.y),
        esx = tx(ep.x),
        esy = ty(ep.y);
      const er = e.r * scale;
      // Floor the body a touch so the wet detail stays legible once tokens get tiny.
      const bodyR = Math.max(er, 4);
      drawShadow(ctx, esx, esy, bodyR);
      drawEnemy(ctx, e.type, esx, esy, bodyR, col, animClock, e.hitFlash, e.facing);
      const prev = seen.get(e.id) || 0;
      if (e.hitFlash > 0 && prev <= 0) {
        spawnSparks(esx, esy, col);
        if (s.atkMode === 'lightning') spawnBolt(hsx, hsy, esx, esy);
        if (cfg.damageNumbers && e.hitDmg) spawnFloat(esx, esy - bodyR - 4, '' + e.hitDmg, '#ffffff', 13);
      }
      seen.set(e.id, e.hitFlash);
      if (e.rend > 0) {
        ctx.fillStyle = '#e64cff';
        const py = esy - bodyR - 9;
        for (let i = 0; i < e.rend; i++) {
          ctx.beginPath();
          ctx.arc(esx - (e.rend - 1) * 2.5 + i * 5, py, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (cfg.enemyHp && e.hp < e.hpMax && e.hp > 0) {
        const bh = 3,
          bw = Math.max(30, bodyR * 2 + 8),
          by = esy - bodyR - bh - 5;
        drawHealthBar(ctx, esx, by, bw, bh, e.hp / e.hpMax);
      }
    }
    // drop hit-flash memory for enemies that no longer exist, so `seen` can't grow over a run
    for (const id of seen.keys()) if (!curPos.has(id)) seen.delete(id);

    ctx.fillStyle = '#ffffff';
    for (const p of s.projectiles) {
      const pp = ipos(p.id, p.x, p.y);
      ctx.beginPath();
      ctx.arc(tx(pp.x), ty(pp.y), Math.max(1, p.r * 0.32 * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    if (!resync) {
      const live = new Set<number>();
      for (const e of s.enemies) live.add(e.id);
      const per = Math.max(5, Math.min(15, Math.round(15 - s.enemies.length * 0.25)));
      let budget = 60;
      for (const [id, pe] of prevEnemies) {
        if (live.has(id) || budget <= 0) continue;
        const c = Math.min(per, budget);
        spawnShatter(pe.x, pe.y, pe.color, c);
        budget -= c;
      }
    }
    prevEnemies.clear();
    for (const e of s.enemies) {
      const ep = ipos(e.id, e.x, e.y);
      prevEnemies.set(e.id, { x: tx(ep.x), y: ty(ep.y), color: e.color });
    }

    if (resync) lastFxSeq = s.fxSeq || 0;
    else if (s.fx && s.fx.length) {
      for (const f of s.fx) {
        if (f.seq <= lastFxSeq) continue;
        const fx = tx(f.x),
          fy = ty(f.y);
        if (cfg.goldOnKill && f.gold) spawnFloat(fx, fy, '+' + f.gold, '#ffd24a', 12);
        if (cfg.coinOnKill && f.coin) spawnFloat(fx, fy - 12, '+' + f.coin, '#ff2e4e', 13);
      }
      lastFxSeq = s.fxSeq;
    }

    const h = s.hero;
    if (s.alive) {
      ctx.strokeStyle = 'rgba(95,62,24,.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(hsx, hsy, range * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // the hero IS the tower: draw the player's selected skin (shadow-free) at the arena centre.
      drawTowerSkin(ctx, selectedCosmeticId(s.meta, 'tower'), hsx, hsy, h.r * scale, animClock);
      // rapid-fire cue (replaces the old gold-core tint): a pulsing gold ring while Burst is up.
      if (s.run && s.run.rapidT > 0) {
        const pr = 0.85 + 0.15 * Math.sin(animClock * 8);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,210,74,' + (0.6 * pr).toFixed(2) + ')';
        ctx.shadowColor = '#ffd24a';
        ctx.shadowBlur = 12 * pr;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(hsx, hsy, h.r * scale * 1.14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      const frac = h.hpMax > 0 ? h.hp / h.hpMax : 0;
      ctx.strokeStyle = frac > 0.3 ? '#3ddc84' : '#ff5d6c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hsx, hsy, (h.r + 6) * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    } else if (heroWasAlive) {
      spawnShatter(hsx, hsy, '#4aa8ff', 24);
    }
    heroWasAlive = s.alive;

    if (resync || prevHp === null) prevHp = h.hp;
    else if (s.alive && h.hp < prevHp - 0.001) {
      hurt = 1;
      shakeT = 0.35;
      prevHp = h.hp;
    } else if (h.hp > prevHp) prevHp = h.hp;

    for (const p of sparks) {
      p.x += p.vx * rdt;
      p.y += p.vy * rdt;
      p.life -= rdt;
      ctx.globalAlpha = Math.max(0, p.life / 0.35);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    sparks = sparks.filter((p) => p.life > 0);

    for (const sh of shards) {
      sh.x += sh.vx * rdt;
      sh.y += sh.vy * rdt;
      sh.vx *= 0.96;
      sh.vy *= 0.96;
      sh.rot += sh.vr * rdt;
      sh.life -= rdt;
      ctx.globalAlpha = Math.max(0, sh.life / sh.max);
      ctx.fillStyle = sh.color;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      const r = sh.size;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.8, r * 0.7);
      ctx.lineTo(-r * 0.8, r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    shards = shards.filter((sh) => sh.life > 0);

    for (const b of bolts) {
      b.life -= rdt;
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.beginPath();
      ctx.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i].x, b.pts[i].y);
      ctx.shadowColor = '#ffd24a';
      ctx.shadowBlur = 9;
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fffbe6';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    bolts = bolts.filter((b) => b.life > 0);

    if (floats.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const f of floats) {
        f.x += f.vx * rdt;
        f.y += f.vy * rdt;
        f.life -= rdt;
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        ctx.font = '700 ' + f.size + 'px system-ui, sans-serif';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      floats = floats.filter((f) => f.life > 0);
    }

    if (hurt > 0) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
      vg.addColorStop(0, 'rgba(255,40,60,0)');
      vg.addColorStop(1, 'rgba(255,40,60,' + (0.55 * hurt).toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      hurt = Math.max(0, hurt - rdt * 3);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { resize, draw };
}
