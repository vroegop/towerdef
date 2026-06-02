/* src/render/towers.ts — top-down TOWER skins, one draw fn per cosmetic id.

   The single source of truth for how every tower looks. Used by the in-game renderer
   (render/canvas2d.ts) AND the menu/picker (hud/hud.ts), so a skin reads identically everywhere.

   Each drawer is (ctx, cx, cy, r, t): r = tower radius in px, t = a render-only seconds clock for
   cosmetic motion (pulses / rotation / sparks). NONE of them draw a ground shadow — by request the
   towers sit flat on the map. Callers own the range ring, HP arc and rapid-fire cue around them. */

type Ctx = CanvasRenderingContext2D;
type TowerDraw = (ctx: Ctx, cx: number, cy: number, r: number, t: number) => void;

const TAU = Math.PI * 2;
const INK = 'rgba(38,26,10,0.85)';

// Mix a hex colour toward white (the lit face of a token).
function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  const m = (c: number): number => Math.round(c + (255 - c) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function poly(ctx: Ctx, x: number, y: number, r: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU,
      px = x + Math.cos(a) * r,
      py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function disc(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function inkRing(ctx: Ctx, x: number, y: number, r: number, w: number): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}
// the pulsing arcane/treasure core shared by several towers.
function core(ctx: Ctx, x: number, y: number, r: number, accent: string, t: number, intensity = 1): void {
  const pulse = 0.82 + 0.18 * Math.sin(t * 3);
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = r * 1.7 * pulse * intensity;
  const g = ctx.createRadialGradient(x - r * 0.12, y - r * 0.12, r * 0.04, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, accent);
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  disc(ctx, x, y, r * pulse);
  ctx.restore();
}
function rune(ctx: Ctx, x: number, y: number, s: number, color: string, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.18);
  ctx.shadowColor = color;
  ctx.shadowBlur = s * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.6, -s * 0.5);
  ctx.lineTo(s * 0.6, -s * 0.5);
  ctx.moveTo(0, -s * 0.5);
  ctx.lineTo(0, s * 0.5);
  ctx.moveTo(-s * 0.45, s * 0.5);
  ctx.lineTo(s * 0.45, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

// ============================ THE TOWERS ============================

// keep — Stone Keep: a round castle with crenellated walls, four corner turrets, an inner
// courtyard and a central keep flying a crimson pennant. The basic, magic-free starter.
function stoneKeep(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  // four corner turrets (drawn first so the curtain wall overlaps their bases)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const tx = cx + Math.cos(a) * R * 0.86,
      ty = cy + Math.sin(a) * R * 0.86,
      tr = R * 0.26;
    const tg = ctx.createRadialGradient(tx - tr * 0.4, ty - tr * 0.4, tr * 0.1, tx, ty, tr);
    tg.addColorStop(0, '#9a8d7c');
    tg.addColorStop(1, '#534b40');
    ctx.fillStyle = tg;
    disc(ctx, tx, ty, tr);
    ctx.fillStyle = '#6a6155';
    for (let m = 0; m < 6; m++) {
      const ma = (m / 6) * TAU;
      ctx.beginPath();
      ctx.arc(tx + Math.cos(ma) * tr, ty + Math.sin(ma) * tr, tr * 0.13, 0, TAU);
      ctx.fill();
    }
    inkRing(ctx, tx, ty, tr, 1.5);
  }
  // curtain wall
  const stone = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.15, cx, cy, R);
  stone.addColorStop(0, '#928677');
  stone.addColorStop(1, '#4a4339');
  ctx.fillStyle = stone;
  disc(ctx, cx, cy, R);
  // battlements around the rim
  const merlons = 12;
  ctx.fillStyle = '#5b5347';
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * TAU;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.rotate(a);
    ctx.fillRect(-R * 0.1, -R * 0.1, R * 0.2, R * 0.2);
    ctx.restore();
  }
  inkRing(ctx, cx, cy, R, 2);
  // courtyard ring
  ctx.fillStyle = '#6c6356';
  disc(ctx, cx, cy, R * 0.62);
  ctx.strokeStyle = 'rgba(38,26,10,0.6)';
  inkRing(ctx, cx, cy, R * 0.62, Math.max(2, R * 0.08));
  // central keep
  const keep = ctx.createRadialGradient(cx - R * 0.12, cy - R * 0.12, R * 0.05, cx, cy, R * 0.4);
  keep.addColorStop(0, '#a99c89');
  keep.addColorStop(1, '#5c5447');
  ctx.fillStyle = keep;
  disc(ctx, cx, cy, R * 0.38);
  inkRing(ctx, cx, cy, R * 0.38, 1.5);
  // arrow-slit windows on the keep
  ctx.strokeStyle = 'rgba(20,14,6,0.7)';
  ctx.lineWidth = Math.max(1, R * 0.04);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14);
    ctx.lineTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3);
    ctx.stroke();
  }
  // a small glowing blue sphere set in the keep's heart (gently pulsing)
  const orbR = R * 0.19 * (0.94 + 0.06 * Math.sin(t * 3));
  ctx.save();
  ctx.shadowColor = '#4aa8ff';
  ctx.shadowBlur = R * 0.45;
  const og = ctx.createRadialGradient(cx - orbR * 0.35, cy - orbR * 0.38, orbR * 0.1, cx, cy, orbR);
  og.addColorStop(0, '#dff0ff');
  og.addColorStop(0.5, '#4aa8ff');
  og.addColorStop(1, '#1c5fa8');
  ctx.fillStyle = og;
  disc(ctx, cx, cy, orbR);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(cx - orbR * 0.3, cy - orbR * 0.38, orbR * 0.3, orbR * 0.16, -0.5, 0, TAU);
  ctx.fill();
}

