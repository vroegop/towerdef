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
import { drawGoldenBg, goldenBoltStyle, drawGoldenRing, drawMoat, drawCrystals } from './superpowers-fx';

const RANGE_PAD = 0.25; // frame out to 1.25× range so the fog edge (1.2×) and its dim silhouettes are on-screen
const FOG_VISION = 1.2; // vision edge as a multiple of range: inside = clear, outside = fog (enemies spawn at 1.4×)
const FOG_FADE = 0.2;   // over how many ×range past the vision edge an enemy fades from clear to full silhouette
const FOG_COLOR = '226,224,240'; // rgb of the fog overlay (soft warm-cool cloud white), alpha applied per-stop below
const BOTTOM_MARGIN = 0.4; // bottom 40% of the screen is reserved (upgrade menus) — tower stays in the top 60%
const TRAIL_LIFE = 0.32; // seconds a slime-trail dab lingers behind a moving enemy before it fully fades
const PLASMA_ARC_H = 48; // world-px peak height of a lobbed plasma orb (render-only; sim travels flat)
const PLASMA_R_PX = 7;   // base on-screen radius of a plasma orb before its apex swell

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
  // A per-wave info note: drifts up slowly above the tower and lingers longer than combat floats, so
  // it reads as a deliberate message rather than spilled combat text. Stays subtle (no note → nothing).
  function spawnNote(x: number, y: number, text: string, color: string): void {
    floats.push({ x, y, text, color, size: 14, life: 1.8, max: 1.8, vy: -16, vx: 0 });
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
    bolts.push({ pts, life: 0.2, max: 0.2 });
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
    // Player-set camera zoom (Settings slider): >1 magnifies the tower, <1 pulls back to reveal more
    // of the field. Defaults to 1 so the framing is unchanged unless the player moves the slider.
    const zoom = cfg.zoom && cfg.zoom > 0 ? cfg.zoom : 1;
    const baseScale = Math.min(W, availH) / (2 * range * (1 + RANGE_PAD)); // the zoom-1 fit
    const scale = baseScale * zoom;
    const hp = ipos(HERO_ID, s.hero.x, s.hero.y);
    let shx = 0,
      shy = 0;
    if (shakeT > 0) {
      const amp = 9 * (shakeT / 0.35);
      shx = (Math.random() - 0.5) * amp;
      shy = (Math.random() - 0.5) * amp;
      shakeT = Math.max(0, shakeT - rdt);
    }
    // Hero is a stationary tower at the arena centre, and the arena always exceeds the viewport, so no
    // edge-clamping is needed — we centre horizontally and anchor vertically. We keep the TOP of the
    // range ring at the same screen-y for any zoom: as the player zooms IN (the ring grows) the tower
    // slides down toward the screen centre so the margin above the ring stays about the same, rather
    // than the ring spilling off the top. (At zoom 1 this resolves to availH/2, the old framing.)
    const ringTopY = availH / 2 - range * baseScale; // fixed top-of-ring line, independent of zoom
    let towerY = ringTopY + range * scale;            // tower centre = ring top + current ring radius
    towerY = Math.min(towerY, H - 8);                 // safety: never let the tower slide off the bottom
    const ox = W / 2 - hp.x * scale + shx,
      oy = towerY - hp.y * scale + shy;
    const tx = (x: number): number => ox + x * scale,
      ty = (y: number): number => oy + y * scale;

    ctx.clearRect(0, 0, W, H);
    const hsx = tx(hp.x),
      hsy = ty(hp.y);
    // Endless battle-map: the arena has NO edges. It's a continuous parchment surface and the camera is
    // locked on the tower — the sim's arena box only decides where enemies spawn, never the visuals, so a
    // big range never reveals a border or a too-small map. Paint a tower-centred parchment glow across
    // the whole viewport, then a world-anchored grid that tiles to the screen edges. No clip, no border.
    const fg = ctx.createRadialGradient(hsx, hsy, 0, hsx, hsy, Math.hypot(W, H) * 0.75);
    fg.addColorStop(0, '#ecdcb6');
    fg.addColorStop(0.55, '#dcc596');
    fg.addColorStop(1, '#b89a62');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, W, H);
    // World-anchored grid covering the viewport; spacing doubles as needed so cells never collapse into
    // a dense mesh when the camera is zoomed far out at very high range.
    let gstep = 48; // world units between grid lines
    while (gstep * scale < 8) gstep *= 2;
    ctx.strokeStyle = 'rgba(90,60,25,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wx1 = (W - ox) / scale;
    for (let gx = Math.floor(-ox / scale / gstep) * gstep; gx <= wx1; gx += gstep) {
      const X = tx(gx);
      ctx.moveTo(X, 0);
      ctx.lineTo(X, H);
    }
    const wy1 = (H - oy) / scale;
    for (let gy = Math.floor(-oy / scale / gstep) * gstep; gy <= wy1; gy += gstep) {
      const Y = ty(gy);
      ctx.moveTo(0, Y);
      ctx.lineTo(W, Y);
    }
    ctx.stroke();

    drawGoldenBg(ctx, s, W, H); // Golden Lightning warm-dim tint
    drawMoat(ctx, s, hsx, hsy, scale, rdt, animClock); // Moat trench + caustic water (ground layer)

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

    const fogVisionWR = range * FOG_VISION; // world-px radius of the vision edge (clear inside, fog outside)
    for (const e of s.enemies) {
      const col = e.color;
      const ep = ipos(e.id, e.x, e.y),
        esx = tx(ep.x),
        esy = ty(ep.y);
      const er = e.r * scale;
      // Floor the body a touch so the wet detail stays legible once tokens get tiny when far-zoomed.
      const bodyR = Math.max(er, 6);
      // Fog of war: enemies beyond the vision edge are dim, blurred silhouettes that sharpen as they
      // cross inward; the spawn ring (1.4× range) sits out in fog so new enemies fade in rather than pop.
      const dw = Math.hypot(ep.x - hp.x, ep.y - hp.y); // world distance from the hero
      const fog = dw > fogVisionWR ? Math.min(1, (dw - fogVisionWR) / (range * FOG_FADE)) : 0;
      // Skip bodies clearly off the viewport (the spawn ring mostly sits outside the 1.25× frame) so a
      // big fogged crowd costs nothing — and avoid the per-body blur filter on things you can't see.
      const margin = bodyR + 40;
      if (esx < -margin || esx > W + margin || esy < -margin || esy > H + margin) {
        seen.set(e.id, e.hitFlash);
        continue;
      }
      const fogged = fog > 0.02;
      if (fogged) {
        ctx.save();
        ctx.globalAlpha = 1 - 0.4 * fog; // enemies stay visible through the cozy clouds (~0.6 alpha at full fog)
        ctx.filter = 'blur(' + (2.2 * fog).toFixed(2) + 'px)'; // a gentle, soft-cloud blur
      }
      drawEnemy(ctx, e.type, esx, esy, bodyR, col, animClock, e.hitFlash, e.facing);
      if (fogged) ctx.restore();
      const prev = seen.get(e.id) || 0;
      // Combat detail (sparks, bolts, damage numbers, rend pips, HP bars) only renders in the clear —
      // anything out in the fog stays a featureless shadow.
      if (!fogged && e.hitFlash > 0 && prev <= 0) {
        spawnSparks(esx, esy, col);
        if (s.atkMode === 'lightning') spawnBolt(hsx, hsy, esx, esy);
        if (cfg.damageNumbers && e.hitDmg) spawnFloat(esx, esy - bodyR - 4, '' + e.hitDmg, '#ffffff', 13);
      }
      seen.set(e.id, e.hitFlash);
      if (!fogged && e.rend > 0) {
        ctx.fillStyle = '#e64cff';
        const py = esy - bodyR - 9;
        for (let i = 0; i < e.rend; i++) {
          ctx.beginPath();
          ctx.arc(esx - (e.rend - 1) * 2.5 + i * 5, py, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // ---- status-effect overlays (the new on-hit skills, render-only) ----
      // Poison: a faint green wash over the body + a few venom bubbles rising off it.
      if (!fogged && (e.poisonT || 0) > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(80,220,90,0.16)';
        ctx.beginPath();
        ctx.arc(esx, esy, bodyR * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(130,245,140,0.85)';
        for (let i = 0; i < 3; i++) {
          const ph = (animClock * 1.3 + i * 0.66) % 1; // 0→1 rise cycle
          const bx = esx + Math.sin(animClock * 2 + i * 2.1) * bodyR * 0.4;
          const by = esy - bodyR * 0.2 - ph * bodyR * 1.4;
          ctx.globalAlpha = (1 - ph) * 0.8;
          ctx.beginPath();
          ctx.arc(bx, by, 1.4 + (1 - ph) * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      // Frostbite / slow: a ring of cool cyan frost ticks while the enemy is chilled (also reads a knockback slow).
      if (!fogged && e.slowT > 0 && e.slow < 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(130,215,255,0.55)';
        ctx.lineWidth = Math.max(1, bodyR * 0.1);
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + animClock * 0.4;
          const r1 = bodyR * 1.04,
            r2 = bodyR * 1.24;
          ctx.beginPath();
          ctx.moveTo(esx + Math.cos(a) * r1, esy + Math.sin(a) * r1);
          ctx.lineTo(esx + Math.cos(a) * r2, esy + Math.sin(a) * r2);
          ctx.stroke();
        }
        ctx.restore();
      }
      // Stun: two little sparkles orbiting just above the dazed enemy.
      if (!fogged && (e.stunT || 0) > 0) {
        ctx.save();
        ctx.strokeStyle = '#ffe06a';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        const cy = esy - bodyR - 6;
        for (let i = 0; i < 2; i++) {
          const a = animClock * 5 + i * Math.PI;
          const sx = esx + Math.cos(a) * bodyR * 0.7,
            sy = cy + Math.sin(a) * 2.2,
            sr = 2.6;
          ctx.beginPath();
          ctx.moveTo(sx - sr, sy);
          ctx.lineTo(sx + sr, sy);
          ctx.moveTo(sx, sy - sr);
          ctx.lineTo(sx, sy + sr);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (!fogged && cfg.enemyHp && e.hp < e.hpMax && e.hp > 0) {
        const bh = 3,
          bw = Math.max(30, bodyR * 2 + 8),
          by = esy - bodyR - bh - 5;
        drawHealthBar(ctx, esx, by, bw, bh, e.hp / e.hpMax);
      }
    }
    // Crystal Circle: orbiting crystals + flying shards. Drawn BEFORE the fog overlay so shards that
    // fly out past the vision edge get dimmed by the fog as they die there.
    drawCrystals(ctx, s, tx, ty, animClock);
    // Fog overlay: veil the world beyond the vision edge with a soft, semi-transparent cloud bank. Drawn
    // AFTER the enemies (so silhouettes sit under it) but BEFORE the projectiles, tower and range ring (so
    // those always stay crisp). It's a light, see-through haze — enemies stay readable through it — that
    // thickens gently toward the spawn ring rather than blacking the world out. Transparent at the edge.
    {
      const inner = fogVisionWR * scale;       // screen-px where the clouds begin
      const outer = range * 1.55 * scale;       // screen-px where the clouds reach full (still partial) density
      const fgrad = ctx.createRadialGradient(hsx, hsy, inner, hsx, hsy, outer);
      fgrad.addColorStop(0, 'rgba(' + FOG_COLOR + ',0)');
      fgrad.addColorStop(0.45, 'rgba(' + FOG_COLOR + ',0.22)'); // eased mid-stop keeps the falloff soft and fluffy
      fgrad.addColorStop(1, 'rgba(' + FOG_COLOR + ',0.58)');    // peak haze stays translucent so silhouettes read through
      ctx.fillStyle = fgrad;
      ctx.fillRect(0, 0, W, H);
      // a faint warm rim right at the vision edge so the boundary reads as a gentle horizon, not a hard wall
      ctx.strokeStyle = 'rgba(245,240,255,0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hsx, hsy, inner, 0, Math.PI * 2);
      ctx.stroke();
    }
    // drop hit-flash memory for enemies that no longer exist, so `seen` can't grow over a run
    for (const id of seen.keys()) if (!curPos.has(id)) seen.delete(id);

    ctx.fillStyle = '#fffbe6';
    ctx.strokeStyle = '#2a1c08';
    for (const p of s.projectiles) {
      if (p.kind === 'plasma') continue; // plasma orbs draw in their own pass (with glow), below
      const pp = ipos(p.id, p.x, p.y);
      const r = Math.max(1.5, p.r * 0.42 * scale);
      ctx.lineWidth = Math.max(1, r * 0.4);
      ctx.beginPath();
      ctx.arc(tx(pp.x), ty(pp.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Plasma Cannon orbs: a glowing cyan ball LOBBED at a boss. The sim travels flat (top-down), so we
    // fake the throw here — a parabolic height (sin over flight progress) lifts the orb on screen and
    // swells it, so it reads as arcing up and over the crowd before dropping onto the boss.
    for (const p of s.projectiles) {
      if (p.kind !== 'plasma') continue;
      const pp = ipos(p.id, p.x, p.y);
      const tgt = p.targetId != null ? s.enemies.find((e) => e.id === p.targetId) : undefined;
      const dist = tgt ? Math.hypot(tgt.x - p.x, tgt.y - p.y) : 0;
      const prog = p.dist0 ? Math.max(0, Math.min(1, 1 - dist / p.dist0)) : 1; // 0 at launch → 1 at impact
      const lift = Math.sin(prog * Math.PI); // 0 → 1 → 0 over the flight
      const cx = tx(pp.x),
        gy = ty(pp.y), // ground point (the orb's true world position)
        cy = gy - lift * PLASMA_ARC_H * scale; // lifted toward the viewer at the apex
      const r = PLASMA_R_PX * scale * (1 + 0.8 * lift); // swells near the apex (closer = bigger)
      // faint ground shadow so the height reads as a throw, not a teleport
      ctx.fillStyle = 'rgba(20,40,60,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx, gy, r * 0.7, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      // glowing orb
      ctx.save();
      ctx.shadowColor = '#37d7ff';
      ctx.shadowBlur = r * 2.2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, '#eafaff');
      g.addColorStop(0.45, '#37d7ff');
      g.addColorStop(1, 'rgba(55,160,255,0.15)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
      let noteStack = 0; // vertical stack offset so multiple per-wave notes don't overlap
      for (const f of s.fx) {
        if (f.seq <= lastFxSeq) continue;
        const fx = tx(f.x),
          fy = ty(f.y);
        // Lightning bolt on every kill event, so an enemy that dies INSTANTLY from the strike still flashes
        // a bolt (the hit-flash path below never sees it — it's already gone from s.enemies this frame).
        // Kill events carry the enemy's death position; non-kill events (interest/wave-skip) sit on the
        // hero, so their bolt is zero-length and invisible.
        if (s.atkMode === 'lightning' && (f.gold || f.coin)) spawnBolt(hsx, hsy, fx, fy);
        if (cfg.goldOnKill && f.gold) spawnFloat(fx, fy, '+' + f.gold, '#ffd24a', 12);
        if (cfg.coinOnKill && f.coin) spawnFloat(fx, fy - 12, '+' + f.coin, '#ff2e4e', 13);
        // Per-wave info notes (each gated by its own Display toggle). Stacked above the tower so
        // several in one wave don't overlap. Absent/disabled notes simply never appear.
        if (f.note) {
          const v = f.noteVal || 0;
          const ny = hsy - 58 - noteStack * 18;
          if (f.note === 'waveskip' && cfg.msgWaveSkip) { spawnNote(hsx, ny, 'Wave ' + v + ' skipped', '#9fd8ff'); noteStack++; }
          else if (f.note === 'interest' && cfg.msgInterest) { spawnNote(hsx, ny, '+' + v + ' interest', '#ffd24a'); noteStack++; }
          else if (f.note === 'hpskip' && cfg.msgEnemySkip) { spawnNote(hsx, ny, 'Enemy HP level skipped', '#7CFFB0'); noteStack++; }
          else if (f.note === 'dmgskip' && cfg.msgEnemySkip) { spawnNote(hsx, ny, 'Enemy attack level skipped', '#ffae4a'); noteStack++; }
          // Dodge is a fast combat pop (not a lingering wave note), so it uses a quick float at the tower.
          else if (f.note === 'dodge' && cfg.msgDodge !== false) spawnFloat(fx, fy - 26, 'Dodge!', '#7fe8ff', 13);
        }
      }
      lastFxSeq = s.fxSeq;
    }

    const h = s.hero;
    if (s.alive) {
      // Golden Lightning recolours the range ring to a rotating gold dash while its window is live.
      if (!drawGoldenRing(ctx, s, hsx, hsy, range * scale, animClock)) {
        ctx.strokeStyle = 'rgba(95,62,24,.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(hsx, hsy, range * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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

    const goldBolt = goldenBoltStyle(s); // gold recolor while Golden Lightning is active (null = white)
    for (const b of bolts) {
      b.life -= rdt;
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      ctx.beginPath();
      ctx.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i].x, b.pts[i].y);
      ctx.shadowColor = goldBolt ? goldBolt.glow : 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = goldBolt ? goldBolt.blur : 4;
      ctx.strokeStyle = goldBolt ? goldBolt.color : '#ffffff';
      ctx.lineWidth = goldBolt ? goldBolt.width : 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = goldBolt ? '#fffdf0' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    bolts = bolts.filter((b) => b.life > 0);

    if (floats.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Floats sit on the light parchment, where white damage numbers and golden gold gains wash out.
      // A soft dark drop shadow keeps every floating number legible against any background.
      ctx.shadowColor = 'rgba(0,0,0,.78)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      for (const f of floats) {
        f.x += f.vx * rdt;
        f.y += f.vy * rdt;
        f.life -= rdt;
        ctx.globalAlpha = Math.max(0, f.life / f.max);
        ctx.font = '700 ' + f.size + 'px Roboto, system-ui, sans-serif';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
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
