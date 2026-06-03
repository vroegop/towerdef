/* src/render/superpowers-fx.ts — render layer for the Superpowers feature (Golden Lightning, Moat,
   Crystal Circle). Reads SIM state (deterministic) — never drives it. The art here is the set chosen
   during prototyping: Golden = thick gold bolts + gold dashed ring + warm dim; Moat = dug sand +
   pool-caustic water with feathered, organic (wobbly) edges; Crystal = shard-spike crystals + shards.

   Render-only animation state (water fill ramp, caustic tile, offscreen layer) lives here as module
   singletons — there is exactly one renderer. None of it affects the save or the sim. */
import type { State } from '../types';
import { PX_PER_METER } from '../sim/skills';
import { MOAT_INNER_M, superEnabled, trackValue } from '../sim/superpowers';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

// ============================ GOLDEN LIGHTNING ============================
export const goldenActive = (s: State): boolean => superEnabled(s.meta, 'golden') && (s.run.superActive?.golden || 0) > 0;

// warm gold-dim background tint (drawn just after the parchment+grid, before enemies).
export function drawGoldenBg(ctx: Ctx, s: State, W: number, H: number): void {
  if (!goldenActive(s)) return;
  ctx.save();
  ctx.fillStyle = 'rgba(46,30,2,0.3)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// gold-bolt style for the lightning FX pass (null = the renderer's default white).
export interface BoltStyle { glow: string; blur: number; color: string; width: number }
export function goldenBoltStyle(s: State): BoltStyle | null {
  return goldenActive(s) ? { glow: '#ffb000', blur: 12, color: '#ffd24a', width: 4.2 } : null;
}

// gold dashed rotating range ring; returns true if it drew one (renderer skips its default ring).
export function drawGoldenRing(ctx: Ctx, s: State, cx: number, cy: number, rPx: number, t: number): boolean {
  if (!goldenActive(s)) return false;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.4);
  ctx.shadowColor = '#ffcf4a';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = 'rgba(255,207,74,0.85)';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, rPx, 0, TAU);
  ctx.stroke();
  ctx.restore();
  return true;
}

// ============================ MOAT ============================
// Seamless caustic tile (zero-crossing web of summed sines), generated once.
let causticTile: HTMLCanvasElement | null = null;
function getCausticTile(): HTMLCanvasElement | null {
  if (causticTile) return causticTile;
  if (typeof document === 'undefined') return null;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(N, N);
  const d = img.data;
  const k = (n: number): number => (TAU * n) / N;
  const waves: [number, number, number][] = [[k(3), k(2), 0], [k(2), -k(3), 1.3], [k(4), k(1), 2.1], [k(1), -k(4), 0.7], [k(5), k(3), 3.4], [k(2), k(5), 5.0]];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [a, b, ph] of waves) v += Math.sin(x * a + y * b + ph);
      let r = 1 - Math.abs(v) / waves.length;
      r = Math.pow(Math.max(0, r), 7);
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(r * 255);
    }
  }
  g.putImageData(img, 0, 0);
  causticTile = c;
  return c;
}

// deterministic pebble scatter (polar so it adapts to any width).
const PEBBLES = (() => {
  let s = 1337;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: 90 }, () => ({ ang: rnd() * TAU, rf: rnd(), size: 1.3 + rnd() * 2.4, tone: rnd() }));
})();

// organic trench edges: per-angle radius wobble (static sum of sines).
const WOBBLE_OUT: [number, number, number][] = [[4, 0.7, 0.5], [7, 2.1, 0.3], [11, 4.3, 0.2]];
const WOBBLE_IN: [number, number, number][] = [[5, 1.9, 0.5], [9, 0.4, 0.3], [3, 3.7, 0.2]];
const ringAmp = (rIn: number, rOut: number): number => Math.max(3, Math.min(9, (rOut - rIn) * 0.13));
function wobbleR(set: [number, number, number][], theta: number, base: number, amp: number): number {
  let w = 0;
  for (const [f, p, wt] of set) w += Math.sin(theta * f + p) * wt;
  return base + amp * w;
}
function annulus(ctx: Ctx, cx: number, cy: number, rIn: number, rOut: number): void {
  const amp = ringAmp(rIn, rOut), N = 128;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, r = wobbleR(WOBBLE_OUT, th, rOut, amp);
    i ? ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r) : ctx.moveTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
  }
  ctx.closePath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, r = wobbleR(WOBBLE_IN, th, rIn, amp);
    i ? ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r) : ctx.moveTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
  }
  ctx.closePath();
}
function traceEdge(ctx: Ctx, set: [number, number, number][], cx: number, cy: number, base: number, amp: number, off: number): void {
  const N = 128;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, r = wobbleR(set, th, base, amp) + off;
    i ? ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r) : ctx.moveTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
  }
  ctx.closePath();
}

