/* tests/unit/labs.test.ts — lab auto-start chaining, the never-idle "waiting" state, and the timed
   per-lab speed boost (cost ladder + boost-aware timer projection + per-lab isolation). */
import { describe, it, expect } from 'vitest';
import {
  migrateMeta, reconcileResearch, applyLabBoost, labBoostCost, labBoostMult,
  labBoostRemaining, labCoinCost, labLevel, LAB_BY_ID,
  startResearch, rushResearch, rushVialCost, researchProgress, researchOf,
} from '../../src/sim/labs';
import type { Meta } from '../../src/types';

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

describe('timed per-lab speed boost', () => {
  it('prices one lab over a day: 2x=24, 3x=46, 4x=65, 5x=82 vials (each step 10% cheaper)', () => {
    expect(labBoostCost(2, 86400)).toBe(24);
    expect(labBoostCost(3, 86400)).toBe(46);
    expect(labBoostCost(4, 86400)).toBe(65);
    expect(labBoostCost(5, 86400)).toBe(82);
  });

  it('charges 1 vial / hour at 2x (1 day → 24 vials)', () => {
    expect(labBoostCost(2, 86400)).toBe(24);
  });

  it('does not shorten the window, but banks multiplier×duration of lab time', () => {
    const now = 5_000_000;
    // a level with 48h of work left; a 1-day 2x boost should finish it in 24h of REAL time.
    const m = freshMeta({ vials: 10_000, research: [{ id: 'dmgLab', cost: 0, endsAt: now + 48 * H }] });
    expect(applyLabBoost(m, 'dmgLab', 2, 86400, now)).toBe(true);
    expect(labBoostMult(m, 'dmgLab', now)).toBe(2);
    expect(Math.round(labBoostRemaining(m, 'dmgLab', now))).toBe(86400); // window is a full real day, not 12h
    expect(m.research[0].endsAt).toBe(now + 24 * H);                      // 48h work / 2x = 24h real
    expect(m.vials).toBe(10_000 - 24);                                    // 1 lab × 24h × 1x block
  });

  it('refuses to stack a second boost on the SAME lab while one is live', () => {
    const now = 5_000_000;
    const m = freshMeta({ vials: 10_000, research: [{ id: 'dmgLab', cost: 0, endsAt: now + 10 * H }] });
    expect(applyLabBoost(m, 'dmgLab', 2, 86400, now)).toBe(true);
    expect(applyLabBoost(m, 'dmgLab', 3, 86400, now + H)).toBe(false); // still inside the first window
  });

  it('refuses to boost a lab that is not being researched', () => {
    const now = 5_000_000;
    const m = freshMeta({ vials: 10_000, research: [] });
    expect(applyLabBoost(m, 'dmgLab', 2, 86400, now)).toBe(false);
  });

  it('speeds up auto-started levels begun during the boost window', () => {
    const now = 5_000_000;
    const m = freshMeta({ coins: 1_000_000_000, vials: 10_000, labs: { dmgLab: 0 },
      research: [{ id: 'dmgLab', cost: 30, endsAt: now + H }] });
    applyLabBoost(m, 'dmgLab', 3, 7 * 86400, now); // a week-long 3x boost
    // level 2 of dmgLab takes 360s of work; auto-started under the 3x boost it should finish ~3x sooner.
    const beforeStart = m.research[0].endsAt; // level-1 completion
    reconcileResearch(m, beforeStart);
    const lvl2 = m.research[0];
    expect(lvl2.waiting).toBeFalsy();
    const realDuration = lvl2.endsAt - beforeStart;
    expect(realDuration).toBeCloseTo((360 * 1000) / 3, -1); // boosted to a third of the work-time
  });
});

