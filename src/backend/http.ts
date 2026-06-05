/* src/backend/http.ts — the real-server adapter. It is the drop-in that replaces MockBackend the day a
   Node service exists: same Backend contract, talking REST over fetch. It is selected automatically
   when VITE_BACKEND_URL is set. The endpoint map below is the spec the Node server must implement —
   see src/backend/README.md.

   Auth note: `authenticate` posts the device id and gets a token back; every other call carries it as
   a Bearer header. When OAuth lands, only `authenticate` (and how the token is obtained) changes. */
import type { Backend, LeaderboardEntry, SaveBundle, Session, Tournament } from './types';

export class HttpBackend implements Backend {
  readonly kind = 'http' as const;
  private readonly base: string;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  private async req<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(this.base + path, { ...init, headers: { ...headers, ...init?.headers } });
    if (!res.ok) throw new Error(`backend ${path} -> ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }

  authenticate(deviceId: string): Promise<Session> {
    return this.req<Session>('/auth', { method: 'POST', body: JSON.stringify({ deviceId }) });
  }

  pull(session: Session): Promise<SaveBundle | null> {
    return this.req<SaveBundle | null>('/save', undefined, session.token);
  }

  push(session: Session, bundle: SaveBundle): Promise<{ rev: number }> {
    return this.req<{ rev: number }>('/save', { method: 'PUT', body: JSON.stringify(bundle) }, session.token);
  }

  listTournaments(): Promise<Tournament[]> {
    return this.req<Tournament[]>('/tournaments');
  }

  getLeaderboard(tournamentId: string): Promise<LeaderboardEntry[]> {
    return this.req<LeaderboardEntry[]>(`/tournaments/${encodeURIComponent(tournamentId)}/leaderboard`);
  }

  submitScore(session: Session, tournamentId: string, score: number): Promise<LeaderboardEntry[]> {
    return this.req<LeaderboardEntry[]>(
      `/tournaments/${encodeURIComponent(tournamentId)}/scores`,
      { method: 'POST', body: JSON.stringify({ score }) },
      session.token,
    );
  }
}
