# AGENTS.md — Cardio Agent Context

**Cardio** is a real-time multiplayer card game platform. Six games share one monorepo: a Vite+React frontend and a standalone Express+WebSocket backend. Runtime state is authoritative in memory and persisted to local SQLite snapshots/event log for crash recovery.

For deeper context, see [`docs/agent/`](./docs/agent/).

---

## Tech Stack

| Layer    | Technology                                       |
| -------- | ------------------------------------------------ |
| Frontend | React 19, TypeScript, TailwindCSS v4, Vite       |
| Backend  | Express 5, `ws` WebSocket library, `tsx` runtime |
| Testing  | Vitest                                           |

## NPM Scripts

```
npm run dev        # Vite (:5173) + tsx server (:3001) concurrently
npm run build      # tsc -b && vite build
npm run start      # build + run server (production)
npm run kill-ports # kill :3001 and :5173
npm test           # vitest run (single pass)
npm run test:watch # vitest watch
```

---

## Directory Layout

```
cardio/
├── server/
│   ├── index.ts                    # WS server, session manager, message router
│   └── games/
│       ├── literature.ts / .test.ts
│       ├── coup.ts
│       ├── secretHitler.ts
│       ├── hanabi.ts
│       ├── love_letter.ts
│       └── spades.ts
├── src/
│   ├── App.tsx                     # Phase-based game router
│   ├── main.tsx                    # React entry — wraps App in GameProvider
│   ├── index.css                   # Global styles, TailwindCSS import
│   ├── shared/types.ts             # GameType, Player, Move, BaseGameState
│   ├── constants/rules.ts          # Human-readable rules for all games
│   ├── context/GameContext.tsx     # WS client, state, reconnection logic
│   ├── components/
│   │   ├── LandingPage.tsx
│   │   ├── Lobby.tsx
│   │   ├── Instructions.tsx
│   │   └── RulesButton.tsx
│   └── games/
│       ├── literature/  types.ts · logic.ts · logic.test.ts · Board.tsx
│       ├── coup/        types.ts · logic.ts · Board.tsx
│       ├── secretHitler/ types.ts · logic.ts · Board.tsx
│       ├── hanabi/      types.ts · logic.ts · Board.tsx
│       ├── love_letter/ types.ts · logic.ts · Board.tsx
│       └── spades/      types.ts · logic.ts · Board.tsx
├── docs/agent/                     # Machine-oriented docs (architecture, per-game)
├── scripts/kill-ports.sh
├── public/
└── [tsconfig|vite|eslint config files]
```

---

## Core Architecture Patterns

### Server Authority

- **All game state mutations happen server-side.** The client never mutates state.
- Client sends action → server validates → mutates → broadcasts sanitized state to all clients.
- `src/games/*/logic.ts` files are shared client+server. They must be isomorphic (no browser/Node APIs).
- Server imports them via relative `.js` paths: `../../src/games/literature/logic.js` (ESM convention, not a bug).

### WebSocket Protocol

All messages are JSON. See [`docs/agent/architecture.md`](./docs/agent/architecture.md) for the full message table.

**Client → Server:** `CREATE_SESSION`, `JOIN_SESSION`, `JOIN_LOBBY`, `START_GAME`, `ASK_CARD`, `CLAIM_BOOK`, `COUP_ACTION`, `SECRET_HITLER_ACTION`, `GAME_ACTION`  
**Server → Client:** `SESSION_CREATED`, `SESSION_JOINED`, `STATE_UPDATE`, `ERROR`

### Session Lifecycle

1. `CREATE_SESSION {gameType}` → server creates session, responds with 4-char hex `sessionId`.
2. Others `JOIN_SESSION {sessionId}` → server adds them to session.
3. All players send `JOIN_LOBBY {player}` → state broadcast.
4. Host sends `START_GAME` → game handler deals/initializes. Initial host is first joiner; host migrates to another connected player if the current host leaves.
5. On disconnect, server marks player `isConnected: false` and schedules cleanup (2 min if no clients remain).

### Adding a New Game

See [`docs/agent/architecture.md#adding-a-game`](./docs/agent/architecture.md#adding-a-game) for the checklist.

### State Sanitization

`sanitizeStateForPlayer()` in `server/index.ts` strips private information before broadcast (hands, roles, etc.). Each game has its own sanitization branch. When adding game-specific private state, add a branch there.

### No Turn Enforcement by Default

The server does NOT globally enforce turn order — each game handler is responsible. Literature enforces it. Some newer handlers may not.

---

## Game Modules (quick reference)

| Game          | Status                        | Players | Key mechanic                     |
| ------------- | ----------------------------- | ------- | -------------------------------- |
| Literature    | ✅ Fully implemented + tested | 6 or 8  | Team-based half-suit claiming    |
| Coup          | ✅ Fully implemented          | 2–6     | Bluffing, challenges, blocking   |
| Secret Hitler | ✅ Fully implemented          | 5–10    | Hidden roles, legislative rounds |
| Hanabi        | ✅ Fully implemented          | 2–5     | Cooperative, hidden-hand hints   |
| Love Letter   | ✅ Fully implemented          | 2–4     | Single-card elimination rounds   |
| Spades        | ✅ Fully implemented          | 4       | Trick-taking, bidding            |

Per-game detail in [`docs/agent/games/`](./docs/agent/games/).

---

## Coding Conventions

- **Immutability**: State mutations must return new objects. Spread operators, not direct mutation.
- **Types**: Game-specific types extend `BaseGameState`. Don't add game-specific fields to `src/shared/types.ts`.
- **Error returns**: Handler functions return `{ state }` on success, `{ error: string }` on failure.
- **Handler signature**: `handleAction(state, data, broadcastState?, dispatch?)` — `broadcastState` is passed for games that need async/deferred broadcasts (Hanabi, Love Letter, Spades). `dispatch` is passed for timer-based actions (like Coup) to maintain pure immutability while allowing timeouts to dispatch events.
- **Tests**: Logic-layer functions are pure and ideal for unit tests. Run `npm test` after any logic change. Coup and Secret Hitler now have full testing and complete immutability.

---

## Deployment

- Deployed to **Render** at `https://cardio-5uu3.onrender.com`.
- GitHub Actions workflow (`.github/workflows/keep_alive.yml`) pings `/ping` every 14 min to prevent Render cold starts.
- Production: `npm run start` (builds then runs server). Server serves the `dist/` SPA and handles WS upgrades at `/ws`.
