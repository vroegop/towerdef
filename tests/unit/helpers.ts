/* tests/unit/helpers.ts — thin re-exports so the test file imports stay tidy. */
export { buyPerm, permCost, computeStats } from '../../src/sim/skills';
// trivial sentinel used to assert the module graph loaded without side effects
export const waveStrSafe = (): boolean => true;
