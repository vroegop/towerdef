/* sim/registries.js — the two data axes. Add a row here, the whole game adapts.
   TYPES = shape + behavior + base numbers.  TIERS = color + strength/reward multiplier. */
(function (A) {
  // Integer base stats to match the literal hero model. hp/dmg are multiplied by the
  // tier multiplier and wave growth, then rounded (min 1). A 1-damage hero one-shots a weak enemy.
  A.TYPES = {
    melee:    { shape: 'square',   behavior: 'stick',  hp: 1,   dmg: 1,   speed: 46, range: 0,   r: 11 },
    ranged:   { shape: 'triangle', behavior: 'bounce', hp: 1,   dmg: 1,   speed: 34, range: 150, r: 11 },
    boss:     { shape: 'hexagon',  behavior: 'stick',  hp: 10,  dmg: 3,   speed: 22, range: 0,   r: 22 },
    // ---- archetypes (Phase 5): distinct shapes + behaviours, each teaching a counter ----
    fast:     { shape: 'diamond',  behavior: 'stick',  hp: 0.4, dmg: 0.6, speed: 92, range: 0,   r: 9  }, // swarm → attack speed / multishot
    tank:     { shape: 'square',   behavior: 'stick',  hp: 6,   dmg: 1.6, speed: 24, range: 0,   r: 17 }, // wall → raw damage / rend
    splitter: { shape: 'pentagon', behavior: 'stick',  hp: 1.2, dmg: 1,   speed: 40, range: 0,   r: 13, splits: 3 }, // → AoE; drops cells
    vampire:  { shape: 'pentagon', behavior: 'stick',  hp: 2,   dmg: 1.2, speed: 32, range: 0,   r: 12, vamp: 0.5 }, // heals on hit; drops cells
    protector:{ shape: 'hexagon',  behavior: 'stick',  hp: 3,   dmg: 1,   speed: 26, range: 0,   r: 14, aura: 0.5, auraR: 120 }, // shields nearby
  };

  A.TIERS = {
    weak:    { color: '#3ddc84', stat: 1, reward: 1 }, // green
    average: { color: '#4aa8ff', stat: 2, reward: 2 }, // blue
    hard:    { color: '#e64cff', stat: 4, reward: 4 }, // pink/purple
    elite:   { color: '#ffd24a', stat: 8, reward: 8 }, // gold
  };
})(window.ARENA = window.ARENA || {});
