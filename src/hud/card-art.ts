/* src/hud/card-art.ts — bespoke, per-card illustrations.
   Each card gets its OWN themed, layered SVG art (replacing the old shared outline glyphs) with a
   single subtle animation hook (a classed <g> the stylesheet drives — see `.cart-*` rules in hud.css).
   Convention (matching the rest of the HUD): inline SVG only, no UTF8 glyphs. Art is keyed by CARD ID
   so every card is guaranteed unique. Primary strokes/fills use `currentColor` (the card's --tint) so
   the existing tint backdrop + glow theme each piece; explicit hexes add metal / highlight accents.
   viewBox is 0 0 24 24 for all pieces. */

// Each entry is the inner SVG body; the animated layer carries a class the CSS targets.
const CARD_ART: Record<string, string> = {
  // ---- COMMON ----
  // Damage — a drawn bow; the single-pointed arrow nocks back and releases. The rear is crossed
  // fletching (feathers), NOT a second arrowhead.
  damage:
    '<path d="M8 3a11 11 0 0 1 0 18"/>' +
    '<path d="M8 3 13 12 8 21" stroke-width="1.2"/>' +
    '<g class="arrow">' +
    '<path d="M5.5 12H19" stroke-width="1.8"/>' +
    '<path d="M16.4 9.2 20 12l-3.6 2.8"/>' +
    '<path d="M6.2 10.4 8.6 12.8M6.2 13.6 8.6 11.2" stroke-width="1.2"/>' +
    '</g>',

  // Attack Speed — a dial with a fast-sweeping hand.
  attackSpeed:
    '<circle cx="12" cy="12" r="8.6" stroke-width="1.6"/>' +
    '<path d="M12 3.4v1.7M20.6 12h-1.7M12 20.6v-1.7M3.4 12h1.7" stroke-width="1.3"/>' +
    '<g class="hand"><path d="M12 12V5.4" stroke-width="2"/></g>' +
    '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',

  // Health — a beating heart.
  health:
    '<g class="beat">' +
    '<path d="M12 20.5C5 16 3.5 11.6 3.5 8.6A4.2 4.2 0 0 1 12 6.2a4.2 4.2 0 0 1 8.5 2.4C20.5 11.6 19 16 12 20.5Z" fill="currentColor" fill-opacity=".85"/>' +
    '<path d="M8.4 9.6A3.2 3.2 0 0 1 12 7.6" stroke="#fff" stroke-opacity=".55" stroke-width="1.3"/>' +
    '</g>',

  // Health Regen — a heart with small hearts popping out and rising.
  healthRegen:
    '<path d="M12 19C7.6 16 5.8 13 5.8 10.6A3 3 0 0 1 12 8.4a3 3 0 0 1 6.2 2.2c0 2.4-1.8 5.4-6.2 8.4Z" fill="currentColor" fill-opacity=".85"/>' +
    '<g class="pop pop1"><path d="M6.6 9.4c-.8-.6-2-.05-2 .95 0 .8 1 1.6 2 2.25 1-.65 2-1.45 2-2.25 0-1-1.2-1.55-2-.95Z" fill="#bfffd9" stroke="none"/></g>' +
    '<g class="pop pop2"><path d="M17.4 8.8c-.7-.5-1.75-.05-1.75.85 0 .7.9 1.4 1.75 2 .85-.6 1.75-1.3 1.75-2 0-.9-1.05-1.35-1.75-.85Z" fill="#bfffd9" stroke="none"/></g>' +
    '<g class="pop pop3"><path d="M12 5c-.6-.45-1.5-.05-1.5.75 0 .6.75 1.2 1.5 1.7.75-.5 1.5-1.1 1.5-1.7 0-.8-.9-1.2-1.5-.75Z" fill="#eafff2" stroke="none"/></g>',

  // Range — radar: static rings + a centre, with two ripples pulsing outward.
  range:
    '<circle cx="12" cy="12" r="9" stroke-opacity=".25"/>' +
    '<circle cx="12" cy="12" r="5.4" stroke-opacity=".45"/>' +
    '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>' +
    '<g class="r1"><circle cx="12" cy="12" r="6" stroke-width="1.6"/></g>' +
    '<g class="r2"><circle cx="12" cy="12" r="6" stroke-width="1.6"/></g>',

  // Gold — two overlapping struck coins (matching the coin currency glyph), gently turning. No symbol
  // on the face: this is gold, not dollars.
  cash:
    '<g class="spincoin">' +
    '<circle cx="14.6" cy="9.4" r="6.4" fill="currentColor" fill-opacity=".92" stroke="#9a7416" stroke-width="1.1"/>' +
    '<circle cx="14.6" cy="9.4" r="4.3" stroke="#9a7416" stroke-opacity=".45" stroke-width=".9"/>' +
    '<circle cx="9.4" cy="14.6" r="6.4" fill="currentColor" stroke="#9a7416" stroke-width="1.1"/>' +
    '<circle cx="9.4" cy="14.6" r="4.3" stroke="#9a7416" stroke-opacity=".45" stroke-width=".9"/>' +
    '</g>',

  // Coins — a stack of coins with a glinting sparkle.
  coins:
    '<path d="M4.5 10.6v6M19.5 10.6v6" stroke="#9a7416" stroke-opacity=".5"/>' +
    '<ellipse cx="12" cy="16.6" rx="7.5" ry="3" fill="currentColor" fill-opacity=".82" stroke="#9a7416" stroke-width="1.1"/>' +
    '<ellipse cx="12" cy="13.6" rx="7.5" ry="3" fill="currentColor" fill-opacity=".9" stroke="#9a7416" stroke-width="1.1"/>' +
    '<ellipse cx="12" cy="10.6" rx="7.5" ry="3" fill="currentColor" stroke="#9a7416" stroke-width="1.1"/>' +
    '<g transform="translate(17.6 6.4)"><g class="spark"><path d="M0-2.6.7-.7 2.6 0 .7.7 0 2.6-.7.7-2.6 0-.7-.7Z" fill="#fff" stroke="none"/></g></g>',

  // Slow Aura — a frost crystal turning slowly inside a cold ring.
  slowAura:
    '<circle cx="12" cy="12" r="9" stroke-opacity=".22" stroke-dasharray="2 3.5"/>' +
    '<g class="flake">' +
    '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" stroke-width="1.5"/>' +
    '<path d="M12 6.2 10 4.2M12 6.2l2-2M12 17.8l-2 2M12 17.8l2 2" stroke-width="1.2"/>' +
    '<path d="M6.4 8.8 4.1 8.2M6.4 8.8 5.8 6.5M17.6 15.2l2.3.6M17.6 15.2l.6 2.3" stroke-width="1.1"/>' +
    '<path d="M17.6 8.8l2.3-.6M17.6 8.8 18.2 6.5M6.4 15.2l-2.3.6M6.4 15.2l-.6 2.3" stroke-width="1.1"/>' +
    '</g>',

  // Critical Chance — a crit starburst that twinkles.
  critChance:
    '<g class="spark"><path d="M12 2.2 13.8 9.4 21 11.2 13.8 13 12 20.2 10.2 13 3 11.2 10.2 9.4Z" fill="currentColor" fill-opacity=".95" stroke-width="1"/></g>' +
    '<g class="spark2"><path d="M18.4 3.6 19 6 21.4 6.6 19 7.2 18.4 9.6 17.8 7.2 15.4 6.6 17.8 6Z" fill="#fff" fill-opacity=".9" stroke="none"/></g>',

  // Enemy Balance — a scale of justice tipping gently.
  enemyBalance:
    '<path d="M12 4.4V19M8 19h8" stroke-width="1.6"/>' +
    '<circle cx="12" cy="4.4" r="1.3" fill="currentColor" stroke="none"/>' +
    '<g class="scale">' +
    '<path d="M4.6 6h14.8" stroke-width="1.6"/>' +
    '<path d="M4.6 6 2.4 10.2a2.2 2.2 0 0 0 4.4 0Z" fill="currentColor" fill-opacity=".45" stroke-width="1.2"/>' +
    '<path d="M19.4 6l-2.2 4.2a2.2 2.2 0 0 0 4.4 0Z" fill="currentColor" fill-opacity=".45" stroke-width="1.2"/>' +
    '</g>',

  // Extra Defense — a shield with a checkmark and a glimmering inner edge.
  extraDefense:
    '<path d="M12 2.6 20 5.3v5.8c0 5.4-3.6 8.4-8 10.3-4.4-1.9-8-4.9-8-10.3V5.3Z" fill="currentColor" fill-opacity=".22" stroke-width="1.7"/>' +
    '<path d="M8.4 12.2 10.9 14.8 15.6 9.8" stroke-width="2"/>' +
    '<g class="sheen"><path d="M12 3.4 5.2 5.7v5.4c0 4 2.2 6.6 4.8 8.2" stroke="#eafff2" stroke-width="1.4"/></g>',

  // Fortress — a battlemented keep with a banner that waves.
  fortress:
    '<path d="M4 21v-9h2v-2h2v2h2v-2h2v2h2v-2h2v2h2v9Z" fill="currentColor" fill-opacity=".28" stroke-width="1.5"/>' +
    '<path d="M10.4 21v-3.6a1.6 1.6 0 0 1 3.2 0V21" fill="currentColor" fill-opacity=".5" stroke-width="1.1"/>' +
    '<path d="M6.6 14.4h1.6M15.8 14.4h1.6" stroke-width="1.6"/>' +
    '<path d="M16 10V3.4" stroke-width="1.3"/>' +
    '<g class="flag"><path d="M16 3.8h4.4l-1.4 1.7 1.4 1.7H16Z" fill="#37d7ff" stroke="none"/></g>',

  // Overrun — a charging horde: chevrons sweeping forward in sequence.
  overrun:
    '<g class="rush rush1"><path d="M4 7l4.4 5-4.4 5" stroke-width="2"/></g>' +
    '<g class="rush rush2"><path d="M10 7l4.4 5-4.4 5" stroke-width="2"/></g>' +
    '<g class="rush rush3"><path d="M16 7l4.4 5-4.4 5" stroke-width="2"/></g>',

  // ---- RARE ----
  // Free Upgrades — a rising upgrade arrow with a sparkle of "free".
  freeUpgrades:
    '<g class="lift"><path d="M12 4.5 19 11.5h-3.4v6.4h-7.2v-6.4H5Z" fill="currentColor" fill-opacity=".85" stroke-width="1.3"/></g>' +
    '<g transform="translate(18.6 5.4)"><g class="spark"><path d="M0-2.4.6-.6 2.4 0 .6.6 0 2.4-.6.6-2.4 0-.6-.6Z" fill="#fff" stroke="none"/></g></g>',

  // Plasma Canon — an angled barrel discharging a pulsing plasma orb.
  plasmaCanon:
    '<rect x="2.6" y="15.4" width="6.4" height="4.6" rx="1.2" fill="currentColor" fill-opacity=".4" stroke-width="1.2"/>' +
    '<path d="M5.4 16.6 15.4 7.4" stroke-width="3.4"/>' +
    '<g class="orb2"><circle cx="17.4" cy="6.6" r="3.4" stroke-width="1.4"/></g>' +
    '<g class="orb"><circle cx="17.4" cy="6.6" r="3.2" fill="#a9ecff" fill-opacity=".9" stroke="#37d7ff" stroke-width="1.2"/></g>',

  // Critical Coin — a turning coin throwing off a crit spark.
  criticalCoin:
    '<g class="spincoin">' +
    '<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".9" stroke="#9a7416" stroke-width="1.2"/>' +
    '<circle cx="12" cy="12" r="5.8" stroke="#9a7416" stroke-opacity=".5"/>' +
    '</g>' +
    '<g transform="translate(18 6)"><g class="spk"><path d="M0-3 .9-.9 3 0 .9.9 0 3-.9.9-3 0-.9-.9Z" fill="#fff" stroke="none"/></g></g>',

  // Wave Skip — a skip-forward marker leaping over a wave.
  waveSkip:
    '<g class="skip"><path d="M5 7l5 5-5 5M11 7l5 5-5 5" stroke-width="2"/><path d="M18.5 7v10" stroke-width="2"/></g>' +
    '<path d="M3 20c2-1.7 3.6-1.7 5.6 0s3.6 1.7 5.6 0 3.6-1.7 5.6 0" stroke-opacity=".5" stroke-width="1.3"/>',

  // ---- EPIC ----
  // Super Tower — a turret with a pulsing power core inside a charged aura.
  superTower:
    '<g class="aura"><circle cx="12" cy="12" r="9.4" stroke-opacity=".4" stroke-width="1.4"/></g>' +
    '<path d="M8 21v-8l4-3 4 3v8Z" fill="currentColor" fill-opacity=".3" stroke-width="1.5"/>' +
    '<path d="M8.4 13.4h7.2M10 21v-4.4h4V21" stroke-opacity=".6" stroke-width="1.2"/>' +
    '<g class="core"><circle cx="12" cy="8.6" r="2.2" fill="#fff" fill-opacity=".92" stroke-width="1.2"/></g>',

  // Revive (Second Wind) — a winged heart, the wings beating as it revives.
  secondWind:
    '<path d="M12 19.2c-3.7-2.5-5.2-5-5.2-7A2.6 2.6 0 0 1 12 10.4a2.6 2.6 0 0 1 5.2 1.8c0 2-1.5 4.5-5.2 7Z" fill="currentColor" fill-opacity=".88"/>' +
    '<g class="wingL"><path d="M9 11.4C6.4 8.8 3.2 8.6 1.6 9.7c1.9.4 2.3 1.5 2.5 2.8 1.1-.7 2.6-.5 3.4.4Z" fill="#ffd2d8" stroke="none"/></g>' +
    '<g class="wingR"><path d="M15 11.4c2.6-2.6 5.8-2.8 7.4-1.7-1.9.4-2.3 1.5-2.5 2.8-1.1-.7-2.6-.5-3.4.4Z" fill="#ffd2d8" stroke="none"/></g>',

  // Dark Wiz (Demon Mode) — a horned dark-wizard head with eyes that flare.
  demonMode:
    '<path d="M6.4 7.4C5.2 5.3 5.1 3.6 5.6 2.4c1.3 1 2.2 2.2 2.8 3.7M17.6 7.4c1.2-2.1 1.3-3.8.8-5-1.3 1-2.2 2.2-2.8 3.7" fill="currentColor" fill-opacity=".5" stroke-width="1.2"/>' +
    '<path d="M12 6.6c4 0 6.6 2.6 6.6 6 0 4-3 6.6-6.6 8.6C8.4 19.2 5.4 16.6 5.4 12.6c0-3.4 2.6-6 6.6-6Z" fill="currentColor" fill-opacity=".75" stroke-width="1.4"/>' +
    '<path d="M10 17.2c1.1.8 2.9.8 4 0" stroke="#fff" stroke-opacity=".7" stroke-width="1.2"/>' +
    '<g class="flare"><path d="M8.8 12.2 11.4 13.4 8.8 14.6Z" fill="#fff" stroke="none"/><path d="M15.2 12.2 12.6 13.4 15.2 14.6Z" fill="#fff" stroke="none"/></g>',
};

// Fallback for any id without bespoke art (keeps the UI safe if a new card is added).
const FALLBACK = '<circle cx="12" cy="12" r="8" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke-width="1.6"/>';

// Render a card's bespoke art. Carries `.ic` (so it inherits the existing card-image sizing + tint
// glow) plus `.cart cart-<id>` hooks for the per-card animation rules in hud.css.
export function cardArt(id: string, size?: number, cls?: string): string {
  size = size || 50;
  const body = CARD_ART[id] || FALLBACK;
  return (
    '<svg class="ic cart cart-' + id + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    body + '</svg>'
  );
}
