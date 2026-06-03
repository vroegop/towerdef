# Continuous top-up spawning — design

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan
**Area:** `src/sim/waves.ts`, `src/sim/core.ts` (`_waves`, `_startWave`, `_skipWave`), `src/types.ts` (`Wave` interface), `src/sim/state.ts`, `src/sim/skills.ts` (new card), `src/sim/enemies.ts` (`spawnChances`), `src/hud/hud.ts` (enemy panel)

## Problem

Today a wave is a **fixed batch**: `_startWave` builds an ordered roster of exactly
`count = min(140, 8 + 5·(n−1))` enemies (`waveCount`) and releases them over the first
25s of the 30s wave (`spawnWindow`). Once the batch is exhausted, no more spawn until the
next wave's clock tick — even if a strong player kills all 140 in the first few seconds.
`WAVE.screenCap` (200) is a concurrent cap that never bites, because `count ≤ 140 < 200`.

Two consequences we want to change:

1. The "screen cap" is not really a cap on *what's alive* — it's a release total. A player
   who clears the wave instantly then sits idle until the next wave starts.
2. Income is bounded only by the batch size (≤140 kills/wave), not by a spawn *rate*. We
   want an explicit per-second throttle so early-wave farming (kill-everything-instantly)
   can't yield unbounded resources.

## Core model change

A wave stops being a fixed batch and becomes a **clock-driven difficulty/composition
window** governed by two independent throttles:

### Concurrent-alive cap `C(n)`

Max enemies alive at once. **Keeps today's early ramp** so early game stays gentle:

```
C(n) = min(140, 8 + 5·(n − 1))    // 8 at wave 1, reaches 140 at wave 28
```

Spawning only occurs while `alive < C(n)`. As enemies die and slots free, top-up refills
toward `C(n)`. Splitter offspring count against `C(n)` (unchanged from today).

This replaces `WAVE.screenCap` (200) — the two are folded into one cap.

### Spawn-rate cap `R(n)`

Max enemies spawned per second, keyed on the **real wave number** `n`:

| Wave range     | R(n)   |
| -------------- | ------ |
| ≤ 100          | 5 / s  |
| 101 – 500      | 6 / s  |
| 501 – 1000     | 7 / s  |
| 1001 – 2000    | 9 / s  |
| 2001 – 5000    | 12 / s |
| 5001 – 10000   | 20 / s |
| > 10000        | 25 / s |

A spawn fires every `1 / R(n)` seconds **if** `alive < C(n)` **and** we are not in the
between-wave lull. If the screen is full, the spawn timer holds (does not accumulate
backlog) and tops up the moment a slot frees. Net effect:

- **One-shotting player:** earns exactly `R(n)` kills/sec — the anti-farm income bound.
- **Overwhelmed player:** screen fills to `C(n)`, spawning self-throttles to the kill rate.

Today's effective rate is `140 / 25 = 5.6/s`, so the ≤100 tier at 5/s is a hair slower —
intentional and negligible.

## Between-wave lull

Each wave still runs on the `WAVE.interval` (30s) clock (modified by the Accelerator card's
`waveAccel`). The **last 5s of each wave is a no-spawn lull** — the screen drains a little,
giving a breather and a visual beat between waves.

### New card: "Overrun" (common)

Reduces the lull, letting pressure stay continuous:

```
lull = max(0.5, 5 − reduction)
reduction curve (by stars): [[1, 0.3], [15, 4.5]]   // linear, 0.3s per star
```

- ★1 → reduction 0.3s → lull 4.7s
- ★15 → reduction 4.5s → lull **0.5s** (floor)

`fmt`: `-Xs lull` style; `stat: 'lullReduce'`, `kind: 'mechanic'`. Slots into the common
group in `CARD_ORDER`.

**Edge case — Accelerator interaction:** the Accelerator card shortens the effective
interval (`effInt = 30 · max(0.1, 1 − waveAccel)`). The lull must be clamped so it never
exceeds the (possibly shortened) interval: `effLull = min(lull, effInt)` — otherwise a
heavily-accelerated wave would be all lull and spawn nothing.

## Composition — per-spawn weighted roll

Each enemy's type is decided **at spawn time** via `this.rng` (deterministic, so offline
catch-up replays identically). No roster to build or refill.

- **Normals : specials = 6 : 1**, preserving today's `normalCap 120 / specialCap 20`
  ratio: ~`1/7` chance the spawn is a special; its type is chosen uniformly among the
  specials unlocked at `(n, tier)` via the existing `allowedSpecials(n, tier)`.
- **Boss waves** (`isBossWave(n)`: every 10th from wave 10): exactly **one boss** per wave,
  tracked by a `bossSpawned` flag on the wave state so top-up cannot duplicate it. Normals
  **and specials** continue to spawn around the boss. (This is a change from today, where
  boss waves suppress specials — accepted.)
- **Splitters** are never rolled directly (unchanged); they appear only via on-death
  splits.

New pure function `rollEnemyType(rng, n, tier, bossPending)` replaces `waveRoster`.

### RNG-draw protocol (determinism)

`rollEnemyType` must consume a **fixed, branch-known** number of `rng.next()` calls so the
spawn stream is identical live vs. catch-up regardless of how many slots fire per tick:

- If `bossPending` (boss not yet spawned this boss wave): **return `boss`, draw zero rng.**
  The boss bypasses the 6:1 roll entirely (see boss-priority rule below).
- Otherwise: **draw exactly one** `rng.next()` for the normal-vs-special decision
  (`< 1/7` → special). If special **and** at least one special is unlocked, **draw exactly
  one more** `rng.next()` to pick the type uniformly among unlocked specials. If special is
  rolled but none are unlocked, fall back to `melee` (the second draw is *not* taken).