// prism — Prismatic Orb: a white sun-orb with three chromatic bubbles orbiting in pseudo-3D.
// Gem-bought; grants +crit chance.
function prismaticOrb(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const cols = ['#ff5db0', '#37d7ff', '#b07cff'];
  const baseR = R * 0.2;
  interface Bub { x: number; y: number; r: number; front: boolean; col: string }
  const bubbles: Bub[] = [];
  for (let i = 0; i < 3; i++) {
    const a = t * 1.3 + (i / 3) * TAU;
    const depth = Math.sin(a) * 0.5 + 0.5; // 0 (back) → 1 (front)
    bubbles.push({
      x: cx + Math.cos(a) * R * 0.82,
      y: cy + Math.sin(a) * R * 0.34, // squashed orbit → perspective
      r: baseR * (0.7 + 0.3 * depth),
      front: Math.sin(a) >= 0,
      col: cols[i],
    });
  }
  const drawBubble = (b: Bub): void => {
    ctx.save();
    ctx.globalAlpha = b.front ? 1 : 0.6;
    ctx.shadowColor = b.col;
    ctx.shadowBlur = b.r * 2;
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, b.col);
    g.addColorStop(1, b.col);
    ctx.fillStyle = g;
    disc(ctx, b.x, b.y, b.r);
    ctx.globalAlpha = b.front ? 1 : 0.6;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.24, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
  for (const b of bubbles) if (!b.front) drawBubble(b); // behind the orb
  // central white sun-orb
  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = R * 0.8 * (0.8 + 0.2 * Math.sin(t * 3));
  const g = ctx.createRadialGradient(cx - R * 0.22, cy - R * 0.26, R * 0.05, cx, cy, R * 0.62);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.65, '#eef3ff');
  g.addColorStop(1, '#c4d2e8');
  ctx.fillStyle = g;
  disc(ctx, cx, cy, R * 0.6);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.2, cy - R * 0.24, R * 0.18, R * 0.1, -0.5, 0, TAU);
  ctx.fill();
  for (const b of bubbles) if (b.front) drawBubble(b); // in front of the orb
}

