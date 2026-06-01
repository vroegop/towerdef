/* dev/runner.ts — headless scenario runner for the balance dashboard.
   THROWAWAY dev tooling. Imports the REAL sim modules, so it always reflects current balance
   (including any in-memory rebalance the dashboard applied to the registry objects). It runs the
   deterministic sim with a fixed build (no in-run buying) until the hero dies or a safety cap. */
import type { Meta, State } from '../src/types';
import { Sim } from '../src/sim/core';
import { createState } from '../src/sim/state';
import { DT } from '../src/sim/offline';
import { migrateMeta } from '../src/sim/labs';
import { coinsForRun, coinMult, tierDifficulty, waveStr, waveSpeed } from '../src/sim/waves';
import { TYPES } from '../src/sim/registries';

export interface Scenario {
  perm: Record<string, number>; // upgrade id -> level
  cards: Record<string, number>; // card id -> stars
  labs: Record<string, number>; // lab id -> level
  tier: number;
  seeds: number[];
  maxWave: number; // the ONLY cap: stop if the run reaches this wave still alive
  maxTicks?: number; // optional extra tick guard (unset = no tick cap; the dashboard leaves it unset)
}

export interface RunResult {
  wave: number; // furthest wave reached
  kills: number;
  gold: number; // gold earned over the run
  coins: number; // coins that would be banked (coinsForRun)
  hits: number; // damaging hits taken
  ticks: number; // sim ticks elapsed
  simSeconds: number;
  survived: boolean; // true if it hit the safety cap without dying
}

function buildMeta(sc: Scenario): Meta {
  return migrateMeta({
    coins: 0,
    perm: { ...sc.perm },
    hasPlayed: true,
    bestWave: 999999, // unlock everything; lab levels apply via meta.labs regardless
    claimedMilestones: {},
    tier: sc.tier,
    tierBest: {},
    gems: 0,
    cards: Object.entries(sc.cards)
      .filter(([, s]) => s > 0)
      .map(([id, stars]) => ({ id, stars })),
    cardBuys: 0,
    totalWaves: 0,
    labs: { ...sc.labs },
    research: [],
    labSlots: 1,
    vials: 0,
    unlocked: {}, // headless recalc applies perm levels directly, so the unlock gate is bypassed
    cardSlots: 1,
    activeCards: [],
    lastCheckIn: 0,
    ver: 0,
  } as Meta);
}

// A resumable single-run stepper. The dashboard advances it in small time-sliced chunks and yields
// to the browser between chunks, so the wave count climbs on screen instead of freezing. Headless
// callers just loop advance() until done. The ONLY stop conditions are death and the wave cap (plus
// an optional maxTicks guard, which the dashboard leaves unset).
export class RunStepper {
  private sim: Sim;
  private t = 0;
  constructor(
    private sc: Scenario,
    readonly seed: number,
  ) {
    this.sim = new Sim(createState(seed >>> 0, buildMeta(sc), false));
    this.sim.refreshStats(); // fixed build → stats are invariant across the run (compute once)
  }
  get wave(): number {
    return this.sim.s.wave.maxWave;
  }
  get done(): boolean {
    const s = this.sim.s;
    return !s.alive || s.wave.n >= this.sc.maxWave || (this.sc.maxTicks != null && this.t >= this.sc.maxTicks);
  }
  // Advance up to `budget` ticks; stops early when the run finishes. Returns true while not done.
  advance(budget: number): boolean {
    for (let n = 0; n < budget && !this.done; n++) {
      this.sim.step(DT);
      this.t++;
    }
    return !this.done;
  }
  result(): RunResult {
    const s: State = this.sim.s;
    return {
      wave: s.wave.maxWave,
      kills: s.econ.kills,
      gold: Math.round(s.econ.goldEarned),
      coins: coinsForRun(s, this.sc.tier),
      hits: s.econ.hitsTaken,
      ticks: this.t,
      simSeconds: Math.round(this.t * DT),
      survived: s.alive, // true ⇒ hit the wave cap (or tick guard) without dying
    };
  }
}

export function runOne(sc: Scenario, seed: number): RunResult {
  const r = new RunStepper(sc, seed);
  while (r.advance(100000));
  return r.result();
}

export interface ScenarioResult {
  avg: RunResult;
  runs: RunResult[];
}

export function runScenario(sc: Scenario): ScenarioResult {
  const runs = (sc.seeds.length ? sc.seeds : [1]).map((seed) => runOne(sc, seed));
  const n = runs.length;
  const mean = (k: keyof RunResult): number => Math.round(runs.reduce((a, r) => a + (r[k] as number), 0) / n);
  const avg: RunResult = {
    wave: mean('wave'),
    kills: mean('kills'),
    gold: mean('gold'),
    coins: mean('coins'),
    hits: mean('hits'),
    ticks: mean('ticks'),
    simSeconds: mean('simSeconds'),
    survived: runs.some((r) => r.survived),
  };
  return { avg, runs };
}

export interface EnemyRow {
  type: string;
  hp: number;
  dmg: number;
  speed: number;
  mass: number;
}
// Reference HP/dmg/speed/mass for each enemy type at a given REAL wave (and game-tier difficulty).
// Mirrors enemies.makeEnemy's math (base × waveStr, rounded, min 1). Enemies have one mode now.
export function enemyTableAtWave(realWave: number, tier: number): EnemyRow[] {
  const eff = Math.max(1, realWave) * tierDifficulty(tier);
  const str = waveStr(eff),
    spd = waveSpeed(eff);
  const rows: EnemyRow[] = [];
  for (const type of Object.keys(TYPES)) {
    const def = TYPES[type];
    rows.push({
      type,
      hp: Math.max(1, Math.round(def.hp * str)),
      dmg: Math.max(1, Math.round(def.dmg * str)),
      speed: Math.round(def.speed * spd),
      mass: def.mass,
    });
  }
  return rows;
}

export const tierCoinMult = coinMult;
