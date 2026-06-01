/* dev/verify-labs.ts — throwaway verification that the Damage/Health lab VALUE, COIN cost and
   research TIME at sample levels match the preserved reference tables, and that the scale/cap hooks
   wire to the right keys. Run: PATH=... npx tsx dev/verify-labs.ts */
import { LAB_BY_ID, labScaleMults, labCapBonus } from '../src/sim/labs';
import type { Meta } from '../src/types';

let fails = 0;
function eq(name: string, got: number, want: number, tol = 0.5): void {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  got=' + got + '  want=' + want);
}

const dmg = LAB_BY_ID.dmgLab,
  hp = LAB_BY_ID.hpLab;

// ---- value multipliers (Damage 1+0.02·lvl, Health 1+0.03·lvl) ----
const val = (per: number, lvl: number): number => 1 + per * lvl;
eq('Damage value L1', val(dmg.per, 1), 1.02, 1e-9);
eq('Damage value L50', val(dmg.per, 50), 2.0, 1e-9);
eq('Damage value L100', val(dmg.per, 100), 3.0, 1e-9);
eq('Health value L1', val(hp.per, 1), 1.03, 1e-9);
eq('Health value L50', val(hp.per, 50), 2.5, 1e-9);
eq('Health value L100', val(hp.per, 100), 4.0, 1e-9);

// ---- coin cost (shared table). at(L-1) = cost to reach level L. ----
eq('Coin cost L1', dmg.coin.at(0), 30);
eq('Coin cost L2', dmg.coin.at(1), 71);
eq('Coin cost L7', dmg.coin.at(6), 2120);
eq('Coin cost L50', dmg.coin.at(49), 623890);
eq('Coin cost L100', dmg.coin.at(99), 4310000);
eq('Health shares cost L50', hp.coin.at(49), 623890);

// ---- research time in seconds (shared table). L1 instant. ----
eq('Time L1 (instant)', dmg.time.at(0), 0);
eq('Time L2 (6m)', dmg.time.at(1), 6 * 60);
eq('Time L20 (1d 0h 22m)', dmg.time.at(19), 86400 + 22 * 60);
eq('Time L50 (9d 9h 31m)', dmg.time.at(49), 9 * 86400 + 9 * 3600 + 31 * 60);
eq('Time L100 (50d 5h 52m)', dmg.time.at(99), 50 * 86400 + 5 * 3600 + 52 * 60);

// ---- hooks wire to the right sim-stat / upgrade keys ----
const meta = { labs: { dmgLab: 50, hpLab: 100 } } as unknown as Meta;
const sm = labScaleMults(meta);
eq('scale rangedDamage @50', sm.rangedDamage, 2.0, 1e-9);
eq('scale maxHp @100', sm.maxHp, 4.0, 1e-9);
eq('cap rangedDamage @50', labCapBonus(meta, 'rangedDamage'), 60 * 50);
eq('cap health @100', labCapBonus(meta, 'health'), 90 * 100);

console.log(fails === 0 ? '\nALL LAB CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
if (fails) process.exit(1);
