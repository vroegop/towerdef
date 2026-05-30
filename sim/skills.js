/* sim/skills.js — UNIFIED upgrade model.

   ONE list of upgrades (A.UPGRADES). Every upgrade is buyable in two contexts:
     • in a run, with GOLD   → A.run.levels[id]  (resets each run)
     • out of a run, with CORES → A.meta.perm[id] (permanent; a "base level skip")

   The effective number of levels a stat has is perm + run (capped at the upgrade's max).
   Permanent levels are pure head-starts: a run begins as if you'd already bought them,
   and the in-run price is driven ONLY by run.levels[id] — so buying level "11" in a run
   costs the same as level 1 when 10 levels came from cores. Both currencies' costs
   accelerate with their own level, so the last upgrade feels unreachable at first and
   trivial once income compounds.

   Tabs: attack / defense / economic (icons, not words). Economic unlocks at Tier 2. */
(function (A) {
  // pixel/metre scale: the literal range stat is in METRES; the sim runs in pixels.
  A.PX_PER_METER = 4;
  A.BASE_RANGE_M = 50;   // default attack radius before any Range upgrade
  A.MAX_RANGE_M = 1000;  // hard cap on range (metres)

  // cost factory: round(base · growth^n). growth > 1 → accelerating curve.
  const curve = (base, grow) => ({ base, grow, cost: (n) => Math.round(base * Math.pow(grow, n)) });

  // The three subtabs shared by the in-run bar and the out-of-run Upgrades menu.
  A.TAB_DEFS = [
    { id: 'attack',   icon: 'sword' },
    { id: 'defense',  icon: 'shield' },
    { id: 'economic', icon: 'coins', gated: true }, // locked until Tier 2 is reached
  ];

  // Every upgrade. `value(b)` turns a level count into the stat number; `fmt(b)` is the
  // string shown to the player; `max` caps perm+run; `gold`/`core` are the two cost curves.
  A.UPGRADES = [
    // ---- ATTACK ----
    { id: 'attackSpeed',  tab: 'attack',  icon: 'rate',  label: 'Attack Speed',  max: 10000,
      value: (b) => 1 + b,                          fmt: (b) => (1 + b) + '/s',
      gold: curve(15, 1.6),    core: curve(3, 1.0018) },
    { id: 'rangedDamage', tab: 'attack',  icon: 'bow',   label: 'Ranged Damage', max: 10000,
      value: (b) => 1 + b,                          fmt: (b) => '' + (1 + b),
      gold: curve(10, 1.5),    core: curve(4, 1.0018) },
    { id: 'dmgPerMeter',  tab: 'attack',  icon: 'ruler', label: 'Damage / Metre', max: 10000,
      value: (b) => b * 0.001,                      fmt: (b) => '+' + (b * 0.001).toFixed(3) + '×/m',
      gold: curve(25, 1.55),   core: curve(6, 1.0018) },
    { id: 'range',        tab: 'attack',  icon: 'range', label: 'Range', max: 9500, // 50 + 9500·0.1 = 1000 m
      value: (b) => Math.min(A.MAX_RANGE_M, A.BASE_RANGE_M + b * 0.1),
      fmt:   (b) => Math.min(A.MAX_RANGE_M, A.BASE_RANGE_M + b * 0.1).toFixed(1) + 'm',
      gold: curve(20, 1.5),    core: curve(5, 1.0018) },
    { id: 'critChance',   tab: 'attack',  icon: 'crit',  label: 'Crit Chance', max: 1200, // 1200·0.1% = 120%
      value: (b) => Math.min(1.2, b * 0.001),       fmt: (b) => (Math.min(1.2, b * 0.001) * 100).toFixed(1) + '%',
      gold: curve(40, 1.6),    core: curve(20, 1.008) },
    { id: 'critDamage',   tab: 'attack',  icon: 'burst', label: 'Crit Damage', max: 10000, // 1000× at level 10000
      value: (b) => 1 + b * (999 / 10000),          fmt: (b) => { const v = 1 + b * (999 / 10000); return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + '×'; },
      gold: curve(50, 1.6),    core: curve(25, 1.0018) },
    { id: 'superCrit',    tab: 'attack',  icon: 'burst', label: 'Super Crit', max: 1000, // up to +100% chance to crit-again
      value: (b) => Math.min(1, b * 0.001),         fmt: (b) => (Math.min(1, b * 0.001) * 100).toFixed(1) + '%',
      gold: curve(80, 1.6),    core: curve(25, 1.0018) },

    // ---- DEFENSE ----
    { id: 'health',       tab: 'defense', icon: 'heart', label: 'Health', max: 10000,
      value: (b) => 1 + b,                          fmt: (b) => '' + (1 + b),
      gold: curve(10, 1.5),    core: curve(4, 1.0018) },
    { id: 'regen',        tab: 'defense', icon: 'regen', label: 'Health Regen', max: 10000,
      value: (b) => b * 0.2,                         fmt: (b) => (b * 0.2).toFixed(1) + '/s',
      gold: curve(20, 1.6),    core: curve(5, 1.0018) },
    { id: 'dodge',        tab: 'defense', icon: 'dodge', label: 'Dodge', max: 1100, // 1100·0.09% = 99%
      value: (b) => Math.min(0.99, b * 0.0009),      fmt: (b) => (Math.min(0.99, b * 0.0009) * 100).toFixed(1) + '%',
      gold: curve(40, 1.6),    core: curve(20, 1.008) },
    { id: 'armor',        tab: 'defense', icon: 'shield', label: 'Armor', max: 10000, // flat damage soak per hit
      value: (b) => b,                               fmt: (b) => '-' + b,
      gold: curve(30, 1.55),   core: curve(6, 1.0018) },
    { id: 'defPct',       tab: 'defense', icon: 'shield', label: 'Defense %', max: 900, // multiplicative DR, caps at 90%
      value: (b) => Math.min(0.9, b * 0.001),        fmt: (b) => (Math.min(0.9, b * 0.001) * 100).toFixed(1) + '%',
      gold: curve(50, 1.6),    core: curve(20, 1.008) },

    // ---- ECONOMIC (Tier 2+) ----
    { id: 'coinsPerWave', tab: 'economic', icon: 'coin',  label: 'Coins / Wave', max: 10000, gated: true,
      value: (b) => b,                               fmt: (b) => '+' + b,
      gold: curve(30, 1.55),   core: curve(8, 1.0018) },
    { id: 'coinsPerKill', tab: 'economic', icon: 'coin',  label: 'Coins / Kill', max: 10000, gated: true,
      value: (b) => b * 0.1,                         fmt: (b) => '+' + (b * 0.1).toFixed(1) + '×',
      gold: curve(50, 1.6),    core: curve(12, 1.0018) },
    { id: 'cashBonus',    tab: 'economic', icon: 'coin',  label: 'Cash Bonus', max: 10000, gated: true,
      value: (b) => 1 + b * 0.02,                    fmt: (b) => '×' + (1 + b * 0.02).toFixed(2), // global × on all gold income
      gold: curve(40, 1.55),   core: curve(10, 1.0018) },
    { id: 'coresPerWave', tab: 'economic', icon: 'cores', label: 'Cores / Wave', max: 10000, gated: true,
      value: (b) => b,                               fmt: (b) => '+' + b,
      gold: curve(50, 1.6),    core: curve(10, 1.0018) },
    { id: 'coresPerKill', tab: 'economic', icon: 'cores', label: 'Cores / Kill', max: 10000, gated: true,
      value: (b) => b * 0.001,                       fmt: (b) => '+' + (b * 0.001).toFixed(3),
      gold: curve(60, 1.6),    core: curve(15, 1.0018) },
  ];
  A.UP_BY_ID = {};
  for (const u of A.UPGRADES) A.UP_BY_ID[u.id] = u;
  A.upgradesIn = (tab) => A.UPGRADES.filter((u) => u.tab === tab);

  // economic/utility upgrades: tier gating disabled — everything is buyable from the start (test mode)
  A.economyUnlocked = (meta) => true;

  // The scripted first run grants exactly enough cores to buy the tutorial's first upgrade.
  A.FIRST_PERM_COST = A.UP_BY_ID.attackSpeed.core.cost(0);

  // The effective cap for an upgrade: its base `max` PLUS any cap raised by labs.
  // Labs are the only thing that can lift this leash (see sim/labs.js). When labs.js
  // isn't loaded this collapses to the constant base max.
  function capOf(meta, id) {
    const up = A.UP_BY_ID[id];
    return up.max + (A.labCapBonus ? A.labCapBonus(meta, id) : 0);
  }
  A.upgradeCap = (meta, id) => capOf(meta, id);

  // perm + run levels for an upgrade, capped at its (lab-liftable) cap.
  function boughtOf(state, id) {
    const perm = (state.meta && state.meta.perm && state.meta.perm[id]) || 0;
    const run = (state.run && state.run.levels && state.run.levels[id]) || 0;
    return Math.min(capOf(state.meta, id), perm + run);
  }
  A.boughtOf = boughtOf;
  // perm-only level (used by the between-runs menu, which has no live run state)
  A.permBought = (meta, id) => Math.min(capOf(meta, id), (meta && meta.perm && meta.perm[id]) || 0);

  // ---- CARDS (Pokemon-style; bought/upgraded with a separate active-play currency: TOKENS) ----
  // A card contributes one or more {stat, kind:'flat'|'mult'} effects; its magnitude is value(stars).
  // Stacking is resolved at calc time via the kind flag: effective = (base + flats) * prod(1 + mults).
  A.MAX_STARS = 15; // 5 white, then 5 gold, then 5 chromatic (each star raises value)
  // A card contributes flat or mult bonuses to one sim stat (see STAT2SIM). `value(stars)` is the
  // magnitude; `fmt(v)` is how that magnitude is shown on the card. Flat geometric cards reuse pow2.
  const pow2 = (stars) => (stars > 0 ? Math.pow(2, stars - 1) : 0); // 1,2,4,8,16...
  const pct = (v) => '+' + Math.round(v * 100) + '%';
  A.CARDS = {
    damage: {
      id: 'damage', name: 'Bullseye', art: 'bullseye', tint: '#37d7ff',
      effects: [{ stat: 'rangedDamage', kind: 'flat' }],
      value: pow2, fmt: (v) => '+' + v, desc: (v) => '+' + v + ' ranged damage',
    },
    power: {
      id: 'power', name: 'Onslaught', art: 'bow', tint: '#4aa8ff',
      effects: [{ stat: 'rangedDamage', kind: 'mult' }],
      value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' damage',
    },
    haste: {
      id: 'haste', name: 'Overclock', art: 'rate', tint: '#ffae4a',
      effects: [{ stat: 'attackSpeed', kind: 'mult' }],
      value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' attack speed',
    },
    crit: {
      id: 'crit', name: 'Deadeye', art: 'crit', tint: '#ffd24a',
      effects: [{ stat: 'critChance', kind: 'flat' }],
      value: (s) => s * 0.01, fmt: (v) => '+' + (v * 100).toFixed(0) + '%', desc: (v) => '+' + (v * 100).toFixed(0) + '% crit chance',
    },
    execute: {
      id: 'execute', name: 'Executioner', art: 'burst', tint: '#e64cff',
      effects: [{ stat: 'critDamage', kind: 'mult' }],
      value: (s) => s * 0.15, fmt: pct, desc: (v) => pct(v) + ' crit damage',
    },
    vitality: {
      id: 'vitality', name: 'Vitality', art: 'heart', tint: '#ff5d6c',
      effects: [{ stat: 'health', kind: 'flat' }],
      value: pow2, fmt: (v) => '+' + v, desc: (v) => '+' + v + ' health',
    },
    regrowth: {
      id: 'regrowth', name: 'Regrowth', art: 'regen', tint: '#3ddc84',
      effects: [{ stat: 'regen', kind: 'flat' }],
      value: (s) => s * 0.5, fmt: (v) => '+' + v.toFixed(1) + '/s', desc: (v) => '+' + v.toFixed(1) + ' regen/s',
    },
    phantom: {
      id: 'phantom', name: 'Phantom', art: 'dodge', tint: '#37d7ff',
      effects: [{ stat: 'dodge', kind: 'flat' }],
      value: (s) => s * 0.005, fmt: (v) => '+' + (v * 100).toFixed(1) + '%', desc: (v) => '+' + (v * 100).toFixed(1) + '% dodge',
    },
    fortune: {
      id: 'fortune', name: 'Fortune', art: 'coin', tint: '#ffd24a',
      effects: [{ stat: 'coins', kind: 'mult' }],
      value: (s) => s * 0.1, fmt: pct, desc: (v) => pct(v) + ' coins',
    },
  };
  A.CARD_SLOTS = 20;
  A.CARD_ORDER = ['damage', 'power', 'haste', 'crit', 'execute', 'vitality', 'regrowth', 'phantom', 'fortune'];
  A.cardValue = (id, stars) => (A.CARDS[id] ? A.CARDS[id].value(stars) : 0);
  A.cardsUnlocked = (meta) => true; // cards available from the start
  A.grantInitialCard = function (meta) {
    // own one of every card type from the start (each at 1 star) so all types are testable
    meta.cards = meta.cards || [];
    let added = false;
    for (const id of A.CARD_ORDER) {
      if (!meta.cards.find((c) => c.id === id)) { meta.cards.push({ id, stars: 1 }); added = true; }
    }
    return added;
  };
  A.starSlot = (i, stars) => (stars >= i + 11 ? 'chroma' : stars >= i + 6 ? 'gold' : stars >= i + 1 ? 'white' : 'empty');

  A.buyCardCost = (meta) => 5 + 5 * (meta.cardBuys || 0);
  A.upgradeCost = (meta) => 5 + 5 * (meta.starBuys || 0);
  A.buyCard = function (meta) { // spend tokens -> random card (dupe becomes a star)
    const cost = A.buyCardCost(meta); if ((meta.tokens || 0) < cost) return null;
    const ids = Object.keys(A.CARDS), id = ids[Math.floor(Math.random() * ids.length)];
    meta.cards = meta.cards || [];
    const owned = meta.cards.find((c) => c.id === id);
    if (owned) owned.stars = Math.min(A.MAX_STARS, (owned.stars || 0) + 1);
    else meta.cards.push({ id, stars: 1 });
    meta.tokens -= cost; meta.cardBuys = (meta.cardBuys || 0) + 1; return id;
  };
  A.upgradeRandomCard = function (meta) { // spend tokens -> +1 star on a random owned card
    const pool = (meta.cards || []).filter((c) => (c.stars || 0) < A.MAX_STARS);
    if (!pool.length) return null;
    const cost = A.upgradeCost(meta); if ((meta.tokens || 0) < cost) return null;
    const c = pool[Math.floor(Math.random() * pool.length)];
    c.stars = (c.stars || 0) + 1; meta.tokens -= cost; meta.starBuys = (meta.starBuys || 0) + 1; return c.id;
  };

  // ---- tier / milestones (cores rewards for furthest-wave progress in the current tier) ----
  A.TIER = 1;
  A.MILESTONES = (function () { const a = [10, 50, 100, 250, 500]; for (let w = 1000; w <= 10000; w += 1000) a.push(w); return a; })();
  A.milestoneReward = function (wave) { return wave; }; // cores; tune freely
  A.claimableCount = function (meta) {
    const best = meta.bestWave || 0, cl = meta.claimedMilestones || {};
    let c = 0; for (const w of A.MILESTONES) if (best >= w && !cl[w]) c++; return c;
  };
  A.claimMilestone = function (meta, wave) {
    const best = meta.bestWave || 0; meta.claimedMilestones = meta.claimedMilestones || {};
    if (best >= wave && !meta.claimedMilestones[wave]) {
      const r = A.milestoneReward(wave);
      meta.cores = (meta.cores || 0) + r; meta.claimedMilestones[wave] = true; return r;
    }
    return 0;
  };

  // Turn levels into the numbers the sim runs on, then apply card bonuses.
  // Stacking is resolved at calc time per-modifier: effective = (base + Σflat) × Π(1 + mult).
  // card effect stat → the sim stat key it modifies (extend this to let cards target more stats)
  const STAT2SIM = {
    rangedDamage: 'rangedDamage', attackSpeed: 'fireRate', health: 'maxHp', regen: 'regen',
    critChance: 'critChance', critDamage: 'critMult', dodge: 'dodge', coins: 'goldFind',
  };
  A.computeStats = function (state) {
    const b = (id) => boughtOf(state, id);
    const U = A.UP_BY_ID;
    const rangeM = U.range.value(b('range'));
    const out = {
      rangedDamage: U.rangedDamage.value(b('rangedDamage')),
      fireRate:     U.attackSpeed.value(b('attackSpeed')),
      maxHp:        U.health.value(b('health')),
      regen:        U.regen.value(b('regen')),
      rangeM,
      range:        rangeM * A.PX_PER_METER,
      dmgPerMeter:  U.dmgPerMeter.value(b('dmgPerMeter')),  // ×/metre coefficient
      critChance:   U.critChance.value(b('critChance')),
      critMult:     U.critDamage.value(b('critDamage')),
      superCrit:    U.superCrit.value(b('superCrit')),  // chance for a crit to crit again

      dodge:        U.dodge.value(b('dodge')),
      armor:        U.armor.value(b('armor')),          // flat damage soaked per hit
      defPct:       U.defPct.value(b('defPct')),        // multiplicative DR applied after armor
      cashMult:     U.cashBonus.value(b('cashBonus')),  // global × on all gold income
      coinsPerWave: U.coinsPerWave.value(b('coinsPerWave')),
      coresPerWave: U.coresPerWave.value(b('coresPerWave')),
      coresPerKill: U.coresPerKill.value(b('coresPerKill')),
      goldFind:     1 + U.coinsPerKill.value(b('coinsPerKill')),
      xpGain: 1,
    };
    // Resolve cards + labs into the final stats, keyed by SIM stat. The formula is
    //   effective = (base + Σ card.flat) × labSlope × Π(1 + card.mult)
    // where labSlope (1 + Σ scale-lab per·level) is the labs' multiplicative contribution.
    const flat = {}, mult = {};
    const cards = (state.meta && state.meta.cards) || [];
    for (const c of cards) {
      const def = A.CARDS[c.id]; if (!def) continue;
      const v = def.value(c.stars || 0);
      for (const e of def.effects) {
        const k = STAT2SIM[e.stat] || e.stat;
        if (e.kind === 'mult') mult[k] = (mult[k] || 1) * (1 + v);
        else flat[k] = (flat[k] || 0) + v;
      }
    }
    const labMult = (A.labScaleMults && A.labScaleMults(state.meta)) || {};
    const touched = new Set([...Object.keys(flat), ...Object.keys(mult), ...Object.keys(labMult)]);
    for (const k of touched) {
      if (typeof out[k] !== 'number') continue;
      out[k] = (out[k] + (flat[k] || 0)) * (labMult[k] || 1) * (mult[k] || 1);
    }
    // safety clamp: dodge must stay below 1 so the hero can never become un-hittable
    if (out.dodge > 0.99) out.dodge = 0.99;
    return out;
  };

  // ---- run upgrades (gold; price driven by run levels only) ----
  A.runUpgradeCost = function (state, id) {
    const up = A.UP_BY_ID[id]; if (!up) return 0;
    return up.gold.cost((state.run.levels[id] || 0));
  };
  A.runAtMax = function (state, id) {
    const perm = (state.meta.perm && state.meta.perm[id]) || 0;
    return perm + (state.run.levels[id] || 0) >= capOf(state.meta, id);
  };
  A.buyRunUpgrade = function (state, id) {
    const up = A.UP_BY_ID[id]; if (!up) return false;
    if (up.gated && !A.economyUnlocked(state.meta)) return false;
    if (A.runAtMax(state, id)) return false;
    const n = state.run.levels[id] || 0, cost = up.gold.cost(n);
    if (state.econ.gold < cost) return false;
    state.econ.gold -= cost; state.run.levels[id] = n + 1; return true;
  };

  // ---- permanent upgrades (cores; price driven by perm levels only) ----
  A.permCost = function (meta, id) {
    const up = A.UP_BY_ID[id]; const n = (meta && meta.perm && meta.perm[id]) || 0;
    return up ? up.core.cost(n) : 0;
  };
  A.permAtMax = function (meta, id) {
    return ((meta && meta.perm && meta.perm[id]) || 0) >= capOf(meta, id);
  };
  A.buyPerm = function (meta, id) {
    const up = A.UP_BY_ID[id]; if (!up) return false;
    if (up.gated && !A.economyUnlocked(meta)) return false;
    const n = (meta.perm && meta.perm[id]) || 0;
    if (n >= capOf(meta, id)) return false;
    const cost = up.core.cost(n);
    if ((meta.cores || 0) < cost) return false;
    meta.cores -= cost; meta.perm = meta.perm || {}; meta.perm[id] = n + 1; return true;
  };
})(window.ARENA = window.ARENA || {});
