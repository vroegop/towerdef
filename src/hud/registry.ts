/* src/hud/registry.ts — the list of swappable HUDs.
   Each entry: { label, load } where load() returns a HUD FACTORY (root, handlers) => instance.
   The dev menu renders this list; the HUD host (host.ts) calls load() + the factory inside an
   error boundary, so a missing/broken HUD can never take down the running game. */
import type { HudRegistryEntry } from '../types';
import { createDndHud } from '../huds/dnd';

export const HUDS: Record<string, HudRegistryEntry> = {
  dnd: { label: 'D&D', load: () => createDndHud }, // parchment character-sheet skin
};
// Booted synchronously by the host. The devmenu remembers any other pick across reloads.
export const DEFAULT_HUD = 'dnd';