let waterLayer: { canvas: HTMLCanvasElement; ctx: Ctx } | null = null;
function getWaterLayer(main: HTMLCanvasElement): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === 'undefined') return null;
  if (!waterLayer) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (!g) return null;
    waterLayer = { canvas: c, ctx: g };
  }
  const { canvas, ctx } = waterLayer;
  if (canvas.width !== main.width || canvas.height !== main.height) {
    canvas.width = main.width;
    canvas.height = main.height;
  }
  const dpr = main.width / (main.clientWidth || main.width);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return waterLayer;
}

let moatWater = 0; // render-side fill level [0,1], lerped toward watered ? 1 : 0
// Moat ground (dry sand trench + animated caustic water). Drawn under enemies. rdt = real seconds
// since last frame (0 when paused). `t` = render clock for ripple shimmer.
export function drawMoat(ctx: Ctx, s: State, cx: number, cy: number, scale: number, rdt: number, t: number): void {
  if (!superEnabled(s.meta, 'moat')) {
    moatWater = 0;
    return;
  }
  const widthM = trackValue(s.meta, 'moat', 'width');
  const rIn = MOAT_INNER_M * PX_PER_METER * scale;
  const rOut = (MOAT_INNER_M + widthM) * PX_PER_METER * scale;
  const watered = (s.run.superActive?.moat || 0) > 0 ? 1 : 0;
  moatWater += (watered - moatWater) * Math.min(1, rdt * 3); // ~0.33s ramp
  // ---- dug-out sand: inner-edge shadow + sandy floor fading outward, with pebbles ----
  ctx.save();
  annulus(ctx, cx, cy, rIn, rOut);
  const bw = rOut - rIn;
  const g = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
  g.addColorStop(0, 'rgba(96,72,38,0.55)');
  g.addColorStop(Math.min(0.16, 14 / bw), 'rgba(150,124,80,0.32)');
  g.addColorStop(0.45, 'rgba(150,126,82,0.2)');
  g.addColorStop(1, 'rgba(150,126,82,0)');
  ctx.fillStyle = g;
  ctx.fill('evenodd');
  ctx.lineWidth = Math.max(1.5, Math.min(6, bw * 0.04));
  ctx.strokeStyle = 'rgba(70,50,24,0.5)';
  traceEdge(ctx, WOBBLE_IN, cx, cy, rIn, ringAmp(rIn, rOut), ctx.lineWidth * 0.5);
  ctx.stroke();
  annulus(ctx, cx, cy, rIn, rOut);
  ctx.clip('evenodd');
  for (const p of PEBBLES) {
    const r = rIn + p.rf * bw, px = cx + Math.cos(p.ang) * r, py = cy + Math.sin(p.ang) * r;
    const fade = Math.max(0, 1 - p.rf * 0.9);
    if (fade <= 0.02) continue;
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(50,36,16,0.35)';
    ctx.beginPath();
    ctx.ellipse(px + 1, py + 1.2, p.size, p.size * 0.8, 0, 0, TAU);
    ctx.fill();
    const tone = 150 - p.tone * 60;
    ctx.fillStyle = `rgb(${tone + 30},${tone + 12},${tone - 20})`;
    ctx.beginPath();
    ctx.ellipse(px, py, p.size, p.size * 0.8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // ---- caustic water on an offscreen layer, alpha-feathered to the wobbly edges ----
  if (moatWater <= 0.01) return;
  const layer = getWaterLayer(ctx.canvas);
  if (!layer) return;
  const gx = layer.ctx;
  gx.save();
  annulus(gx, cx, cy, rIn, rOut);
  gx.clip('evenodd');
  const a = moatWater;
  annulus(gx, cx, cy, rIn, rOut);
  const bg = gx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
  bg.addColorStop(0, `rgba(38,120,190,${(0.9 * a).toFixed(3)})`);
  bg.addColorStop(1, `rgba(28,150,205,${(0.85 * a).toFixed(3)})`);
  gx.fillStyle = bg;
  gx.fill('evenodd');
  const tile = getCausticTile();
  if (tile) {
    const bx = cx - rOut, by = cy - rOut, bs = rOut * 2;
    gx.save();
    gx.globalCompositeOperation = 'lighter';
    const p1 = gx.createPattern(tile, 'repeat');
    if (p1 && 'setTransform' in p1) {
      p1.setTransform(new DOMMatrix().translateSelf(t * 9, t * 5));
      gx.globalAlpha = 0.55 * a;
      gx.fillStyle = p1;
      gx.fillRect(bx, by, bs, bs);
    }
    const p2 = gx.createPattern(tile, 'repeat');
    if (p2 && 'setTransform' in p2) {
      p2.setTransform(new DOMMatrix().translateSelf(-t * 6, 90 - t * 3).scaleSelf(1.7, 1.7));
      gx.globalAlpha = 0.4 * a;
      gx.fillStyle = p2;
      gx.fillRect(bx, by, bs, bs);
    }
    gx.restore();
  }
  gx.restore();
  // feather edges in alpha via a blurred copy of the wobbly ring
  const blur = Math.max(4, Math.min(16, bw * 0.2));
  gx.save();
  gx.globalCompositeOperation = 'destination-in';
  gx.filter = `blur(${blur}px)`;
  gx.fillStyle = '#fff';
  annulus(gx, cx, cy, rIn, rOut);
  gx.fill('evenodd');
  gx.filter = 'none';
  gx.restore();
  ctx.drawImage(layer.canvas, 0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
}

// ============================ CRYSTAL CIRCLE ============================
const CRYSTAL_COL = '#37d7ff';
const CRYSTAL_ORBIT_FRAC = 0.5; // matches the sim's orbit radius so the drawn crystal sits where it collides

function drawShard(ctx: Ctx, x: number, y: number, r: number, rot: number, alpha: number): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = CRYSTAL_COL;
  ctx.shadowBlur = r * 1.7;
  const gr = ctx.createLinearGradient(0, -r * 1.6, 0, r * 1.2);
  gr.addColorStop(0, '#eaffff');
  gr.addColorStop(0.5, CRYSTAL_COL);
  gr.addColorStop(1, '#1f7fb0');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.7);
  ctx.lineTo(r * 0.42, r * 0.3);
  ctx.lineTo(0, r * 1.1);
  ctx.lineTo(-r * 0.42, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Crystals + shards. Positions come from the sim (crystal.ang, frag.x/y in world px) so the drawn
// shape sits exactly where collisions resolve. tx/ty map world→screen; CRYSTAL_R is screen px.
const CRYSTAL_R = 11;
export function drawCrystals(ctx: Ctx, s: State, tx: (x: number) => number, ty: (y: number) => number, t: number): void {
  if (!superEnabled(s.meta, 'crystal')) return;
  const spin = t * 1.6;
  if (s.crystals && s.crystals.length) {
    const orbitR = (s.hero.range || 0) * CRYSTAL_ORBIT_FRAC;
    let i = 0;
    for (const c of s.crystals) {
      i++;
      if (!c.alive) continue;
      const wx = s.hero.x + Math.cos(c.ang) * orbitR, wy = s.hero.y + Math.sin(c.ang) * orbitR;
      drawShard(ctx, tx(wx), ty(wy), CRYSTAL_R, spin + i, 1);
    }
  }
  if (s.crystalFrags && s.crystalFrags.length) {
    for (const fr of s.crystalFrags) drawShard(ctx, tx(fr.x), ty(fr.y), CRYSTAL_R * 0.6, spin, 0.95);
  }
}
