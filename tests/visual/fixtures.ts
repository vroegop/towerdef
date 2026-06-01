/* tests/visual/fixtures.ts — deterministic HUD-state seeding for visual regression.
 *
 * The game reads its progression from localStorage (arena.meta / arena.settings) and its HUD skin
 * from arena.hud. By writing a known meta + skin BEFORE the page boots, then forcing the game into
 * a specific screen, we get a pixel-stable screenshot of each HUD state.
 *
 * `?dev=0` removes the dev overlay so it never pollutes a baseline. We disable the canvas game loop
 * (decorative particles use Math.random + a wall clock, so the arena background is intentionally NOT
 * part of the HUD baselines) by covering only HUD DOM in the screenshots. */
import type { Page } from '@playwright/test';

// A rich meta that unlocks every menu tab (cards, labs, tier 2) so each screen renders real content.
export const RICH_META = {
  coins: 125000,
  perm: { attackSpeed: 4, rangedDamage: 6, health: 8, regen: 3 },
  hasPlayed: true,
  bestWave: 120,
  claimedMilestones: { '10': true, '50': true },
  tier: 2,
  coinMult: 1,
  tierBest: { 1: 320, 2: 120 },
  gems: 240,
  cards: [
    { id: 'damage', stars: 7 },
    { id: 'power', stars: 3 },
    { id: 'haste', stars: 12 },
    { id: 'crit', stars: 5 },
    { id: 'vitality', stars: 9 },
  ],
  cardBuys: 4,
  totalWaves: 1840,
  waveTokensGranted: 18,
  labs: { dmgScale: 12, hpScale: 8, gameSpeed: 2 },
  research: [],
  labSlots: 2,
  vials: 60,
  // far in the past so the check-in button shows as "ready" deterministically
  lastCheckIn: 0,
  ultimates: {},
  ver: 2,
};

export const SETTINGS = { goldOnKill: true, coinOnKill: true, enemyHp: true, damageNumbers: true };

// Seed localStorage before any app code runs, so the boot reads our fixed state.
export async function seed(page: Page, opts: { hud?: string; meta?: object } = {}): Promise<void> {
  const meta = opts.meta || RICH_META;
  const hud = opts.hud || 'classic';
  await page.addInitScript(
    ([m, s, h]) => {
      localStorage.setItem('arena.meta', JSON.stringify(m));
      localStorage.setItem('arena.settings', JSON.stringify(s));
      localStorage.setItem('arena.hud', h as string);
      // Park the lastCheckIn far in the past so the Hero screen is deterministic.
      // (RICH_META already sets lastCheckIn: 0.)
    },
    [meta, SETTINGS, hud] as const,
  );
}

// Navigate, seed, and wait until the HUD menu DOM has rendered the bottom tab strip.
export async function bootToMenu(page: Page, hud = 'classic'): Promise<void> {
  await seed(page, { hud });
  await page.goto('/?dev=0');
  // The between-games menu is shown for a hasPlayed meta. Wait for its tab strip.
  await page.waitForSelector('#h-menu.show .menutabs button', { state: 'visible' });
  // Let fonts / theme stylesheet settle so themed skins paint consistently.
  await page.waitForTimeout(350);
}

// Click a bottom menu tab by its index (0 hero, 1 upgrades, 2 cards, 3 labs, 4 prestige).
export async function openMenuTab(page: Page, index: number): Promise<void> {
  const tabs = page.locator('#h-menu .menutabs button');
  await tabs.nth(index).click();
  await page.waitForTimeout(200);
}
