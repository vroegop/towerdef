/* hud/registry.js — the list of swappable HUDs.
   Each entry: { label, load } where load() returns a HUD FACTORY (root, handlers) => instance,
   OR a Promise of one (so prototypes can be lazily `import()`ed only when first selected).
   The dev menu renders this list; the HUD host (host.js) calls load() + the factory inside an
   error boundary, so a missing/broken prototype can never take down the running game.

   Add a prototype: drop huds/<name>.js (an ES module `export default (root, handlers) => ...`)
   and add one line here. See huds/minimal.js for the reference implementation. */
(function (A) {
  A.HUDS = {
    classic: { label: 'Classic', load: () => A.Hud }, // the original HUD; always available, loads sync
    minimal: { label: 'Minimal', load: () => import('../huds/minimal.js').then((m) => m.default) },
  };
  // Booted synchronously by the host, so it MUST be a sync-loading entry (classic qualifies).
  A.DEFAULT_HUD = 'classic';
})(window.ARENA = window.ARENA || {});
