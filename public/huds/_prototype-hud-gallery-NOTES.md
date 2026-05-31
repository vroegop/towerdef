# HUD + Game Style Gallery — prototype notes

**Throwaway prototype.** Question it answers: _which HUD + in-game art style should we build for the swappable HUD system?_

Two parallel documents, cross-linked (button top-corner of each):
- **Set A** — `_prototype-hud-gallery.html` — the baseline-extreme look & feel.
- **Set B** — `_prototype-hud-gallery-v2.html` — the **same six themes, fully redesigned**: different navigation paradigm, different naming, different palette/layout.

## How to open
Dev server serves the repo. Open either:
`http://localhost:8778/huds/_prototype-hud-gallery.html`  (Set A)
`http://localhost:8778/huds/_prototype-hud-gallery-v2.html` (Set B)
(or open the `.html` directly — self-contained, only external dep is Google Fonts).

- **Bottom white bar** swaps THEME (`←` / `→` keys too). `?style=<id>&page=<id>` is shareable/reload-stable.
- **Each theme has inner navigation** (`1`–`6` keys) over pages: **Home · Upgrades · Cards · Labs · Play · Questions**.
- **Home = main menu** (out of run) with **Play buttons**. **Play = in-game**: the running-game mock + an in-game HUD bar + a **❚❚ in-game pause menu**, with a "● live run" flag so it's clearly *not* the main menu. (Upgrades are intentionally locked mid-run.)
- **Labs use slots**: 1 running, 1 **open → click to open a research-selection list**, 3 **locked** with unlock reqs (max 5).
- **Cards** is literally "Cards" in every theme (shows cards, real word).
- Upgrades / Cards / Labs buttons are **dummy** (toast feedback, no real state).
- All themes read ONE fixed mock state (`G`) so you compare *form*, not data.

## The six themes (same ids in both sets)
| id | Set A (baseline) | Set B (redesign) |
|----|------------------|------------------|
| `dnd` | parchment character sheet · **hex stats** · top tabs · quest-board labs | **illuminated tome** · drop-cap prose · **right ribbon-bookmark nav** · "Pacts" labs |
| `arcade` | colorful CRT cabinet · vending-machine shop · cartridge labs | **4-shade Game-Boy handheld** · **D-pad dock nav** · LINK-cable labs |
| `holo` | cyan centered radial ring · augment-ring upgrades · fab-bay labs | **amber first-person AR visor** · corner reticle · **radial wheel nav** · FORGE labs |
| `tui` | green boxes · apt-table upgrades · download-queue labs · top tabs | **amber BBS** · ANSI banner · **bottom tmux status-bar nav** · cron labs |
| `steam` | warm brass · dial home · pipe/valve upgrades · alembic labs | **iron + verdigris submarine cockpit** · porthole · **lever-bank nav** · retort labs |
| `plants` | sunny **PvZ lawn lanes** (zombies) · almanac upgrades · seed-pot labs | **moonlit vertical terrarium** (threats descend to one core) · **left vine-trellis nav** |

Per-theme **Upgrades layout differs** (Set A): hex advancement / vending grid / augment ring / apt table / pipe-valves / seed almanac.
Per-theme **Labs slot visuals differ** (Set A): quest scrolls / cartridges / fab hexes / download rows / alembic flasks / plant pots.

Dropped earlier per request: Fallout Pip-Boy ("idea 2") and the four neural styles (Synapse/Wetware/Cosmic/Mycelial). Also gone from pass 1: Cyberpunk, Swiss, Glass, TCG.

## Status
- Verified in-browser: **both sets, all 6 themes × 6 pages render, zero JS errors**. Lab slot→selection, in-game pause menu, dummy buttons, keyboard, switcher, and the A↔B cross-links all work.
- Known nits (prototype-level): Set A holo augment-ring chips crowd near the hub; Set B holo radial wheel labels are a touch small. Easy to space out when chosen.

## VERDICT — pending
> _Fill in when a direction is chosen, then build the winner as a real HUD module under `huds/` against live game state and delete both prototype files._
>
> The useful answer is usually a **mashup**: pick a theme, then say which *Set* (A vs B) wins for its **look**, **navigation**, and **naming** — they're mix-and-match. e.g. "Plants, Set A lanes for the arena + Set B moonlit palette" or "Terminal, Set B amber + tmux nav but Set A apt naming."
>
> Theme: …  ·  Look: A/B …  ·  Nav: A/B …  ·  Naming: A/B …
> Why: …
