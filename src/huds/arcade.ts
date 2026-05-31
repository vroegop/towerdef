/* src/huds/arcade.ts — the "Arcade" CRT-cabinet skin as a REAL, full-parity HUD.
   Like huds/dnd.ts, this reuses the single themeable core via createThemedHud({ cls, css }). */
import { createThemedHud } from '../hud/hud';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

/* ============ Arcade cabinet skin — scoped to .hud.theme-arcade ============ */
.hud.theme-arcade {
  --bg: #101018; --panel: #1a1a2e; --panel-dk: #14142a;
  --ink: #fff; --dim: #7f7faf; --rule: #3a3a5e;
  --accent: #ffd23f; --teal: #06d6a0; --crimson: #d62828; --pink: #ef476f;
  color: var(--ink);
  font-family: 'Press Start 2P', ui-monospace, monospace;
  font-size: 11px; line-height: 1.7;
  image-rendering: pixelated;
}
.hud.theme-arcade b { color: var(--ink); }
/* pixel type is wide: relax fixed widths the base sets for proportional fonts */
.hud.theme-arcade .stat.hp b { min-width: 0; }
.hud.theme-arcade .stat.gold b { min-width: 0; }
.hud.theme-arcade .menutabs button,
.hud.theme-arcade .tabs button { font-family: 'Press Start 2P', monospace; font-size: 8px; }

/* CRT backdrops with a faint scanline grid */
.hud.theme-arcade .menu,
.hud.theme-arcade .modal,
.hud.theme-arcade .over {
  background: var(--bg);
  background-image: linear-gradient(transparent 95%, rgba(255,255,255,.05) 0),
                    linear-gradient(90deg, transparent 95%, rgba(255,255,255,.05) 0);
  background-size: 24px 24px;
}
.hud.theme-arcade .menu-content,
.hud.theme-arcade .modal-inner { background: transparent; }

