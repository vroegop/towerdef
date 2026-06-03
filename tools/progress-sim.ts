/* tools/progress-sim.ts — CLI front-end for the progression engine.
 *
 *   Run:  npm run sim:progress              (default "Balanced (Casual)" profile)
 *         npm run sim:progress -- "Tank"    (substring-match a profile from sim-dashboard/profiles.ts)
 *
 * Prints a per-tier progression table + CSV. The actual simulation lives in ../sim-engine (shared
 * with the Web-Worker dashboard), so behaviour is identical across both. See sim-engine.ts for the
 * model, and sim-dashboard/profiles.ts for the player profiles. */

import { runProgression, fmtBig, type TierRow, type Profile } from './sim-engine';
import { PROFILES } from './sim-dashboard/profiles';

const arg = process.argv.slice(2).join(' ').trim().toLowerCase();
const profile: Profile = (arg && PROFILES.find((p) => p.name.toLowerCase().includes(arg))) || PROFILES[0];

function printReport(rows: TierRow[], days: number, finalTier: number, name: string): void {
  const cols: [string, (r: TierRow) => string][] = [
    ['Tier', (r) => String(r.tier)],
    ['Reached(d)', (r) => r.reachedDay.toFixed(1)],
    ['Cap wave', (r) => r.capWave + (r.guard ? '+' : '')], // '+' = clearable past the compute guard
    ['Runs', (r) => String(r.runs)],
    ['Days', (r) => r.daysInTier.toFixed(1)],
    ['Coins', (r) => fmtBig(r.coins)],
    ['Gems', (r) => fmtBig(r.gems)],
    ['Vials', (r) => fmtBig(r.vials)],
    ['Atk', (r) => String(r.permA)],
    ['Def', (r) => String(r.permD)],
    ['Eco', (r) => String(r.permE)],
    ['Labs', (r) => String(r.labLv)],
    ['Cards', (r) => String(r.cards)],
    ['Spd', (r) => r.speed + 'x'],
    ['Next?', (r) => (r.advanced ? 'advance' : 'WALL')],
  ];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => f(r).length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padStart(widths[i])).join('  ');
  console.log(`\n=== Player progression — ${name} ===`);
  console.log(line(cols.map(([h]) => h)));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(cols.map(([, f]) => f(r))));
  console.log(`\nReached tier ${finalTier} in ${days.toFixed(1)} simulated days (${(days / 365).toFixed(2)} years).`);
  const csv = [cols.map(([h]) => h).join(',')]
    .concat(rows.map((r) => cols.map(([, f]) => f(r).replace(/∞/g, 'inf')).join(',')))
    .join('\n');
  console.log('\nCSV:\n' + csv);
}

let last = 0;
const { rows, days, finalTier } = runProgression({
  profile,
  onProgress: (e) => {
    if (e.kind === 'tier') {
      const r = e.rows[e.rows.length - 1];
      console.log(`tier ${r.tier}: ${r.advanced ? 'advance at' : 'WALL at'} wave ${r.capWave}${r.guard ? '+' : ''} ` +
        `(${r.runs} runs, ${r.daysInTier.toFixed(1)}d)`);
    } else if (e.kind === 'progress' && e.totalRuns - last >= 25) {
      last = e.totalRuns;
      console.log(`  [t${e.tier} run#${e.totalRuns} day ${e.day.toFixed(1)}] best ${e.tierBest} · ` +
        `coins ${fmtBig(e.coins)} · ${e.speed}x`);
    }
  },
});
printReport(rows, days, finalTier, profile.name);
