/* tools/superweapons-dashboard/art.ts — bespoke "example art" for every super weapon.
 *
 * One layered 24×24 SVG per weapon id, in the same idiom as the in-game card art
 * (src/hud/card-art.ts): inline SVG, `currentColor` primary strokes (so the weapon's category
 * tint themes the piece), explicit hexes for metal / fire / frost / energy accents. These are the
 * illustrations the dashboard shows so you can FEEL what a weapon would look like in the arena before
 * committing to building it for real. Keyed by weapon id; weaponArt() wraps a body in the <svg>. */

// Each entry is the inner SVG body. Kept deliberately readable so they're easy to tweak by hand.
export const WEAPON_ART: Record<string, string> = {
  // ---- the three CURRENT powers (matching their in-game flavour) ----
  // Golden Lightning — a fat gold bolt throwing off sparks.
  golden:
    '<path d="M13 2 5 13h4.6l-2 9 9.4-12.4H12l3-7.6z" fill="#f4c64a" stroke="#caa233" stroke-width="1"/>' +
    '<g class="spark"><path d="M19 3.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="#fff" stroke="none"/></g>' +
    '<path d="M4.2 19.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="#ffe9a8" stroke="none"/>',

  // Moat — a keep ringed by a flooded, wavy trench.
  moat:
    '<circle cx="12" cy="12" r="9.4" stroke="#4fb6e0" stroke-opacity=".55" stroke-dasharray="1.5 2.6"/>' +
    '<circle cx="12" cy="12" r="6.6" fill="#2f7fa8" fill-opacity=".32" stroke="#4fb6e0"/>' +
    '<path d="M5.8 12c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0" stroke="#bfeaff" stroke-width="1" fill="none"/>' +
    '<path d="M9.2 15.4 12 9.6l2.8 5.8z" fill="#d8c39a" stroke="#8a6d44"/>' +
    '<path d="M10.6 15.4v-2.2h2.8v2.2" stroke="#8a6d44" stroke-width="1"/>',

  // Crystal Circle — four shards orbiting a tower core on a faint ring.
  crystal:
    '<circle cx="12" cy="12" r="8" stroke-opacity=".32" stroke-dasharray="2 3"/>' +
    '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>' +
    '<g class="spin">' +
    '<path d="M12 1.6 13.7 4 12 6.4 10.3 4z" fill="#a9ecff" stroke="#37d7ff"/>' +
    '<path d="M22.4 12 20 13.7 17.6 12 20 10.3z" fill="#a9ecff" stroke="#37d7ff"/>' +
    '<path d="M12 22.4 10.3 20 12 17.6 13.7 20z" fill="#a9ecff" stroke="#37d7ff"/>' +
    '<path d="M1.6 12 4 10.3 6.4 12 4 13.7z" fill="#a9ecff" stroke="#37d7ff"/>' +
    '</g>',

  // ---- proposed NEW powers ----
  // Meteor Storm — a blazing meteor on a trail, cratering the ground.
  meteor:
    '<path d="M21.4 2.6 13 11" stroke="#ff8a3c" stroke-width="2.2"/>' +
    '<path d="M22 5 17 10M19 2 14.5 6.5" stroke="#ffd08a" stroke-width="1.1"/>' +
    '<circle cx="11" cy="13" r="3.6" fill="#ff6a2c" stroke="#b23c12"/>' +
    '<circle cx="10" cy="12" r="1.1" fill="#ffd9b0" stroke="none"/>' +
    '<path d="M3.5 20.5c1.8-2.2 3.8-2.2 5 0M8.5 21.5c1.2-1.6 3-1.6 4.2 0" stroke="#ff8a3c" stroke-width="1.3"/>',

  // Chain Tesla — arc lightning chaining between two charged nodes.
  tesla:
    '<circle cx="4.2" cy="6" r="1.7" fill="#9fe0ff" stroke="#37d7ff"/>' +
    '<circle cx="19.8" cy="18" r="1.7" fill="#9fe0ff" stroke="#37d7ff"/>' +
    '<path d="M5.4 7.2 9 8.2 7 11.4l4.4 1L9 15.6l4.6 1-2 3.1" stroke="#cfeeff" stroke-width="1.7"/>' +
    '<path d="M5.4 7.2 9 8.2 7 11.4l4.4 1L9 15.6l4.6 1-2 3.1" stroke="#37d7ff" stroke-width=".7"/>',

  // Inferno Ring — a circling ring of flame tongues around a hot core.
  inferno:
    '<circle cx="12" cy="12" r="2.1" fill="#ffd08a" stroke="#ff6a2c"/>' +
    '<g class="flames" fill="#ff7a33" stroke="#c8431a" stroke-width=".8">' +
    '<path d="M12 3.2c1.3 1.2 1.6 2.4.9 3.6.9-.3 1.4-1.1 1.3-2.1 1.1 1.3.7 2.9-.8 3.6h-2.8c-1.5-.7-1.9-2.3-.8-3.6-.1 1 .4 1.8 1.3 2.1-.7-1.2-.4-2.4.9-3.6z"/>' +
    '<path d="M20 9.4c-.2 1.2-1 1.9-2.1 2 .8.5 1.6.3 2.2-.4-.1 1.6-1.6 2.5-3 1.9l-1.8-2.1c-.4-1.5.5-2.9 2-3.2-.6.7-.6 1.6.1 2.2.1-1.3 1-2.1 2.6-2.4z"/>' +
    '<path d="M4 9.4c.2 1.2 1 1.9 2.1 2-.8.5-1.6.3-2.2-.4.1 1.6 1.6 2.5 3 1.9l1.8-2.1c.4-1.5-.5-2.9-2-3.2.6.7.6 1.6-.1 2.2-.1-1.3-1-2.1-2.6-2.4z"/>' +
    '<path d="M12 20.8c1.3-1.2 1.6-2.4.9-3.6.9.3 1.4 1.1 1.3 2.1 1.1-1.3.7-2.9-.8-3.6h-2.8c-1.5.7-1.9 2.3-.8 3.6-.1-1 .4-1.8 1.3-2.1-.7 1.2-.4 2.4.9 3.6z"/>' +
    '</g>',

  // Frost Nova — a six-armed snowflake bursting inside a cold shock-ring.
  frost:
    '<circle cx="12" cy="12" r="9" stroke="#9fe6ff" stroke-opacity=".4" stroke-dasharray="2 3.4"/>' +
    '<g stroke="#cdefff" stroke-width="1.5">' +
    '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>' +
    '<path d="M12 6.4 9.8 4.4M12 6.4l2.2-2M12 17.6l-2.2 2M12 17.6l2.2 2" stroke-width="1.1"/>' +
    '<path d="M6.4 8.9 4 8.2M6.4 8.9 5.8 6.5M17.6 15.1l2.4.7M17.6 15.1l.6 2.3" stroke-width="1"/>' +
    '<path d="M17.6 8.9 20 8.2M17.6 8.9l.6-2.4M6.4 15.1 4 15.8M6.4 15.1l-.6 2.3" stroke-width="1"/>' +
    '</g>' +
    '<circle cx="12" cy="12" r="1.6" fill="#eafaff" stroke="none"/>',

  // Aegis Bulwark — a glowing energy shield inside a protective bubble.
  aegis:
    '<circle cx="12" cy="12" r="9.2" stroke="#7fd0ff" stroke-opacity=".45"/>' +
    '<path d="M12 2.8 19 5.4v5.4C19 16 15.6 19.2 12 20.8 8.4 19.2 5 16 5 10.8V5.4z" fill="#3a7fd6" fill-opacity=".32" stroke="#7fd0ff" stroke-width="1.6"/>' +
    '<path d="M8.8 12.2 11 14.4 15.4 9.6" stroke="#eaf6ff" stroke-width="1.8"/>' +
    '<path d="M12 3.6 6.2 5.7v5C6.2 14.6 8.4 17 11 18.4" stroke="#bfe6ff" stroke-opacity=".7" stroke-width="1"/>',

  // Singularity — a black-hole core with matter spiralling inward.
  singularity:
    '<g class="spin" stroke="#9a8bf0" stroke-width="1.4" fill="none">' +
    '<path d="M3 8c4-1.6 6.5.4 7.4 3.6"/>' +
    '<path d="M21 16c-4 1.6-6.5-.4-7.4-3.6"/>' +
    '<path d="M8 3.2c1.6 4 .2 6.6-2.9 7.7"/>' +
    '<path d="M16 20.8c-1.6-4-.2-6.6 2.9-7.7"/>' +
    '</g>' +
    '<circle cx="12" cy="12" r="3.4" fill="#0c0c18" stroke="#b6a8ff" stroke-width="1.4"/>' +
    '<circle cx="12" cy="12" r="3.4" fill="none" stroke="#6a5acd" stroke-width="2.6" stroke-opacity=".4"/>',

  // Chrono Field — a clock face warped by a time eddy.
  chrono:
    '<circle cx="12" cy="12" r="7.6" stroke="#9fe0ff" stroke-width="1.7"/>' +
    '<path d="M12 7.2V12l3.2 2" stroke="#eaf6ff" stroke-width="1.8"/>' +
    '<path d="M12 2.2v2M12 19.8v2M2.2 12h2M19.8 12h2" stroke="#9fe0ff" stroke-width="1.4"/>' +
    '<g class="spin"><path d="M18.8 5.2c2.2 2.4 2.4 5.4.6 7.4" stroke="#7fc8ff" stroke-opacity=".6" stroke-dasharray="1.6 2"/></g>',

  // Midas Rain — gold coins raining down with a sparkle.
  midas:
    '<path d="M7 5.5v3M14 3.5v3M18.5 7v3" stroke="#caa233" stroke-opacity=".5" stroke-dasharray="1 1.8"/>' +
    '<circle cx="7" cy="16.5" r="2.7" fill="#f4c64a" stroke="#9a7416"/>' +
    '<circle cx="14.2" cy="12" r="2.3" fill="#f4c64a" stroke="#9a7416"/>' +
    '<circle cx="18.4" cy="18" r="2" fill="#f4c64a" stroke="#9a7416"/>' +
    '<circle cx="7" cy="16.5" r="1.4" stroke="#9a7416" stroke-opacity=".5"/>' +
    '<g class="spark"><path d="M19.6 4.4l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" fill="#fff7d6" stroke="none"/></g>',

  // Mirror Turret — a summoned ghost-clone of the tower beside the real one.
  mirror:
    '<path d="M14 21v-7l3.4-2.6L20.8 14v7z" fill="#5b8cff" fill-opacity=".18" stroke="#7fa8ff" stroke-dasharray="2 1.8"/>' +
    '<path d="M3.2 21v-7l3.4-2.6L10 14v7z" fill="#5b8cff" fill-opacity=".35" stroke="#9fc0ff" stroke-width="1.6"/>' +
    '<path d="M4.8 14.6h3.6M6.6 21v-3.6h1.2V21" stroke="#9fc0ff" stroke-opacity=".7"/>' +
    '<circle cx="6.6" cy="10.4" r="1.5" fill="#eaf6ff" stroke="#9fc0ff"/>',

  // Soul Harvest — a glowing soul-wisp drawn down into a reaping funnel.
  soul:
    '<path d="M12 2.6c2.8 2.8 2.8 6.4 0 9.6-2.8-3.2-2.8-6.8 0-9.6z" fill="#9be7c4" fill-opacity=".55" stroke="#5fd6a0"/>' +
    '<circle cx="12" cy="7" r="1.1" fill="#eafff5" stroke="none"/>' +
    '<path d="M5.5 13.5h13l-2.8 7H8.3z" fill="#2a6a55" fill-opacity=".4" stroke="#5fd6a0" stroke-width="1.5"/>' +
    '<g class="spark"><path d="M7.5 16.5l.4 1.3 1.3.4-1.3.4-.4 1.3-.4-1.3-1.3-.4 1.3-.4z" fill="#d8fff0" stroke="none"/>' +
    '<path d="M16 16l.4 1.3 1.3.4-1.3.4-.4 1.3-.4-1.3-1.3-.4 1.3-.4z" fill="#d8fff0" stroke="none"/></g>',
};

// Fallback for any id without bespoke art (keeps the UI safe if a brand-new weapon is added).
const FALLBACK =
  '<circle cx="12" cy="12" r="8" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke-width="1.6"/>';

// Render a weapon's art as an inline SVG string. `cls` lets the page add hooks (e.g. animation/tint).
export function weaponArt(id: string, size = 48, cls = ''): string {
  const body = WEAPON_ART[id] || FALLBACK;
  return (
    '<svg class="wart wart-' + id + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    body +
    '</svg>'
  );
}

// The ids that ship with bespoke art — offered in the editor's "art" picker.
export const ART_IDS: string[] = Object.keys(WEAPON_ART);
