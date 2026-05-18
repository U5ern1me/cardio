# Architecture Reference

Deep-dive on the server internals, WebSocket protocol, and shared systems. Read AGENTS.md first for orientation.

---

## Server Architecture (Phase 3)

Core runtime remains in `server/index.ts`, but responsibilities are now split into explicit modules:

- `server/protocol/schemas.ts` — strict runtime schemas for all client/server wire messages
- `server/protocol/respond.ts` — protocol envelope emission (`ACK`, `REJECT`, legacy `ERROR`)
- `server/state/gameState.ts` — game-state initialization + privacy sanitization
- `server/games/dispatcher.ts` — game handler dispatch boundary
- `server/sessionOrchestrator.ts` — lifecycle timers (disconnect grace, inactivity, cleanup)
- `server/db.ts` + `server/persistence/*` — append-only persistence, replay/recovery, migration tooling
- `server/infra/logger.ts` + `server/infra/metrics.ts` — structured logs + in-memory metrics snapshot

## Server: `server/index.ts`

### Session Object

```typescript
interface Session {
  clients: Map<WebSocket, string>; // ws → playerId
  state: GameState; // authoritative state (any shape)
  gameType: GameType;
  hostPlayerId: string | null;
  stateVersion: number;
  lifecycleState: "LOBBY" | "ACTIVE" | "COMPLETED" | "IDLE_EMPTY" | "ENDED";
  inviteToken: string;
  pendingSeatTransfers: Map<string, SeatTransferRequest>;
  validReconnectVersions: Record<string, number>;
  connectionEpochByPlayer: Record<string, number>;
}
```

Sessions live in `const sessions: Record<string, Session>`.  
Session IDs: 4-char uppercase hex, collision-resistant.  
Player IDs: server-authoritative random hex IDs generated only on `JOIN_LOBBY`.

### MAX_PLAYERS per game

```
LITERATURE: 8 | COUP: 6 | SECRET_HITLER: 10 | HANABI: 5 | LOVE_LETTER: 4 | SPADES: 4
```

### Heartbeat (WebSocket keep-alive)

- Server sends `ws.ping()` every 15 s.
- Clients must respond with pong within 10 s or are terminated.
- Tracked via `wsAliveMap: WeakMap<WebSocket, boolean>`.

### Reconnection Flow

1. `JOIN_SESSION` requires either an invite token (new join) or reconnect token (seat reclaim).
2. Reconnect uses signed token claims `{sid, pid, reconnectVersion}` with monotonic rotation.
3. Disconnects are finalized via orchestrator grace window to absorb brief network flaps.
4. Cleanup/inactivity/disconnect all run via one `SessionOrchestrator` timer service.
5. State updates include `stateVersion`; mutating actions can provide `expectedStateVersion` for stale-write rejection.

---

## WebSocket Message Protocol

### Client → Server

| Type                   | Payload                                   | Notes                                                                      |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `CREATE_SESSION`       | `{protocolVersion?, requestId?, gameType, messageId?}`                  | Server responds with `SESSION_CREATED` (includes invite + one-time session token) |
| `JOIN_SESSION`         | `{protocolVersion?, requestId?, sessionId, inviteToken? or reconnectToken?, joinAs?, messageId?}` | Invite-only join authorization and reconnect resume                         |
| `JOIN_LOBBY`           | `{protocolVersion?, requestId?, sessionToken, player: {name, team?, seatIndex?}, messageId}` | Claims a lobby seat with server-issued one-time token                      |
| `START_GAME`           | `{}`                                      | Host only; delegates to game handler                                       |
| `ASK_CARD`             | `{askerId, targetId, card}`               | Literature only (server trusts socket-bound actor identity, not askerId)   |
| `CLAIM_BOOK`           | `{claimerId, halfSuit}`                   | Literature only (server trusts socket-bound actor identity, not claimerId) |
| `COUP_ACTION`          | varies                                    | Coup-specific                                                              |
| `SECRET_HITLER_ACTION` | varies                                    | Secret Hitler-specific                                                     |
| `GAME_ACTION`          | `{actorId, ...}`                          | Generic action for all games                                               |
| `REQUEST_SEAT_TRANSFER`| `{protocolVersion?, requestId?, displayName?, messageId}`              | Spectator requests host-approved disconnected-seat takeover token           |
| `HOST_ACTION.REASSIGN_SEAT` | `{targetId, transferToken}`         | Host-only deterministic ownership transfer                                 |

### Server → Client

