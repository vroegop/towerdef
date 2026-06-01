/* dev/chart.ts — a tiny dependency-free canvas line chart for the balance dashboard.
   THROWAWAY dev tooling: nothing in src/ imports this. Plots one curve sampled across a level
   range so you can eyeball its shape (linear vs exponential blow-up) and the marked current level.
   BOTH axes are strictly LINEAR on purpose: an exponential curve must LOOK exponential (flat then
   hockey-stick) so you can spot it — a log axis would hide exactly that. */

export interface ChartOpts {
  label: string;
  color?: string;
  markLevel?: number; // draw a vertical marker + dot at this x (level)
}

// Sample fn(level) for level in [0, maxLevel] at ~`samples` points and draw it.
export function drawCurve(
  canvas: HTMLCanvasElement,
  fn: (level: number) => number,
  maxLevel: number,
  opts: ChartOpts,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const W = canvas.clientWidth || 260,
    H = canvas.clientHeight || 120;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const padL = 44,
    padR = 8,
    padT = 16,
    padB = 18;
  const plotW = W - padL - padR,
    plotH = H - padT - padB;

  const N = Math.max(2, Math.min(120, maxLevel));
  const xs: number[] = [],
    ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const lvl = Math.round((i / N) * maxLevel);
    xs.push(lvl);
    ys.push(fn(lvl));
  }
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  // strictly linear Y: include 0 in the range so the curve's true shape (and any blow-up) is honest
  let lo = Math.min(0, minY),
    hi = Math.max(0, maxY);
  if (hi - lo < 1e-9) {
    hi = lo + 1;
    lo -= 1;
  }

  const px = (lvl: number): number => padL + (maxLevel ? (lvl / maxLevel) * plotW : 0);
  const py = (v: number): number => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  // frame + grid
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);
  ctx.fillStyle = 'rgba(220,225,235,.6)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  // y labels (top = range hi, bottom = range lo — the linear axis bounds, which include 0)
  const fmtY = (v: number): string => (Math.abs(v) >= 1000 ? v.toExponential(1) : +v.toPrecision(4) + '');
  ctx.textAlign = 'right';
  ctx.fillText(fmtY(hi), padL - 5, padT + 4);
  ctx.fillText(fmtY(lo), padL - 5, padT + plotH - 2);
  // x labels (0, max)
  ctx.textAlign = 'left';
  ctx.fillText('0', padL, H - 8);
  ctx.textAlign = 'right';
  ctx.fillText('lvl ' + maxLevel, W - padR, H - 8);

  // the curve
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const X = px(xs[i]),
      Y = py(ys[i]);
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.strokeStyle = opts.color || '#5fd0ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // current-level marker
  if (opts.markLevel != null && opts.markLevel >= 0 && opts.markLevel <= maxLevel) {
    const mx = px(opts.markLevel),
      mv = fn(opts.markLevel),
      myy = py(mv);
    ctx.strokeStyle = 'rgba(255,210,74,.5)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(mx, myy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // title
  ctx.fillStyle = 'rgba(220,225,235,.85)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(opts.label, padL, 11);
}
