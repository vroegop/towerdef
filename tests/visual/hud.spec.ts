/* tests/visual/hud.spec.ts — visual-regression screenshots of the game HUD / menu UI.
 *
 * Each test drives the game into a deterministic state (seeded localStorage) and compares the HUD
 * overlay against a committed baseline. Run `npm run test:visual` to compare, and
 * `npm run test:visual:update` to re-bless baselines after an intentional UI change.
 *
 * We screenshot the #hud overlay element (not the full page) so the screenshots cover the HUD/menu
 * chrome only — the canvas arena behind it is full of non-deterministic decorative particles and is
 * deliberately excluded from these baselines. */
import { test, expect } from '@playwright/test';
import { bootToMenu, openMenuTab } from './fixtures';

const HUDS = ['classic', 'dnd', 'arcade'] as const;
// Menu tabs that render rich content for our seeded meta: hero, upgrades, cards, labs.
const TABS: { index: number; name: string }[] = [
  { index: 0, name: 'hero' },
  { index: 1, name: 'upgrades' },
  { index: 2, name: 'cards' },
  { index: 3, name: 'labs' },
];

for (const hud of HUDS) {
  test.describe(`HUD: ${hud}`, () => {
    for (const tab of TABS) {
      test(`menu — ${tab.name}`, async ({ page }) => {
        await bootToMenu(page, hud);
        await openMenuTab(page, tab.index);
        const overlay = page.locator('#h-menu');
        await expect(overlay).toHaveScreenshot(`${hud}-menu-${tab.name}.png`);
      });
    }

    test('overview (run over)', async ({ page }) => {
      await bootToMenu(page, hud);
      // Drive the HUD straight to the game-over overview with a fixed earn summary.
      await page.evaluate(() => {
        // The menu's Start button begins a run; instead we directly show the overview via a
        // synthetic game-over by exiting immediately. Simplest deterministic path: reload into a
        // crafted save is complex, so we trigger the overview through the public start→exit flow.
      });
      // Start a run then immediately exit it to reach the overview deterministically.
      await page.locator('#h-start').click();
      await page.waitForTimeout(300);
      // open the side-menu rail, then the Run Stats panel, and use its Exit-run button (banks + shows overview)
      await page.locator('#h-menu-btn').click();
      await page.locator('#h-chart').click();
      await page.waitForSelector('#h-stats-exit', { state: 'visible' });
      await page.locator('#h-stats-exit').click();
      await page.waitForSelector('#h-over:not(.hide) .over-card', { state: 'visible' });
      await page.waitForTimeout(200);
      await expect(page.locator('#h-over')).toHaveScreenshot(`${hud}-overview.png`);
    });
  });
}

test('in-game top bar + upgrade dock', async ({ page }) => {
  await bootToMenu(page, 'classic');
  await page.locator('#h-start').click();
  await page.waitForTimeout(400);
  // open the attack subtab so the upgrade dock is expanded
  await page.locator('#h-tabs button').first().click();
  await page.waitForTimeout(200);
  // top bar
  await expect(page.locator('#h-top')).toHaveScreenshot('classic-ingame-topbar.png');
  // upgrade dock
  await expect(page.locator('#h-tabbar')).toHaveScreenshot('classic-ingame-dock.png');
  // side-menu rail (opened from the header menu toggle) — part of the redesigned in-game chrome
  await page.locator('#h-menu-btn').click();
  await page.waitForTimeout(150);
  await expect(page.locator('#h-sidemenu')).toHaveScreenshot('classic-ingame-sidemenu.png');
});
