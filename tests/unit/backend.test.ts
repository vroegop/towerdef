/* tests/unit/backend.test.ts — the fake backend + sync policy. These exercise the online-only paths
   (persistence round-trips, client-wins restore, tournament leaderboards with fake players) entirely
   in Node, so the same behaviour can be relied on before any real server exists. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockBackend, setBackend, type Backend, type SaveBundle } from '../../src/backend/index';
import { hydrateDevice, resetSync, type StorageKeys } from '../../src/backend/sync';

// Minimal in-memory localStorage: the unit env is plain Node, but the mock backend + sync layer both
// persist through the Web Storage API.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const KEYS: StorageKeys = { meta: 'arena.meta', settings: 'arena.settings', save: 'arena.save', device: 'arena.deviceId' };

function bundle(coins: number): SaveBundle {
  return { meta: { coins } as SaveBundle['meta'], settings: null, save: null, rev: 0, updatedAt: Date.now() };
}

let backend: Backend;

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  backend = new MockBackend(0); // zero latency for tests
  setBackend(backend);
  resetSync();
});

afterEach(() => {
  setBackend(null);
  resetSync();
});

describe('MockBackend persistence', () => {
  it('round-trips a bundle and bumps the server rev', async () => {
    const session = await backend.authenticate('dev-1');
    expect(await backend.pull(session)).toBeNull(); // nothing stored yet

    const first = await backend.push(session, bundle(100));
    expect(first.rev).toBe(1);
    const second = await backend.push(session, bundle(250));
    expect(second.rev).toBe(2);

    const got = await backend.pull(session);
    expect(got?.meta?.coins).toBe(250);
    expect(got?.rev).toBe(2);
  });

  it('keeps each player bundle separate', async () => {
    const a = await backend.authenticate('dev-a');
    const b = await backend.authenticate('dev-b');
    await backend.push(a, bundle(10));
    await backend.push(b, bundle(20));
    expect((await backend.pull(a))?.meta?.coins).toBe(10);
    expect((await backend.pull(b))?.meta?.coins).toBe(20);
  });
});

describe('MockBackend tournaments', () => {
  it('seeds a tournament with a populated, descending leaderboard', async () => {
    const tournaments = await backend.listTournaments();
    expect(tournaments.length).toBeGreaterThan(0);
    const board = await backend.getLeaderboard(tournaments[0].id);
    expect(board.length).toBeGreaterThan(0);
    for (let i = 1; i < board.length; i++) expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
    expect(board[0].rank).toBe(1);
  });

  it('slots a submitted score into the ranking and keeps the player best', async () => {
    const session = await backend.authenticate('me');
    const id = (await backend.listTournaments())[0].id;

    let board = await backend.submitScore(session, id, 999);
    expect(board[0].playerId).toBe('me'); // a huge score takes first
    expect(board[0].name).toBe('You');

    board = await backend.submitScore(session, id, 5); // a worse score must not lower the best
    const mine = board.find((e) => e.playerId === 'me');
    expect(mine?.score).toBe(999);
  });
});

describe('sync policy (client-wins)', () => {
  it('does not pull when the device already has local progression', async () => {
    localStorage.setItem(KEYS.meta, JSON.stringify({ coins: 7 }));
    const session = await backend.authenticate('keepme');
    localStorage.setItem(KEYS.device, 'keepme');
    await backend.push(session, bundle(9999)); // server has richer data...

    const changed = await hydrateDevice(KEYS);
    expect(changed).toBe(false); // ...but local wins and is left untouched
    expect(JSON.parse(localStorage.getItem(KEYS.meta) as string).coins).toBe(7);
  });

  it('restores from the backend on a fresh device (reinstall / re-auth)', async () => {
    // Seed the server for a known device id, then simulate a fresh install that still authenticates as it.
    const session = await backend.authenticate('returning-device');
    await backend.push(session, bundle(4242));
    localStorage.setItem(KEYS.device, 'returning-device'); // no meta/settings/save → fresh local
    resetSync();

    const changed = await hydrateDevice(KEYS);
    expect(changed).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEYS.meta) as string).coins).toBe(4242);
  });
});