// spire — Wizard's Spire: a tiled cone tapering to a spinning rune-star finial (violet).
function wizardSpire(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const base = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  base.addColorStop(0, '#6a5d7a');
  base.addColorStop(1, '#33293f');
  ctx.fillStyle = base;
  poly(ctx, cx, cy, R, 8, -Math.PI / 8);
  ctx.fill();
  const rings = 4;
  for (let i = 0; i < rings; i++) {
    const f = 1 - (i + 1) / (rings + 1);
    const rr = R * (0.92 - i * 0.2);
    ctx.fillStyle = lighten('#5a3f7a', 0.1 + f * 0.5);
    poly(ctx, cx, cy, rr, 8, -Math.PI / 8 + i * 0.18);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(30,18,40,0.6)';
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(20,12,30,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 8 + (i / 8) * TAU;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  ctx.stroke();
  core(ctx, cx, cy, R * 0.26, '#b07cff', t, 1.2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.6);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#c89cff';
  ctx.shadowBlur = R * 0.8;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU,
      rr = i % 2 ? R * 0.12 : R * 0.34;
    const px = Math.cos(a) * rr,
      py = Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  inkRing(ctx, cx, cy, R, 2);
}

// obelisk — Arcane Obelisk: a floating rune-monolith with glyphs orbiting (teal).
function arcaneObelisk(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const lift = Math.sin(t * 1.5) * R * 0.06;
  const oy = cy - lift;
  for (let i = 0; i < 3; i++) {
    const a = t * 0.9 + (i / 3) * TAU;
    if (Math.sin(a) >= 0) continue;
    rune(ctx, cx + Math.cos(a) * R * 1.15, oy + Math.sin(a) * R * 0.5, R * 0.18, 'rgba(56,224,208,0.5)', a);
  }
  ctx.save();
  ctx.translate(cx, oy);
  ctx.rotate(Math.PI / 4);
  const s = R * 0.95;
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, '#2b6f6a');
  g.addColorStop(0.5, '#1d4a47');
  g.addColorStop(1, '#0f2c2a');
  ctx.fillStyle = g;
  ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
  ctx.strokeStyle = '#38e0d0';
  ctx.shadowColor = '#38e0d0';
  ctx.shadowBlur = R * 0.5 * (0.7 + 0.3 * Math.sin(t * 4));
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, -s * 0.35);
  ctx.lineTo(-s * 0.3, s * 0.35);
  ctx.moveTo(-s * 0.3, 0);
  ctx.lineTo(s * 0.05, -s * 0.18);
  ctx.moveTo(s * 0.28, -s * 0.3);
  ctx.lineTo(s * 0.28, s * 0.3);
  ctx.moveTo(s * 0.1, s * 0.2);
  ctx.lineTo(s * 0.28, s * 0.05);
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const a = t * 0.9 + (i / 3) * TAU;
    if (Math.sin(a) < 0) continue;
    rune(ctx, cx + Math.cos(a) * R * 1.15, oy + Math.sin(a) * R * 0.5, R * 0.22, '#38e0d0', a);
  }
}

// heartwood — Druidic Heartwood: a living tree-stump with swaying leaves + a green sap-heart.
function heartwood(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + Math.sin(t * 1.2 + i) * 0.08;
    const lx = cx + Math.cos(a) * R * 1.02,
      ly = cy + Math.sin(a) * R * 1.02;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = i % 2 ? '#5a8a2a' : '#6fbf4a';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.16, R * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#5a3d22';
  disc(ctx, cx, cy, R);
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = i % 2 ? 'rgba(120,84,46,0.9)' : 'rgba(176,134,80,0.9)';
    ctx.lineWidth = R * 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.86 - i * 0.15), 0, TAU);
    ctx.stroke();
  }
  core(ctx, cx, cy, R * 0.32, '#7fe04a', t);
  inkRing(ctx, cx, cy, R, 2);
}

