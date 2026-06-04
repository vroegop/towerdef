/* tests/unit/labs.test.ts — lab auto-start chaining, the never-idle "waiting" state, and the timed
   global lab-speed boost (cost ladder + boost-aware timer projection). */
import { describe, it, expect } from 'vitest';
import {
  migrateMeta, reconcileResearch, startResearch, applyLabBoost, labBoostCost, labBoostMult,
  labBoostRemaining, labCoinCost, labLevel, LAB_BY_ID,
} from '../../src/sim/labs';
import type { Meta, Research } from '../../src/types';

function freshMeta(over: Partial<Meta> = {}): Meta {
  return migrateMeta({
    coins: 0, perm: {}, unlocked: {}, hasPlayed: true, bestWave: 30, claimedMilestones: {}, tier: 1,
    tierBest: {}, gems: 0, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
    labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
  });
}
const H = 3600 * 1000; // one hour in ms

describe('lab auto-start chaining', () => {
  it('auto-starts the next level when one completes (the slot never goes idle)', () => {
    const T = 1_000_000;
    const m = freshMeta({ coins: 1_000_000, labs: { dmgLab: 0 }, research: [{ id: 'dmgLab', cost: 30, endsAt: T }] });
    const done = reconcileResearch(m, T);
    expect(done).toEqual(['dmgLab']);
    expect(labLevel(m, 'dmgLab')).toBe(1);
    expect(m.research.length).toBe(1);            // slot still occupied
    expect(m.research[0].id).toBe('dmgLab');
    expect(m.research[0].endsAt).toBeGreaterThan(T); // level 2 now researching
    expect(m.research[0].waiting).toBeFalsy();
  });

  it('completes many levels across a long offline gap', () => {
    const T = 1_000_000;
    const m = freshMeta({ coins: 1_000_000_000, labs: { dmgLab: 0 }, research: [{ id: 'dmgLab', cost: 30, endsAt: T }] });
    reconcileResearch(m, T + 100 * H); // a big jump should bank several levels
    expect(labLevel(m, 'dmgLab')).toBeGreaterThan(3);
    expect(m.research.length).toBe(1); // still chaining the next level
  });

  it('frees the slot ONLY when the lab maxes out', () => {
    const max = LAB_BY_ID.dmgLab.max;
    const T = 1_000_000;
    const m = freshMeta({ coins: 1_000_000_000, labs: { dmgLab: max - 1 }, research: [{ id: 'dmgLab', cost: 0, endsAt: T }] });
    reconcileResearch(m, T);
    expect(labLevel(m, 'dmgLab')).toBe(max);
    expect(m.research.length).toBe(0); // maxed → the one and only idle state
  });
});

describe('the never-idle "waiting" state (coins-blocked)', () => {
  it('holds the slot when the next level is unaffordable, then resumes when coins arrive', () => {
    const T = 1_000_000;
    const m = freshMeta({ coins: 0, labs: { dmgLab: 0 }, research: [{ id: 'dmgLab', cost: 30, endsAt: T }] });
    reconcileResearch(m, T);
    expect(labLevel(m, 'dmgLab')).toBe(1);
    expect(m.research.length).toBe(1);         // slot kept (not idle)
    expect(m.research[0].waiting).toBe(true);  // but parked, waiting on coins
    expect(m.coins).toBe(0);                    // nothing spent while waiting

    m.coins = 1_000_000;
    const T2 = T + H;
    reconcileResearch(m, T2);
    expect(m.research[0].waiting).toBeFalsy();             // resumed
    expect(m.research[0].endsAt).toBeGreaterThan(T2);
    expect(m.coins).toBe(1_000_000 - labCoinCost(m, 'dmgLab')); // paid for the resumed level
  });
});

describe('timed global lab-speed boost', () => {
  it('prices the example ladder: 5 labs, 1 day → 2x=120, 3x=228, 4x=324, 5x=408 vials', () => {
    const research: Research[] = Array.from({ length: 5 }, (_, i) => ({ id: 'lab' + i, cost: 0, endsAt: 0 }));
    const m = freshMeta({ research });
    expect(labBoostCost(m, 2, 86400)).toBe(120);
    expect(labBoostCost(m, 3, 86400)).toBe(228);
    expect(labBoostCost(m, 4, 86400)).toBe(324);
    expect(labBoostCost(m, 5, 86400)).toBe(408);
  });

  it('charges 1 vial / hour / lab at 2x (a single lab, 1 day → 24 vials)', () => {
    const m = freshMeta({ research: [{ id: 'dmgLab', cost: 0, endsAt: 0 }] });
    expect(labBoostCost(m, 2, 86400)).toBe(24);
  });

  it('does not shorten the window, but banks multiplier×duration of lab time', () => {
    const now = 5_000_000;
    // a level with 48h of work left; a 1-day 2x boost should finish it in 24h of REAL time.
    const m = freshMeta({ vials: 10_000, research: [{ id: 'dmgLab', cost: 0, endsAt: now + 48 * H }] });
    expect(applyLabBoost(m, 2, 86400, now)).toBe(true);
    expect(labBoostMult(m, now)).toBe(2);
    expect(Math.round(labBoostRemaining(m, now))).toBe(86400); // window is a full real day, not 12h
    expect(m.research[0].endsAt).toBe(now + 24 * H);           // 48h work / 2x = 24h real
    expect(m.vials).toBe(10_000 - 24);                          // 1 lab × 24h × 1x block
  });

  it('refuses to stack a second boost while one is live', () => {
    const now = 5_000_000;
    const m = freshMeta({ vials: 10_000, research: [{ id: 'dmgLab', cost: 0, endsAt: now + 10 * H }] });
    expect(applyLabBoost(m, 2, 86400, now)).toBe(true);
    expect(applyLabBoost(m, 3, 86400, now + H)).toBe(false); // still inside the first window
  });

  it('speeds up auto-started levels begun during the boost window', () => {
    const now = 5_000_000;
    const m = freshMeta({ coins: 1_000_000_000, vials: 10_000, labs: { dmgLab: 0 },
      research: [{ id: 'dmgLab', cost: 30, endsAt: now + H }] });
    applyLabBoost(m, 3, 7 * 86400, now); // a week-long 3x boost
    // level 2 of dmgLab takes 360s of work; auto-started under the 3x boost it should finish ~3x sooner.
    const beforeStart = m.research[0].endsAt; // level-1 completion
    reconcileResearch(m, beforeStart);
    const lvl2 = m.research[0];
    expect(lvl2.waiting).toBeFalsy();
    const realDuration = lvl2.endsAt - beforeStart;
    expect(realDuration).toBeCloseTo((360 * 1000) / 3, -1); // boosted to a third of the work-time
  });
});

describe('startResearch honours an active boost', () => {
  it('projects a freshly started level onto the boosted timeline', () => {
    const now = 5_000_000;
    const m = freshMeta({ coins: 1_000_000_000, vials: 10_000, labSlots: 2, labs: { dmgLab: 1 },
      research: [{ id: 'hpLab', cost: 0, endsAt: now + 100 * H }] });
    applyLabBoost(m, 2, 7 * 86400, now);
    expect(startResearch(m, 'dmgLab', now)).toBe(true); // dmgLab level 2 = 360s work
    const r = m.research.find((x) => x.id === 'dmgLab')!;
    expect(r.endsAt - now).toBeCloseTo((360 * 1000) / 2, -1); // started under 2x → half the real time
  });
});