/* ---- in-run top stats: glowing marquee readouts ---- */
.hud.theme-arcade .topbar { text-shadow: 2px 2px 0 #000; }
.hud.theme-arcade .stat .lbl { color: var(--dim); font-size: 8px; }
.hud.theme-arcade .wave b { color: var(--accent); }
.hud.theme-arcade .gold b { color: var(--accent); }
.hud.theme-arcade .stat.hp b { color: var(--pink); }
.hud.theme-arcade .iconbtn { color: var(--dim); }
.hud.theme-arcade .iconbtn:hover { color: var(--ink); }
.hud.theme-arcade .protolink { color: var(--teal); }

/* side menu: a chunky cabinet rail */
.hud.theme-arcade .sidemenu { background: var(--panel); border: 3px solid #fff; border-radius: 0; backdrop-filter: none; }
.hud.theme-arcade .sideitem { color: var(--ink); border-radius: 0; }
.hud.theme-arcade .sideitem .ic { color: var(--dim); }
.hud.theme-arcade .sideitem:hover { background: rgba(255,210,63,.12); }
.hud.theme-arcade .sideitem:hover .ic { color: var(--ink); }
.hud.theme-arcade .hpbar { background: #000; border: 2px solid #fff; border-radius: 0; height: 10px; }
.hud.theme-arcade .hpbar i { background: var(--teal); }

/* wave countdown: a chunky power meter */
.hud.theme-arcade .wavebar { width: 8px; background: #000; border-left: 2px solid #fff; }
.hud.theme-arcade .wavebar i { background: var(--accent); box-shadow: none; }

/* ---- in-run upgrade dock: bezeled cabinet panel ---- */
.hud.theme-arcade .tabbar { background: var(--panel); border-top: 4px solid #fff; backdrop-filter: none; }
.hud.theme-arcade .tabs button { color: var(--dim); }
.hud.theme-arcade .tabs button.on { color: #222; border-top: 0; background: var(--accent); }
.hud.theme-arcade .up {
  background: var(--panel-dk); border: 3px solid #fff; color: var(--ink); border-radius: 0; box-shadow: 3px 3px 0 #000;
}
.hud.theme-arcade .up:hover:not(:disabled):not(.cant) { border-color: var(--accent); }
.hud.theme-arcade .up .nm .ic { color: var(--teal); }
.hud.theme-arcade .up .delta { color: var(--dim); }
.hud.theme-arcade .up .cost { color: var(--accent); }
.hud.theme-arcade .tablock, .hud.theme-arcade .tablock .ic { color: var(--dim); }

/* ---- menu chrome ---- */
.hud.theme-arcade .menutabs { background: var(--panel); border-top: 4px solid #fff; }
.hud.theme-arcade .menutabs button { color: var(--dim); }
.hud.theme-arcade .menutabs button.on { color: #222; border-top: 0; background: var(--accent); }
.hud.theme-arcade .menutabs button.locked { color: #44446a; }
.hud.theme-arcade .statshead { border-bottom: 4px solid #fff; }
.hud.theme-arcade .statshead h2, .hud.theme-arcade .modal h2 { color: var(--accent); text-shadow: 2px 2px 0 var(--crimson); font-size: 14px; }
.hud.theme-arcade .menuproto, .hud.theme-arcade .menugear { color: var(--teal); }
.hud.theme-arcade .menuproto:hover, .hud.theme-arcade .menugear:hover { color: var(--ink); }

/* every framed surface = white-bezel cabinet card with hard shadow */
.hud.theme-arcade .statscard,
.hud.theme-arcade .over-card,
.hud.theme-arcade .setmodal-inner,
.hud.theme-arcade .cardmodal-inner,
.hud.theme-arcade .chip,
.hud.theme-arcade .cores-chip,
.hud.theme-arcade .earncard,
.hud.theme-arcade .msbtn,
.hud.theme-arcade .tiersel .tierlabel,
.hud.theme-arcade .tiersel .tierstep,
.hud.theme-arcade .slotbtn,
.hud.theme-arcade .cardbtn,
.hud.theme-arcade .perm,
.hud.theme-arcade .subtabs .subtab,
.hud.theme-arcade .card,
.hud.theme-arcade .lab,
.hud.theme-arcade .ms,
.hud.theme-arcade .up,
.hud.theme-arcade .checkin {
  border-radius: 0;
}
.hud.theme-arcade .statscard,
.hud.theme-arcade .over-card,
.hud.theme-arcade .setmodal-inner,
.hud.theme-arcade .cardmodal-inner {
  background: var(--panel); border: 4px solid #fff; box-shadow: 6px 6px 0 #000;
}

.hud.theme-arcade .chip,
.hud.theme-arcade .cores-chip,
.hud.theme-arcade .earncard {
  background: var(--panel); border: 3px solid #fff; color: var(--dim); box-shadow: 3px 3px 0 #000;
}
.hud.theme-arcade .chip b { color: var(--ink); }
.hud.theme-arcade .cores-chip b { color: var(--accent); }
.hud.theme-arcade .earncard .el { color: var(--dim); font-size: 8px; }
.hud.theme-arcade .earncard .ev { color: var(--accent); }
.hud.theme-arcade .earncard .ev span, .hud.theme-arcade .earncard .es { color: var(--dim); }

/* hero "sprite" frame */
.hud.theme-arcade .avatar-frame {
  background: #05060f; border: 4px solid #fff; box-shadow: 6px 6px 0 #000;
  border-radius: 0;
}

.hud.theme-arcade .msbtn,
.hud.theme-arcade .tiersel .tierlabel,
.hud.theme-arcade .tiersel .tierstep,
.hud.theme-arcade .slotbtn {
  background: var(--panel-dk); border: 3px solid #fff; color: var(--ink); box-shadow: 3px 3px 0 #000;
}
.hud.theme-arcade .msbtn:hover, .hud.theme-arcade .tiersel .tierstep:hover { border-color: var(--accent); }
.hud.theme-arcade .tiersel .tl-tier { color: var(--ink); }
.hud.theme-arcade .tiersel .tl-core b { color: var(--accent); }
.hud.theme-arcade .msbtn .badge { background: var(--teal); color: #002018; border-radius: 0; }

/* INSERT COIN → PLAY: blinking neon start cabinet button */
.hud.theme-arcade .startsq {
  color: #222; border-radius: 0;
  background: var(--accent);
  border: 4px solid #fff; box-shadow: 6px 6px 0 #000, 0 0 18px rgba(255,210,63,.5);
  animation: arc-startblink 1s steps(1) infinite;
}
.hud.theme-arcade .startsq:hover { box-shadow: 6px 6px 0 #000, 0 0 30px rgba(255,210,63,.9); }
.hud.theme-arcade .startsq .ic { color: #222; }
@keyframes arc-startblink { 50% { background: #ffe98a; } }

/* permanent-upgrade tiles → vending-machine slots */
.hud.theme-arcade .perm,
.hud.theme-arcade .subtabs .subtab {
  background: var(--panel-dk); border: 2px solid var(--rule); color: var(--ink);
}
.hud.theme-arcade .perm:hover:not(:disabled):not(.cant) { border-color: var(--accent); }
.hud.theme-arcade .perm.tut { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255,210,63,.25); }
.hud.theme-arcade .perm .pname { color: var(--dim); font-size: 8px; }
.hud.theme-arcade .perm .pcur { color: var(--ink); }
.hud.theme-arcade .perm .pcost { color: var(--accent); }
.hud.theme-arcade .subtabs .subtab.on { color: #222; border-color: #fff; background: var(--accent); }
.hud.theme-arcade .subtabs .subtab .ic { color: var(--teal); }

/* cards → game cartridges */
.hud.theme-arcade .cardbtn { background: var(--panel-dk); border: 3px solid #fff; color: var(--ink); box-shadow: 3px 3px 0 #000; }
.hud.theme-arcade .cardbtn:hover:not(:disabled):not(.cant) { border-color: var(--teal); }
.hud.theme-arcade .card { background: var(--panel-dk); border: 4px solid #fff; box-shadow: 5px 5px 0 #000; }
.hud.theme-arcade .card.tier-gold { border-color: var(--accent); }
.hud.theme-arcade .card.tier-chroma { border-color: var(--pink); }
.hud.theme-arcade .card.locked { border: 3px dashed var(--rule); background: #0c0c1a; box-shadow: none; }
.hud.theme-arcade .card { border-radius: 0; }
.hud.theme-arcade .card-img { box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.hud.theme-arcade .card-desc { color: var(--dim); border-top-color: rgba(255,255,255,.14); }
.hud.theme-arcade .cardbtn { border-radius: 0; }
.hud.theme-arcade .cardbtn .cb-ic { border-radius: 0; }
.hud.theme-arcade .cardbtn .cb-s { color: var(--dim); }

/* labs → cartridge research bay */
.hud.theme-arcade .lab { background: var(--panel-dk); border: 3px solid #fff; box-shadow: 4px 4px 0 #000; }
.hud.theme-arcade .lab.active { border-color: var(--accent); box-shadow: 4px 4px 0 #000, inset 0 0 16px rgba(255,210,63,.12); }
.hud.theme-arcade .lab .pname { color: var(--ink); font-size: 9px; }
.hud.theme-arcade .lab .lablv, .hud.theme-arcade .lab .pcost { color: var(--dim); }
.hud.theme-arcade .lab .pcur { color: var(--teal); }
.hud.theme-arcade .lab .reslab { background: #000; border: 2px solid #fff; color: var(--accent); border-radius: 0; }
.hud.theme-arcade .lab .reslab:hover:not(.cant) { border-color: var(--accent); }
.hud.theme-arcade .lab .mbar { background: #000; border: 2px solid #fff; border-radius: 0; }
.hud.theme-arcade .lab .mbar i { background: var(--teal); }
.hud.theme-arcade .lab .rushlab { color: var(--teal); border: 2px solid var(--rule); border-radius: 0; }
.hud.theme-arcade .lab .cancellab { color: var(--pink); border: 2px solid var(--rule); border-radius: 0; }
.hud.theme-arcade .cores-chip .slotchip { color: var(--dim); }

/* check-in → INSERT COIN */
.hud.theme-arcade .checkin { background: var(--panel-dk); border: 3px solid #fff; color: var(--dim); box-shadow: 3px 3px 0 #000; }
.hud.theme-arcade .checkin.ready { color: #002018; background: var(--teal); border-color: #fff; animation: blink 1s steps(1) infinite; }
.hud.theme-arcade .checkin.ready .ic { color: #002018; }
@keyframes blink { 50% { opacity: .55; } }

/* shared rows / overview / settings */
.hud.theme-arcade .strow { border-bottom: 2px solid var(--rule); }
.hud.theme-arcade .strow span { color: var(--dim); }
.hud.theme-arcade .strow b { color: var(--ink); }
.hud.theme-arcade .over-rewards .rew { border-bottom: 2px solid var(--rule); }
.hud.theme-arcade .over-rewards .rew span { color: var(--dim); }
.hud.theme-arcade .over-rewards .rew b { color: var(--accent); }
.hud.theme-arcade .over-rewards .rew b.tok { color: var(--teal); }
.hud.theme-arcade .exitrun { background: var(--crimson); color: #fff; border-top: 4px solid #fff; }
.hud.theme-arcade .exitrun:hover { background: #ff3b3b; }
.hud.theme-arcade .setrow { color: var(--ink); border-bottom: 2px solid var(--rule); }
.hud.theme-arcade .setrow .switch { background: #000; border: 2px solid #fff; border-radius: 0; }
.hud.theme-arcade .setrow .switch i { border-radius: 0; background: var(--dim); }
.hud.theme-arcade .setrow.on .switch { background: #003a2a; }
.hud.theme-arcade .setrow.on .switch i { background: var(--teal); }
.hud.theme-arcade .ms { background: var(--panel-dk); border: 3px solid #fff; box-shadow: 3px 3px 0 #000; }
.hud.theme-arcade .ms.can { border-color: var(--teal); }
.hud.theme-arcade .ms .mw { color: var(--ink); font-size: 9px; }
.hud.theme-arcade .ms .mr { color: var(--accent); }
.hud.theme-arcade .ms button { background: #003a2a; border: 2px solid var(--teal); color: #caffe9; border-radius: 0; }
.hud.theme-arcade .ghint { background: var(--panel); border: 3px solid var(--accent); color: var(--ink); border-radius: 0; }
.hud.theme-arcade .ghint .k { background: #000; border: 2px solid #fff; border-radius: 0; }
.hud.theme-arcade .lk-tip, .hud.theme-arcade .tut-thought { background: var(--panel); color: var(--ink); border: 3px solid #fff; border-radius: 0; }
.hud.theme-arcade .lk-tip:after, .hud.theme-arcade .tut-thought:after { border-top-color: #fff; }
.hud.theme-arcade .tut-dim { box-shadow: 0 0 0 9999px rgba(16,16,24,.55), 0 0 22px 4px rgba(255,210,63,.5) inset; border-color: rgba(255,210,63,.8); }
`;

export const createArcadeHud = createThemedHud({ cls: 'theme-arcade', css: CSS });
