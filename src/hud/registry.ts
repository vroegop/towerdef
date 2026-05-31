/* src/hud/registry.ts — the list of swappable HUDs.
   Each entry: { label, load } where load() returns a HUD FACTORY (root, handlers) => instance.
   The dev menu renders this list; the HUD host (host.ts) calls load() + the factory inside an
   error boundary, so a missing/broken HUD can never take down the running game. */
import type { HudRegistryEntry } from '../types';
import { Hud } from './hud';
import { createDndHud } from '../huds/dnd';
import { createArcadeHud } from '../huds/arcade';

export const HUDS: Record<string, HudRegistryEntry> = {
  classic: { label: 'Classic', load: () => Hud }, // original look; the host's crash fallback
  dnd: { label: 'D&D', load: () => createDndHud }, // parchment character-sheet skin
  arcade: { label: 'Arcade', load: () => createArcadeHud }, // CRT-cabinet pixel skin
};
// Booted synchronously by the host. Default to Classic; the devmenu remembers any other pick.
export const DEFAULT_HUD = 'classic';
