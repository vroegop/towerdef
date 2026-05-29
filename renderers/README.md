# renderers/

Swappable render prototypes. **A renderer only ever reads a sim snapshot** — it must never
mutate sim state or contain game rules. This is the seam that lets you drop in a different
engine (Canvas2D today; WebGL, Pixi, Three.js, even a DOM/SVG experiment) without touching
`sim/`.

## The renderer contract

```js
ARENA.SomeRenderer = function (canvasOrRoot) {
  return {
    resize() { /* recompute backing size; called on viewport change */ },
    draw(snapshot, alpha) {
      // snapshot = sim.snapshot() — read-only.
      // alpha = leftover/DT in [0,1) for interpolation between fixed sim ticks.
      // Decorative effects (sparks, shake, smoke) are INVENTED here and discarded on reload.
    },
  };
};
```

What a renderer is allowed to read from the snapshot: positions, velocities, `facing`,
`hp/shield`, `type`/`tier` (color lookup only), `state`, `hitFlash`, `veteran`, `effects`,
`econ`. What it must NOT do: change those values, decide damage, or spawn enemies.

## Current

- `canvas2d/renderer.js` — the simple-shapes renderer (M0/M1). Circles = hero, squares =
  melee, triangles = ranged, hexagons = bosses; color = tier; a faint extra ring marks an
  aged "veteran" survivor.

## Adding a prototype

Create `renderers/<name>/renderer.js`, expose `ARENA.<Name>Renderer`, and point
`index.html` at it. Run two side by side to compare feel — same sim, different paint.
