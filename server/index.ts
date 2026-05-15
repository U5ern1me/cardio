import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import * as db from "./db.js";
import * as LiteratureHandler from "./games/literature.js";
import * as CoupHandler from "./games/coup.js";
import * as SecretHitlerHandler from "./games/secretHitler.js";
import * as HanabiHandler from "./games/hanabi.js";
import * as LoveLetterHandler from "./games/love_letter.js";
import * as SpadesHandler from "./games/spades.js";
import { logEvent, classifyError } from "./infra/logger.js";
import { TokenBucket } from "./network/tokenBucket.js";
import {
  parseClientMessage,
  parseServerEvent,
  type ClientMessage,
  type ServerEvent,
} from "./protocol/schemas.js";
import {
  issueInviteToken,
  issueReconnectToken,
  issueSessionToken,
  verifyToken,
  type SessionRole,
} from "./security/tokens.js";
import {
  deriveLifecycleFromState,
  transitionLifecycle,
  type SessionLifecycleState,
} from "./sessionLifecycle.js";
import { SessionOrchestrator } from "./sessionOrchestrator.js";
import type { GameState as LiteratureState } from "../src/games/literature/types.js";
import type { GameState as CoupState } from "../src/games/coup/types.js";
import type { SecretHitlerState } from "../src/games/secretHitler/types.js";
import type { GameState as HanabiState } from "../src/games/hanabi/types.js";
import type { GameState as LoveLetterState } from "../src/games/love_letter/types.js";
import type { GameState as SpadesState } from "../src/games/spades/types.js";
import type { BaseGameState, GameType, Move } from "../src/shared/types.js";
import type { PersistedSessionEnvelope } from "./db.js";

type GameStateUnion =
  | LiteratureState
  | CoupState
  | SecretHitlerState
  | HanabiState
  | LoveLetterState
  | SpadesState
  | BaseGameState;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(
    request.url || "",
    `http://${request.headers.host}`,
  );
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const PORT = process.env.PORT || 3001;

// ─── Constants ───────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 15_000;
const SESSION_CLEANUP_DELAY_MS = 120_000; // 2 minutes after last client leaves
const ORCHESTRATOR_TICK_INTERVAL_MS = 1_000;
const INACTIVITY_TIMEOUT_MS = 60_000;
const DISCONNECT_GRACE_MS = 1_500;
const RATE_LIMIT_BUCKET_CAPACITY = 30;
const RATE_LIMIT_REFILL_PER_SECOND = 20;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const MAX_MOVE_LOG_ENTRIES = 50;
const CLIENT_MESSAGE_TTL_MS = 2 * 60 * 1000;
const PENDING_JOIN_NONCE_TTL_MS = 20 * 60 * 1000;

const MAX_PLAYERS: Record<string, number> = {
  LITERATURE: 8,
  COUP: 6,
  SECRET_HITLER: 10,
  HANABI: 5,
  LOVE_LETTER: 4,
  SPADES: 4,
};

// ─── Types ───────────────────────────────────────────────
interface Session {
  clients: Map<WebSocket, string>; // ws -> playerId
  state: GameStateUnion;
  gameType: GameType;
  hostPlayerId: string | null; // first player to join is host
  lastActionTimestamp: number;
  stateVersion: number;
  lifecycleState: SessionLifecycleState;
  lifecycleUpdatedAt: number;
  lifecycleReason: string;
  inviteToken: string;
  processedMessageIds: Map<string, number>;
  pendingJoinNonces: Map<string, number>;
  validReconnectVersions: Record<string, number>;
  connectionEpochByPlayer: Record<string, number>;
}

// Track which WS is alive for heartbeat
const wsAliveMap = new WeakMap<WebSocket, boolean>();

const sessions: Record<string, Session> = {};

function withDisconnectedPlayers(state: GameStateUnion): GameStateUnion {
  if (!Array.isArray(state.players)) {
    return state;
  }
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      isConnected: false,
    })),
  };
}

function restoreInviteToken(
  sessionId: string,
  persistedInviteToken?: string,
): string {
  if (persistedInviteToken) {
    const tokenResult = verifyToken(persistedInviteToken, "invite");
    if (tokenResult.ok && tokenResult.claims.sid === sessionId) {
      return persistedInviteToken;
    }
  }
  return issueInviteToken(sessionId);
}

function hydrateSessionFromEnvelope(envelope: PersistedSessionEnvelope): Session {
  const state = withDisconnectedPlayers(envelope.state as GameStateUnion);
  return {
    clients: new Map(),
    state,
    gameType: envelope.gameType,
    hostPlayerId: envelope.hostPlayerId,
    lastActionTimestamp: envelope.lastActionTimestamp || Date.now(),
    stateVersion: envelope.stateVersion || 0,
    lifecycleState: "IDLE_EMPTY",
    lifecycleUpdatedAt: Date.now(),
    lifecycleReason: "session-restored",
    inviteToken: restoreInviteToken(envelope.sessionId, envelope.inviteToken),
    processedMessageIds: new Map(),
    pendingJoinNonces: new Map(),
    validReconnectVersions: envelope.validReconnectVersions ?? {},
    connectionEpochByPlayer: envelope.connectionEpochByPlayer ?? {},
  };
}

function restoreSessionsFromPersistence(trigger: string) {
  const report = db.recoverAllSessions();
  for (const sessionId of Object.keys(sessions)) {
    delete sessions[sessionId];
  }
  for (const persistedSession of report.sessions) {
    sessions[persistedSession.sessionId] = hydrateSessionFromEnvelope(
      persistedSession,
    );
    ensureValidHost(sessions[persistedSession.sessionId]);
  }

  logEvent("info", "sessions.recovered", {
    detail: trigger,
    recoveredCount: report.sessions.length,
    corruptedCount: report.corruptedSessionIds.length,
    replayedFromEvents: report.replayedFromEvents,
  });
}

restoreSessionsFromPersistence("startup");

// ─── Helpers ─────────────────────────────────────────────