The number of draws is fully determined by `(bossPending, the first draw's outcome, whether
specials are unlocked)` — all of which are themselves deterministic — so the stream is
reconstructable. (This replaces `waveRoster`'s variable-length shuffle.)

### Boss-priority rule

On a boss wave, while `bossSpawned === false`, the **next spawn is forced to be the boss**
(call `rollEnemyType` with `bossPending = true`), then set `bossSpawned = true`. This
guarantees the boss appears on the first eligible spawn tick even when a heavy Accelerator
shrinks the active window — it can never be starved out by the 6:1 roll or a short wave.

## State / data changes

- **`waves.ts`:** add `concurrentCap(n)`, `spawnRate(n)`, `lullDuration(stars)`,
  `rollEnemyType(...)`. Remove/retire `waveCount`-as-batch (and its `WAVE.maxCount`,
  `baseCount`, `perWave` if no longer referenced — verify `enemies.ts` callers),
  `waveRoster`, and `WAVE.screenCap`. While in this file, optionally remove the now-unused
  `econStr` (vestigial since the XP subsystem was deleted in 99d9648) — adjacent cleanup, not
  load-bearing for this change.
- **`types.ts` `Wave` interface (lines 145–154):** this is the source of truth for the wave
  shape — `state.ts:37` only constructs the literal. **Both must change together** or the
  build won't compile. Remove `toSpawn`, `releaseTimer`, `releaseGap`, `count`, `queue`; add
  `spawnTimer: number` (counts down to next spawn) and `bossSpawned: boolean` (reset each
  wave). Then update the `state.ts` literal to match. Old saves carrying the removed fields
  are harmless (ignored on load).
- **`core.ts` `_startWave`:** no longer builds a roster; just increments `n`, resets
  `bossSpawned = false`, runs `ageSurvivors`, handles Wave Skip.
- **`core.ts` `_waves`:** drives `spawnTimer` against `R(n)`, gates on `alive < C(n)` and
  the lull window, applies the boss-priority rule, calls `_spawnOne` with a per-spawn rolled
  type.
- **`skills.ts`:** add the `overrun` card spec to `CARD_SPECS` (common rarity) and to
  `CARD_ORDER` (common group — note this grows `CARD_SLOTS = CARD_ORDER.length`, i.e. the
  card grid gains one tile; this is intentional). Add `lullReduce: 'lullReduce'` to
  **`CARD_PASSTHROUGH`** (lines 900–912 — the mechanic-hook map, *not* the base-stat
  `STAT_NAME` map) and `lullReduce: 0` to the `computeStats` defaults block (≈ lines 952–963).
- **`enemies.ts` `spawnChances` (lines 13–30):** **rewrite** to mirror `rollEnemyType`'s flat
  6:1 split and the new boss-wave-includes-specials behavior (it currently replicates the old
  caps/unlock/boss-suppresses-specials roster math and drives the HUD probability column). It
  no longer depends on `waveCount`/`SPAWN.*Cap`. Either re-derive the proportions directly or
  expose a shared helper consumed by both `rollEnemyType` and `spawnChances`.
- **`hud.ts` enemy panel (≈ lines 982–996):** `spawnRate` is computed as
  `waveCount(n) / WAVE.spawnWindow` — re-point it at the new `spawnRate(n)` (R(n)) function.
  The per-type `spawnChances(...)` column updates automatically once `spawnChances` is
  rewritten. Verify the file's imports (`waveCount`, `WAVE`) still resolve after removals.
- **`_skipWave` (core.ts:115–133):** today derives the kill count from `w.toSpawn` (line 119)
  and clears `w.queue` (line 121). With no batch, use a **representative kill count**:
  `kills = round(R(n) · (effInt − effLull))` (spawn rate × active spawning window for the
  wave), then keep the existing `coins`/`gold` spoils formulas using that `kills` value.
  Remove the `w.queue.length = 0` line (the field is gone). Note `_skipWave` runs right after
  `_startWave(w.n+1)`, so `w.n` is already the new wave — use that incremented `w.n` for
  `R(n)` (consistent with the existing `waveStepCoins` computation). `effInt`/`effLull` are
  not stored fields; recompute them locally in `_skipWave` (same expressions as `_waves`).

## Accepted balance consequences (not fixed in this change)

- **Deep-wave income rises** vs today. A capable player at wave 10k can see up to
  `~20/s × ~30s ≈ 600 kills/wave` (~4× today's 140-cap). Early game stays roughly flat
  (5/s ≈ today's 5.6/s).
- As a direct result, **high waves at a low tier can out-earn lower waves at a high tier**,
  since income now tracks wave-driven spawn rate rather than a flat per-wave batch. This is
  accepted as the intended shape; a coin/cash-curve rebalance pass is a candidate follow-up,
  out of scope here.

## Testing

- **Pure-function unit tests:** `concurrentCap(n)` (8 at w1, 140 at w28+, monotone clamp),
  `spawnRate(n)` (each ladder boundary: 100/101, 500/501, 1000/1001, 2000/2001, 5000/5001,
  10000/10001), `lullDuration(stars)` (4.7 at ★1, 0.5 floor at ★15).
- **Composition:** `rollEnemyType` honours the 6:1 ratio over a large deterministic sample;
  only unlocked specials appear; exactly one boss per boss wave; specials present on boss
  waves.
- **Sim integration:** with a kill-everything stub, sustained spawn rate equals `R(n)` and
  never exceeds it; with no kills, `alive` plateaus at `C(n)` and spawning stops; no spawns
  during the lull window; Accelerator + Overrun extremes clamp correctly.
- **Determinism / offline:** same seed + inputs → identical spawn stream live vs catch-up.
