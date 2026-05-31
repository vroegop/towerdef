/* hud/registry.js — the list of swappable HUDs.
   Each entry: { label, load } where load() returns a HUD FACTORY (root, handlers) => instance,
   OR a Promise of one (the host awaits load(), so a lazy `import()` would work too).
   The dev menu renders this list; the HUD host (host.js) calls load() + the factory inside an
   error boundary, so a missing/broken HUD can never take down the running game.

   Add a skin: the lightweight way is to reuse the themeable core — `A.createThemedHud({ cls, css })`
   in a huds/<name>.js included via <script> in index.html (see huds/dnd.js / huds/arcade.js) — then
   add one line here. A fully bespoke HUD can instead supply its own factory (root, handlers) => ...
   with the same method surface as A.Hud (update/showMenu/.../setMeta). */
(function (A) {
  // All HUDs eager-load: classic is defined in hud/hud.js, the themed skins in huds/<id>.js,
  // each included via a plain <script> in index.html BEFORE the registry. load() therefore
  // returns the factory synchronously (no import()) — eager by request; the bundles are small.
  A.HUDS = {
    classic: { label: 'Classic', load: () => A.Hud },             // original look; the host's crash fallback
    dnd:     { label: 'D&D',     load: () => A.createDndHud },     // parchment character-sheet skin
    arcade:  { label: 'Arcade',  load: () => A.createArcadeHud },  // CRT-cabinet pixel skin
  };
  // Booted synchronously by the host, so it MUST be a sync-loading entry. Default to Classic for now;
  // the devmenu remembers any other pick in localStorage (arena.hud) and index.html re-applies it.
  A.DEFAULT_HUD = 'classic';
})(window.ARENA = window.ARENA || {});
