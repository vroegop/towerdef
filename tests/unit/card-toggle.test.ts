/* tests/unit/card-toggle.test.ts — verifies that ACTIVATING and DEACTIVATING every card mid-run
   actually changes (and then restores) the live sim stats. Cards funnel through a single recompute
   path: computeStats(state) reads activeCardIds(meta) fresh every frame, so a toggle must be visible
   on the very next computeStats() call with no stale state left behind.

   For each card we record the ONE Stats key it drives, then assert:
     baseline (no active card)  →  active (card in a slot) differs  →  deactivated == baseline. */
import { describe, it, expect } from 'vitest';
import { createState } from '../../src/sim/state';
import { migrateMeta } from '../../src/sim/labs';
import { computeStats, setActiveCard, CARD_ORDER } from '../../src/sim/skills';
import type { Meta, State, Stats } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}

// Every Stats key a card can move maps to a single readable number on the sheet. (mult/flat land on a
// base stat; aura/mechanic/active are surfaced under a passthrough key.) The Coins card surfaces its
// ×multiplier under `cardCoinMult` (consumed by effectiveCoinMult), not coinsPerKill.
const CARD_STAT: Record<string, keyof Stats> = {
  damage: 'rangedDamage', attackSpeed: 'fireRate', health: 'maxHp', healthRegen: 'regen',
  range: 'range', cash: 'goldFind', coins: 'cardCoinMult', slowAura: 'slowAura',
  critChance: 'critChance', enemyBalance: 'enemyBalance', extraDefense: 'defPct', fortress: 'armor',
  overrun: 'lullReduce', freeUpgrades: 'cardFreeUp', plasmaCanon: 'plasmaCanon',
  criticalCoin: 'criticalCoin', waveSkip: 'waveSkip', superTower: 'superTower',
  secondWind: 'secondWind', demonMode: 'demonMode',
};

// Seed in-run upgrade levels so every base stat the cards touch is non-zero (regen/coinsPerKill/armor
// start at 0 otherwise, which would hide a ×multiplier card's effect).
function seededState(): State {
  const s = createState(1, freshMeta({ cardSlots: 1 }), false);
  for (const id of ['rangedDamage', 'attackSpeed', 'health', 'regen', 'range', 'goldPerKill',
    'coinsPerKill', 'critChance', 'critDamage', 'armor', 'defPct']) {
    s.run.levels[id] = 50;
  }
  return s;
}

describe('cards — every card applies on activate and reverts on deactivate (mid-run)', () => {
  it('covers all known cards', () => {
    // Guard: if a new card is added, this map must grow too — otherwise we silently skip it.
    expect(Object.keys(CARD_STAT).sort()).toEqual([...CARD_ORDER].sort());
  });

  for (const id of CARD_ORDER) {
    it(`${id}: activate changes ${String(CARD_STAT[id])}, deactivate restores it`, () => {
      const key = CARD_STAT[id];
      const s = seededState();
      // Own the card at max stars so its magnitude is unmistakable.
      s.meta.cards = [{ id, stars: 15 }];

      const baseline = computeStats(s)[key] as number;

      // ACTIVATE: place the card into slot 0.
      expect(setActiveCard(s.meta, 0, id)).toBe(true);
      const active = computeStats(s)[key] as number;
      expect(active).not.toBe(baseline);

      // DEACTIVATE: clear the slot — the stat must return to exactly the baseline.
      expect(setActiveCard(s.meta, 0, null)).toBe(true);
      const restored = computeStats(s)[key] as number;
      expect(restored).toBe(baseline);
    });
  }

  it('multiple active cards compose, and removing one leaves the others intact', () => {
    const s = seededState();
    s.meta.cardSlots = 3;
    s.meta.cards = [{ id: 'damage', stars: 15 }, { id: 'health', stars: 15 }, { id: 'fortress', stars: 15 }];
    const base = computeStats(s);

    setActiveCard(s.meta, 0, 'damage');
    setActiveCard(s.meta, 1, 'health');
    setActiveCard(s.meta, 2, 'fortress');
    const all = computeStats(s);
    expect(all.rangedDamage).toBeGreaterThan(base.rangedDamage);
    expect(all.maxHp).toBeGreaterThan(base.maxHp);
    expect(all.armor).toBeGreaterThan(base.armor);

    // Pull the Health card mid-run: maxHp drops back to baseline, the other two stay buffed.
    setActiveCard(s.meta, 1, null);
    const minusHealth = computeStats(s);
    expect(minusHealth.maxHp).toBe(base.maxHp);
    expect(minusHealth.rangedDamage).toBe(all.rangedDamage);
    expect(minusHealth.armor).toBe(all.armor);
  });
});
