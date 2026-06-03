/* src/render/enemies.ts — top-down ENEMY bodies, one drawer per enemy TYPE.

   The single source of truth for how every enemy looks, so an enemy reads identically in the
   live renderer (render/canvas2d.ts). Each enemy is a floating, wet, translucent "jelly" in
   its type colour; the slime trail behind it is owned by the caller (it needs per-id state).

   Type → silhouette (chosen from the design board):
     melee   → Marble    (glass sphere)
     fast    → Kite      (gem-rhombus, leans into travel)
     ranged  → Prism     (faceted hexagon, slow spin)
     tank    → Halo      (translucent ring / torus)
     boss    → Frogspawn (cluster of fused bubbles)
     splitter→ Trefoil   (wobbling three-lobed clover)

   drawEnemy(ctx, type, x, y, r, color, t, flash, facing): r = body radius in px, t = a
   render-only seconds clock for cosmetic motion, flash > 0 = a hit (body blooms white),
   facing = travel heading in radians. NONE of them draw a ground shadow — the caller owns it. */

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

const TAU = Math.PI * 2;
const INK: RGB = [12, 10, 22];

function hexRGB(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// mix a colour toward a target (default white); returns an [r,g,b]
function mix(hex: string | RGB, amt: number, target: RGB = [255, 255, 255]): RGB {
  const c = Array.isArray(hex) ? hex : hexRGB(hex);
  return [c[0] + (target[0] - c[0]) * amt, c[1] + (target[1] - c[1]) * amt, c[2] + (target[2] - c[2]) * amt];
}
function rgba(c: string | RGB, a: number): string {
  const v = Array.isArray(c) ? c : hexRGB(c);
  return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`;
}
function poly(ctx: Ctx, x: number, y: number, r: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
// a jiggly closed blob outline (used by the trefoil): a circle perturbed by sine lobes.
function pathBlob(ctx: Ctx, x: number, y: number, r: number, lobes: number, wob: number, t: number): void {
  const N = 36;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const rr = 1 + wob * Math.sin(a * lobes + t * 2.2);
    const px = x + Math.cos(a) * r * rr, py = y + Math.sin(a) * r * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// Fill the CURRENT path as translucent wet gel lit from the upper-left, then (optionally) ink the rim.
// On a hit (flash > 0) the body blooms white. Works for ring paths too (nonzero winding). Pass
// rim=false to skip the inked outline for a softer, borderless body.
function gelFill(ctx: Ctx, x: number, y: number, r: number, color: string, flash: number, coreA: number, rimA: number, rim = true): void {
  ctx.save();
  if (flash > 0) {
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = r * 1.1;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.38, r * 0.08, x, y, r * 1.06);
    g.addColorStop(0, rgba(mix(color, 0.6), coreA));
    g.addColorStop(0.55, rgba(color, coreA * 0.66));
    g.addColorStop(1, rgba(color, rimA));
    ctx.shadowColor = rgba(color, 0.8);
    ctx.shadowBlur = r * 0.7;
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  if (!rim) return;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.strokeStyle = flash > 0 ? 'rgba(255,255,255,0.9)' : rgba(mix(color, 0.4, INK), 0.5);
  ctx.stroke();
}
// the glossy specular hotspot that sells the "wet" look.
function sheen(ctx: Ctx, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.4, 0, x - r * 0.32, y - r * 0.4, r * 0.55);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(x - r * 0.3, y - r * 0.38);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.34, r * 0.24, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// melee — Marble: a near-perfect glass sphere with an inner caustic ring. Borderless (no inked rim)
// for a smoother basic-enemy read.
function marble(ctx: Ctx, x: number, y: number, r: number, color: string, flash: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  gelFill(ctx, x, y, r, color, flash, 0.72, 0.2, false);
  if (flash <= 0) {
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = rgba(mix(color, 0.7), 0.5);
    ctx.beginPath();
    ctx.arc(x + r * 0.12, y + r * 0.16, r * 0.55, -0.2, Math.PI * 0.9);
    ctx.stroke();
  }
  sheen(ctx, x, y, r);
}

// fast — Kite: a rounded gem-rhombus whose long axis leans into the travel direction.
function kite(ctx: Ctx, x: number, y: number, r: number, color: string, flash: number, facing: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  const a = r * 1.2, b = r * 0.78; // along-travel / across reach
  ctx.beginPath();
  ctx.moveTo(a, 0);
  ctx.lineTo(0, b);
  ctx.lineTo(-a, 0);
  ctx.lineTo(0, -b);
  ctx.closePath();
  gelFill(ctx, 0, 0, r, color, flash, 0.84, 0.24);
  if (flash <= 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(a * 0.85, 0);
    ctx.lineTo(0, b * 0.45);
    ctx.lineTo(-a * 0.3, 0);
    ctx.lineTo(0, -b * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ranged — Prism: a faceted hexagon of gel, internal facet lines, slow spin.
function prism(ctx: Ctx, x: number, y: number, r: number, color: string, t: number, flash: number): void {
  const rot = t * 0.4;
  poly(ctx, x, y, r, 6, rot);
  gelFill(ctx, x, y, r, color, flash, 0.74, 0.2);
  if (flash <= 0) {
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * TAU;
      ctx.strokeStyle = i % 2 ? rgba(mix(color, 0.8), 0.5) : rgba(mix(color, 0.4, INK), 0.3);
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.stroke();
    }
  }
  sheen(ctx, x, y, r);
}

// tank — Halo: a translucent ring; the reverse-wound inner arc punches a clean hole.
function halo(ctx: Ctx, x: number, y: number, r: number, color: string, flash: number): void {
  const inner = r * 0.46;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU, false);
  ctx.arc(x, y, inner, 0, TAU, true);
  gelFill(ctx, x, y, r, color, flash, 0.86, 0.34);
  if (flash <= 0) {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, (r + inner) / 2, Math.PI * 1.05, Math.PI * 1.5);
    ctx.stroke();
  }
}

// boss — Frogspawn: a cluster of fused bubbles, each with its own highlight.
function frogspawn(ctx: Ctx, x: number, y: number, r: number, color: string, t: number, flash: number): void {
  const blobs: [number, number, number][] = [
    [0, 0, 0.72], [-0.5, 0.2, 0.46], [0.5, 0.28, 0.5], [0.15, -0.5, 0.4], [-0.32, -0.42, 0.34],
  ];
  for (const [dx, dy, rr] of blobs) {
    const bx = x + dx * r + Math.sin(t * 2 + dx * 5) * r * 0.04;
    const by = y + dy * r + Math.cos(t * 2 + dy * 5) * r * 0.04;
    const br = r * rr;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, TAU);
    gelFill(ctx, bx, by, br, color, flash, 0.62, 0.2);
    if (flash <= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(bx - br * 0.32, by - br * 0.32, br * 0.18, 0, TAU);
      ctx.fill();
    }
  }
}

// splitter — Trefoil: a wobbling three-lobed clover of goo that turns as it drifts.
function trefoil(ctx: Ctx, x: number, y: number, r: number, color: string, t: number, flash: number): void {
  pathBlob(ctx, x, y, r * 0.82, 3, 0.28, t);
  gelFill(ctx, x, y, r, color, flash, 0.84, 0.26);
  sheen(ctx, x, y, r * 0.82);
}

export function drawEnemy(
  ctx: Ctx,
  type: string,
  x: number,
  y: number,
  r: number,
  color: string,
  t: number,
  flash: number,
  facing: number,
): void {
  switch (type) {
    case 'fast':
      kite(ctx, x, y, r, color, flash, facing);
      break;
    case 'ranged':
      prism(ctx, x, y, r, color, t, flash);
      break;
    case 'tank':
      halo(ctx, x, y, r, color, flash);
      break;
    case 'boss':
      frogspawn(ctx, x, y, r, color, t, flash);
      break;
    case 'splitter':
      trefoil(ctx, x, y, r, color, t, flash);
      break;
    case 'melee':
    default:
      marble(ctx, x, y, r, color, flash);
      break;
  }
}