describe('per-lab boost isolation', () => {
  it('boosts only the targeted lab, leaving others at 1×', () => {
    const now = 5_000_000;
    const m = freshMeta({ vials: 10_000, labSlots: 2,
      research: [{ id: 'dmgLab', cost: 0, endsAt: now + 48 * H }, { id: 'hpLab', cost: 0, endsAt: now + 48 * H }] });
    expect(applyLabBoost(m, 'dmgLab', 2, 86400, now)).toBe(true);
    expect(labBoostMult(m, 'dmgLab', now)).toBe(2);
    expect(labBoostMult(m, 'hpLab', now)).toBe(1);
    expect(m.research.find((r) => r.id === 'dmgLab')!.endsAt).toBe(now + 24 * H); // boosted → finishes sooner
    expect(m.research.find((r) => r.id === 'hpLab')!.endsAt).toBe(now + 48 * H);  // untouched
  });

  it('lets a SECOND lab be boosted while the first is still boosted', () => {
    const now = 5_000_000;
    const m = freshMeta({ vials: 10_000, labSlots: 2,
      research: [{ id: 'dmgLab', cost: 0, endsAt: now + 10 * H }, { id: 'hpLab', cost: 0, endsAt: now + 10 * H }] });
    expect(applyLabBoost(m, 'dmgLab', 2, 86400, now)).toBe(true);
    expect(applyLabBoost(m, 'hpLab', 3, 86400, now)).toBe(true); // a different lab → allowed
    expect(labBoostMult(m, 'hpLab', now)).toBe(3);
  });

  it('re-projects the running level onto the boost the moment it is bought', () => {
    const now = 5_000_000;
    // dmgLab has 100h of work left; a 2× boost should re-time it to 50h of REAL time immediately.
    const m = freshMeta({ vials: 10_000, research: [{ id: 'dmgLab', cost: 0, endsAt: now + 100 * H }] });
    expect(applyLabBoost(m, 'dmgLab', 2, 7 * 86400, now)).toBe(true);
    expect(m.research[0].endsAt - now).toBeCloseTo(50 * H, -1);
  });
});

describe('rushResearch settles the finish immediately', () => {
  it('completes the level and auto-starts a FRESH next level (no lingering 100% / 1-gem state)', () => {
    const T = 1_000_000;
    const m = freshMeta({ coins: 1e9, gems: 1000, labs: { dmgLab: 4 } });
    startResearch(m, 'dmgLab', T); // researching level 5 (lots of work left)
    const fresh = rushVialCost(m, 'dmgLab', T);
    expect(fresh).toBeGreaterThan(1); // a fresh level costs many gems to finish

    expect(rushResearch(m, 'dmgLab', T)).toBe(true);
    expect(m.gems).toBe(1000 - fresh); // charged exactly once, for the level that was in progress
    expect(labLevel(m, 'dmgLab')).toBe(5); // the rushed level COMPLETED right away

    // the slot now holds a genuinely fresh next level — not a finished one stuck at 100% / 1 gem
    const r = researchOf(m, 'dmgLab');
    expect(r).not.toBeNull();
    expect(r!.waiting).toBeFalsy();
    expect(r!.endsAt).toBeGreaterThan(T);
    const now2 = T + 1; // the HUD renders a moment later
    expect(researchProgress(m, 'dmgLab', now2)).toBeLessThan(0.01);
    expect(rushVialCost(m, 'dmgLab', now2)).toBeGreaterThan(1);
  });

  it('does not charge a second gem for an already-finished level', () => {
    const T = 1_000_000;
    const m = freshMeta({ coins: 1e9, gems: 1000, labs: { dmgLab: 4 } });
    startResearch(m, 'dmgLab', T);
    rushResearch(m, 'dmgLab', T);
    const afterFirst = m.gems;
    // a fresh next level is in progress; rushing it pays its OWN (full) cost, never a stray 1-gem charge
    const nextCost = rushVialCost(m, 'dmgLab', T);
    expect(nextCost).toBeGreaterThan(1);
    rushResearch(m, 'dmgLab', T);
    expect(m.gems).toBe(afterFirst! - nextCost);
    expect(labLevel(m, 'dmgLab')).toBe(6); // it advanced again — two distinct levels, two real charges
  });
});

describe('Speed Up boost settles a finished level before boosting', () => {
  it('boosts the LIVE level, not a just-elapsed one that would sit at 100% / 1 gem', () => {
    const now = 5_000_000;
    // dmgLab level 5 finished 1s ago but has not been reconciled yet; the player hits "Speed Up".
    const m = freshMeta({ coins: 1e9, vials: 10_000, labs: { dmgLab: 5 },
      research: [{ id: 'dmgLab', cost: 0, endsAt: now - 1000 }] });
    expect(applyLabBoost(m, 'dmgLab', 3, 86400, now)).toBe(true);
    expect(labLevel(m, 'dmgLab')).toBe(6); // the elapsed level completed instead of lingering
    const r = researchOf(m, 'dmgLab')!;
    expect(r.endsAt).toBeGreaterThan(now);                    // a real, in-progress next level
    expect(researchProgress(m, 'dmgLab', now)).toBeLessThan(0.01);
    expect(rushVialCost(m, 'dmgLab', now)).toBeGreaterThan(1); // not a 1-gem freebie
    expect(labBoostMult(m, 'dmgLab', now)).toBe(3);           // and the boost landed on it
  });
});
