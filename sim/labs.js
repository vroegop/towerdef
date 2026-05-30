/* sim/labs.js — the LAB layer: the ceiling + slope engine.

   Labs live ENTIRELY OUTSIDE the deterministic run sim. They advance on the wall
   clock (Date.now()), in menus and while offline, so they never touch the seeded
   replay. A lab does one of three things:
     • kind 'cap'    → raises an upgrade's effective max  (lets the workshop fill higher)
     • kind 'scale'  → multiplies a sim stat               (every workshop level worth more)
     • kind 'special'→ drives a global outside the stat block (game speed, lab speed)

   Research is real-time: starting a lab records { id, endsAt } against the wall clock.
   A.reconcileResearch(meta, now) is called on load / focus / tick to complete anything
   whose endsAt has passed. Nothing here is ever called from inside Sim.step. */
(function (A) {
  // cost factory: round(base · grow^n) — `at(n)` is the price/time of the NEXT level n.
  const lcurve = (base, grow) => ({ base, grow, at: (n) => Math.round(base * Math.pow(grow, n)) });

  // Starter roster (Phase 1 MVP). `per` is the per-level effect; `max` the level cap;
  // `coin` is the cores price curve, `time` the wall-clock seconds curve; `gate.wave`
  // is the best-wave milestone that unlocks it. cat groups them in the Lab menu.
  // Labs make your SKILLS more EFFECTIVE — they multiply the stat itself, not its level cap.
  // (Caps almost never bind in practice: income limits you far below them. So the lab roster is
  //  all 'scale' research plus two 'special' globals; the cap-lab machinery still exists for later.)
  A.LABS = [
    // ---- ATTACK ----
    { id: 'dmgScale',  cat: 'attack',  kind: 'scale',   target: 'rangedDamage', label: 'Damage Amplifier',
      per: 0.04, max: 50, coin: lcurve(60, 1.15),  time: lcurve(90, 1.18),  gate: { wave: 30 } },
    { id: 'rateScale', cat: 'attack',  kind: 'scale',   target: 'fireRate',     label: 'Fire-Rate Amplifier',
      per: 0.03, max: 50, coin: lcurve(70, 1.15),  time: lcurve(100, 1.18), gate: { wave: 45 } },
    { id: 'critScale', cat: 'attack',  kind: 'scale',   target: 'critMult',     label: 'Crit Amplifier',
      per: 0.03, max: 50, coin: lcurve(90, 1.16),  time: lcurve(140, 1.20), gate: { wave: 70 } },
    // ---- DEFENSE ----
    { id: 'hpScale',   cat: 'defense', kind: 'scale',   target: 'maxHp',        label: 'Health Amplifier',
      per: 0.04, max: 50, coin: lcurve(60, 1.15),  time: lcurve(90, 1.18),  gate: { wave: 30 } },
    { id: 'regenScale',cat: 'defense', kind: 'scale',   target: 'regen',        label: 'Regen Amplifier',
      per: 0.05, max: 50, coin: lcurve(70, 1.15),  time: lcurve(110, 1.19), gate: { wave: 60 } },
    // ---- UTILITY ----
    { id: 'coinScale', cat: 'utility', kind: 'scale',   target: 'goldFind',     label: 'Coin Amplifier',
      per: 0.08, max: 40, coin: lcurve(80, 1.16),  time: lcurve(120, 1.20), gate: { wave: 50 } },
    // Game Speed: 8 levels, +0.5x each → 5x at max. Research time doubles each level (1h→128h,
    // ~255h to max) — the long-haul lever that compresses thousands of game-hours into real days.
    // Headroom left for a later premium +1x (→6x). gameSpeed scales the loop's step count, not DT.
    { id: 'gameSpeed', cat: 'utility', kind: 'special', target: 'gameSpeed',    label: 'Game Speed',
      per: 0.5,  max: 8,  coin: lcurve(500, 2.0),  time: lcurve(3600, 2),   gate: { wave: 50 } },
    { id: 'labSpeed',  cat: 'utility', kind: 'special', target: 'labTime',      label: 'Research Speed',
      per: 0.02, max: 25, coin: lcurve(150, 1.20), time: lcurve(240, 1.22), gate: { wave: 100 } },
  ];
  A.LAB_BY_ID = {};
  for (const L of A.LABS) A.LAB_BY_ID[L.id] = L;
  A.labsIn = (cat) => A.LABS.filter((L) => L.cat === cat);
  A.LAB_CATS = ['attack', 'defense', 'utility'];

  // ---- pure level/effect helpers (read meta.labs = { labId: completedLevel }) ----
  const lvl = (meta, id) => (meta && meta.labs && meta.labs[id]) || 0;
  A.labLevel = lvl;

  // cap labs: how much extra `max` a given upgrade id has earned.
  A.labCapBonus = function (meta, upgradeId) {
    let b = 0;
    for (const L of A.LABS) if (L.kind === 'cap' && L.target === upgradeId) b += L.per * lvl(meta, L.id);
    return b;
  };
  // scale labs: a dict { simStatKey: 1 + Σ per·level } applied multiplicatively in computeStats.
  A.labScaleMults = function (meta) {
    const out = {};
    for (const L of A.LABS) {
      if (L.kind !== 'scale') continue;
      out[L.target] = (out[L.target] || 1) + L.per * lvl(meta, L.id);
    }
    return out;
  };
  // special: live game-speed multiplier (folded into the loop's step count, never into a step).
  A.gameSpeed = function (meta) { return 1 + lvl(meta, 'gameSpeed') * A.LAB_BY_ID.gameSpeed.per; };
  // special: research-time reduction (capped at 50%).
  A.labSpeedReduction = function (meta) { return Math.min(0.5, lvl(meta, 'labSpeed') * A.LAB_BY_ID.labSpeed.per); };

  // ---- gating / pricing for the NEXT level of a lab ----
  A.labUnlocked = function (meta, id) {
    const L = A.LAB_BY_ID[id]; if (!L) return false;
    return (meta && meta.bestWave || 0) >= ((L.gate && L.gate.wave) || 0);
  };
  // the Lab menu tab itself opens once the first lab's gate is reachable (keeps the tutorial clean).
  A.labsTabUnlocked = function (meta) { return (meta && meta.bestWave || 0) >= 30; };
  // wall-clock seconds remaining for an in-progress lab (for the progress bar).
  A.researchRemaining = function (meta, id, nowMs) { const r = A.researchOf(meta, id); return r ? Math.max(0, (r.endsAt - nowMs) / 1000) : 0; };
  A.researchProgress = function (meta, id, nowMs) {
    const r = A.researchOf(meta, id); if (!r) return 0;
    const total = A.LAB_BY_ID[id].time.at(lvl(meta, id)) * (1 - A.labSpeedReduction(meta)) * 1000;
    return total > 0 ? Math.max(0, Math.min(1, 1 - (r.endsAt - nowMs) / total)) : 1;
  };
  A.labAtMax = function (meta, id) { const L = A.LAB_BY_ID[id]; return lvl(meta, id) >= (L ? L.max : 0); };
  A.labCoinCost = function (meta, id) { const L = A.LAB_BY_ID[id]; return L ? L.coin.at(lvl(meta, id)) : 0; };
  // wall-clock seconds for the next level, after the lab-speed reduction.
  A.labTimeSec = function (meta, id) {
    const L = A.LAB_BY_ID[id]; if (!L) return 0;
    return Math.max(1, Math.round(L.time.at(lvl(meta, id)) * (1 - A.labSpeedReduction(meta))));
  };

  // ---- research lifecycle (wall-clock; meta-only; safe to advance from any delta) ----
  A.researchOf = function (meta, id) { return (meta.research || []).find((r) => r.id === id) || null; };
  A.freeSlots = function (meta) { return Math.max(0, (meta.labSlots || 1) - (meta.research || []).length); };

  // Begin researching a lab's next level. Deducts cores up front (refunded on cancel).
  A.startResearch = function (meta, id, nowMs) {
    if (!A.labUnlocked(meta, id) || A.labAtMax(meta, id)) return false;
    if (A.researchOf(meta, id)) return false;            // already in progress
    if (A.freeSlots(meta) <= 0) return false;            // no free slot
    const cost = A.labCoinCost(meta, id);
    if ((meta.cores || 0) < cost) return false;
    meta.cores -= cost;
    meta.research = meta.research || [];
    meta.research.push({ id, cost, endsAt: nowMs + A.labTimeSec(meta, id) * 1000 });
    return true;
  };

  // Cancel an in-progress lab: refund its cores, free the slot. (No partial-progress memory yet.)
  A.cancelResearch = function (meta, id) {
    const r = A.researchOf(meta, id); if (!r) return false;
    meta.cores = (meta.cores || 0) + (r.cost || 0);
    meta.research = (meta.research || []).filter((x) => x.id !== id);
    return true;
  };

  // Rush an in-progress lab by spending cells: halves its remaining time. Cost scales with the
  // time skipped (1 cell per 2 minutes remaining, min 1) — the primary sink for farmed cells.
  A.rushCellCost = function (meta, id, nowMs) {
    const r = A.researchOf(meta, id); if (!r) return 0;
    return Math.max(1, Math.ceil(Math.max(0, (r.endsAt - nowMs) / 1000) / 120));
  };
  A.rushResearch = function (meta, id, nowMs) {
    const r = A.researchOf(meta, id); if (!r) return false;
    const cost = A.rushCellCost(meta, id, nowMs);
    if ((meta.cells || 0) < cost) return false;
    meta.cells -= cost;
    r.endsAt = nowMs + Math.max(0, (r.endsAt - nowMs) * 0.5);
    return true;
  };

  // Complete every research whose timer has elapsed. Returns the list of completed lab ids.
  // Idempotent and order-independent — safe to call on load, focus, and on a periodic tick.
  A.reconcileResearch = function (meta, nowMs) {
    if (!meta.research || !meta.research.length) return [];
    const done = [], keep = [];
    for (const r of meta.research) {
      if (nowMs >= r.endsAt) { meta.labs = meta.labs || {}; meta.labs[r.id] = (meta.labs[r.id] || 0) + 1; done.push(r.id); }
      else keep.push(r);
    }
    meta.research = keep;
    return done;
  };

  // ---- concurrent research slots (a premium-currency / token sink; 1 → MAX_SLOTS) ----
  A.MAX_SLOTS = 5;
  A.labSlotCost = function (meta) { return 25 * Math.pow(2, Math.max(0, (meta.labSlots || 1) - 1)); }; // 25,50,100,200
  A.buyLabSlot = function (meta) {
    if ((meta.labSlots || 1) >= A.MAX_SLOTS) return false;
    const cost = A.labSlotCost(meta);
    if ((meta.tokens || 0) < cost) return false;
    meta.tokens -= cost; meta.labSlots = (meta.labSlots || 1) + 1; return true;
  };

  // ---- meta defaults / migration (idempotent; additive only, never destructive) ----
  A.META_VER = 2;
  A.migrateMeta = function (meta) {
    if (!meta) return meta;
    if (meta.labs == null) meta.labs = {};
    if (!Array.isArray(meta.research)) meta.research = [];
    if (meta.labSlots == null) meta.labSlots = 1;
    if (meta.cells == null) meta.cells = 0;
    if (meta.ultimates == null) meta.ultimates = {};
    meta.ver = A.META_VER;
    return meta;
  };
})(window.ARENA = window.ARENA || {});
