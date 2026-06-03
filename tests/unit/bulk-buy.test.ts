/* tests/unit/bulk-buy.test.ts — the upgrade-menu bulk-buy multiplier (1x/5x/25x/100x/Max).
   Verifies the unlock gating (pre-completed labs), the affordability planning, and the atomic
   fixed-quantity buys vs. the affordable-prefix 'Max' buy, for both run (gold) and perm (coins). */
import { describe, it, expect } from 'vitest';
import { migrateMeta } from '../../src/sim/labs';
import { createState } from '../../src/sim/state';
import {
  BULK_TIERS, availableBulkTiers, bulkTierUnlocked,
  permBulkPlan, runBulkPlan, buyPermBulk, buyRunUpgradeBulk, permBought,
} from '../../src/sim/skills';
import type { Meta, State } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

describe('bulk-buy unlock gating', () => {
  it('pre-completes every tier for a migrated player (all tiers available by default)', () => {
    const meta = freshMeta();
    expect(availableBulkTiers(meta).length).toBe(BULK_TIERS.length);
    for (const t of BULK_TIERS) expect(bulkTierUnlocked(meta, t)).toBe(true);
  });

  it('locking a tier (no completed lab) removes it from the available set', () => {
    const meta = freshMeta();
    delete meta.labs.bulk100; // simulate "not yet unlocked"
    const tiers = availableBulkTiers(meta);
    expect(tiers.some((t) => t.qty === 100)).toBe(false);
    expect(tiers.some((t) => t.qty === 5)).toBe(true); // others still available
  });
});

describe('perm bulk plan + buy (coins)', () => {
  it('a fixed quantity is all-or-nothing: disabled when you cannot afford the whole batch', () => {
    const meta = freshMeta({ coins: 1e9 });
    const id = 'rangedDamage';
    const one = permBulkPlan(meta, id, 1).cost; // priced with funds available
    meta.coins = one; // exactly enough for 1
    expect(permBulkPlan(meta, id, 1).canBuy).toBe(true);
    expect(permBulkPlan(meta, id, 5).canBuy).toBe(false); // can't afford all 5
    expect(buyPermBulk(meta, id, 5)).toBe(0); // atomic → nothing bought
    expect(permBought(meta, id)).toBe(1); // 0 purchased + the free level-1 (unlocked skill)
  });

  it('buys exactly N when affordable and deducts the planned cost', () => {
    const meta = freshMeta({ coins: 1e9 });
    const id = 'rangedDamage';
    const plan = permBulkPlan(meta, id, 5);
    const before = meta.coins;
    expect(buyPermBulk(meta, id, 5)).toBe(5);
    expect(permBought(meta, id)).toBe(6); // 5 purchased + the free level-1 (unlocked skill)
    expect(before - meta.coins).toBe(plan.cost);
  });

  it("'Max' buys the affordable prefix and is enabled when at least 1 is affordable", () => {
    const meta = freshMeta({ coins: 1e9 });
    const id = 'rangedDamage';
    const c0 = permBulkPlan(meta, id, 1).cost; // priced with funds available
    meta.coins = c0; // enough for exactly 1 (the next level costs more)
    const plan = permBulkPlan(meta, id, 'max');
    expect(plan.canBuy).toBe(true);
    expect(plan.count).toBe(1);
    expect(buyPermBulk(meta, id, 'max')).toBe(1);
  });
});

describe('run bulk plan (gold)', () => {
  function freshState(): State {
    const meta = freshMeta();
    meta.unlocked.rangedDamage = true;
    return createState(1, meta);
  }
  it('plans against run gold and caps the count at affordability', () => {
    const s = freshState();
    s.econ.gold = 0;
    expect(runBulkPlan(s, 'rangedDamage', 5).canBuy).toBe(false);
    expect(buyRunUpgradeBulk(s, 'rangedDamage', 5)).toBe(0);
    s.econ.gold = 1e9;
    expect(buyRunUpgradeBulk(s, 'rangedDamage', 5)).toBe(5);
    expect(s.run.levels.rangedDamage).toBe(5);
  });
});
