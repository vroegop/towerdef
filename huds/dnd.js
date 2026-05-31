/* huds/dnd.js — the "D&D" parchment skin (Set A) as a REAL, full-parity HUD.

   It is NOT a fork of the HUD logic: it reuses the single themeable core in hud/hud.js via
   A.createThemedHud({ cls, css }). The core renders the exact same DOM + wires the exact same
   handlers as Classic; this file only supplies a scope class and an override stylesheet that
   restyles that DOM into aged parchment, burnt-sienna ink and Cinzel/IM-Fell display type.

   Palette + type lifted from the Set A prototype (huds/_prototype-hud-gallery.html, theme-dnd):
     parchment #e9dcc0 / #f3e9d2 · ink #2a1a08 · accent #7a4a1a · crimson #9a2a1a · rule #b09a6a
     fonts: 'Cinzel Decorative' (titles) · Cinzel (headings) · 'IM Fell English' (body)

   Eager-loaded (registry load() returns this factory synchronously). Self-contained: the only
   external dep is the Google Fonts @import inside the injected stylesheet. */
(function (A) {
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

/* parchment backdrop for every full-screen surface (menu / overview / modals / stats) */
.hud.theme-dnd .menu,
.hud.theme-dnd .modal,
.hud.theme-dnd .over { background: #2b1d10; }
.hud.theme-dnd .menu-content,
.hud.theme-dnd .modal-inner {
  background: var(--parch);
  background-image: radial-gradient(circle at 30% 8%, var(--parch-lt), #e3d3b0 70%);
}
.hud.theme-dnd .menu-content,
.hud.theme-dnd .modal { box-shadow: inset 0 0 0 3px #8a6a3a, inset 0 0 0 6px var(--parch); }

/* ---- in-run top stats: engraved on the arena ---- */
.hud.theme-dnd .topbar { text-shadow: 0 1px 2px rgba(243,233,210,.4); }
.hud.theme-dnd .stat .lbl { color: var(--ink-dim); font-family: 'Cinzel', serif; font-weight: 700; }
.hud.theme-dnd .wave b { color: var(--crimson); font-family: 'Cinzel', serif; }
.hud.theme-dnd .gold b { color: var(--gold-ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .stat.hp b { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .iconbtn { color: var(--ink-dim); }
.hud.theme-dnd .iconbtn:hover { color: var(--ink); }
.hud.theme-dnd .protolink { color: var(--accent); }

/* side menu: a small parchment rail pinned in the margin */
.hud.theme-dnd .sidemenu { background: var(--parch); background-image: radial-gradient(circle at 70% 8%, var(--parch-lt), #e3d3b0 70%);
  border: 3px double #7a5a2a; }
.hud.theme-dnd .sideitem { color: var(--ink); }
.hud.theme-dnd .sideitem .ic { color: var(--ink-dim); }
.hud.theme-dnd .sideitem:hover { background: rgba(122,74,26,.12); }
.hud.theme-dnd .sideitem:hover .ic { color: var(--ink); }
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
.hud.theme-dnd .menuproto, .hud.theme-dnd .menugear { color: var(--accent); }
.hud.theme-dnd .menuproto:hover, .hud.theme-dnd .menugear:hover { color: var(--ink); }

/* chips / cores chip / earnings — framed ledger entries */
.hud.theme-dnd .chip,
.hud.theme-dnd .cores-chip,
.hud.theme-dnd .earncard {
  background: rgba(255,255,255,.32); border: 1px solid var(--rule); border-radius: 4px; color: var(--ink-dim);
}
.hud.theme-dnd .chip b { color: var(--ink); }
.hud.theme-dnd .cores-chip b { color: var(--crimson); }
.hud.theme-dnd .earncard .el { color: var(--ink-dim); font-family: 'Cinzel', serif; }
.hud.theme-dnd .earncard .ev { color: var(--gold-ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .earncard .ev span, .hud.theme-dnd .earncard .es { color: var(--ink-dim); }

/* the hero "character sheet" avatar frame */
.hud.theme-dnd .avatar-frame {
  background: radial-gradient(circle at 50% 40%, #f3ead4, #d8c8a8 75%);
  border: 2px solid #7a5a2a; box-shadow: inset 0 0 26px rgba(122,74,26,.25), 0 4px 14px rgba(0,0,0,.35);
}

/* milestones / tier stepper / buttons — carved wood + brass */
.hud.theme-dnd .msbtn,
.hud.theme-dnd .tiersel .tierlabel,
.hud.theme-dnd .tiersel .tierstep,
.hud.theme-dnd .slotbtn {
  background: #c9b285; border: 2px solid #7a5a2a; color: var(--ink); box-shadow: 2px 2px 0 #7a5a2a;
  font-family: 'Cinzel', serif; border-radius: 4px;
}
.hud.theme-dnd .msbtn:hover, .hud.theme-dnd .tiersel .tierstep:hover { border-color: var(--crimson); color: var(--ink); }
.hud.theme-dnd .tiersel .tl-tier { color: var(--ink); }
.hud.theme-dnd .tiersel .tl-core b { color: var(--gold-ink); }
.hud.theme-dnd .msbtn .badge { background: var(--crimson); color: var(--parch-lt); }

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
.hud.theme-dnd .perm .pcost { color: var(--crimson); }
.hud.theme-dnd .subtabs .subtab.on { color: var(--ink); border-color: var(--crimson); background: rgba(122,74,26,.14); }
.hud.theme-dnd .subtabs .subtab .ic { color: var(--ink-dim); }

/* cards → quest scrolls */
.hud.theme-dnd .cardbtn { background: var(--parch-lt); border: 1px solid var(--rule); color: var(--ink); }
.hud.theme-dnd .cardbtn:hover:not(:disabled):not(.cant) { border-color: var(--gold-ink); }
.hud.theme-dnd .card { background: #f3ead4; border: 1px solid var(--rule); border-radius: 6px 6px 10px 10px; box-shadow: 0 6px 14px rgba(0,0,0,.35); }
.hud.theme-dnd .card.tier-gold { border-color: var(--gold-ink); box-shadow: 0 0 12px rgba(154,106,26,.3); }
.hud.theme-dnd .card.tier-chroma { border-color: #8a3aaa; box-shadow: 0 0 14px rgba(138,58,170,.3); }
.hud.theme-dnd .card.locked { border: 2px dashed var(--rule); background: var(--parch-dk); }
.hud.theme-dnd .card-img { box-shadow: inset 0 0 0 1px rgba(122,74,26,.25); }
.hud.theme-dnd .card-band { opacity: .22; }
.hud.theme-dnd .card-name { font-family: 'Cinzel', serif; color: var(--ink); text-shadow: none; }
.hud.theme-dnd .card-desc { color: var(--ink-dim); border-top-color: rgba(122,74,26,.25); }
.hud.theme-dnd .cmhead .cm-title b { color: var(--ink); }
.hud.theme-dnd .cmhead .cm-title span, .hud.theme-dnd .cm-sub { color: var(--ink-dim); }
.hud.theme-dnd .cardbtn .cb-t { color: var(--ink); }
.hud.theme-dnd .cardbtn .cb-s { color: var(--ink-dim); }

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
.hud.theme-dnd .cores-chip .slotchip { color: var(--ink-dim); }

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
.hud.theme-dnd .setrow { color: var(--ink); border-bottom: 1px dotted var(--rule); }
.hud.theme-dnd .setrow .switch { background: var(--parch-dk); }
.hud.theme-dnd .setrow.on .switch { background: #6a8a3a; }
.hud.theme-dnd .ms { background: var(--parch-lt); border: 1px solid var(--rule); }
.hud.theme-dnd .ms.can { border-color: #4a7a2a; }
.hud.theme-dnd .ms .mw { color: var(--ink); font-family: 'Cinzel', serif; }
.hud.theme-dnd .ms .mr { color: var(--gold-ink); }
.hud.theme-dnd .ms button { background: #2f5a1a; border: 1px solid #4a7a2a; color: var(--parch-lt); }
.hud.theme-dnd .ghint { background: var(--parch-lt); border: 1px solid var(--accent); color: var(--ink); }
.hud.theme-dnd .lk-tip, .hud.theme-dnd .tut-thought { background: #c9b285; color: var(--ink); border: 1px solid #7a5a2a; }
.hud.theme-dnd .lk-tip:after, .hud.theme-dnd .tut-thought:after { border-top-color: #c9b285; }
.hud.theme-dnd .tut-dim { box-shadow: 0 0 0 9999px rgba(43,29,16,.5), 0 0 22px 4px rgba(154,106,26,.45) inset; border-color: rgba(154,106,26,.7); }
`;

  A.createDndHud = A.createThemedHud({ cls: 'theme-dnd', css: CSS });
})(window.ARENA = window.ARENA || {});
