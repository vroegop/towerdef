/* dev/verify-cards.ts — throwaway verification of the card-system overhaul.
   Run: PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsx dev/verify-cards.ts */
import type { Meta } from '../src/types';
import {
  buyCard, CARD_SLOT_COSTS, cardSlotCost, buyCardSlot, setActiveCard, activeCardIds,
  computeStats, CARDS, RARITY_WEIGHT,
} from '../src/sim/skills';
import { migrateMeta } from '../src/sim/labs';
import { createState } from '../src/sim/state';
import { Sim } from '../src/sim/core';
import { makeRng } from '../src/sim/rng';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log(' FAIL ' + name + (extra ? '  → ' + extra : '')); }
};
const meta = (over: Partial<Meta> = {}): Meta => migrateMeta({
  coins: 0, perm: {}, hasPlayed: true, bestWave: 0, claimedMilestones: {}, tier: 1,
  tierBest: {}, gems: 999999, cards: [], cardBuys: 0, cardSlots: 1, activeCards: [], totalWaves: 0,
  labs: {}, research: [], labSlots: 1, vials: 0, lastCheckIn: 0, ver: 0, ...over,
} as Meta);

// ---- 1. RARITY DISTRIBUTION (rough) ----
{
  // Drive buyCard's rarity roll with a deterministic PRNG; count which rarity each draw lands in.
  // Keep the pool full (never level anything) by snapshotting/restoring cards each draw so the
  // rarity the draw WOULD pick is observable from the card's def.rarity.
  const rng = makeRng(7);
  const draw = (): number => rng.next();
  const counts = { common: 0, rare: 0, epic: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const m = meta();
    const r = buyCard(m, draw);
    if (r) counts[CARDS[r.id].rarity]++;
  }
  const total = counts.common + counts.rare + counts.epic;
  const fc = counts.common / total, fr = counts.rare / total, fe = counts.epic / total;
  console.log('Rarity distribution over ' + total + ' draws:',
    'common=' + (fc * 100).toFixed(1) + '% rare=' + (fr * 100).toFixed(1) + '% epic=' + (fe * 100).toFixed(1) + '%');
  ok('common ≈ 80%', Math.abs(fc - RARITY_WEIGHT.common) < 0.03, fc.toFixed(3));
  ok('rare ≈ 17%', Math.abs(fr - RARITY_WEIGHT.rare) < 0.03, fr.toFixed(3));
  ok('epic ≈ 3%', Math.abs(fe - RARITY_WEIGHT.epic) < 0.02, fe.toFixed(3));
}

// ---- 2. PASSIVE multiplies its stat ONLY when ACTIVE ----
{
  // Own a maxed Damage card but DON'T place it → no effect. Then place it → ×4.40 damage.
  const m = meta({ cards: [{ id: 'damage', stars: 15 }] });
  const ownedOnly = computeStats(createState(1, m, false));
  const baseline = computeStats(createState(1, meta(), false));
  ok('owned-but-inactive card does not change damage',
    Math.abs(ownedOnly.rangedDamage - baseline.rangedDamage) < 1e-6,
    ownedOnly.rangedDamage + ' vs ' + baseline.rangedDamage);
  setActiveCard(m, 0, 'damage');
  ok('placing the card in a slot makes it active', activeCardIds(m).join(',') === 'damage');
  const active = computeStats(createState(1, m, false));
  ok('active Damage card ×4.40 at Lv15',
    Math.abs(active.rangedDamage - baseline.rangedDamage * 4.40) < 1e-3,
    active.rangedDamage + ' vs ' + baseline.rangedDamage * 4.40);
}

// ---- 3. SLOT PURCHASE COSTS match the table ----
{
  const m = meta({ cardSlots: 1, gems: 10_000_000 });
  let okCosts = true, detail = '';
  for (let slot = 1; slot < CARD_SLOT_COSTS.length; slot++) {
    // buying the (slot+1)-th slot should cost CARD_SLOT_COSTS[slot]
    const expected = CARD_SLOT_COSTS[slot];
    const got = cardSlotCost(m);
    if (got !== expected) { okCosts = false; detail = 'slot ' + (slot + 1) + ' got ' + got + ' want ' + expected; break; }
    buyCardSlot(m);
  }
  ok('slot costs follow the table (free,50,100,...,10000)', okCosts, detail);
  ok('cardSlots reaches the max (22)', m.cardSlots === CARD_SLOT_COSTS.length, '' + m.cardSlots);
  ok('no slot beyond max', !buyCardSlot(m) && cardSlotCost(m) === 0);
}

// ---- 4. ACTIVE TIMERS tick (Super Tower + Demon Mode) ----
{
  // Super Tower (Lv15 ×5.5) auto-activates at run start; while up, dmgBoost = 5.5.
  const m = meta({ cards: [{ id: 'superTower', stars: 15 }], cardSlots: 2 });
  setActiveCard(m, 0, 'superTower');
  const s = createState(1, m, false);
  const sim = new Sim(s);
  sim.refreshStats();
  sim.step(1 / 30);
  ok('Super Tower applies a damage boost while active', (s.run.dmgBoost || 1) > 1, 'boost=' + s.run.dmgBoost);
  ok('Super Tower active timer is counting', (s.run.actActive!.superTower || 0) > 0, '' + s.run.actActive!.superTower);
  // Demon Mode → hero invincible while up.
  const m2 = meta({ cards: [{ id: 'demonMode', stars: 1 }], cardSlots: 1 });
  setActiveCard(m2, 0, 'demonMode');
  const s2 = createState(2, m2, false);
  const sim2 = new Sim(s2);
  sim2.refreshStats();
  sim2.step(1 / 30);
  ok('Demon Mode makes the hero invincible', (s2.run.invuln || 0) > 0, 'invuln=' + s2.run.invuln);
  ok('Demon Mode applies ×3 damage', Math.abs((s2.run.dmgBoost || 1) - 3) < 1e-6, 'boost=' + s2.run.dmgBoost);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