function sendError(
  ws: WebSocket,
  message: string,
  context: {
    sessionId?: string;
    playerId?: string | null;
    messageType?: string;
    reconnectTraceId?: string;
  } = {},
) {
  logEvent("warn", "ws.error", {
    sessionId: context.sessionId,
    playerId: context.playerId ?? undefined,
    messageType: context.messageType,
    reconnectTraceId: context.reconnectTraceId,
    errorClass: classifyError(message),
    detail: message,
  });
  sendServerEvent(ws, { type: "ERROR", message });
}

function sendServerEvent(
  ws: WebSocket,
  event: ServerEvent,
) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const parsed = parseServerEvent(event);
  if (!parsed.ok) {
    logEvent("error", "ws.invalid_server_event_blocked", {
      errorClass: "SERVER_EVENT_SCHEMA",
      detail: parsed.error,
    });
    return;
  }
  ws.send(JSON.stringify(parsed.data));
}

function buildPersistedEnvelope(
  sessionId: string,
  session: Session,
): PersistedSessionEnvelope {
  return {
    sessionId,
    gameType: session.gameType,
    state: session.state,
    hostPlayerId: session.hostPlayerId,
    stateVersion: session.stateVersion,
    lifecycleState: session.lifecycleState,
    lifecycleUpdatedAt: session.lifecycleUpdatedAt,
    lifecycleReason: session.lifecycleReason,
    lastActionTimestamp: session.lastActionTimestamp,
    validReconnectVersions: session.validReconnectVersions,
    connectionEpochByPlayer: session.connectionEpochByPlayer,
    inviteToken: session.inviteToken,
    persistedAtEpochMs: Date.now(),
  };
}

function persistSessionState(sessionId: string, reason: string) {
  const session = sessions[sessionId];
  if (!session) {
    return;
  }
  const persistenceResult = db.persistSessionSnapshot(
    buildPersistedEnvelope(sessionId, session),
    reason,
  );
  if (!persistenceResult.ok) {
    logEvent("error", "session.persist_failed", {
      sessionId,
      errorClass: "PERSISTENCE_WRITE",
      detail: persistenceResult.error,
    });
  }
}

function capMoveLog(state: GameStateUnion): GameStateUnion {
  if (
    !Array.isArray(state.moveLog) ||
    state.moveLog.length <= MAX_MOVE_LOG_ENTRIES
  ) {
    return state;
  }

  return {
    ...state,
    moveLog: state.moveLog.slice(0, MAX_MOVE_LOG_ENTRIES),
  };
}

function createServerMove(
  details: string,
  playerName: string = "System",
): Move {
  return {
    type: "SYSTEM",
    timestamp: new Date().toISOString(),
    playerName,
    details,
    success: true,
  };
}

function prependServerMove(state: GameStateUnion, move: Move): GameStateUnion {
  return capMoveLog({
    ...state,
    lastMove: move,
    moveLog: [move, ...(state.moveLog ?? [])],
  });
}

function selectNextHostPlayerId(session: Session): string | null {
  const connectedPlayerIds = new Set<string>();
  for (const [client, playerId] of session.clients.entries()) {
    if (client.readyState === WebSocket.OPEN && playerId) {
      connectedPlayerIds.add(playerId);
    }
  }

  for (const player of session.state.players) {
    if (connectedPlayerIds.has(player.id) && player.isConnected !== false) {
      return player.id;
    }
  }

  return session.state.players[0]?.id ?? null;
}

function ensureValidHost(session: Session, previousHostId?: string | null) {
  const hostExists =
    !!session.hostPlayerId &&
    session.state.players.some((p) => p.id === session.hostPlayerId);
  if (hostExists && previousHostId === undefined) {
    return;
  }

  const shouldReassign =
    !hostExists ||
    (previousHostId !== undefined &&
      previousHostId !== null &&
      session.hostPlayerId === previousHostId);
  if (!shouldReassign) {
    return;
  }

  session.hostPlayerId = selectNextHostPlayerId(session);
}

function transitionSessionLifecycle(
  sessionId: string,
  session: Session,
  nextState: SessionLifecycleState,
  reason: string,
) {
  const previousState = session.lifecycleState;
  transitionLifecycle(session, nextState, reason);
  if (previousState !== session.lifecycleState) {
    logEvent("info", "session.lifecycle_transition", {
      sessionId,
      lifecycleState: `${previousState}->${session.lifecycleState}`,
      lifecycleReason: reason,
    });
  }
}

function isMutatingMessageType(type: ClientMessage["type"]): boolean {
  return (
    type === "JOIN_LOBBY" ||
    type === "START_GAME" ||
    type === "ASK_CARD" ||
    type === "CLAIM_BOOK" ||
    type === "COUP_ACTION" ||
    type === "SECRET_HITLER_ACTION" ||
    type === "PLACE_BID" ||
    type === "PLAY_CARD" ||
    type === "DISCARD_CARD" ||
    type === "GIVE_HINT" ||
    type === "MOVE_CARD" ||
    type === "GAME_ACTION" ||
    type === "HOST_ACTION"
  );
}

function pruneSessionCaches(session: Session) {
  const now = Date.now();
  for (const [messageId, timestamp] of session.processedMessageIds.entries()) {
    if (now - timestamp > CLIENT_MESSAGE_TTL_MS) {
      session.processedMessageIds.delete(messageId);
    }
  }
  for (const [nonce, expiresAt] of session.pendingJoinNonces.entries()) {
    if (expiresAt <= now) {
      session.pendingJoinNonces.delete(nonce);
    }
  }
}

function markProcessedMessage(session: Session, messageId: string) {
  pruneSessionCaches(session);
  session.processedMessageIds.set(messageId, Date.now());
}

function hasProcessedMessage(session: Session, messageId: string): boolean {
  pruneSessionCaches(session);
  return session.processedMessageIds.has(messageId);
}

function ensureLifecycleForCurrentState(
  sessionId: string,
  session: Session,
  reason: string,
) {
  if (session.lifecycleState === "ENDED") {
    return;
  }
  const derived = deriveLifecycleFromState(session.state as BaseGameState);
  transitionSessionLifecycle(sessionId, session, derived, reason);
}

