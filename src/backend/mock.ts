/* src/backend/mock.ts — a backend that runs entirely in the browser, so the game keeps working as a
   pure static site (GitHub Pages) with no server. It "pretends to be a server": state lives under a
   separate `arena.server.*` localStorage namespace (distinct from the device's own `arena.*` keys, so
   the sync layer can treat it as a remote store), every method is async with a small simulated
   latency, and a roster of fake players + a sample tournament are seeded so online-only features can
   be built and tested offline.

   When a real server arrives this whole file is replaced by HttpBackend — nothing else changes. */
import type {
  Backend,
  LeaderboardEntry,
  PlayerProfile,
  SaveBundle,
  Session,
  Tournament,
} from './types';

const NS = 'arena.server.';
const K_SAVES = NS + 'saves'; // Record<playerId, SaveBundle>
const K_TOURNAMENTS = NS + 'tournaments'; // Tournament[]
const K_SCORES = NS + 'scores'; // Record<tournamentId, LeaderboardEntry[]>
const K_SEEDED = NS + 'seeded';

// A fixed cast of opponents so a leaderboard is never empty in dev. Their scores are seeded once and
// then a real submitScore slots in among them, which is exactly what a tournament UI needs to render.
const FAKE_PLAYERS: PlayerProfile[] = [
  { id: 'npc-aria', name: 'Aria Stormblade' },
  { id: 'npc-borin', name: 'Borin Deepdelver' },
  { id: 'npc-cyra', name: 'Cyra Nightwhisper' },
  { id: 'npc-doran', name: 'Doran Ironfist' },
  { id: 'npc-elowen', name: 'Elowen Swiftarrow' },
  { id: 'npc-fenn', name: 'Fenn the Unbroken' },
  { id: 'npc-gwyn', name: 'Gwyn Emberheart' },
  { id: 'npc-hale', name: 'Hale Frostwarden' },
  { id: 'npc-isolde', name: 'Isolde Moonshadow' },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function rank(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export class MockBackend implements Backend {
  readonly kind = 'mock' as const;

  /** Artificial round-trip delay so async code paths (and loading states) are exercised exactly as
      they will be against a real server. Tests pass 0 to keep them instant. */
  constructor(private readonly latency = 60) {
    this.seed();
  }

  private sleep(): Promise<void> {
    return this.latency > 0 ? new Promise((r) => setTimeout(r, this.latency)) : Promise.resolve();
  }

  private seed(): void {
    if (read<boolean>(K_SEEDED, false)) return;
    const now = Date.now();
    const tournaments: Tournament[] = [
      { id: 'weekly-1', name: 'Weekly Arena', metric: 'bestWave', endsAt: now + 7 * 24 * 3600 * 1000 },
    ];
    const scores: Record<string, LeaderboardEntry[]> = {
      'weekly-1': rank(
        FAKE_PLAYERS.map((p, i) => ({
          rank: 0,
          playerId: p.id,
          name: p.name,
          // a spread of plausible wave counts for the seeded field
          score: 120 - i * 9 + ((i * 37) % 11),
        })),
      ),
    };
    write(K_TOURNAMENTS, tournaments);
    write(K_SCORES, scores);
    write(K_SEEDED, true);
  }

  async authenticate(deviceId: string): Promise<Session> {
    await this.sleep();
    // Anonymous auth: the device id *is* the player id, and the "token" is a trivial echo. OAuth later
    // changes only the internals of this method.
    return { playerId: deviceId, token: 'mock-' + deviceId };
  }

  async pull(session: Session): Promise<SaveBundle | null> {
    await this.sleep();
    const saves = read<Record<string, SaveBundle>>(K_SAVES, {});
    return saves[session.playerId] ?? null;
  }

  async push(session: Session, bundle: SaveBundle): Promise<{ rev: number }> {
    await this.sleep();
    const saves = read<Record<string, SaveBundle>>(K_SAVES, {});
    const prev = saves[session.playerId];
    const rev = (prev?.rev ?? 0) + 1;
    saves[session.playerId] = { ...bundle, rev, updatedAt: Date.now() };
    write(K_SAVES, saves);
    return { rev };
  }

  async listTournaments(): Promise<Tournament[]> {
    await this.sleep();
    return read<Tournament[]>(K_TOURNAMENTS, []);
  }

  async getLeaderboard(tournamentId: string): Promise<LeaderboardEntry[]> {
    await this.sleep();
    const scores = read<Record<string, LeaderboardEntry[]>>(K_SCORES, {});
    return rank(scores[tournamentId] ?? []);
  }

  async submitScore(session: Session, tournamentId: string, score: number): Promise<LeaderboardEntry[]> {
    await this.sleep();
    const scores = read<Record<string, LeaderboardEntry[]>>(K_SCORES, {});
    const board = scores[tournamentId] ?? [];
    const mine = board.find((e) => e.playerId === session.playerId);
    if (mine) {
      mine.score = Math.max(mine.score, score); // tournaments keep a player's best
      mine.name = 'You';
    } else {
      board.push({ rank: 0, playerId: session.playerId, name: 'You', score });
    }
    const ranked = rank(board);
    scores[tournamentId] = ranked;
    write(K_SCORES, scores);
    return ranked;
  }
}
