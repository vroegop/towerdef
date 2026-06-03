/* tools/sim-dashboard/profiles.ts — predefined player profiles for the dashboard.
 *
 * A profile is just data (see Profile in ../sim-engine). Add/clone freely; the dashboard also lets
 * you tweak any of these live before running. `skillBoosts` multiply a single skill's pick-weight on
 * top of its category weight — e.g. { health: 4 } makes a player strongly prioritise buying Health.
 * `advanceAtWave` (optional) makes the player grind each tier to that wave before advancing; omit it
 * and the player instead maxes each tier out (advances only when it caps). */

import type { Profile } from '../sim-engine';

const base = {
  sessionsPerDay: 3,
  sessionMinutes: 25,
  unlockBudgetFrac: 0.5,
  maxLabSlots: 3,
  maxCardSlots: 6,
  labPriority: ['dmgLab', 'hpLab', 'gameSpeed', 'coinKillLab', 'goldKillLab', 'tierCoinLab', 'startGoldLab'],
  seed: 0x9e3779b1,
};

export const PROFILES: Profile[] = [
  { ...base, name: 'Balanced (Casual)', weights: { attack: 0.45, defense: 0.4, economic: 0.15 } },
  { ...base, name: 'Glass Cannon', weights: { attack: 0.7, defense: 0.2, economic: 0.1 }, skillBoosts: { rangedDamage: 3, critChance: 2 } },
  { ...base, name: 'Tank (Health-first)', weights: { attack: 0.25, defense: 0.6, economic: 0.15 }, skillBoosts: { health: 4, regen: 2 } },
  { ...base, name: 'Economist', weights: { attack: 0.35, defense: 0.3, economic: 0.35 }, skillBoosts: { coinsPerKill: 2, interest: 2 } },
  { ...base, name: 'Hardcore (more play)', sessionsPerDay: 6, sessionMinutes: 45, weights: { attack: 0.45, defense: 0.4, economic: 0.15 } },
  { ...base, name: 'Idle (away a lot)', sessionsPerDay: 2, sessionMinutes: 10, weights: { attack: 0.4, defense: 0.4, economic: 0.2 } },
  // Two grinders that farm each tier all the way to wave 6000 before advancing (health→defense,
  // damage→attack). The marquee skill is also boosted so the focus is on Health vs Damage specifically,
  // not just the whole category — tweak/remove the boost in the UI for pure category weighting.
  { ...base, name: 'Grinder · Health (w6k)', weights: { attack: 0.1, defense: 0.7, economic: 0.2 }, skillBoosts: { health: 3 }, advanceAtWave: 6000 },
  { ...base, name: 'Grinder · Damage (w6k)', weights: { attack: 0.7, defense: 0.1, economic: 0.2 }, skillBoosts: { rangedDamage: 3 }, advanceAtWave: 6000 },
];