function generatePlayerId(): string {
  return crypto.randomBytes(6).toString("hex");
}

function generateSessionId(): string {
  let id: string;
  let attempts = 0;
  do {
    if (attempts++ > 100)
      throw new Error("Could not generate unique session ID");
    id = crypto.randomBytes(2).toString("hex").toUpperCase();
  } while (sessions[id]);
  return id;
}

function broadcastState(sessionId: string) {
  const session = sessions[sessionId];
  if (!session) return;

  pruneSessionCaches(session);
  persistSessionState(sessionId, "broadcast-state");

  for (const [client, playerId] of session.clients.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      sendStateToClient(sessionId, client, playerId || null);
    }
  }
}

function createStateUpdateEvent(
  sessionId: string,
  playerId: string | null,
): ServerEvent | null {
  const session = sessions[sessionId];
  if (!session) {
    return null;
  }
  const sanitized = sanitizeStateForPlayer(session.state, playerId ?? "");
  const role: SessionRole = playerId
    ? session.hostPlayerId === playerId
      ? "HOST"
      : "PLAYER"
    : "SPECTATOR";

  let reconnectToken: string | undefined;
  if (playerId) {
    const reconnectVersion = session.validReconnectVersions[playerId] ?? 1;
    session.validReconnectVersions[playerId] = reconnectVersion;
    reconnectToken = issueReconnectToken(
      sessionId,
      playerId,
      role,
      reconnectVersion,
    );
  }

  return {
    type: "STATE_UPDATE",
    state: { ...sanitized, hostPlayerId: session.hostPlayerId },
    yourPlayerId: playerId,
    gameType: session.gameType,
    stateVersion: session.stateVersion,
    lifecycleState: session.lifecycleState,
    reconnectToken,
    inviteToken: role === "HOST" ? session.inviteToken : undefined,
    capabilities: {
      canPlay: role === "HOST" || role === "PLAYER",
      canHostActions: role === "HOST",
    },
  };
}

function sendStateToClient(
  sessionId: string,
  ws: WebSocket,
  playerId: string | null,
) {
  const event = createStateUpdateEvent(sessionId, playerId);
  if (!event) {
    return;
  }
  sendServerEvent(ws, event);
}

/** Mark a player as connected/disconnected in game state */
function setPlayerConnected(
  session: Session,
  playerId: string,
  connected: boolean,
): boolean {
  let changed = false;
  session.state = {
    ...session.state,
    players: session.state.players.map((p: any) =>
      p.id === playerId
        ? (() => {
            if (p.isConnected !== connected) {
              changed = true;
            }
            return { ...p, isConnected: connected };
          })()
        : p,
    ),
  };
  return changed;
}

/** Check if any WS in the session is bound to this playerId and is still OPEN */
function isPlayerConnectedViaAnotherSocket(
  session: Session,
  playerId: string,
  excludeWs: WebSocket,
): boolean {
  for (const [ws, pid] of session.clients.entries()) {
    if (
      pid === playerId &&
      ws !== excludeWs &&
      ws.readyState === WebSocket.OPEN
    ) {
      return true;
    }
  }
  return false;
}

/** Clean up dead/stale WebSocket entries from session clients */
function pruneDeadClients(session: Session) {
  const toDelete: WebSocket[] = [];
  for (const [ws] of session.clients.entries()) {
    if (
      ws.readyState !== WebSocket.OPEN &&
      ws.readyState !== WebSocket.CONNECTING
    ) {
      toDelete.push(ws);
    }
  }
  for (const ws of toDelete) {
    session.clients.delete(ws);
  }
}

function sanitizeStateForPlayer(
  state: GameStateUnion,
  playerId: string,
): GameStateUnion {
  if (state.gameType === "LITERATURE") {
    const cardCounts: Record<string, number> = {};
    for (const [id, hand] of Object.entries(state.hands || {})) {
      cardCounts[id] = (hand as any[]).length;
    }
    const { deck, ...rest } = state;
    return {
      ...rest,
      hands: { [playerId]: state.hands[playerId] || [] },
      cardCounts,
      playerCardCounts: cardCounts,
    } as any;
  }

  if (state.gameType === "COUP") {
    const players = state.players.map((p: any) => ({
      ...p,
      influences:
        !p.influences || p.id === playerId
          ? p.influences
          : p.influences.map((i: any) =>
              i.isRevealed ? i : { role: "HIDDEN", isRevealed: false },
            ),
    }));
    return { ...state, players };
  }

  if (state.gameType === "SECRET_HITLER") {
    const me = state.players.find((p: any) => p.id === playerId);
    const visiblePlayers = state.players.map((p: any) => ({
      ...p,
      role: p.id === playerId ? p.role : undefined,
      partyMembership: p.id === playerId ? p.partyMembership : undefined,
    }));

    const fascists = state.players.filter((p: any) => p.role === "FASCIST");
    const hitler = state.players.find((p: any) => p.role === "HITLER");
    if (me?.role === "FASCIST") {
      for (const other of fascists) {
        const target = visiblePlayers.find((p: any) => p.id === other.id);
        if (target) target.role = other.role;
      }
      if (hitler) {
        const target = visiblePlayers.find((p: any) => p.id === hitler.id);
        if (target) target.role = "HITLER";
      }
    } else if (me?.role === "HITLER") {
      const playerCount = state.players.length;
      if (playerCount <= 6) {
        for (const fascist of fascists) {
          const target = visiblePlayers.find((p: any) => p.id === fascist.id);
          if (target) target.role = "FASCIST";
        }
      }
    }

    return {
      ...state,
      players: visiblePlayers,
      presidentCards: me?.id === state.presidentId ? state.presidentCards : [],
      chancellorCards:
        me?.id === state.nominatedChancellorId ? state.chancellorCards : [],
      policyPeek:
        me?.id === state.presidentId && state.executiveAction === "POLICY_PEEK"
          ? state.policyPeek
          : null,
    };
  }

  if (state.gameType === "HANABI") {
    const me = state.players.find((p: any) => p.id === playerId);
    return {
      ...state,
      players: state.players.map((p: any) => ({
        ...p,
        // Hide hand from the player themselves
        hand:
          p.id === playerId
            ? p.hand.map((card: any) => ({
                id: card.id,
                color: "HIDDEN",
                rank: 0,
                hintedColor: card.hintedColor,
                hintedRank: card.hintedRank,
              }))
            : p.hand,
      })),
    };
  }

  if (state.gameType === "LOVE_LETTER") {
    return {
      ...state,
      deck: [], // Hide deck completely
      players: state.players.map((p: any) => ({
        ...p,
        hand:
          p.id === playerId
            ? p.hand
            : p.hand.map((card: any) => ({ role: "HIDDEN", value: 0 })),
      })),
      setAsideCard: state.setAsideCard ? { role: "HIDDEN", value: 0 } : null,
      priestPeeks: state.priestPeeks
        ? state.priestPeeks.filter((peek: any) => peek.viewerId === playerId)
        : [],
    };
  }

  if (state.gameType === "SPADES") {
    return {
      ...state,
      deck: [],
      players: state.players.map((p: any) => ({
        ...p,
        hand: p.id === playerId ? p.hand : [],
      })),
    };
  }

  return state;
}

