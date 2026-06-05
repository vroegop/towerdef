/* src/backend/types.ts — the backend contract. This is the seam that lets the game treat "the
   server" as a black box: today it's faked entirely in the browser (MockBackend, localStorage),
   tomorrow it's a real Node service (HttpBackend, fetch) selected purely by VITE_BACKEND_URL. The
   interface is deliberately async — even the mock returns Promises — so call sites are already shaped
   for the network and the migration is a one-line swap with no caller changes.

   Nothing here is part of the deterministic sim: the backend is wall-clock/lifecycle plumbing that
   lives strictly outside step() (same rule as lab timers and the check-in clock). */
import type { Meta, Settings, State } from '../types';

/** A persisted in-progress run, mirroring the shape main.ts writes under `arena.save`. */
export interface SaveSnapshot {
  savedAt: number;
  state: State;
}

/** Everything one player owns server-side: their progression, settings, and any mid-run save. The
    three may be independently null (e.g. a fresh account, or a player with no active run). `rev` is a
    monotonic version the server stamps on every push so a real backend can detect conflicts later. */
export interface SaveBundle {
  meta: Meta | null;
  settings: Settings | null;
  save: SaveSnapshot | null;
  rev: number;
  updatedAt: number;
}

/** Result of authenticating a device. `playerId` is anonymous today (a device UUID); when OAuth lands
    it becomes the real account id and `token` becomes a bearer credential — the shape stays the same. */
export interface Session {
  playerId: string;
  token: string;
}

/** A fake player the mock seeds so tournament/leaderboard features have opponents to render offline. */
export interface PlayerProfile {
  id: string;
  name: string;
}

export interface Tournament {
  id: string;
  name: string;
  metric: string; // e.g. 'bestWave' — what the score column measures
  endsAt: number; // wall-clock ms
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  score: number;
}

/** The full server surface. Persistence is the load-bearing part used at boot; the tournament methods
    exist so online-only features (leaderboards, "fake players") can be built and tested against the
    mock before any real server exists. A real HttpBackend implements the identical contract. */
export interface Backend {
  /** Which implementation is live — handy for dev tooling / diagnostics. */
  readonly kind: 'mock' | 'http';

  // --- identity + persistence ---
  authenticate(deviceId: string): Promise<Session>;
  /** The player's last server-side bundle, or null if the account has never synced. */
  pull(session: Session): Promise<SaveBundle | null>;
  /** Back up the bundle; returns the new server `rev`. */
  push(session: Session, bundle: SaveBundle): Promise<{ rev: number }>;

  // --- online-only features (tournaments / leaderboards) ---
  listTournaments(): Promise<Tournament[]>;
  getLeaderboard(tournamentId: string): Promise<LeaderboardEntry[]>;
  /** Submit the session player's score; returns the updated leaderboard. */
  submitScore(session: Session, tournamentId: string, score: number): Promise<LeaderboardEntry[]>;
}
