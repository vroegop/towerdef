# Super Weapons — Design & Balance dashboard

A standalone dev tool for designing and balancing the game's **super weapons** (the Prestige-tab
"superpowers": Moat, Golden Lightning, Crystal Circle, plus a shelf of new proposals). It is not part
of the shipped game bundle — like `tools/sim-dashboard`, it is served by Vite on demand.

```bash
npm run super:dashboard
```

## On GitHub Pages

The dashboard ships with the game build, so it's reachable on the deployed site (the Vite build emits
it under `/tools/` — see `rollupOptions.input` in `vite.config.ts`). After this lands on `main` and the
Pages workflow runs:

- dashboard → `https://vroegop.github.io/towerdef/tools/superweapons-dashboard/`
- art gallery → `https://vroegop.github.io/towerdef/tools/superweapons-dashboard/art-gallery.html`

(Pages only deploys from `main`, so it goes live once this PR is merged.)

## What it does

- **Loads the current powers live** from `src/sim/superpowers.ts`, so Moat & friends always show their
  real, current balances — edit them in place.
- **Proposes new super weapons** (Meteor Storm, Chain Tesla, Inferno Ring, Frost Nova, Aegis Bulwark,
  Singularity, Chrono Field, Midas Rain, Mirror Turret, Soul Harvest) as starting points to tune.
- **Example art** for every weapon, drawn in the in-game icon idiom, shown on a little arena backdrop
  so you can feel what it would look like before building it for real. Swap a weapon's art from the
  swatch picker.
- **Everything is editable**: name, category, blurb, art, each track's value curve (base + per level),
  max level, the Energy cost to unlock (the purchase-order ladder) and the Energy cost per upgrade
  (`cost¹ + per`). Add/remove tracks, add/duplicate/delete/reorder weapons. Edits persist to
  `localStorage`.
- **Suggest upgrades**: a planner that, given an Energy budget, spits out a concrete shopping list
  (what to unlock, which track levels to buy, in order) plus a value-per-Energy view to spot
  over/under-priced knobs.
- **Export** the result as a `src/sim/superpowers.ts`-shaped snippet (rebalances the live powers
  verbatim; stubs the proposed ones — their *mechanics* still need wiring in `tickSuperpowers`, and a
  new `icon` registered in `src/hud/hud.ts`), or as re-importable JSON.

## Files

| file          | purpose                                                            |
|---------------|--------------------------------------------------------------------|
| `weapons.ts`  | the editable catalog + balance maths (value/cost), loads the game registry |
| `art.ts`      | bespoke 24×24 SVG example art per weapon                           |
| `planner.ts`  | pure "suggest upgrades" logic (build planner + value-efficiency)  |
| `main.ts`     | the dashboard UI (editor, art preview, economy, planner, export)  |
| `index.html`  | shell + styling                                                    |
| `art-gallery.html` | a self-contained, no-build snapshot of every weapon's art (open directly in a browser) |