function createEmptyState(
  sessionId: string,
  gameType: GameType,
): GameStateUnion {
  const base = {
    sessionId,
    gameType,
    phase: "LOBBY",
    players: [],
    activePlayerIndex: 0,
    lastMove: null,
    moveLog: [],
  };

  if (gameType === "LITERATURE") {
    return {
      ...base,
      hands: {},
      books: [],
      houseRules: {
        mandatory_declaration: false,
        announce_one_card: false,
        high_book_double: false,
        claim_any_turn: false,
        claim_passes_turn: false,
      },
      scores: { teamA: 0, teamB: 0 },
    };
  }

  if (gameType === "COUP") {
    return {
      ...base,
      deck: [],
      pendingAction: null,
    };
  }

  if (gameType === "SECRET_HITLER") {
    return {
      ...base,
      drawPile: [],
      discardPile: [],
      electionTracker: 0,
      liberalPolicies: 0,
      fascistPolicies: 0,
      presidentId: null,
      nominatedChancellorId: null,
      chancellorId: null,
      previousPresidentId: null,
      previousChancellorId: null,
      presidentCards: [],
      chancellorCards: [],
      votes: {},
      vetoRequested: false,
      executiveAction: null,
      policyPeek: null,
      specialElectionReturnIndex: null,
      winner: null,
      winnerReason: null,
      investigateResults: {},
    };
  }

  if (gameType === "HANABI") {
    return {
      ...base,
      deck: [],
      playArea: { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0, WHITE: 0 },
      discardPile: [],
      hintTokens: 8,
      mistakeTokens: 0,
      score: 0,
      turnsLeft: null,
    };
  }

  if (gameType === "LOVE_LETTER") {
    return {
      ...base,
      deck: [],
      setAsideCard: null,
      discardPile: [],
      eliminatedThisRound: [],
      currentRound: 1,
      handmaidProtections: [],
      priestPeeks: [],
    };
  }

  if (gameType === "SPADES") {
    return {
      ...base,
      deck: [],
      currentTrick: { leadSuit: "SPADE", cards: [] },
      trickHistory: [],
      teamAScore: { tricks: 0, bags: 0, score: 0 },
      teamBScore: { tricks: 0, bags: 0, score: 0 },
      allPlayersBid: false,
      spadesBroken: false,
    };
  }

  return base;
}

// ─── Heartbeat ───────────────────────────────────────────
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (wsAliveMap.get(ws) === false) {
      logEvent("warn", "ws.heartbeat_terminated", {
        errorClass: "HEARTBEAT_TIMEOUT",
      });
      ws.terminate();
      return;
    }
    wsAliveMap.set(ws, false);
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeatInterval));

function finalizePlayerDisconnect(sessionId: string, playerId: string) {
  const session = sessions[sessionId];
  if (!session) {
    return;
  }
  let hasOpenSocket = false;
  for (const [ws, pid] of session.clients.entries()) {
    if (pid === playerId && ws.readyState === WebSocket.OPEN) {
      hasOpenSocket = true;
      break;
    }
  }
  if (hasOpenSocket) {
    return;
  }

  const changed = setPlayerConnected(session, playerId, false);
  if (changed) {
    session.stateVersion += 1;
  }
  ensureValidHost(session, playerId);
  ensureLifecycleForCurrentState(sessionId, session, "player-disconnect-finalized");
  session.lastActionTimestamp = Date.now();
  broadcastState(sessionId);
}

const sessionOrchestrator = new SessionOrchestrator<Session>({
  tickIntervalMs: ORCHESTRATOR_TICK_INTERVAL_MS,
  inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
  cleanupDelayMs: SESSION_CLEANUP_DELAY_MS,
  disconnectGraceMs: DISCONNECT_GRACE_MS,
  getSessions: () => sessions,
  onInactivityTimeout: (sessionId) => {
    const session = sessions[sessionId];
    if (!session || session.state.players.length === 0) {
      return;
    }
    const activeIdx = session.state.activePlayerIndex;
    if (activeIdx == null || !session.state.players[activeIdx]) {
      return;
    }
    session.state = prependServerMove(
      {
        ...session.state,
        activePlayerIndex: (activeIdx + 1) % session.state.players.length,
      },
      createServerMove("Turn auto-skipped due to inactivity."),
    );
    session.stateVersion += 1;
    ensureLifecycleForCurrentState(sessionId, session, "inactivity-autoskip");
    session.lastActionTimestamp = Date.now();
    logEvent("info", "session.inactivity_autoskip", {
      sessionId,
      lifecycleState: session.lifecycleState,
    });
    broadcastState(sessionId);
  },
  onCleanupDue: (sessionId) => {
    const session = sessions[sessionId];
    if (!session || session.clients.size > 0) {
      return;
    }
    logEvent("info", "session.cleanup_unloaded", {
      sessionId,
      lifecycleState: session.lifecycleState,
      lifecycleReason: session.lifecycleReason,
    });
    persistSessionState(sessionId, "idle-unload");
    delete sessions[sessionId];
    sessionOrchestrator.clearSession(sessionId);
  },
  onDisconnectDue: finalizePlayerDisconnect,
});

