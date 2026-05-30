/* sim/waves.js — wave scheduling & difficulty curves (pure functions of wave number).
   A wave starts every WAVE.interval seconds; its enemies spawn over the first spawnWindow
   seconds. screenCap limits CONCURRENT enemies, so a bigger wave only adds pressure when
   the arena isn't already full. Strength/speed baselines rise with wave number. */
(function (A) {
  A.WAVE = {
    interval: 30,     // seconds between wave starts
    spawnWindow: 25,  // a wave's enemies all spawn within this many seconds of its start
    screenCap: 200,   // max concurrent enemies alive (the "screen cap" — stays fixed)
    baseCount: 8,     // enemies in wave 1
    perWave: 5,       // added per wave...
    maxCount: 140,    // ...up to this ceiling (the upgradable "spawn cap")
    strPerWave: 0.08, // +8% baseline strength per wave (the LINEAR term)
    expBase: 1.015,   // gentle EXPONENTIAL term blended on top so a "wall" emerges at depth
    speedPerWave: 0.02,
  };

  // First-run script: spawn a cluster on a fixed-radius ring so they converge together and a
  // no-input 1/1/1/1 hero dies at ~10s (deterministic across seeds). Tuned via headless harness.
  A.FIRST_RUN = { count: 10, gap: 0.05, speed: 42, radius: 500 };

  A.COIN_DECAY_WAVES = 3;    // a survivor older than this many waves...
  A.COIN_DECAY_FACTOR = 0.5; // ...pays only this share of its coin value (anti-kite rule)

  A.waveCount = function (n) {
    return Math.min(A.WAVE.maxCount, A.WAVE.baseCount + A.WAVE.perWave * (n - 1));
  };
  // Strength = linear ramp × gentle exponential. Wave 1 is exactly ×1 (both terms = 1), so the
  // scripted first run and early game are unchanged; the exponential only bites at depth, where it
  // races the player's compounding (multiplicative) power and creates the wall.
  // expBase 1.015 was chosen via tools/balance.js: gentler curves flatten the wall at ~120 (a
  // survival ceiling, not a DPS one) and make labs irrelevant; 1.015 keeps the HP/DPS race live so
  // perm levels and labs measurably push the wall outward (fresh→~2, light→~27, heavy→~101, +labs→~117).
  A.waveStr = function (n) { return (1 + A.WAVE.strPerWave * (n - 1)) * Math.pow(A.WAVE.expBase, n - 1); };
  A.waveSpeed = function (n) { return 1 + A.WAVE.speedPerWave * (n - 1); };

  // Game tiers (distinct from enemy A.TIERS strength classes): each tier doubles the
  // *effective* wave number, so tier 2 wave 4 plays like wave 8, tier 3 like wave 16, etc.
  A.MAX_TIER = 5;
  A.TIER_UNLOCK_WAVE = 300; // reach this wave in a tier to unlock the next one
  A.tierDifficulty = function (tier) { return Math.pow(2, ((tier || 1) - 1)); };
  // Core reward multiplier per tier: tier 1 is the 1x baseline; each higher tier adds +0.8x.
  A.coreMult = function (tier) { return 1 + 0.8 * ((tier || 1) - 1); };
  // Tier 1 is always open; tier N>1 needs TIER_UNLOCK_WAVE reached in the tier below.
  A.tierUnlocked = function (meta, tier) {
    if (tier <= 1) return true;
    const prevBest = (meta && meta.tierBest && meta.tierBest[tier - 1]) || 0;
    return prevBest >= A.TIER_UNLOCK_WAVE;
  };
})(window.ARENA = window.ARENA || {});
