/* hud/host.js — the HUD host: a proxy + error boundary that sits between index.html's call
   sites and whichever HUD is currently active. The game loop only ever talks to this facade,
   so a HUD that throws or fails to load can NEVER crash frame().

   Guarantees:
   - A failed swap (load reject / not-a-factory) keeps the current working HUD untouched.
   - A throw while BUILDING a HUD, or a runtime throw from an active HUD method, auto-reverts
     to the last-good HUD (falling back to DEFAULT_HUD) so the game keeps running.
   - A HUD missing one of the facade methods just no-ops that call (partial prototypes are fine).
   - setDevToggle is routed to the host-level dev menu, not the HUD (the dev menu survives swaps).

   createHudHost(root, handlers, { reenter }) → facade with the same method names index.html
   already called on A.Hud(), plus switchTo(name), attachDevMenu(dm), getActiveName().
   `reenter(instance)` is supplied by index.html: it re-applies the CURRENT view (menu / playing /
   overview) to a freshly-built HUD so a mid-game swap shows the right screen instantly. */
(function (A) {
  // The methods index.html invokes on the HUD. setDevToggle is handled specially (routed to
  // the dev menu); destroy() is an optional teardown hook the host calls before swapping away.
  const METHODS = ['update', 'showMenu', 'refreshMenu', 'hideMenu', 'showOverview', 'hideOverview', 'showHint', 'hideHint', 'setMeta'];

  A.createHudHost = function (root, handlers, opts) {
    opts = opts || {};
    const reenter = typeof opts.reenter === 'function' ? opts.reenter : function () {};
    let current = null, currentName = null, lastGoodName = null;
    let faulted = false, switching = false, devMenu = null;

    function report(msg, err) {
      if (err) console.error('[HUD]', msg, err); else console.info('[HUD]', msg);
      if (devMenu && devMenu.report) try { devMenu.report(msg, !!err); } catch (e) {}
    }

    // A method on the live HUD threw at runtime. Mark faulted (so we stop hammering a broken
    // HUD every frame) and revert to the last-good HUD on a fresh microtask.
    function fault(where, err) {
      if (faulted) return;
      faulted = true;
      report('HUD "' + currentName + '" threw in ' + where + '() — reverting', err);
      const fb = (lastGoodName && lastGoodName !== currentName) ? lastGoodName : A.DEFAULT_HUD;
      if (fb === currentName) { report('no safe fallback (even "' + fb + '" is faulting); game runs without a HUD'); return; }
      Promise.resolve().then(() => switchTo(fb, true));
    }

    // Forward one facade call into the active HUD, swallowing any throw into the error boundary.
    function call(name, args) {
      if (faulted || !current) return;
      const fn = current[name];
      if (typeof fn !== 'function') return; // missing-method fallback: no-op
      try { return fn.apply(current, args); }
      catch (e) { fault(name, e); }
    }

    function teardown() {
      if (current && typeof current.destroy === 'function') { try { current.destroy(); } catch (e) { report('destroy() threw', e); } }
      root.innerHTML = '';
    }

    // Swap to HUD `name`. Async because prototypes load via import(). The current HUD keeps
    // running untouched during the LOAD, so a slow/failed load never disturbs play. Only once the
    // factory resolves do we tear the old HUD down and build the new one.
    function switchTo(name, isRevert) {
      const entry = A.HUDS[name];
      if (!entry) { report('unknown HUD "' + name + '"'); return Promise.resolve(false); }
      if (switching) { report('swap already in progress; ignored "' + name + '"'); return Promise.resolve(false); }
      if (name === currentName && !faulted) { return Promise.resolve(true); }
      switching = true;
      const prevGood = (!faulted && currentName) ? currentName : lastGoodName;
      return Promise.resolve().then(entry.load).then((factory) => {
        if (typeof factory !== 'function') throw new Error('load() for "' + name + '" did not return a factory function');
        teardown(); // load succeeded: now it's safe to remove the old HUD
        let inst;
        try { inst = factory(root, handlers); }
        catch (e) {
          // Build threw AFTER teardown — root is blank. Revert via switchTo (which awaits load),
          // so reverting to an ASYNC prototype works too. Releasing `switching` first lets it run.
          switching = false;
          const fb = (prevGood && prevGood !== name) ? prevGood : A.DEFAULT_HUD;
          report('HUD "' + name + '" factory threw while building — reverting to "' + fb + '"', e);
          if (fb === name) { current = null; currentName = name; faulted = true; if (devMenu && devMenu.refresh) devMenu.refresh(); return false; }
          return switchTo(fb, true);
        }
        current = inst; currentName = name; faulted = false;
        lastGoodName = prevGood || (name === A.DEFAULT_HUD ? name : lastGoodName);
        let reErr = null;
        try { reenter(inst); } catch (e) { reErr = e; }
        switching = false;
        if (devMenu && devMenu.refresh) devMenu.refresh();
        if (reErr) { fault('reenter', reErr); return false; } // revert (async) handled by fault()
        if (!isRevert) report('switched to "' + name + '"');
        return true;
      }).catch((err) => {
        // load failed (missing file, network, bad module) — the current HUD was never touched.
        switching = false;
        report('failed to load HUD "' + name + '" — keeping "' + currentName + '"', err);
        if (devMenu && devMenu.refresh) devMenu.refresh();
        return false;
      });
    }

    // Boot the default HUD synchronously so the facade is live before index.html's first call.
    (function mountDefault() {
      const entry = A.HUDS[A.DEFAULT_HUD];
      if (!entry) { report('DEFAULT_HUD "' + A.DEFAULT_HUD + '" not registered'); return; }
      const factory = entry.load();
      if (typeof factory !== 'function') { report('DEFAULT_HUD must load synchronously'); return; }
      // No reenter at boot: index.html drives the first showMenu/startRun itself.
      try { current = factory(root, handlers); currentName = A.DEFAULT_HUD; lastGoodName = A.DEFAULT_HUD; }
      catch (e) { report('DEFAULT_HUD failed to build', e); }
    })();

    const facade = {
      switchTo,
      attachDevMenu(dm) { devMenu = dm; },
      getActiveName() { return currentName; },
      // routed to the host-level dev menu (lightning/pause toggles), NOT the swappable HUD
      setDevToggle(kind, on) { if (devMenu && devMenu.setToggle) devMenu.setToggle(kind, on); },
      root,
    };
    METHODS.forEach((m) => { facade[m] = function () { return call(m, arguments); }; });
    return facade;
  };
})(window.ARENA = window.ARENA || {});
