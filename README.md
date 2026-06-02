# Arena — Hero vs Horde

A deterministic, browser-based tower-defense / roguelite. A single hero auto-fights endless
waves; you spend earned currencies on upgrades, cards, and timed lab research between (and during)
runs. Battles continue offline by replaying the elapsed time on resume.

Built with TypeScript + Vite. No runtime framework — the game is a plain ES-module graph rooted at
`src/main.ts`, bundled by Vite into a static, no-runtime site.

## Commands

```bash
npm run dev            # Vite dev server on http://localhost:8778 (fixed port, no-store caching)
npm run build          # tsc --noEmit + vite build → dist/ (what GitHub Pages deploys)
npm run preview        # serve the production build on :8778
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run test           # vitest (unit: sim/balance)
npm run test:visual    # playwright screenshot diffs of the HUD (browsers required locally)
npm run test:visual:update   # re-bless HUD screenshot baselines after an intentional UI change
npm run check          # typecheck + lint + unit tests
npm run balance        # tsx tools/balance.ts — headless balance harness
```

Deployment: `.github/workflows/pages.yml` builds on push to `main` and publishes `dist/` to GitHub
Pages. `index.html` points at `/src/main.ts` (TypeScript) which only the dev server can transpile, so
**the raw repo must never be served directly** — only the Vite `dist/` output. `vite.config.ts` sets
`base: './'` so the bundle works from any sub-path.

## Architecture: SIM / RENDER / HUD

Three layers with a strict one-way dependency flow. `src/main.ts` is the **only** module that touches
the browser lifecycle (canvas, `localStorage`, `requestAnimationFrame`, visibility) and wires the
three together.

```
src/sim/      pure game logic & rules — no DOM, no canvas, no Date.now() in a step
src/render/   reads a sim snapshot and paints it — never mutates the sim, holds no rules
src/hud/      DOM overlay: menus, upgrade docks, modals, the swappable-HUD host + dev menu
src/huds/     themed HUD skins (D&D) built on the one themeable HUD core
src/main.ts   boot + fixed-timestep loop + persistence + offline catch-up (the only lifecycle owner)
```

### Must-not-break invariants

These are the load-bearing rules of the codebase. Breaking one reintroduces non-determinism,
save corruption, or layering bugs.

- **The sim never imports render or hud; render/hud never mutate the sim.** Render and HUD read
  `sim.snapshot()` (read-only state) and call back through explicit handlers. This is the seam that
  lets HUDs and renderers be swapped freely.
- **Determinism rests entirely on the seeded PRNG** (`src/sim/rng.ts`, mulberry32; state is one
  uint32 saved with the game). Never call `Math.random()` or read `Date.now()` inside a sim step —
  time inside the sim is the tick counter only.
- **One `step(dt)` drives both live play and offline catch-up.** There is no second "offline engine"
  (a divergent replay would be an exploit). Offline = the same `step()` in a tight, render-free loop
  (`src/sim/offline.ts`, fixed `DT = 1/30`, capped at 12h), which **stops the instant the hero dies**
  — it never simulates past death.
- **Wall-clock vs sim-clock split.** Anything driven by real elapsed time (lab research timers, the
  15-minute check-in) lives *outside* `step()`. Game-speed multipliers that *do* enter the sim must
  remain pure math so offline replay stays identical.
- **Decorative effects are invented in render/HUD and discarded on reload** — they are never part of
  saved or authoritative state.
- **Save migration is forward-only and idempotent** (`migrateMeta` in `src/sim/labs.ts`): new
  `meta.*` fields are backfilled on load so old saves keep working. Add new fields there.

### Renderer contract

A renderer is `(canvasOrRoot) => { resize(), draw(snapshot, alpha, paused) }`. From the snapshot it
may **read only**: positions, velocities, `facing`, `hp`/`shield`, `type`/`tier` (color lookup),
`state`, `hitFlash`, `veteran`, `effects`, `econ`. It must **never** change those values, decide
damage, or spawn enemies. `alpha` is the leftover-accumulator fraction for interpolating between
fixed ticks; `paused` freezes the decorative clock for frame inspection. Today there is one renderer,
`src/render/canvas2d.ts`; a WebGL/Pixi/Three prototype can drop in against the same contract.

### Upgrade / stat model

One `UPGRADES` list (`src/sim/skills.ts`); every upgrade is buyable in two contexts — in-run with
gold (`run.levels[id]`, resets each run) and out-of-run with cores (`meta.perm[id]`, permanent). The
effective level is `perm + run`, capped at the upgrade's `max` **plus** any cap lift from labs
(`upgradeCap` / `capOf`). Final stats resolve in three buckets to keep balance sane:
`effective = (base + Σ flat) × Π (1 + mult%)` with card and lab modifiers folded in by sim-stat key.

## HUD system

The game loop never talks to a HUD directly — it talks to the **HUD host** (`src/hud/host.ts`), a
proxy + error boundary. If the active HUD throws in any method (or fails to build), the host catches
it, reports it, and reverts to the last-good HUD, so a broken skin can never crash `frame()`. Swaps
go through `host.switchTo(name)`; the dev menu remembers the choice in `localStorage` (`arena.hud`).

All HUDs are **one themeable core** (`src/hud/hud.ts` — identical structure and wiring) restyled by a
scoping class plus an injected override stylesheet. Adding a skin = `createThemedHud({ cls, css })`.

One HUD ships, registered in `src/hud/registry.ts`:

| id    | label | look                                                            |
|-------|-------|-----------------------------------------------------------------|
| `dnd` | D&D   | parchment character sheet, hexagonal ability-score currency chips |

The dev overlay (`src/hud/devmenu.ts`) lives outside the swappable root (appended to `<body>`) so it
survives HUD swaps; it exposes cheats, time-skip, and the HUD switcher. HUD visual regressions are
covered by `tests/visual/hud.spec.ts` (screenshots of `dnd` across menu tabs and the run-over
overview); re-bless baselines with `npm run test:visual:update` after intentional UI changes.

## Technical backlog (non-game)

Genuinely-technical, still-open items (game/feature ideas are intentionally not tracked here):

- **Sim → Web Worker.** The sim has no DOM dependencies, so the step loop and offline catch-up could
  run off the main thread to keep heavy late-game frames smooth.
- **Spatial partitioning for collisions.** Hitboxes are circular and checked O(n) today; introduce a
  grid only once enemy counts make it necessary.
- **Coin-decay on long-lived enemies** is specced but not wired — without it, kiting one wave forever
  is an income exploit.
