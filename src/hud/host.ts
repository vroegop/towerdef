/* src/hud/host.ts — the HUD host: a proxy + error boundary that sits between main.ts's call
   sites and whichever HUD is currently active. The game loop only ever talks to this facade,
   so a HUD that throws or fails to load can NEVER crash frame().

   createHudHost(root, handlers, { reenter }) → facade with the same method names main.ts
   calls on a HUD, plus switchTo(name), attachDevMenu(dm), getActiveName(). */
import type { DevMenu, EarnSummary, Hud, HudHandlers, HudHost, MenuOpts, Meta, State } from '../types';
import { DEFAULT_HUD, HUDS } from './registry';

export function createHudHost(root: HTMLElement, handlers: HudHandlers, opts?: { reenter?: (h: Hud) => void }): HudHost {
  opts = opts || {};
  const reenter = typeof opts.reenter === 'function' ? opts.reenter : () => {};
  let current: Hud | null = null,
    currentName: string | null = null,
    lastGoodName: string | null = null;
  let faulted = false,
    switching = false,
    devMenu: DevMenu | null = null;

  function report(msg: string, err?: unknown): void {
    if (err) console.error('[HUD]', msg, err);
    else console.info('[HUD]', msg);
    if (devMenu && devMenu.report)
      try {
        devMenu.report(msg, !!err);
      } catch {
        /* ignore */
      }
  }

  // A method on the live HUD threw at runtime. Mark faulted and revert to the last-good HUD.
  function fault(where: string, err: unknown): void {
    if (faulted) return;
    faulted = true;
    report('HUD "' + currentName + '" threw in ' + where + '() — reverting', err);
    const fb = lastGoodName && lastGoodName !== currentName ? lastGoodName : DEFAULT_HUD;
    if (fb === currentName) {
      report('no safe fallback (even "' + fb + '" is faulting); game runs without a HUD');
      return;
    }
    Promise.resolve().then(() => switchTo(fb, true));
  }

  // Forward one facade call into the active HUD, swallowing any throw into the error boundary.
  function call(name: keyof Hud, args: unknown[]): unknown {
    if (faulted || !current) return;
    const fn = (current as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') return; // missing-method fallback: no-op
    try {
      return (fn as (...a: unknown[]) => unknown).apply(current, args);
    } catch (e) {
      fault(name, e);
    }
  }

  function teardown(): void {
    if (current && typeof current.destroy === 'function') {
      try {
        current.destroy();
      } catch (e) {
        report('destroy() threw', e);
      }
    }
    root.innerHTML = '';
  }

  // Swap to HUD `name`. Async-shaped so a HUD whose load() returns a promise still works.
  function switchTo(name: string, isRevert?: boolean): Promise<boolean> {
    const entry = HUDS[name];
    if (!entry) {
      report('unknown HUD "' + name + '"');
      return Promise.resolve(false);
    }
    if (switching) {
      report('swap already in progress; ignored "' + name + '"');
      return Promise.resolve(false);
    }
    if (name === currentName && !faulted) return Promise.resolve(true);
    switching = true;
    const prevGood = !faulted && currentName ? currentName : lastGoodName;
    return Promise.resolve()
      .then(entry.load)
      .then((factory) => {
        if (typeof factory !== 'function') throw new Error('load() for "' + name + '" did not return a factory function');
        teardown();
        let inst: Hud;
        try {
          inst = factory(root, handlers);
        } catch (e) {
          switching = false;
          const fb = prevGood && prevGood !== name ? prevGood : DEFAULT_HUD;
          report('HUD "' + name + '" factory threw while building — reverting to "' + fb + '"', e);
          if (fb === name) {
            current = null;
            currentName = name;
            faulted = true;
            if (devMenu && devMenu.refresh) devMenu.refresh();
            return false;
          }
          return switchTo(fb, true);
        }
        current = inst;
        currentName = name;
        faulted = false;
        lastGoodName = prevGood || (name === DEFAULT_HUD ? name : lastGoodName);
        let reErr: unknown = null;
        try {
          reenter(inst);
        } catch (e) {
          reErr = e;
        }
        switching = false;
        if (devMenu && devMenu.refresh) devMenu.refresh();
        if (reErr) {
          fault('reenter', reErr);
          return false;
        }
        if (!isRevert) report('switched to "' + name + '"');
        return true;
      })
      .catch((err) => {
        switching = false;
        report('failed to load HUD "' + name + '" — keeping "' + currentName + '"', err);
        if (devMenu && devMenu.refresh) devMenu.refresh();
        return false;
      });
  }

  // Boot the default HUD synchronously so the facade is live before main.ts's first call.
  (function mountDefault() {
    const entry = HUDS[DEFAULT_HUD];
    if (!entry) {
      report('DEFAULT_HUD "' + DEFAULT_HUD + '" not registered');
      return;
    }
    const factory = entry.load();
    if (typeof factory !== 'function') {
      report('DEFAULT_HUD must load synchronously');
      return;
    }
    try {
      current = factory(root, handlers);
      currentName = DEFAULT_HUD;
      lastGoodName = DEFAULT_HUD;
    } catch (e) {
      report('DEFAULT_HUD failed to build', e);
    }
  })();

  const facade: HudHost = {
    root,
    switchTo,
    attachDevMenu(dm: DevMenu) {
      devMenu = dm;
    },
    getActiveName() {
      return currentName;
    },
    // routed to the host-level dev menu (lightning/pause toggles), NOT the swappable HUD
    setDevToggle(kind: string, on: boolean) {
      if (devMenu && devMenu.setToggle) devMenu.setToggle(kind, on);
    },
    update: (s: State) => void call('update', [s]),
    showMenu: (meta: Meta, o: MenuOpts) => void call('showMenu', [meta, o]),
    refreshMenu: (meta: Meta) => void call('refreshMenu', [meta]),
    hideMenu: () => void call('hideMenu', []),
    showOverview: (meta: Meta, earn: EarnSummary) => void call('showOverview', [meta, earn]),
    hideOverview: () => void call('hideOverview', []),
    showHint: (html: string) => void call('showHint', [html]),
    hideHint: () => void call('hideHint', []),
    setMeta: (meta: Meta) => void call('setMeta', [meta]),
  };
  return facade;
}