// forge — Dwarven Forge: a riveted hex furnace, flickering ember mouth, rising sparks.
function dwarvenForge(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#5a5650');
  g.addColorStop(1, '#2c2925');
  ctx.fillStyle = g;
  poly(ctx, cx, cy, R, 6, 0);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  poly(ctx, cx, cy, R * 0.74, 6, 0);
  ctx.lineWidth = R * 0.08;
  ctx.strokeStyle = '#6b6660';
  ctx.stroke();
  ctx.fillStyle = '#888079';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.74, cy + Math.sin(a) * R * 0.74, R * 0.06, 0, TAU);
    ctx.fill();
  }
  const flick = 0.85 + 0.15 * Math.sin(t * 17) + 0.05 * Math.sin(t * 31);
  ctx.save();
  ctx.shadowColor = '#ff7a2a';
  ctx.shadowBlur = R * 1.4 * flick;
  const fg = ctx.createRadialGradient(cx, cy, R * 0.04, cx, cy, R * 0.5);
  fg.addColorStop(0, '#fff3c0');
  fg.addColorStop(0.4, '#ff9a2a');
  fg.addColorStop(1, '#b3331f');
  ctx.fillStyle = fg;
  disc(ctx, cx, cy, R * 0.46 * flick);
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    const ph = (t * 0.9 + i * 0.37) % 1;
    const sx = cx + Math.sin(i * 2.3 + t) * R * 0.3;
    const sy = cy - ph * R * 1.3;
    ctx.globalAlpha = 1 - ph;
    ctx.fillStyle = ph < 0.5 ? '#ffd24a' : '#ff7a2a';
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  poly(ctx, cx, cy, R, 6, 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// sanctum — Cleric's Sanctum: a marble rotunda, pillar ring, halo + rotating sun-rays (gold).
function clericSanctum(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const halo = (t * 0.5) % 1;
  ctx.strokeStyle = `rgba(255,210,74,${(1 - halo) * 0.5})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R * (0.9 + halo * 0.5), 0, TAU);
  ctx.stroke();
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#fbf6e8');
  g.addColorStop(1, '#cdbf9a');
  ctx.fillStyle = g;
  disc(ctx, cx, cy, R);
  ctx.fillStyle = '#e7dcc2';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78, R * 0.1, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120,96,50,0.6)';
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.4);
  ctx.fillStyle = 'rgba(255,210,74,0.55)';
  ctx.shadowColor = '#ffd24a';
  ctx.shadowBlur = R * 0.6;
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.2);
    ctx.lineTo(R * 0.06, -R * 0.62);
    ctx.lineTo(-R * 0.06, -R * 0.62);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  core(ctx, cx, cy, R * 0.3, '#ffd24a', t, 1.2);
  inkRing(ctx, cx, cy, R, 2);
}

// necro — Necromancer's Eye: bone ribs around an eldritch slit-pupil eye, green wisps.
function necroEye(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  ctx.fillStyle = '#d8d2bd';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.26);
    ctx.lineTo(R * 0.1, R * 0.06);
    ctx.lineTo(-R * 0.1, R * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,55,40,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#3a3340');
  g.addColorStop(1, '#15121a');
  ctx.fillStyle = g;
  disc(ctx, cx, cy, R);
  for (let i = 0; i < 4; i++) {
    const a = -t * 1.3 + (i / 4) * TAU;
    ctx.fillStyle = 'rgba(110,240,122,0.5)';
    ctx.shadowColor = '#6ef07a';
    ctx.shadowBlur = R * 0.4;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7, R * 0.06, 0, TAU);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.shadowColor = '#6ef07a';
  ctx.shadowBlur = R * 0.9 * (0.7 + 0.3 * Math.sin(t * 2.5));
  ctx.fillStyle = '#0a160c';
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 0.5, R * 0.3, 0, 0, TAU);
  ctx.fill();
  const eg = ctx.createRadialGradient(cx, cy, R * 0.02, cx, cy, R * 0.3);
  eg.addColorStop(0, '#d8ffd0');
  eg.addColorStop(0.5, '#3dd06a');
  eg.addColorStop(1, '#0d6a2a');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.28, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#05120a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 0.05, R * 0.24, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  inkRing(ctx, cx, cy, R, 2);
}

// hoard — Dragon's Hoard: a wyrm coiled on a glowing pile of gold (crimson + gold). NEW for tier 7.
function dragonHoard(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  // gold hoard base
  const hg = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
  hg.addColorStop(0, '#ffe9a0');
  hg.addColorStop(0.6, '#e6b24a');
  hg.addColorStop(1, '#9a6a1a');
  ctx.fillStyle = hg;
  disc(ctx, cx, cy, R);
  // coin glints scattered on the hoard
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4,
      rr = R * (0.4 + ((i * 7) % 5) * 0.1);
    ctx.fillStyle = i % 2 ? '#fff4cf' : '#caa23a';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * 0.06, 0, TAU);
    ctx.fill();
  }
  // coiled dragon body: a thick scaled ring, broken to leave room for the head, slowly breathing
  const breathe = 1 + Math.sin(t * 1.6) * 0.015;
  const bodyR = R * 0.86 * breathe,
    bw = R * 0.26;
  const headA = -Math.PI * 0.5; // head points up
  ctx.save();
  ctx.lineCap = 'round';
  // body arc (leaves a gap at the head)
  const bg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  bg.addColorStop(0, '#b3331f');
  bg.addColorStop(0.5, '#7a1a12');
  bg.addColorStop(1, '#4a0f0a');
  ctx.strokeStyle = bg;
  ctx.lineWidth = bw;
  ctx.beginPath();
  ctx.arc(cx, cy, bodyR, headA + 0.5, headA + TAU - 0.15);
  ctx.stroke();
  // scale plates riding along the body
  for (let i = 0; i < 16; i++) {
    const a = headA + 0.6 + (i / 16) * (TAU - 0.8);
    const px = cx + Math.cos(a) * bodyR,
      py = cy + Math.sin(a) * bodyR;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = i % 2 ? '#d24a2a' : '#e8643a';
    ctx.beginPath();
    ctx.moveTo(0, -bw * 0.32);
    ctx.lineTo(bw * 0.28, bw * 0.18);
    ctx.lineTo(-bw * 0.28, bw * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // glowing treasure heart
  core(ctx, cx, cy, R * 0.28, '#ffcf4a', t, 1.1);
  // dragon head at the top of the coil: snout wedge + two horns + a slit eye
  const hx = cx + Math.cos(headA) * bodyR,
    hy = cy + Math.sin(headA) * bodyR;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(headA + Math.PI / 2);
  const hgr = ctx.createLinearGradient(0, -R * 0.3, 0, R * 0.2);
  hgr.addColorStop(0, '#e8643a');
  hgr.addColorStop(1, '#7a1a12');
  ctx.fillStyle = hgr;
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.34); // snout
  ctx.lineTo(R * 0.22, R * 0.12);
  ctx.lineTo(-R * 0.22, R * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // horns
  ctx.strokeStyle = '#f0d9a0';
  ctx.lineWidth = Math.max(1.5, R * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(R * 0.14, -R * 0.04);
  ctx.lineTo(R * 0.28, -R * 0.22);
  ctx.moveTo(-R * 0.14, -R * 0.04);
  ctx.lineTo(-R * 0.28, -R * 0.22);
  ctx.stroke();
  // glowing eyes
  ctx.fillStyle = '#ffe14a';
  ctx.shadowColor = '#ffae2a';
  ctx.shadowBlur = R * 0.3;
  ctx.beginPath();
  ctx.arc(R * 0.08, -R * 0.12, R * 0.035, 0, TAU);
  ctx.arc(-R * 0.08, -R * 0.12, R * 0.035, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// crystal — Crystal Conflux: ice-shards radiating from a twinkling faceted gem.
function crystalConflux(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = t * 0.25 + (i / n) * TAU;
    const len = R * (0.95 + 0.12 * Math.sin(i * 1.7));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, '#bff0ff');
    g.addColorStop(1, '#2a8fd0');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(R * 0.28, 0);
    ctx.lineTo(len * 0.55, -R * 0.14);
    ctx.lineTo(len, 0);
    ctx.lineTo(len * 0.55, R * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,60,90,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(R * 0.28, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = '#6fd0ff';
  ctx.shadowBlur = R * 1.2 * (0.7 + 0.3 * Math.sin(t * 3));
  const gg = ctx.createRadialGradient(cx - R * 0.1, cy - R * 0.1, R * 0.02, cx, cy, R * 0.4);
  gg.addColorStop(0, '#ffffff');
  gg.addColorStop(0.5, '#7fdcff');
  gg.addColorStop(1, '#2a7fc0');
  ctx.fillStyle = gg;
  poly(ctx, cx, cy, R * 0.38, 6, t * 0.4);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  poly(ctx, cx, cy, R * 0.38, 6, t * 0.4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,60,90,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = t * 0.4 + (i / 6) * TAU;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R * 0.38, cy + Math.sin(a) * R * 0.38);
  }
  ctx.stroke();
}

// watchtower — Ranger's Watchtower: log palisade, planked deck, three nocked arrows tracking.
function watchtower(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU;
    const lx = cx + Math.cos(a) * R * 0.92,
      ly = cy + Math.sin(a) * R * 0.92;
    ctx.fillStyle = '#7a5230';
    ctx.beginPath();
    ctx.arc(lx, ly, R * 0.16, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#4d3219';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,40,20,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(lx, ly, R * 0.08, 0, TAU);
    ctx.stroke();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.74, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#9a7048';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.strokeStyle = 'rgba(70,46,24,0.6)';
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - R, cy + i * R * 0.22);
    ctx.lineTo(cx + R, cy + i * R * 0.22);
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const a = t * 0.2 + (i / 3) * TAU;
    ctx.fillStyle = 'rgba(90,140,50,0.55)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.35, cy + Math.sin(a) * R * 0.35, R * 0.22, 0, TAU);
    ctx.fill();
  }
  const aim = Math.sin(t * 0.8) * 0.5;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const a = aim + i * 0.4;
    const tipx = cx + Math.cos(a) * R * 0.95,
      tipy = cy + Math.sin(a) * R * 0.95;
    const tailx = cx - Math.cos(a) * R * 0.2,
      taily = cy - Math.sin(a) * R * 0.2;
    ctx.strokeStyle = '#e8dcc0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tailx, taily);
    ctx.lineTo(tipx, tipy);
    ctx.stroke();
    ctx.fillStyle = '#c9c2ad';
    ctx.save();
    ctx.translate(tipx, tipy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-R * 0.12, -R * 0.06);
    ctx.lineTo(-R * 0.12, R * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#6b8a3a';
    ctx.beginPath();
    ctx.moveTo(tailx, taily);
    ctx.lineTo(tailx - Math.cos(a - 0.5) * R * 0.12, taily - Math.sin(a - 0.5) * R * 0.12);
    ctx.moveTo(tailx, taily);
    ctx.lineTo(tailx - Math.cos(a + 0.5) * R * 0.12, taily - Math.sin(a + 0.5) * R * 0.12);
    ctx.stroke();
  }
  inkRing(ctx, cx, cy, R, 2);
}

// nexus — Elemental Nexus: four element nodes ringing a swirling vortex.
function elementalNexus(ctx: Ctx, cx: number, cy: number, R: number, t: number): void {
  ctx.fillStyle = '#2a2630';
  disc(ctx, cx, cy, R);
  inkRing(ctx, cx, cy, R, 2);
  ctx.strokeStyle = 'rgba(180,160,120,0.5)';
  inkRing(ctx, cx, cy, R * 0.82, 1.5);
  const els = [
    { c: '#ff5a2a', g: '#ffb060' },
    { c: '#3aa0ff', g: '#bfe4ff' },
    { c: '#6fbf4a', g: '#c8eca0' },
    { c: '#dfeaf0', g: '#ffffff' },
  ];
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * TAU;
    const nx = cx + Math.cos(a) * R * 0.62,
      ny = cy + Math.sin(a) * R * 0.62;
    ctx.save();
    ctx.shadowColor = els[i].c;
    ctx.shadowBlur = R * 0.5;
    const ng = ctx.createRadialGradient(nx, ny, R * 0.02, nx, ny, R * 0.22);
    ng.addColorStop(0, els[i].g);
    ng.addColorStop(1, els[i].c);
    ctx.fillStyle = ng;
    poly(ctx, nx, ny, R * 0.2, 3, a + Math.PI / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = els[i].c;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = R * 0.1;
    ctx.lineCap = 'round';
    ctx.shadowColor = els[i].c;
    ctx.shadowBlur = R * 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.34, t * 1.2 + (i / 4) * TAU, t * 1.2 + (i / 4) * TAU + 1.1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  core(ctx, cx, cy, R * 0.16, '#ffffff', t, 1.4);
}

// ---- registry --------------------------------------------------------------------------------
export const TOWER_DRAW: Record<string, TowerDraw> = {
  keep: stoneKeep,
  prism: prismaticOrb,
  spire: wizardSpire,
  obelisk: arcaneObelisk,
  heartwood,
  forge: dwarvenForge,
  sanctum: clericSanctum,
  necro: necroEye,
  hoard: dragonHoard,
  crystal: crystalConflux,
  watchtower,
  nexus: elementalNexus,
};
// Draw a tower by cosmetic id, falling back to the basic keep for an unknown id.
export function drawTowerSkin(ctx: Ctx, id: string, cx: number, cy: number, r: number, t: number): void {
  (TOWER_DRAW[id] || stoneKeep)(ctx, cx, cy, r, t);
}