export { sanitizeStateForPlayer };

wss.on("connection", (ws) => {
  logEvent("info", "ws.connected");
  wsAliveMap.set(ws, true);
  let currentSessionId: string | null = null;
  let myPlayerId: string | null = null;
  let myRole: SessionRole = "SPECTATOR";
  let myConnectionEpoch = 0;
  const rateLimiter = new TokenBucket({
    capacity: RATE_LIMIT_BUCKET_CAPACITY,
    refillTokensPerSecond: RATE_LIMIT_REFILL_PER_SECOND,
  });

  const bindSocketToPlayer = (
    sessionId: string,
    session: Session,
    playerId: string,
  ) => {
    for (const [oldWs, oldPid] of session.clients.entries()) {
      if (oldPid === playerId && oldWs !== ws) {
        session.clients.delete(oldWs);
        try {
          oldWs.close(4001, "Replaced by new connection");
        } catch (closeError) {
          logEvent("warn", "ws.replaced_socket_close_failed", {
            sessionId,
            playerId,
            errorClass: "SOCKET_CLOSE",
            detail:
              closeError instanceof Error
                ? closeError.message
                : "unknown close error",
          });
        }
      }
    }

    session.clients.set(ws, playerId);
    sessionOrchestrator.cancelCleanup(sessionId);
    sessionOrchestrator.cancelDisconnect(sessionId, playerId);
    myPlayerId = playerId;
    myRole = session.hostPlayerId === playerId ? "HOST" : "PLAYER";

    const connectedChanged = setPlayerConnected(session, playerId, true);
    if (connectedChanged) {
      session.stateVersion += 1;
    }

    const nextEpoch = (session.connectionEpochByPlayer[playerId] ?? 0) + 1;
    session.connectionEpochByPlayer[playerId] = nextEpoch;
    myConnectionEpoch = nextEpoch;
  };

  const bindSocketAsUnclaimed = (
    sessionId: string,
    session: Session,
    role: SessionRole = "PLAYER",
  ) => {
    session.clients.set(ws, "");
    sessionOrchestrator.cancelCleanup(sessionId);
    myPlayerId = null;
    myRole = role;
    myConnectionEpoch = 0;
  };

  const sendCurrentStateToSocket = () => {
    if (!currentSessionId) {
      return;
    }
    const liveSession = sessions[currentSessionId];
    if (!liveSession) {
      return;
    }
    const playerId = liveSession.clients.get(ws) || null;
    sendStateToClient(currentSessionId, ws, playerId);
  };

  ws.on("pong", () => {
    wsAliveMap.set(ws, true);
  });

  ws.on("message", (raw) => {
    const receivedAt = Date.now();
    const startedAt = performance.now();
    const rawMessage = raw.toString();
    const payloadBytes = Buffer.byteLength(rawMessage, "utf8");
    if (Buffer.byteLength(rawMessage, "utf8") > MAX_WS_MESSAGE_BYTES) {
      sendError(ws, "Payload too large.", {
        sessionId: currentSessionId ?? undefined,
        playerId: myPlayerId,
      });
      ws.close(1009, "Payload too large");
      return;
    }

    if (!rateLimiter.consume(1, receivedAt)) {
      sendError(ws, "Rate limit exceeded.", {
        sessionId: currentSessionId ?? undefined,
        playerId: myPlayerId,
      });
      return;
    }

    try {
      const parsed: unknown = JSON.parse(rawMessage);
      const parsedMessage = parseClientMessage(parsed);
      if (!parsedMessage.ok) {
        sendError(ws, parsedMessage.error, {
          sessionId: currentSessionId ?? undefined,
          playerId: myPlayerId,
        });
        return;
      }

      const data = parsedMessage.data;
      const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
      logEvent("debug", "ws.message_received", {
        sessionId: currentSessionId ?? undefined,
        playerId: myPlayerId ?? undefined,
        messageType: data.type,
        payloadBytes,
        latencyMs,
      });

      const session = currentSessionId ? sessions[currentSessionId] : null;
      if (
        session &&
        isMutatingMessageType(data.type) &&
        "messageId" in data &&
        data.messageId &&
        hasProcessedMessage(session, data.messageId)
      ) {
        sendCurrentStateToSocket();
        return;
      }

      if (
        session &&
        isMutatingMessageType(data.type) &&
        "expectedStateVersion" in data &&
        data.expectedStateVersion !== undefined &&
        data.expectedStateVersion !== session.stateVersion
      ) {
        sendError(
          ws,
          `Stale state version. Expected ${session.stateVersion}, received ${data.expectedStateVersion}.`,
          {
            sessionId: currentSessionId ?? undefined,
            playerId: myPlayerId,
            messageType: data.type,
          },
        );
        sendCurrentStateToSocket();
        return;
      }

      if (
        session &&
        isMutatingMessageType(data.type) &&
        "messageId" in data &&
        data.messageId
      ) {
        markProcessedMessage(session, data.messageId);
      }

      switch (data.type) {
        case "CREATE_SESSION": {
          const gameType = data.gameType;
          const sessionId = generateSessionId();
          const joinNonce = crypto.randomBytes(12).toString("hex");
          const inviteToken = issueInviteToken(sessionId);
          sessions[sessionId] = {
            clients: new Map([[ws, ""]]),
            state: createEmptyState(sessionId, gameType),
            gameType,
            hostPlayerId: null,
            lastActionTimestamp: Date.now(),
            stateVersion: 0,
            lifecycleState: "LOBBY",
            lifecycleUpdatedAt: Date.now(),
            lifecycleReason: "session-created",
            inviteToken,
            processedMessageIds: new Map(),
            pendingJoinNonces: new Map([
              [joinNonce, Date.now() + PENDING_JOIN_NONCE_TTL_MS],
            ]),
            validReconnectVersions: {},
            connectionEpochByPlayer: {},
          };
          const createdSession = sessions[sessionId];
          currentSessionId = sessionId;
          myRole = "PLAYER";
          myPlayerId = null;

          const sessionToken = issueSessionToken(sessionId, joinNonce, "PLAYER");
          sendServerEvent(ws, {
            type: "SESSION_CREATED",
            sessionId,
            gameType,
            inviteToken,
            sessionToken,
          });
          transitionSessionLifecycle(
            sessionId,
            createdSession,
            "LOBBY",
            "session-created",
          );
          broadcastState(sessionId);
          break;
        }

        case "JOIN_SESSION": {
          const sid = data.sessionId.toUpperCase();

          if (!sessions[sid]) {
            const persisted = db.recoverSession(sid);
            if (persisted) {
              sessions[sid] = hydrateSessionFromEnvelope(persisted);
              sessions[sid].lifecycleReason = "session-restored-on-demand";
              ensureValidHost(sessions[sid]);
            } else {
              sendError(ws, "Session not found.", {
                sessionId: sid,
                playerId: myPlayerId,
                messageType: data.type,
              });
              break;
            }
          }

          const targetSession = sessions[sid];
          sessionOrchestrator.cancelCleanup(sid);

          pruneSessionCaches(targetSession);
          currentSessionId = sid;

          if (data.reconnectToken) {
            const reconnectTraceId = crypto.randomBytes(6).toString("hex");
            const verified = verifyToken(data.reconnectToken, "reconnect");
            if (!verified.ok) {
              sendError(ws, verified.error, {
                sessionId: sid,
                playerId: myPlayerId,
                messageType: data.type,
                reconnectTraceId,
              });
              break;
            }
            if (verified.claims.sid !== sid) {
              sendError(ws, "Reconnect token does not match this session.", {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
              });
              break;
            }

            const reconnectingPlayer = targetSession.state.players.find(
              (p: any) => p.id === verified.claims.pid,
            );
            if (!reconnectingPlayer) {
              sendError(ws, "Reconnect token refers to a missing player.", {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
              });
              break;
            }

            const knownVersion =
              targetSession.validReconnectVersions[verified.claims.pid];
            if (
              knownVersion !== undefined &&
              knownVersion !== verified.claims.reconnectVersion
            ) {
              sendError(ws, "Stale reconnect token.", {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
              });
              break;
            }

            targetSession.validReconnectVersions[verified.claims.pid] =
              verified.claims.reconnectVersion + 1;

            bindSocketToPlayer(sid, targetSession, verified.claims.pid);
            ensureValidHost(targetSession);
            ensureLifecycleForCurrentState(
              sid,
              targetSession,
              "player-reconnected",
            );
            logEvent("info", "session.reconnect_resumed", {
              sessionId: sid,
              playerId: verified.claims.pid,
              reconnectTraceId,
              lifecycleState: targetSession.lifecycleState,
            });

            const reconnectToken = issueReconnectToken(
              sid,
              verified.claims.pid,
              myRole,
              targetSession.validReconnectVersions[verified.claims.pid],
            );

            sendServerEvent(ws, {
              type: "SESSION_JOINED",
              sessionId: sid,
              gameType: targetSession.gameType,
              stateVersion: targetSession.stateVersion,
              lifecycleState: targetSession.lifecycleState,
              resumed: true,
              role: myRole,
              reconnectToken,
            });
            broadcastState(sid);
            break;
          }

          if (!data.inviteToken) {
            sendError(ws, "inviteToken is required for new session joins.", {
              sessionId: sid,
              playerId: myPlayerId,
              messageType: data.type,
            });
            break;
          }
          const inviteCheck = verifyToken(data.inviteToken, "invite");
          if (!inviteCheck.ok) {
            sendError(ws, inviteCheck.error, {
              sessionId: sid,
              playerId: myPlayerId,
              messageType: data.type,
            });
            break;
          }
          if (inviteCheck.claims.sid !== sid) {
            sendError(ws, "Invite token does not match this session.", {
              sessionId: sid,
              playerId: myPlayerId,
              messageType: data.type,
            });
            break;
          }

          const requestedRole = data.joinAs === "SPECTATOR" ? "SPECTATOR" : "PLAYER";
          if (requestedRole === "PLAYER" && targetSession.state.phase !== "LOBBY") {
            sendError(
              ws,
              "Game already in progress. Use a reconnect token to reclaim your seat.",
            );
            break;
          }

          bindSocketAsUnclaimed(sid, targetSession, requestedRole);
          ensureValidHost(targetSession);
          ensureLifecycleForCurrentState(
            sid,
            targetSession,
            "session-join-authorized",
          );

          let sessionToken: string | undefined;
          if (requestedRole === "PLAYER") {
            const joinNonce = crypto.randomBytes(12).toString("hex");
            targetSession.pendingJoinNonces.set(
              joinNonce,
              Date.now() + PENDING_JOIN_NONCE_TTL_MS,
            );
            sessionToken = issueSessionToken(sid, joinNonce, "PLAYER");
          }

          sendServerEvent(ws, {
            type: "SESSION_JOINED",
            sessionId: sid,
            gameType: targetSession.gameType,
            stateVersion: targetSession.stateVersion,
            lifecycleState: targetSession.lifecycleState,
            resumed: false,
            role: requestedRole,
            sessionToken,
          });
          sendCurrentStateToSocket();
          break;
        }

        case "JOIN_LOBBY": {
          if (!session || !currentSessionId) {
            sendError(ws, "Join a session first.");
            break;
          }
          if (myPlayerId) {
            sendError(ws, "Already joined as a player.");
            break;
          }

          const tokenCheck = verifyToken(data.sessionToken, "session");
          if (!tokenCheck.ok) {
            sendError(ws, tokenCheck.error);
            break;
          }
          if (tokenCheck.claims.sid !== currentSessionId) {
            sendError(ws, "Session token does not match this session.");
            break;
          }
          if (tokenCheck.claims.role !== "PLAYER") {
            sendError(ws, "Spectators cannot join the lobby as players.");
            break;
          }
          const nonceExpiry = session.pendingJoinNonces.get(
            tokenCheck.claims.joinNonce,
          );
          if (!nonceExpiry || nonceExpiry <= Date.now()) {
            sendError(ws, "Session token has already been used or expired.");
            break;
          }
          session.pendingJoinNonces.delete(tokenCheck.claims.joinNonce);

          if (session.state.phase !== "LOBBY") {
            sendError(ws, "Game already in progress.");
            break;
          }

          const maxPlayers = MAX_PLAYERS[session.gameType] || 10;
          if (session.state.players.length >= maxPlayers) {
            sendError(ws, `Lobby is full (${maxPlayers} players max).`);
            break;
          }

          const trimmedName = data.player.name.trim();
          const nameLower = trimmedName.toLowerCase();
          if (
            session.state.players.some((p: any) => p.name.toLowerCase() === nameLower)
          ) {
            sendError(ws, "That name is already taken.");
            break;
          }

          let playerId = generatePlayerId();
          while (session.state.players.some((p: any) => p.id === playerId)) {
            playerId = generatePlayerId();
          }

          const seatIndex =
            typeof data.player.seatIndex === "number"
              ? data.player.seatIndex
              : session.state.players.length;
          const team = data.player.team === "TEAM_B" ? "TEAM_B" : "TEAM_A";

          session.state = {
            ...session.state,
            players: [
              ...session.state.players,
              {
                id: playerId,
                name: trimmedName,
                team,
                seatIndex,
                isConnected: true,
              },
            ],
          };

          if (!session.hostPlayerId) {
            session.hostPlayerId = playerId;
          }
          session.stateVersion += 1;
          session.validReconnectVersions[playerId] = 1;
          bindSocketToPlayer(currentSessionId, session, playerId);
          ensureValidHost(session);
          ensureLifecycleForCurrentState(
            currentSessionId,
            session,
            "player-joined-lobby",
          );
          broadcastState(currentSessionId);
          break;
        }

        case "START_GAME":
        case "ASK_CARD":
        case "CLAIM_BOOK":
        case "COUP_ACTION":
        case "SECRET_HITLER_ACTION":
        case "PLACE_BID":
        case "PLAY_CARD":
        case "DISCARD_CARD":
        case "GIVE_HINT":
        case "MOVE_CARD":
        case "GAME_ACTION": {
          if (!session || !currentSessionId) {
            sendError(ws, "Join a session first.");
            break;
          }
          if (!myPlayerId || (myRole !== "HOST" && myRole !== "PLAYER")) {
            sendError(ws, "Join the lobby before sending actions.");
            break;
          }
          const latestEpoch = session.connectionEpochByPlayer[myPlayerId] ?? 0;
          if (myConnectionEpoch !== latestEpoch) {
            sendError(ws, "Stale connection. Reconnect and try again.");
            sendCurrentStateToSocket();
            break;
          }

          const dispatch = (
            actionData: Record<string, unknown>,
            shouldSendError: boolean = false,
          ) => {
            const liveSession = currentSessionId
              ? sessions[currentSessionId]
              : null;
            if (!liveSession) return;
            let result: { state?: GameStateUnion; error?: string } = {};

            if (liveSession.gameType === "LITERATURE") {
              result = LiteratureHandler.handleAction(
                liveSession.state as any,
                actionData,
              );
            } else if (liveSession.gameType === "COUP") {
              result = CoupHandler.handleAction(
                liveSession.state as any,
                actionData,
                broadcastState,
                dispatch,
              );
            } else if (liveSession.gameType === "SECRET_HITLER") {
              result = SecretHitlerHandler.handleAction(
                liveSession.state as any,
                actionData,
              );
            } else if (liveSession.gameType === "HANABI") {
              result = HanabiHandler.handleAction(
                liveSession.state as any,
                actionData,
              );
            } else if (liveSession.gameType === "LOVE_LETTER") {
              result = LoveLetterHandler.handleAction(
                liveSession.state as any,
                actionData,
              );
            } else if (liveSession.gameType === "SPADES") {
              result = SpadesHandler.handleAction(
                liveSession.state as any,
                actionData,
              );
            }

            if (result.error && shouldSendError) {
              sendError(ws, result.error);
            } else if (result.state) {
              liveSession.state = capMoveLog(result.state);
              liveSession.lastActionTimestamp = Date.now();
              liveSession.stateVersion += 1;
              ensureValidHost(liveSession);
              ensureLifecycleForCurrentState(
                currentSessionId!,
                liveSession,
                "game-action",
              );
              broadcastState(currentSessionId!);
            }
          };

          if (data.type === "START_GAME") {
            if (myRole !== "HOST" || myPlayerId !== session.hostPlayerId) {
              sendError(ws, "Only the host can start the game.");
              break;
            }
          }

          dispatch({ ...data, actorId: myPlayerId }, true);
          break;
        }

        case "HOST_ACTION": {
          if (!session || !currentSessionId) {
            sendError(ws, "Join a session first.");
            break;
          }
          if (myRole !== "HOST" || myPlayerId !== session.hostPlayerId) {
            sendError(ws, "Only the host can perform administrative actions.");
            break;
          }

          const action = data.action;
          if (action === "END_GAME") {
            transitionSessionLifecycle(
              currentSessionId,
              session,
              "ENDED",
              "host-ended-game",
            );
            db.markSessionDeleted(currentSessionId, "host-ended-game");
            for (const clientWs of session.clients.keys()) {
              sendError(clientWs, "The host has ended the game.");
              clientWs.close(1000, "Game ended by host");
            }
            delete sessions[currentSessionId];
            sessionOrchestrator.clearSession(currentSessionId);
          } else if (action === "KICK_PLAYER") {
            if (!data.targetId) {
              sendError(ws, "Invalid targetId.");
              break;
            }
            const targetId = data.targetId;
            if (targetId === myPlayerId) {
              sendError(ws, "Host cannot kick themselves.");
              break;
            }

            const removedIndex = session.state.players.findIndex(
              (p: any) => p.id === targetId,
            );
            if (removedIndex === -1) {
              sendError(ws, "Player not found.");
              break;
            }

            const nextPlayers = session.state.players.filter(
              (p: any) => p.id !== targetId,
            );
            let nextActivePlayerIndex = session.state.activePlayerIndex;
            if (nextPlayers.length === 0) {
              nextActivePlayerIndex = 0;
            } else if (removedIndex < nextActivePlayerIndex) {
              nextActivePlayerIndex -= 1;
            } else if (removedIndex === nextActivePlayerIndex) {
              nextActivePlayerIndex =
                nextActivePlayerIndex % nextPlayers.length;
            }
            session.state = {
              ...session.state,
              players: nextPlayers,
              activePlayerIndex: Math.max(nextActivePlayerIndex, 0),
            };

            // Disconnect the kicked player
            for (const [clientWs, pid] of session.clients.entries()) {
              if (pid === targetId) {
                sendError(clientWs, "You have been kicked by the host.");
                clientWs.close(1000, "Kicked by host");
                session.clients.delete(clientWs);
              }
            }

            delete session.validReconnectVersions[targetId];
            delete session.connectionEpochByPlayer[targetId];
            ensureValidHost(session, targetId);
            session.state = prependServerMove(
              session.state,
              createServerMove("Host removed a player from the session.", "Host"),
            );
            session.stateVersion += 1;
            ensureLifecycleForCurrentState(
              currentSessionId,
              session,
              "host-kick-player",
            );
            session.lastActionTimestamp = Date.now();
            broadcastState(currentSessionId);
          } else if (action === "FORCE_SKIP") {
            if (
              "activePlayerIndex" in session.state &&
              session.state.players.length > 0
            ) {
              const currentIdx = session.state.activePlayerIndex;
              session.state = prependServerMove(
                {
                  ...session.state,
                  activePlayerIndex:
                    (currentIdx + 1) % session.state.players.length,
                },
                createServerMove("Host forced a turn skip.", "Host"),
              );
              session.stateVersion += 1;
              ensureLifecycleForCurrentState(
                currentSessionId,
                session,
                "host-force-skip",
              );
              session.lastActionTimestamp = Date.now();
              broadcastState(currentSessionId);
            }
          } else if (action === "REASSIGN_SEAT") {
            sendError(
              ws,
              "Seat reassignment is disabled because it can corrupt game state. Ask the player to reconnect with their original ID.",
            );
          } else {
            sendError(ws, `Unsupported host action: ${action}`);
          }
          break;
        }
      }
    } catch (error) {
      const isSyntaxError = error instanceof SyntaxError;
      sendError(
        ws,
        isSyntaxError ? "Invalid JSON payload." : "Message processing failed.",
        {
          sessionId: currentSessionId ?? undefined,
          playerId: myPlayerId,
        },
      );
    }
  });

  ws.on("close", () => {
    if (currentSessionId && sessions[currentSessionId]) {
      const session = sessions[currentSessionId];
      const disconnectedPlayerId = session.clients.get(ws) || null;
      session.clients.delete(ws);

      // Mark player as disconnected (if not connected via another socket)
      if (
        disconnectedPlayerId &&
        !isPlayerConnectedViaAnotherSocket(session, disconnectedPlayerId, ws)
      ) {
        sessionOrchestrator.scheduleDisconnect(
          currentSessionId,
          disconnectedPlayerId,
        );
        logEvent("info", "session.disconnect_scheduled", {
          sessionId: currentSessionId,
          playerId: disconnectedPlayerId,
          lifecycleState: session.lifecycleState,
        });
      }

      // Prune any other dead clients
      pruneDeadClients(session);

      // Schedule cleanup if no one is left
      if (session.clients.size === 0) {
        transitionSessionLifecycle(
          currentSessionId,
          session,
          "IDLE_EMPTY",
          "no-active-clients",
        );
        sessionOrchestrator.scheduleCleanup(currentSessionId);
        persistSessionState(currentSessionId, "session-idle");
      } else {
        sessionOrchestrator.cancelCleanup(currentSessionId);
        ensureLifecycleForCurrentState(
          currentSessionId,
          session,
          "clients-still-connected",
        );
      }
    }
    logEvent("info", "ws.closed", {
      sessionId: currentSessionId ?? undefined,
      playerId: myPlayerId ?? undefined,
    });
  });
});