| Type              | Payload                                                      |
| ----------------- | ------------------------------------------------------------ |
| `SESSION_CREATED` | `{sessionId, gameType, inviteToken, sessionToken}`           |
| `SESSION_JOINED`  | `{sessionId, gameType, resumed, role, stateVersion, lifecycleState, sessionToken?/reconnectToken?}` |
| `STATE_UPDATE`    | `{state (sanitized + hostPlayerId), yourPlayerId, gameType, stateVersion, lifecycleState, reconnectToken?, capabilities}` |
| `ACK`             | `{requestId, ackType, messageType, stateVersion?}`           |
| `REJECT`          | `{requestId, code, message, retryable}`                      |
| `SEAT_TRANSFER_REQUEST` | `{transferToken, requestedBy, requestedAtEpochMs, expiresAtEpochMs}` |
| `SEAT_TRANSFER_GRANTED` | `{sessionId, targetPlayerId, transferToken, reconnectToken}` |
| `ERROR`           | `{message}`                                                  |

`actorId: myPlayerId` is injected by `server/index.ts` before dispatching to every handler.

### Versioning + Compatibility

- Shared contracts live in `src/shared/protocolContracts.ts`
- Current protocol version: `1`
- Supported range is explicitly bounded by `MIN_SUPPORTED_PROTOCOL_VERSION` and `MAX_SUPPORTED_PROTOCOL_VERSION`
- Unsupported versions are rejected with typed `REJECT { code: "UNSUPPORTED_PROTOCOL" }`
- Legacy compatibility is preserved by still emitting `ERROR` alongside typed `REJECT`

---

## State Sanitization

`sanitizeStateForPlayer(state, playerId)` in `server/state/gameState.ts` runs before every `STATE_UPDATE` send.

| Game          | What is hidden                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Literature    | All other players' hands; exposes `cardCounts: Record<string, number>` at top level                                                                                                                                         |
| Coup          | Other players' unrevealed influences shown as `{role: 'HIDDEN', isRevealed: false}`                                                                                                                                         |
| Secret Hitler | Roles/party hidden except for: self always visible; Fascists see each other + Hitler; Hitler sees Fascists; `presidentCards`/`chancellorCards` shown only to active role; `policyPeek` shown only during POLICY_PEEK action |
| Hanabi        | Own hand rank/color hidden from self; hint metadata preserved                                                                                                                                                               |
| Love Letter   | Deck hidden, opponent hands hidden, priest peeks filtered to viewer                                                                                                                                                         |
| Spades        | Deck hidden and all opponent hands hidden                                                                                                                                                                                   |

When adding private state to a game, add a branch in `sanitizeStateForPlayer`.

---

## Game Handler Interface

Every game handler in `server/games/` exports:

```typescript
export function handleAction(
  state: GameState,
  data: ActionData,
  broadcastState?: (sessionId: string) => void, // optional, for async mid-action broadcasts
): { state?: GameState; error?: string };
```

