/* sim/skills.js — LITERAL integer stat model.
   Four core stats start at 1 (regen at 0). The number you see IS the value:
   damage 1 = 1 dmg/shot, attackSpeed 1 = 1 shot/sec, health 1 = 1 HP.

   Effective level = base + permanent levels (cores) + run levels (gold, the tabs).
   Run levels reset every game; permanent levels persist in meta. */
(function (A) {
  // `unit` = value the sim runs on per level. `disp` = number shown to the player per level.
  A.CORE = {
    rangedDamage: { base: 1, unit: 1,   disp: 1,   label: 'Ranged Damage' }, // dmg per shot
    attackSpeed:  { base: 1, unit: 1,   disp: 1,   label: 'Attack Speed' },  // shots per second
    health:       { base: 1, unit: 1,   disp: 1,   label: 'Health' },        // max HP
    regen:        { base: 0, unit: 0.2, disp: 0.2, label: 'Health Regen' },  // HP/sec
  };

  // The number the player reads for a stat at a given LEVEL.
  A.statDisplay = function (stat, level) {
    const v = level * A.CORE[stat].disp;
    return stat === 'regen' ? Math.round(v * 10) / 10 : v;
  };

  // In-game upgrades, grouped into the three bottom tabs. Bought with gold; reset each run.
  A.TABS = [
    { id: 'offense', label: 'Offense', ups: [
      { stat: 'rangedDamage', label: 'Ranged Damage', cost: (n) => Math.round(10 * 1.5 ** n) },
      { stat: 'attackSpeed',  label: 'Attack Speed',  cost: (n) => Math.round(15 * 1.6 ** n) },
    ] },
    { id: 'survival', label: 'Survival', ups: [
      { stat: 'health', label: 'Health', cost: (n) => Math.round(10 * 1.5 ** n) },
      { stat: 'regen',  label: 'Regen',  cost: (n) => Math.round(20 * 1.6 ** n) },
    ] },
  ];

  // Permanent upgrades (cores), ORDERED. Progressive reveal: skill[i] is only visible
  // once skill[i-1] is owned (level >= 1). Each adds +1 level to a core stat.
  A.PERM_UPGRADES = [
    { id: 'attackSpeed',  stat: 'attackSpeed',  label: 'Attack Speed',  cost: (n) => Math.round(3 * 2 ** n) },
    { id: 'rangedDamage', stat: 'rangedDamage', label: 'Ranged Damage', cost: (n) => Math.round(4 * 2 ** n) },
    { id: 'health',       stat: 'health',       label: 'Health',        cost: (n) => Math.round(4 * 2 ** n) },
    { id: 'regen',        stat: 'regen',        label: 'Health Regen',  cost: (n) => Math.round(5 * 2 ** n) },
  ];

  A.FIRST_PERM_COST = A.PERM_UPGRADES[0].cost(0); // cores the scripted first run grants

  // ---- CARDS (Pokemon-style; bought/upgraded with a separate active-play currency: TOKENS) ----
  // A card contributes one or more {stat, kind:'flat'|'mult'} effects; its magnitude is value(stars).
  // Stacking is resolved at calc time via the kind flag: effective = (base + flats) * prod(1 + mults).
  A.MAX_STARS = 15; // 5 white, then 5 gold, then 5 chromatic (each star raises value)
  A.CARDS = {
    damage: {
      id: 'damage', name: 'Bullseye', art: 'bullseye', tint: '#37d7ff',
      effects: [{ stat: 'rangedDamage', kind: 'flat' }],
      value: (stars) => (stars > 0 ? Math.pow(2, stars - 1) : 0), // 1,2,4,8,16...
      desc: (v) => '+' + v + ' ranged damage',
    },
  };
  // Card collection grid: CARD_SLOTS total slots; CARD_ORDER lists the defined cards in order.
  // To add a card later: define it in A.CARDS and append its id here (bump CARD_SLOTS if needed).
  A.CARD_SLOTS = 20;
  A.CARD_ORDER = ['damage'];
  A.cardValue = (id, stars) => (A.CARDS[id] ? A.CARDS[id].value(stars) : 0);
  A.cardsUnlocked = (meta) => (meta.bestWave || 0) >= 30; // unlocks at wave 30 (tier 1)
  A.grantInitialCard = function (meta) {
    if (A.cardsUnlocked(meta) && !(meta.cards && meta.cards.length)) { meta.cards = [{ id: 'damage', stars: 1 }]; return true; }
    return false;
  };
  // colour tier of star slot i (0-4) for a card at `stars` total: chromatic > gold > white > empty
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

  function permByStat(meta) {
    const perm = (meta && meta.perm) || {};
    const by = {};
    for (const up of A.PERM_UPGRADES) by[up.stat] = (by[up.stat] || 0) + (perm[up.id] || 0);
    return by;
  }

  // Turn levels into the numbers the sim runs on, then apply card bonuses.
  // Stacking is resolved at calc time per-modifier: effective = (base + Σflat) × Π(1 + mult).
  // Skill upgrades are flat levels today; cards declare flat/mult via their effect `kind`.
  const STAT2SIM = { rangedDamage: 'rangedDamage', attackSpeed: 'fireRate', health: 'maxHp', regen: 'regen' };
  A.computeStats = function (state) {
    const by = permByStat(state.meta);
    const run = (state.run && state.run.levels) || {};
    const lvl = {};
    for (const stat in A.CORE) lvl[stat] = A.CORE[stat].base + (by[stat] || 0) + (run[stat] || 0);
    const out = {
      lvl,
      rangedDamage: lvl.rangedDamage * A.CORE.rangedDamage.unit,
      fireRate:     lvl.attackSpeed * A.CORE.attackSpeed.unit,
      maxHp:        lvl.health * A.CORE.health.unit,
      regen:        lvl.regen * A.CORE.regen.unit,
      range: 220, goldFind: 1, xpGain: 1,
    };
    const cards = (state.meta && state.meta.cards) || [];
    if (cards.length) {
      const flat = {}, mult = {};
      for (const c of cards) {
        const def = A.CARDS[c.id]; if (!def) continue;
        const v = def.value(c.stars || 0);
        for (const e of def.effects) {
          if (e.kind === 'mult') mult[e.stat] = (mult[e.stat] || 1) * (1 + v);
          else flat[e.stat] = (flat[e.stat] || 0) + v;
        }
      }
      for (const stat in STAT2SIM) {
        const k = STAT2SIM[stat];
        out[k] = (out[k] + (flat[stat] || 0)) * (mult[stat] || 1);
      }
    }
    return out;
  };

  // ---- run upgrades (gold) ----
  function runDef(stat) { for (const t of A.TABS) for (const u of t.ups) if (u.stat === stat) return u; return null; }
  A.runUpgradeCost = function (state, stat) { const d = runDef(stat); return d ? d.cost(state.run.levels[stat] || 0) : 0; };
  A.buyRunUpgrade = function (state, stat) {
    const d = runDef(stat); if (!d) return false;
    const n = state.run.levels[stat] || 0, cost = d.cost(n);
    if (state.econ.gold < cost) return false;
    state.econ.gold -= cost; state.run.levels[stat] = n + 1; return true;
  };

  // ---- permanent upgrades (cores) ----
  A.permVisible = function (meta) {
    const perm = (meta && meta.perm) || {};
    const out = [];
    for (let i = 0; i < A.PERM_UPGRADES.length; i++) {
      const visible = i === 0 || (perm[A.PERM_UPGRADES[i - 1].id] || 0) >= 1;
      if (!visible) break;
      out.push(A.PERM_UPGRADES[i]);
    }
    return out;
  };
  A.permCost = function (meta, id) {
    const up = A.PERM_UPGRADES.find((u) => u.id === id);
    const n = (meta && meta.perm && meta.perm[id]) || 0;
    return up ? up.cost(n) : 0;
  };
  A.buyPerm = function (meta, id) {
    const up = A.PERM_UPGRADES.find((u) => u.id === id); if (!up) return false;
    const n = (meta.perm && meta.perm[id]) || 0, cost = up.cost(n);
    if ((meta.cores || 0) < cost) return false;
    meta.cores -= cost; meta.perm = meta.perm || {}; meta.perm[id] = n + 1; return true;
  };
})(window.ARENA = window.ARENA || {});
