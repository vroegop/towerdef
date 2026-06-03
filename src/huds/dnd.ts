/* src/huds/dnd.ts — the "D&D" parchment skin as a REAL, full-parity HUD.
   It reuses the single themeable core in hud/hud.ts via createThemedHud({ cls, css }). */
import { createThemedHud } from '../hud/hud';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Cinzel+Decorative:wght@700;900&family=IM+Fell+English&display=swap');

/* ============ D&D parchment skin — scoped to .hud.theme-dnd ============ */
.hud.theme-dnd {
  --parch: #e9dcc0; --parch-lt: #f3e9d2; --parch-dk: #d8c8a8;
  --ink: #2a1a08; --ink-dim: #7a5a2a; --rule: #b09a6a;
  --accent: #7a4a1a; --crimson: #9a2a1a; --gold-ink: #9a6a1a;
  color: var(--ink);
  font-family: 'IM Fell English', Georgia, serif;
}
.hud.theme-dnd b, .hud.theme-dnd .stat b { color: var(--ink); }

/* parchment backdrop for every full-screen surface (menu / overview / stats) */
.hud.theme-dnd .menu,
.hud.theme-dnd .over { background: #2b1d10; }
.hud.theme-dnd .menu-content {
  background: var(--parch);
  background-image: radial-gradient(circle at 30% 8%, var(--parch-lt), #e3d3b0 70%);
}
.hud.theme-dnd .menu-content { box-shadow: inset 0 0 0 3px #8a6a3a, inset 0 0 0 6px var(--parch); }

/* ---- in-run top stats: engraved on the arena ---- */
.hud.theme-dnd .topbar, .hud.theme-dnd .wavebanner, .hud.theme-dnd .statline { text-shadow: none; }
.hud.theme-dnd .stat .lbl { color: var(--ink-dim); font-family: 'Cinzel', serif; font-weight: 700; }
.hud.theme-dnd .wave b { color: var(--crimson); font-family: 'Cinzel', serif; }
.hud.theme-dnd .gold b { color: var(--gold-ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .stat.hp b { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .iconbtn { color: var(--ink-dim); }
.hud.theme-dnd .iconbtn:hover { color: var(--ink); }
.hud.theme-dnd .speedbtn { background: rgba(122,74,26,.12); border: 1px solid var(--rule); }
.hud.theme-dnd .speedbtn:hover { background: rgba(122,74,26,.2); }
.hud.theme-dnd .speedbtn b { color: var(--ink); font-family: 'Cinzel', serif; }

/* side menu: a small parchment rail pinned in the margin */
.hud.theme-dnd .sidemenu { background: var(--parch); background-image: radial-gradient(circle at 70% 8%, var(--parch-lt), #e3d3b0 70%);
  border: 3px double #7a5a2a; }
.hud.theme-dnd .sideitem { color: var(--ink); }
.hud.theme-dnd .sideitem .ic { color: var(--ink-dim); }
.hud.theme-dnd .sideitem:hover { background: rgba(122,74,26,.12); }
.hud.theme-dnd .sideitem:hover .ic { color: var(--ink); }
.hud.theme-dnd .sideitem.danger .ic { color: var(--crimson); }
.hud.theme-dnd .sideitem.danger:hover { background: rgba(154,42,26,.14); }
.hud.theme-dnd .hpbar { background: rgba(42,26,8,.18); border: 1px solid var(--rule); }
.hud.theme-dnd .hpbar i { background: #6a8a3a; }

/* wave countdown: a wax-seal red bleed down the margin */
.hud.theme-dnd .wavebar { background: rgba(42,26,8,.08); border-left: 1px solid var(--rule); }
.hud.theme-dnd .wavebar i { background: linear-gradient(0deg, #6a1a10, var(--crimson)); box-shadow: 0 0 8px rgba(154,42,26,.5); }

/* ---- in-run upgrade dock: a leather-trimmed shelf ---- */
.hud.theme-dnd .tabbar { background: #c9b285; border-top: 3px double #7a5a2a; backdrop-filter: none; }
.hud.theme-dnd .tabs button { color: var(--ink-dim); font-family: 'Cinzel', serif; font-weight: 700; }
.hud.theme-dnd .tabs button.on { color: var(--ink); border-top-color: var(--crimson); background: rgba(122,74,26,.12); }
.hud.theme-dnd .up { background: var(--parch-lt); border: 1px solid var(--rule); color: var(--ink); border-radius: 4px; }
.hud.theme-dnd .up:hover:not(:disabled):not(.cant) { border-color: var(--crimson); }
.hud.theme-dnd .up .nm .ic { color: var(--ink-dim); }
.hud.theme-dnd .up .delta { color: var(--ink-dim); }
.hud.theme-dnd .up .cost { color: var(--gold-ink); }
.hud.theme-dnd .tablock, .hud.theme-dnd .tablock .ic { color: var(--ink-dim); }

/* ---- menu chrome: illuminated headings, dotted ledger rules ---- */
.hud.theme-dnd .menutabs { background: #c9b285; border-top: 3px double #7a5a2a; }
.hud.theme-dnd .menutabs button { color: var(--ink-dim); font-family: 'Cinzel', serif; }
.hud.theme-dnd .menutabs button.on { color: var(--ink); border-top-color: var(--crimson); background: rgba(122,74,26,.14); }
.hud.theme-dnd .menutabs button.locked { color: #a99570; }
.hud.theme-dnd .statshead, .hud.theme-dnd .modal h2 { font-family: 'Cinzel Decorative', serif; }
.hud.theme-dnd .statshead { border-bottom: 2px solid var(--rule); }
.hud.theme-dnd .statshead h2 { color: var(--ink); }
.hud.theme-dnd .menugear { color: var(--accent); }
.hud.theme-dnd .menugear:hover { color: var(--ink); }

/* framed surfaces (settings, run stats, run over, card detail) get a parchment backing so their
   dark-default body never leaves ink text sitting on a dark panel — the old "unreadable settings" bug. */
.hud.theme-dnd .setmodal-inner,
.hud.theme-dnd .statscard,
.hud.theme-dnd .over-card,
.hud.theme-dnd .cardmodal-inner,
.hud.theme-dnd .modal-inner,
.hud.theme-dnd .mgmtmodal-inner,
.hud.theme-dnd .updmodal-inner {
  background: var(--parch);
  background-image: radial-gradient(circle at 30% 8%, var(--parch-lt), #e3d3b0 70%);
  border: 1px solid #8a6a3a; box-shadow: inset 0 0 0 3px #8a6a3a, 0 12px 30px rgba(0,0,0,.5);
  color: var(--ink);
}
.hud.theme-dnd .mgmt-head { border-bottom: 1px solid var(--rule); }
.hud.theme-dnd .mgmt-head h2 { color: var(--ink); font-family: 'Cinzel Decorative', serif; }
.hud.theme-dnd .iconclose { color: var(--ink-dim); }
.hud.theme-dnd .iconclose:hover { color: var(--ink); }
/* upgrade detail modal on parchment */
.hud.theme-dnd .updmodal-inner .upd-head { border-bottom-color: var(--rule); }
.hud.theme-dnd .updmodal-inner .upd-icon { background: rgba(122,74,26,.12); color: var(--accent); }
.hud.theme-dnd .updmodal-inner .upd-title b { color: var(--ink); }
.hud.theme-dnd .updmodal-inner .upd-title span { color: var(--ink-dim); }
.hud.theme-dnd .updmodal-inner .upd-tip { color: var(--ink-dim); border-bottom-color: var(--rule); }
.hud.theme-dnd .updmodal-inner .upd-row { border-bottom-color: rgba(122,74,26,.2); }
.hud.theme-dnd .updmodal-inner .upd-row span { color: var(--ink-dim); }
.hud.theme-dnd .updmodal-inner .upd-row b { color: var(--ink); }
.hud.theme-dnd .updmodal-inner .upd-buy { color: var(--crimson); background: rgba(154,106,26,.10); border-top-color: rgba(154,106,26,.25); }
.hud.theme-dnd .updmodal-inner .upd-buy:hover:not(:disabled) { background: rgba(154,106,26,.18); }
.hud.theme-dnd .setbody, .hud.theme-dnd .statsbody { color: var(--ink); }
.hud.theme-dnd .cm-sub, .hud.theme-dnd .cmhead .cm-title span { color: var(--ink-dim); }
.hud.theme-dnd .cm-sub b, .hud.theme-dnd .csr .csv, .hud.theme-dnd .csr .csv b { color: var(--ink); }
.hud.theme-dnd .csr { border-bottom-color: rgba(122,74,26,.25); }

/* chips / coins chip / earnings — framed ledger entries */
.hud.theme-dnd .chip,
.hud.theme-dnd .coins-chip,
.hud.theme-dnd .earncard {
  background: rgba(255,255,255,.32); border: 1px solid var(--rule); border-radius: 4px; color: var(--ink-dim);
}
.hud.theme-dnd .chip b { color: var(--ink); }
.hud.theme-dnd .coins-chip b { color: var(--crimson); }

/* hero "character sheet": the currency chips are carved GEMSTONE stones set in a brass mount. Each
   currency gets its own gem colour (a tinted, glossy cabochon face + a matching engraved icon) so the
   trio reads as three distinct jewels rather than three identical brass tiles. The mount is a metallic
   bevel (lit top-left → shaded base); a 3px inset hex ::before is the gem face; a clipped ::after sends
   an occasional gleam across the polish. nth-child tracks the fixed CURRENCIES order: coins, gems, vials. */
.hud.theme-dnd .chips { gap: 8px; }
.hud.theme-dnd .chip {
  position: relative; width: 76px; height: 84px; padding: 0; border: 0; border-radius: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  color: var(--ink-dim); text-align: center;
  background: linear-gradient(150deg, #c19748 0%, #7a5a2a 46%, #4d3516 100%);
  clip-path: polygon(50% 1%, 95% 25%, 95% 75%, 50% 99%, 5% 75%, 5% 25%);
  filter: drop-shadow(0 3px 4px rgba(0,0,0,.4));
}
/* gem face: a parchment cabochon by default — a soft top gloss over a centre-lit dome that darkens to
   the rim, giving a polished curve. Per-currency tints below recolour the dome. */
.hud.theme-dnd .chip::before {
  content: ''; position: absolute; inset: 3px; z-index: 0;
  clip-path: polygon(50% 1%, 95% 25%, 95% 75%, 50% 99%, 5% 75%, 5% 25%);
  background:
    radial-gradient(ellipse 58% 36% at 50% 19%, rgba(255,255,255,.6), rgba(255,255,255,0) 72%),
    radial-gradient(circle at 50% 44%, var(--parch-lt), #cbb88f 88%);
}
.hud.theme-dnd .chip:nth-child(1)::before { background:
  radial-gradient(ellipse 58% 36% at 50% 19%, rgba(255,255,255,.62), rgba(255,255,255,0) 72%),
  radial-gradient(circle at 50% 46%, #f7e8b4, #c79a3e 92%); }
.hud.theme-dnd .chip:nth-child(2)::before { background:
  radial-gradient(ellipse 58% 36% at 50% 19%, rgba(255,255,255,.62), rgba(255,255,255,0) 72%),
  radial-gradient(circle at 50% 46%, #d3e4f7, #5b86b8 92%); }
.hud.theme-dnd .chip:nth-child(3)::before { background:
  radial-gradient(ellipse 58% 36% at 50% 19%, rgba(255,255,255,.62), rgba(255,255,255,0) 72%),
  radial-gradient(circle at 50% 46%, #c9ede1, #3f9a82 92%); }
.hud.theme-dnd .chip:nth-child(1) .ic { color: #6e4a12; }
.hud.theme-dnd .chip:nth-child(2) .ic { color: #1f3f6a; }
.hud.theme-dnd .chip:nth-child(3) .ic { color: #14564a; }
.hud.theme-dnd .chip .ic { position: relative; z-index: 1; color: var(--accent); }
.hud.theme-dnd .chip b { position: relative; z-index: 1; margin: 0; font-family: 'Cinzel', serif; font-size: 14px; line-height: 1.05; color: var(--ink); }
/* a thin gleam sweeps across the polished face now and then; the three are staggered so they twinkle
   in turn rather than in unison. */
.hud.theme-dnd .chip::after {
  content: ''; position: absolute; z-index: 2; top: -40%; left: -40%; width: 34%; height: 200%;
  pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent);
  transform: translateX(-30%) rotate(12deg);
  animation: dnd-chip-gleam 7s ease-in-out infinite;
}
.hud.theme-dnd .chip:nth-child(2)::after { animation-delay: 2.3s; }
.hud.theme-dnd .chip:nth-child(3)::after { animation-delay: 4.6s; }
@keyframes dnd-chip-gleam {
  0%   { transform: translateX(-30%) rotate(12deg); opacity: 0; }
  4%   { opacity: .8; }
  13%  { transform: translateX(380%) rotate(12deg); opacity: 0; }
  100% { transform: translateX(380%) rotate(12deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .hud.theme-dnd .chip::after { animation: none; opacity: 0; }
}

/* in-run Tower-style HUD (currency strip, wave banner, You/Enemy stat lines) in parchment + ink. */
.hud.theme-dnd .cur { color: var(--ink); }
.hud.theme-dnd .cur b { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .cur.gold b { color: var(--gold-ink); }
.hud.theme-dnd .cur .ic { color: var(--ink-dim); }
.hud.theme-dnd .statline .sl { background: var(--parch-lt); border: 1px solid #8a6a3a; color: var(--ink);
  box-shadow: inset 0 0 0 2px var(--parch); }
.hud.theme-dnd .sl:hover { border-color: var(--accent); }
.hud.theme-dnd .sl b { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .sl-row .ic { color: var(--ink-dim); }
.hud.theme-dnd .sl-wave { color: var(--ink); }
.hud.theme-dnd .sl.enemy .sl-wave { color: var(--crimson); }
.hud.theme-dnd .sl-bar { background: #cdb89a; }
.hud.theme-dnd .sl-bar .slbarfill { background: linear-gradient(90deg, #9a2a1a, #c08a2a); }
.hud.theme-dnd .sl-bar.wave .slbarfill { background: linear-gradient(90deg, #7a5a2a, #b08a4a); }
.hud.theme-dnd .sl-bar b { color: var(--ink); }
/* enemy specs table in the stats modal */
.hud.theme-dnd .enemytbl th { color: var(--ink-dim); border-bottom-color: var(--rule); font-family: 'Cinzel', serif; }
.hud.theme-dnd .enemytbl td { color: var(--ink); border-bottom-color: rgba(176,154,106,.4); }

/* floating check-in: a small carved parchment tablet (no neon) matching the ability-score stones. */
.hud.theme-dnd .checkin-float { background: var(--parch-lt); border: 1px solid #8a6a3a; color: var(--ink);
  box-shadow: inset 0 0 0 2px var(--parch), 0 3px 8px rgba(0,0,0,.3); font-family: 'Cinzel', serif; }
.hud.theme-dnd .checkin-float:hover { border-color: var(--accent); }
.hud.theme-dnd .checkin-float .cf-chip { background: rgba(122,74,26,.12); color: var(--ink); }
.hud.theme-dnd .checkin-float .cf-chip .ic { color: var(--ink-dim); }
.hud.theme-dnd .earncard .el { color: var(--ink-dim); font-family: 'Cinzel', serif; }
.hud.theme-dnd .earncard .ev { color: var(--gold-ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .earncard .ev span, .hud.theme-dnd .earncard .es { color: var(--ink-dim); }

/* the hero "character sheet" avatar frame */
.hud.theme-dnd .avatar-frame {
  background: radial-gradient(circle at 50% 40%, #f3ead4, #d8c8a8 75%);
  border: 2px solid #7a5a2a; box-shadow: inset 0 0 26px rgba(122,74,26,.25), 0 4px 14px rgba(0,0,0,.35);
}

/* milestones section / tier stepper / buttons — carved wood + brass */
.hud.theme-dnd .ms-section,
.hud.theme-dnd .tiersel .tierlabel,
.hud.theme-dnd .tiersel .tierstep,
.hud.theme-dnd .slotbtn {
  background: #c9b285; border: 2px solid #7a5a2a; color: var(--ink); box-shadow: 2px 2px 0 #7a5a2a;
  font-family: 'Cinzel', serif; border-radius: 4px;
}
.hud.theme-dnd .ms-section:hover, .hud.theme-dnd .tiersel .tierstep:hover { border-color: var(--crimson); color: var(--ink); }
.hud.theme-dnd .ms-section .ms-sec-ic { color: var(--gold-ink); }
.hud.theme-dnd .ms-section .ms-sec-tx b { color: var(--ink); }
.hud.theme-dnd .ms-section .ms-sec-sub { color: var(--ink-dim); }
.hud.theme-dnd .ms-section.has-claim .ms-sec-sub { color: #4a6b2a; }
.hud.theme-dnd .ms-section .ms-sec-badge { background: var(--crimson); color: var(--parch-lt); }
.hud.theme-dnd .ms-section .ms-sec-arrow { color: var(--ink-dim); }
.hud.theme-dnd .tiersel .tl-tier { color: var(--ink); }
.hud.theme-dnd .tiersel .tl-coin b { color: var(--gold-ink); }

/* the Start button: an embossed wax seal, not neon */
.hud.theme-dnd .startsq {
  color: var(--parch-lt); font-family: 'Cinzel Decorative', serif;
  background: radial-gradient(circle at 50% 38%, #b3331f, #7a1a10);
  border: 3px solid #5a140c; box-shadow: 0 4px 0 #4a100a, 0 0 22px rgba(154,42,26,.4), inset 0 0 18px rgba(0,0,0,.3);
}
.hud.theme-dnd .startsq:hover { box-shadow: 0 4px 0 #4a100a, 0 0 34px rgba(154,42,26,.7), inset 0 0 18px rgba(0,0,0,.3); }
.hud.theme-dnd .startsq .ic { color: var(--parch-lt); }

/* permanent-upgrade tiles → engraved hex-ish stones */
.hud.theme-dnd .perm,
.hud.theme-dnd .subtabs .subtab {
  background: var(--parch-lt); border: 1px solid var(--rule); color: var(--ink); border-radius: 4px;
}
.hud.theme-dnd .perm:hover:not(:disabled):not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .perm.tut { border-color: var(--crimson); box-shadow: 0 0 0 3px rgba(154,42,26,.18); }
.hud.theme-dnd .perm .pname { font-family: 'Cinzel', serif; color: var(--ink-dim); }
.hud.theme-dnd .perm .pcur { color: var(--ink); font-family: 'Cinzel', serif; }
/* perm header/footer zone tints adapted to parchment palette */
.hud.theme-dnd .perm .phead { background: rgba(42,26,8,.10); border-bottom-color: rgba(42,26,8,.12); }
.hud.theme-dnd .perm .pcost { color: var(--crimson); background: rgba(154,106,26,.10); border-top-color: rgba(154,106,26,.22); }
.hud.theme-dnd .perm .pcost.maxed { color: var(--ink-dim); background: rgba(42,26,8,.05); border-top-color: rgba(42,26,8,.08); }
.hud.theme-dnd .perm:hover:not(:disabled):not(.cant) .pcost { background: rgba(154,106,26,.18); border-top-color: rgba(154,106,26,.35); }
/* locked skill-group rows on parchment */
.hud.theme-dnd .permgroup { background: var(--parch-lt); border-color: var(--rule); }
.hud.theme-dnd .permgroup.next:hover { border-color: var(--gold-ink); }
.hud.theme-dnd .permgroup .pg-ic { color: var(--ink-dim); }
.hud.theme-dnd .permgroup.next .pg-ic { color: var(--gold-ink); }
.hud.theme-dnd .permgroup .pg-tx b { color: var(--ink); }
.hud.theme-dnd .permgroup .pg-tx span { color: var(--ink-dim); }
.hud.theme-dnd .permgroup .pg-act { color: var(--crimson); }
.hud.theme-dnd .permgroup.future .pg-act { color: var(--ink-dim); }
/* in-run upgrade tiles — same card shape; ink colours replace the dark-theme defaults */
.hud.theme-dnd .up .pname { font-family: 'Cinzel', serif; color: var(--ink-dim); }
.hud.theme-dnd .up .phead { background: rgba(42,26,8,.10); border-bottom-color: rgba(42,26,8,.12); }
.hud.theme-dnd .up .cur { color: var(--ink); }
.hud.theme-dnd .up .nxt { color: #4a7a2a; }
.hud.theme-dnd .up .nxt::before { color: var(--ink-dim); }
.hud.theme-dnd .up .pcost { color: var(--gold-ink); background: rgba(154,106,26,.10); border-top-color: rgba(154,106,26,.22); }
.hud.theme-dnd .up:hover:not(:disabled):not(.cant) { border-color: var(--crimson); }
.hud.theme-dnd .up:hover:not(:disabled):not(.cant) .pcost { background: rgba(154,42,26,.14); border-top-color: rgba(154,42,26,.28); }
/* bulk-buy multiplier chip: an inked parchment tab matching the ledger (Cinzel, gold rule). */
.hud.theme-dnd .bmult { background: var(--parch-dk); color: var(--accent); border-color: var(--rule);
  font-family: 'Cinzel', serif; font-weight: 700; box-shadow: 0 1px 2px rgba(42,26,8,.18); }
.hud.theme-dnd .bmult:hover { background: #ecdcb6; color: var(--ink); border-color: var(--accent); }
.hud.theme-dnd .subtabs .subtab.on { color: var(--ink); border-color: var(--crimson); background: rgba(122,74,26,.14); }
.hud.theme-dnd .subtabs .subtab .ic { color: var(--ink-dim); }

/* cards → quest scrolls */
.hud.theme-dnd .cardbtn { background: var(--parch-lt); border: 1px solid var(--rule); color: var(--ink); }
.hud.theme-dnd .cardbtn:hover:not(:disabled):not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .card { background: #f3ead4; border: 1px solid var(--rule); border-radius: 6px 6px 10px 10px; box-shadow: 0 6px 14px rgba(0,0,0,.35); }
.hud.theme-dnd .card.tier-gold { border-color: var(--gold-ink); box-shadow: 0 0 12px rgba(154,106,26,.3); }
.hud.theme-dnd .card.tier-chroma { border-color: #8a3aaa; box-shadow: 0 0 14px rgba(138,58,170,.3); }
.hud.theme-dnd .card.equipped { border-color: #6b8a3a; box-shadow: 0 6px 14px rgba(0,0,0,.35), 0 0 0 1px rgba(107,138,58,.55); }
.hud.theme-dnd .card.locked { border: 2px dashed var(--rule); background: var(--parch-dk); }
/* cards-tab sections + active strip themed to parchment */
.hud.theme-dnd .cards-section-h { color: var(--ink-dim); }
.hud.theme-dnd .cards-section-h .ac-count { color: var(--ink); }
.hud.theme-dnd .activecards::-webkit-scrollbar-thumb { background: var(--rule); }
.hud.theme-dnd .card.cardholder { border: 2px dashed var(--rule); background: var(--parch-dk); }
.hud.theme-dnd .card.cardholder .card-img { box-shadow: none; color: var(--rule); }
.hud.theme-dnd .card.cardholder .card-name { color: var(--ink-dim); }
.hud.theme-dnd .holder-tip { color: var(--ink-dim); }
.hud.theme-dnd .card.cardholder.buyslot .card-img { color: var(--gold-ink); }
.hud.theme-dnd .card.cardholder.buyslot .buyslot-amt { color: var(--gold-ink); }
.hud.theme-dnd .card.cardholder.buyslot:hover { border-color: var(--gold-ink); }
.hud.theme-dnd .activecards .card { box-shadow: none; }

/* ---- Labs: parchment-fit the slots, descriptions, actions and picker (base theme is dark) ---- */
.hud.theme-dnd .labslot { background: var(--parch-lt); border: 1px solid var(--rule); }
.hud.theme-dnd .labslot.running { border-color: var(--accent); box-shadow: inset 0 0 16px rgba(122,74,26,.10); }
.hud.theme-dnd .labslot.empty:hover { border-color: var(--accent); }
.hud.theme-dnd .labdesc { color: var(--ink-dim); }
.hud.theme-dnd .labactions .labrem { color: var(--ink-dim); }
.hud.theme-dnd .labactions .rushlab { border-color: var(--rule); color: var(--gold-ink); }
.hud.theme-dnd .labactions .rushlab:hover:not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .labactions .changelab { border-color: var(--rule); color: var(--ink-dim); }
.hud.theme-dnd .labactions .changelab:hover { border-color: var(--accent); color: var(--ink); }
.hud.theme-dnd .labpick-row { background: var(--parch-lt); border: 1px solid var(--rule); }
.hud.theme-dnd .labpick-ic { color: var(--ink-dim); }
.hud.theme-dnd .labpick-title b { color: var(--ink); }
.hud.theme-dnd .labpick-title span { color: var(--ink-dim); }
.hud.theme-dnd .labpick-info { border-color: var(--rule); color: var(--ink-dim); }
.hud.theme-dnd .labpick-info:hover { border-color: var(--accent); color: var(--ink); }
.hud.theme-dnd .labpick-start { background: rgba(154,106,26,.10); border-color: var(--rule); color: var(--gold-ink); }
.hud.theme-dnd .labpick-start:hover:not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .labpick-start.cant { color: var(--ink-dim); }
.hud.theme-dnd .labpick-detail { border-top-color: var(--rule); color: var(--ink-dim); }
/* glass tube reads fine on parchment; nudge its rim to a warmer bronze to match the wood cork */
.hud.theme-dnd .vial .vtube { border-color: rgba(90,60,20,.55); }

.hud.theme-dnd .card-img { box-shadow: inset 0 0 0 1px rgba(122,74,26,.25); }
.hud.theme-dnd .card-band { opacity: .22; }
.hud.theme-dnd .card-name { font-family: 'Cinzel', serif; color: var(--ink); text-shadow: none; }
.hud.theme-dnd .card-desc { color: var(--ink-dim); border-top-color: rgba(122,74,26,.25); }
.hud.theme-dnd .cmhead .cm-title b { color: var(--ink); }
.hud.theme-dnd .cmhead .cm-title span, .hud.theme-dnd .cm-sub { color: var(--ink-dim); }
.hud.theme-dnd .cardbtn .cb-t { color: var(--ink); }
.hud.theme-dnd .cardbtn .cb-s { color: var(--ink-dim); }
.hud.theme-dnd .cardbtn .cb-cost { color: var(--ink); }

/* labs → spell research scrolls */
.hud.theme-dnd .lab { background: var(--parch-lt); border: 1px solid var(--rule); }
.hud.theme-dnd .lab.active { border-color: var(--accent); box-shadow: inset 0 0 16px rgba(122,74,26,.12); }
.hud.theme-dnd .lab .pname { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .lab .lablv, .hud.theme-dnd .lab .pcost { color: var(--ink-dim); }
.hud.theme-dnd .lab .pcur { color: #4a7a2a; }
.hud.theme-dnd .lab .reslab { background: var(--parch); border: 1px solid var(--rule); color: var(--gold-ink); }
.hud.theme-dnd .lab .reslab:hover:not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .lab .mbar { background: rgba(42,26,8,.12); border: 1px solid var(--rule); }
.hud.theme-dnd .lab .mbar i { background: linear-gradient(90deg, #7a4a1a, #b3331f); }
.hud.theme-dnd .lab .rushlab { color: var(--accent); border: 1px solid var(--rule); }
.hud.theme-dnd .lab .cancellab { color: var(--crimson); border: 1px solid var(--rule); }
.hud.theme-dnd .coins-chip .slotchip { color: var(--ink-dim); }

/* check-in proclamation */
.hud.theme-dnd .checkin { background: var(--parch-lt); border: 1px solid var(--rule); color: var(--ink-dim); }
.hud.theme-dnd .checkin.ready { color: var(--parch-lt); background: linear-gradient(90deg, #7a4a1a, #b3331f); border-color: #7a4a1a; }
.hud.theme-dnd .checkin.ready .ic { color: var(--parch-lt); }

/* shared rows / overview / settings on parchment */
.hud.theme-dnd .strow { border-bottom: 1px dotted var(--rule); }
.hud.theme-dnd .strow span { color: var(--ink-dim); }
.hud.theme-dnd .strow b { color: var(--ink); }
.hud.theme-dnd .over-rewards .rew { border-bottom: 1px dotted var(--rule); }
.hud.theme-dnd .over-rewards .rew span { color: var(--ink-dim); }
.hud.theme-dnd .over-rewards .rew b { color: var(--crimson); }
.hud.theme-dnd .exitrun { background: #7a1a10; color: var(--parch-lt); border-top: 1px solid #5a140c; }
.hud.theme-dnd .exitrun:hover { background: #9a2a1a; color: #fff; }
/* Run-Over "Back" + End-run "Keep playing" + confirm copy → parchment, not dark */
.hud.theme-dnd .over-back,
.hud.theme-dnd .endkeep { background: #c9b285; border-top: 2px solid #7a5a2a; color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .over-back:hover,
.hud.theme-dnd .endkeep:hover { background: #d8c8a8; color: var(--ink); }
.hud.theme-dnd .over-back .ic { color: var(--ink-dim); }
.hud.theme-dnd .endbody { color: var(--ink-dim); }
.hud.theme-dnd .setrow { color: var(--ink); border-bottom: 1px dotted var(--rule); }
.hud.theme-dnd .setrow .switch { background: var(--parch-dk); border: 1px solid #8a6a3a; }
.hud.theme-dnd .setrow .switch i { background: var(--ink-dim); }
.hud.theme-dnd .setrow.on .switch { background: #6a8a3a; }
.hud.theme-dnd .setrow.on .switch i { background: var(--parch-lt); }
/* milestone trail on parchment: an inked spine, gilded to the furthest wave, a wax-seal "here" pin */
.hud.theme-dnd .msrail::before { background: var(--rule); }
.hud.theme-dnd .msrow.reached .msrail::before { background: linear-gradient(180deg, #d9a94a, var(--gold-ink)); }
.hud.theme-dnd .msdot { background: var(--parch-dk); color: var(--ink-dim); box-shadow: inset 0 0 0 1px var(--rule); }
.hud.theme-dnd .msrow.reached .msdot { background: linear-gradient(180deg, #e2bd66, var(--gold-ink)); color: #2a1a08; box-shadow: none; }
.hud.theme-dnd .msrow.can .msdot { background: linear-gradient(180deg, #8aa64f, #5e7a3a); color: var(--parch-lt); box-shadow: 0 0 0 3px rgba(107,138,58,.3); }
.hud.theme-dnd .mscard { border-bottom-color: rgba(122,74,26,.22); }
.hud.theme-dnd .mn-info b { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .msrow.locked .mn-info b { color: var(--ink-dim); }
.hud.theme-dnd .mn-reward { color: var(--gold-ink); }
.hud.theme-dnd .mn-reward.locked { color: var(--ink-dim); }
.hud.theme-dnd .mn-done { color: #5e7a3a; }
.hud.theme-dnd .mn-claim { background: rgba(107,138,58,.16); border-color: #6b8a3a; color: #4a6b2a; }
.hud.theme-dnd .mn-claim:hover { background: rgba(107,138,58,.28); }
.hud.theme-dnd .modal .msnote { color: var(--ink-dim); }
.hud.theme-dnd .modal .close { color: var(--ink-dim); }
.hud.theme-dnd .modal .close:hover { color: var(--ink); }
.hud.theme-dnd .msnow .mspin { background: var(--crimson); color: var(--parch-lt); box-shadow: 0 0 0 3px rgba(154,42,26,.25); }
.hud.theme-dnd .msnow .mn-info b { color: var(--crimson); }
.hud.theme-dnd .msnow .mn-reward { color: var(--ink-dim); }
/* milestones modal header band + tower-skin reward rung on parchment */
.hud.theme-dnd .ms-tierband { background: rgba(154,106,26,.16); color: var(--gold-ink); }
.hud.theme-dnd .ms-ready { color: #4a6b2a; }
.hud.theme-dnd .mn-info .mn-kind { color: var(--ink-dim); }
.hud.theme-dnd .mn-tw-tx b { color: var(--gold-ink); }
.hud.theme-dnd .mn-tw-tx span { color: var(--ink-dim); }
.hud.theme-dnd .msrow.tower .msdot { background: linear-gradient(180deg, #e2bd66, var(--gold-ink)); color: #2a1a08; }
.hud.theme-dnd .ghint { background: var(--parch-lt); border: 1px solid var(--accent); color: var(--ink); }
.hud.theme-dnd .lk-tip, .hud.theme-dnd .tut-thought { background: #c9b285; color: var(--ink); border: 1px solid #7a5a2a; }
.hud.theme-dnd .lk-tip:after, .hud.theme-dnd .tut-thought:after { border-top-color: #c9b285; }
.hud.theme-dnd .tut-dim { box-shadow: 0 0 0 9999px rgba(43,29,16,.5), 0 0 22px 4px rgba(154,106,26,.45) inset; border-color: rgba(154,106,26,.7); }
`;

export const createDndHud = createThemedHud({ cls: 'theme-dnd', css: CSS });