- Return `{ error }` to send an `ERROR` message to the client; state is unchanged.
- Return `{ state }` to persist new state and broadcast to all clients.
- The `broadcastState` callback is only needed for games that broadcast intermediate state mid-action (Coup's challenge/block resolution).
- `data.actorId` is always the playerId of the WS that sent the message (injected by server).

---

## `createEmptyState` Defaults

`server/state/gameState.ts` initializes a blank state for each game type. The base shape for all games:

```typescript
{
  sessionId, gameType, phase: 'LOBBY',
  players: [], activePlayerIndex: 0, lastMove: null, moveLog: []
}
```

Game-specific fields are added on top. If you add new required fields to a game's `GameState`, add defaults here.

---

## Frontend: GameContext

`src/context/GameContext.tsx` — the single WebSocket client for the app.

**Exposed API (via `useGame()`):**

| Property/Method              | Purpose                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| `gameState`                  | Sanitized state from last `STATE_UPDATE`                    |
| `myPlayerId`                 | This client's player ID                                     |
| `cardCounts`                 | Literature card counts (set from `state.cardCounts`)        |
| `connectionStatus`           | `'connected' \| 'disconnected' \| 'reconnecting'`           |
| `createLANSession(gameType)` | Opens WS + sends `CREATE_SESSION`                           |
| `connectToLAN(sessionId)`    | Opens WS + sends `JOIN_SESSION`                             |
| `sendMessage(msg)`           | Send any message; queues if not connected                   |
| `sendAction(action)`         | Wraps action in `{type: 'GAME_ACTION', actorId, ...action}` |
| `clearSession()`             | Clears localStorage + closes WS intentionally               |

`state` and `playerId` are aliases for `gameState` and `myPlayerId` (backward compat).

---

## Frontend: App Routing

`src/App.tsx` phase-based routing:

```
No gameState    → <LandingPage />
phase === LOBBY → <Lobby />
otherwise       → renderBoard() based on gameState.gameType
```

Boards: `LiteratureBoard | CoupBoard | SecretHitlerBoard | HanabiBoard | LoveLetterBoard | SpadesBoard`

---

## Shared Base Types (`src/shared/types.ts`)

```typescript
type GameType =
  | "LITERATURE"
  | "COUP"
  | "SECRET_HITLER"
  | "HANABI"
  | "LOVE_LETTER"
  | "SPADES";

interface Player {
  id;
  name;
  seatIndex;
  isConnected;
  team: "TEAM_A" | "TEAM_B";
}
interface Move {
  type;
  timestamp(ISO);
  playerName;
  details;
  success;
}
interface BaseGameState {
  sessionId;
  gameType;
  phase;
  players;
  activePlayerIndex;
  lastMove;
  moveLog;
  winner?;
}
```

**Rule:** Do not add game-specific fields to `BaseGameState` or `Player`. Extend in each game's own `types.ts`.

---

## Adding a Game

1. **Types** — create `src/games/<name>/types.ts` extending `BaseGameState`.
2. **Logic** — create `src/games/<name>/logic.ts` with pure, isomorphic functions.
3. **Board** — create `src/games/<name>/Board.tsx`.
4. **Server handler** — create `server/games/<name>.ts` exporting `handleAction`.
5. **Wire up server** — in `server/index.ts`:
   - Import handler.
   - Add `GameType` literal to `src/shared/types.ts`.
   - Add `MAX_PLAYERS` entry.
   - Add `createEmptyState` branch.
   - Add sanitization branch in `sanitizeStateForPlayer` (if needed).
   - Add handler dispatch in `START_GAME` and action case blocks.
6. **Wire up client** — in `src/App.tsx` add a `renderBoard()` branch.
7. **Rules** — add an entry to `src/constants/rules.ts`.

---

## Persistence + Migrations

- SQLite remains the persistence engine (single-node, self-hosted optimized)
- Append-only events + snapshots are replayed through `recoverSession()` / `replaySessionFromEvents()`
- Schema migrations are now first-class:
  - `server/persistence/migrations.ts`
  - `server/persistence/migrationDefinitions.ts`
- Migration state is exposed by persistence health diagnostics
- Seat transfers are audit-recorded in `seat_transfer_audit`

## Observability + Operational Interfaces

- Structured JSON logs: `server/infra/logger.ts`
- Metrics abstraction: `server/infra/metrics.ts`
- HTTP operational endpoints:
  - `GET /health` — persistence + orchestrator status snapshot
  - `GET /ready` — readiness gate (`listening && persistence ok && orchestrator running`)
  - `GET /metrics` — protocol range + in-memory metrics counters/histograms

## Testing

Tests live co-located with the modules they test:

- `src/games/*/logic.test.ts` — Pure game logic unit tests (e.g., Literature: 47, Coup: 11, Secret Hitler: 12)
- `server/games/*.test.ts` — Server handler integration tests (e.g., Literature: 12, Secret Hitler: 8)
- `server/index.test.ts` — Server core logic (Sanitization)
- `server/protocol/schemas.test.ts` — Protocol envelope and typed reject schema tests
- `server/persistence/migrations.test.ts` — Migration idempotency and table creation tests
- `server/operational.test.ts` — `/health`, `/ready`, `/metrics` operational endpoint tests
- `server/testUtils/*` — shared websocket harness + chaos helpers used by multiplayer integration tests

There are 140+ tests across the codebase, including multiplayer chaos/recovery integration tests for malformed payloads, reconnect storms, stale token rejection, host migration, snapshot replay recovery, protocol-version rejection, and deterministic seat transfer reclaim.

Target pure functions in `logic.ts` for unit tests. Handler tests should verify validation, happy path, and edge cases (turn enforcement, missing fields, game-over).

```bash
npm test           # single run
npm run test:watch # watch mode
```

---

## Recent Infrastructure Improvements

- **Strict Immutability**: The core game logic (Literature, Coup, Secret Hitler) now strictly enforces immutable state transformations. Functions return entirely new state objects instead of mutating the incoming state, ensuring predictability and simplifying UI re-renders.
- **Unified Logic**: Server-side duplicate code has been heavily refactored. Action resolution logic (like `CLAIM_BOOK` in Literature or `INVESTIGATE` in Secret Hitler) has been centralized in pure, isomorphic functions within `src/games/*/logic.ts` that both the client and server share.
- **Robust Typing**: Type safety has been hardened in the WebSocket handlers (e.g., using `GameStateUnion` instead of `any` in state sanitization).