function persistAllSessions() {
  for (const sessionId of Object.keys(sessions)) {
    persistSessionState(sessionId, "process-shutdown");
  }
}

let isShuttingDown = false;
function shutdownGracefully(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logEvent("info", "process.shutdown_requested", { detail: signal });

  clearInterval(heartbeatInterval);
  sessionOrchestrator.stop();

  persistAllSessions();
  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    logEvent("error", "process.shutdown_forced");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", () => shutdownGracefully("SIGINT"));
process.on("SIGTERM", () => shutdownGracefully("SIGTERM"));

app.get("/ping", (_req, res) => {
  res.send("pong");
});
app.use(express.static(path.join(__dirname, "../dist")));
app.get("/*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

let isServerListening = false;

function getBoundPort(): number | null {
  const address = server.address();
  if (!address || typeof address === "string") {
    return null;
  }
  return address.port;
}

export function startServer(port: number = Number(PORT)): Promise<number> {
  if (isServerListening) {
    return Promise.resolve(getBoundPort() ?? port);
  }
  sessionOrchestrator.start();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      isServerListening = true;
      const actualPort = getBoundPort() ?? port;
      logEvent("info", "server.started", { detail: String(actualPort) });
      resolve(actualPort);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!isServerListening) {
      sessionOrchestrator.stop();
      resolve();
      return;
    }
    persistAllSessions();
    sessionOrchestrator.stop();
    server.close(() => {
      isServerListening = false;
      logEvent("info", "server.stopped");
      resolve();
    });
  });
}

export function simulateCrashRecoveryForTests() {
  persistAllSessions();
  for (const sessionId of Object.keys(sessions)) {
    sessionOrchestrator.clearSession(sessionId);
    delete sessions[sessionId];
  }
  restoreSessionsFromPersistence("test-simulated-recovery");
}

if (process.env.NODE_ENV !== "test") {
  void startServer();
}
