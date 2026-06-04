/* tools/superweapons-dashboard/planner.ts — the "suggest upgrades" brain (pure functions).
 *
 * Given a catalog + an Energy budget, work out a concrete shopping list: which weapon to unlock next
 * and which track levels to buy, in order, until the Energy runs out. Two strategies model the two
 * natural play styles — "cheapest" deepens whatever is cheapest right now; "breadth" unlocks every
 * power it can before leveling. A separate efficiency view ranks which knobs give the most value per
 * Energy, as a design aid for spotting over/under-priced tracks. */

import type { Catalog, DraftTrack, DraftWeapon } from './weapons';
import { trackCostAt, trackValue, unlockCostAt } from './weapons';

export type Strategy = 'cheapest' | 'breadth';

export interface PlanStep {
  kind: 'unlock' | 'level';
  weaponId: string;
  weaponName: string;
  art: string;
  trackId?: string;
  trackLabel?: string;
  toLevel?: number; // for 'level': the level the track reaches (1-based)
  cost: number;
  cumulative: number;
}
export interface PlanResult {
  steps: PlanStep[];
  spent: number;
  remaining: number;
  unlocked: string[]; // weapon ids unlocked, in purchase order
  levels: Record<string, Record<string, number>>; // weaponId → trackId → level reached
}

const STEP_CAP = 4000; // guard against pathological (free) curves looping forever

// Build a shopping list. `include` is the set of weapon ids the planner may spend on (catalog order is
// the purchase priority). Weapons not in `include` are ignored entirely.
export function planUpgrades(
  cat: Catalog,
  budget: number,
  strategy: Strategy,
  include: Set<string>,
): PlanResult {
  const pool = cat.weapons.filter((w) => include.has(w.id));
  const levels: Record<string, Record<string, number>> = {};
  for (const w of pool) levels[w.id] = Object.fromEntries(w.tracks.map((t) => [t.id, 0]));
  const unlocked = new Set<string>();
  const steps: PlanStep[] = [];
  let spent = 0;

  const unlockedList = (): string[] => pool.filter((w) => unlocked.has(w.id)).map((w) => w.id);
  const nextLockedWeapon = (): DraftWeapon | undefined => pool.find((w) => !unlocked.has(w.id));
  const unlockCost = (): number => unlockCostAt(cat, unlocked.size);

  // cheapest affordable track level across all unlocked weapons → {weapon, track, cost}
  const cheapestLevel = (): { w: DraftWeapon; t: DraftTrack; cost: number } | undefined => {
    let best: { w: DraftWeapon; t: DraftTrack; cost: number } | undefined;
    for (const w of pool) {
      if (!unlocked.has(w.id)) continue;
      for (const t of w.tracks) {
        const lvl = levels[w.id][t.id];
        if (lvl >= t.max) continue;
        const cost = trackCostAt(t, lvl);
        if (!best || cost < best.cost) best = { w, t, cost };
      }
    }
    return best;
  };

  const doUnlock = (w: DraftWeapon, cost: number): void => {
    unlocked.add(w.id);
    spent += cost;
    steps.push({ kind: 'unlock', weaponId: w.id, weaponName: w.name, art: w.art, cost, cumulative: spent });
  };
  const doLevel = (w: DraftWeapon, t: DraftTrack, cost: number): void => {
    levels[w.id][t.id] += 1;
    spent += cost;
    steps.push({
      kind: 'level', weaponId: w.id, weaponName: w.name, art: w.art,
      trackId: t.id, trackLabel: t.label, toLevel: levels[w.id][t.id], cost, cumulative: spent,
    });
  };

  while (steps.length < STEP_CAP) {
    const remaining = budget - spent;
    const locked = nextLockedWeapon();
    const uCost = locked ? unlockCost() : Infinity;
    const lvl = cheapestLevel();
    const canUnlock = !!locked && uCost <= remaining;
    const canLevel = !!lvl && lvl.cost <= remaining;

    if (!canUnlock && !canLevel) break;

    if (strategy === 'breadth') {
      // Unlock everything affordable first; only level when no unlock is affordable.
      if (canUnlock) doUnlock(locked!, uCost);
      else doLevel(lvl!.w, lvl!.t, lvl!.cost);
    } else {
      // Cheapest action wins; tie → prefer unlock (broadens future options).
      if (canUnlock && (!canLevel || uCost <= lvl!.cost)) doUnlock(locked!, uCost);
      else doLevel(lvl!.w, lvl!.t, lvl!.cost);
    }
  }

  return { steps, spent, remaining: budget - spent, unlocked: unlockedList(), levels };
}

// ── efficiency view ───────────────────────────────────────────────────────────────────────────────
export interface EffRow {
  weaponId: string;
  weaponName: string;
  trackId: string;
  trackLabel: string;
  cost: number;       // Energy for the level being evaluated
  fromVal: number;
  toVal: number;
  // "% of current value gained per 1000 Energy" — a unit-agnostic gauge of how cheaply a knob moves.
  gainPerK: number;
}
// Rank every track's NEXT level (from `atLevel`, default 0) by value gained per Energy. A design aid:
// outliers flag tracks that are over- or under-priced relative to the impact they buy.
export function valueEfficiency(cat: Catalog, include: Set<string>, atLevel = 0): EffRow[] {
  const rows: EffRow[] = [];
  for (const w of cat.weapons) {
    if (!include.has(w.id)) continue;
    for (const t of w.tracks) {
      if (atLevel >= t.max) continue;
      const cost = trackCostAt(t, atLevel);
      const fromVal = trackValue(t, atLevel);
      const toVal = trackValue(t, atLevel + 1);
      const denom = Math.abs(fromVal) > 1e-9 ? Math.abs(fromVal) : 1;
      const gainPct = Math.abs(toVal - fromVal) / denom; // fraction change
      rows.push({
        weaponId: w.id, weaponName: w.name, trackId: t.id, trackLabel: t.label,
        cost, fromVal, toVal, gainPerK: cost > 0 ? (gainPct * 1000) / cost : 0,
      });
    }
  }
  rows.sort((a, b) => b.gainPerK - a.gainPerK);
  return rows;
}
