# Backend layer

A thin abstraction that lets the game treat "the server" as a black box. **Today there is no server**:
the game is a static site (GitHub Pages) and everything is faked in the browser. The point of this layer
is that turning the fake into a real Node service is a one-line switch — no game code changes.

```
main.ts ──> backend/sync.ts ──> backend/index.ts ──> MockBackend   (default: in-browser, localStorage)
                                                  └─> HttpBackend   (when VITE_BACKEND_URL is set: fetch → Node)
```

- **`types.ts`** — the `Backend` contract (all async) plus its DTOs (`SaveBundle`, `Session`, `Tournament`, …).
- **`mock.ts`** — `MockBackend`: pretends to be a server using a separate `arena.server.*` localStorage
  namespace, with simulated latency and a seeded roster of fake players + a sample tournament.
- **`http.ts`** — `HttpBackend`: the real adapter, REST over `fetch`. This is the spec the Node server
  must satisfy (endpoint table below).
- **`index.ts`** — `getBackend()` picks the implementation from `VITE_BACKEND_URL`. `setBackend()` is a
  test seam.
- **`sync.ts`** — the device↔backend bridge and the sync policy.

## Sync policy (client-wins)

The device's `localStorage` is the authoritative live state. The backend is a backup + a restore-on-
reinstall source, never an override.

- **`hydrateDevice()`** (called once at boot) pulls the server bundle **only when this device has no
  local progression yet** — a fresh install or a reinstall after re-authentication. If local data
  exists it is never touched; we just warm a session for background backups. This guarantees offline
  gains are never clobbered by stale server data.
- **`schedulePush()`** (called on every save) debounces a backup of the current local state to the
  server. It is fire-and-forget: offline simply means the next save retries.

All of this runs outside the deterministic sim's `step()` (same rule as lab timers / the check-in
clock), so determinism and offline catch-up are unaffected.

## Migrating to a real Node backend

1. Stand up a service implementing the endpoints below.
2. Build with `VITE_BACKEND_URL=https://your-api` — `getBackend()` then returns `HttpBackend`.
3. Done. No call-site changes. Later, swap anonymous device-id auth for OAuth inside `authenticate`
   (client) and the `/auth` handler (server); the rest of the contract is unchanged.

### Endpoint contract (what `HttpBackend` expects)

| Method & path                              | Body                | Returns                | Auth   |
| ------------------------------------------ | ------------------- | ---------------------- | ------ |
| `POST /auth`                               | `{ deviceId }`      | `Session`              | —      |
| `GET  /save`                               | —                   | `SaveBundle \| null`   | Bearer |
| `PUT  /save`                               | `SaveBundle`        | `{ rev }`              | Bearer |
| `GET  /tournaments`                        | —                   | `Tournament[]`         | —      |
| `GET  /tournaments/:id/leaderboard`        | —                   | `LeaderboardEntry[]`   | —      |
| `POST /tournaments/:id/scores`             | `{ score }`         | `LeaderboardEntry[]`   | Bearer |

`Session.token` is sent as `Authorization: Bearer <token>` on authed routes.
