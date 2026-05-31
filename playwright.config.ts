import { defineConfig, devices } from '@playwright/test';

// Visual-regression harness for the game HUD / UI. Playwright boots the Vite dev server,
// drives the game into deterministic states (via seeded localStorage), and compares each
// state against a committed baseline screenshot. `npm run test:visual:update` re-blesses
// baselines after an intentional UI change.
//
// Snapshot file names include the OS (Playwright default), so baselines are per-platform:
// the committed ones are generated on this repo's CI/dev container (linux). On a different
// OS (e.g. macOS) run `npm run test:visual:update` once to generate local baselines.
export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './tests/visual/__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  // Deterministic viewport so layout-sensitive screenshots are stable run-to-run.
  use: {
    baseURL: 'http://localhost:8778',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  },
  // Pixel-diff tolerance: small enough to catch real visual regressions, large enough to
  // absorb sub-pixel anti-aliasing noise. Tune per-assertion where needed.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch: if PW_CHROMIUM_PATH is set, use that browser binary instead of the one
        // Playwright bundles. Lets the screenshots run in environments where the matching browser
        // build can't be downloaded but a compatible Chromium is already present. Normal users just
        // run `npx playwright install` and leave this unset.
        ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
      },
    },
  ],
  // Reuse a running dev server locally; start one in CI / fresh runs.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8778',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
