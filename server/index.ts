import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import * as db from "./db.js";
import { logEvent } from "./infra/logger.js";
import { metrics } from "./infra/metrics.js";
import { TokenBucket } from "./network/tokenBucket.js";
import { sendServerEvent } from "./protocol/respond.js";
import {
  verifyToken,
  issueInviteToken,
  issueReconnectToken,
  type SessionRole,
} from "./security/tokens.js";
import {
  deriveLifecycleFromState,
  transitionLifecycle,
  type SessionLifecycleState,
} from "./sessionLifecycle.js";
import { SessionOrchestrator } from "./sessionOrchestrator.js";
import {
  sanitizeStateForPlayer,
  type GameStateUnion,
} from "./state/gameState.js";
import {
  MAX_SUPPORTED_PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
} from "../src/shared/protocolContracts.js";
import type { BaseGameState, GameType } from "../src/shared/types.js";
import type { PersistedSessionEnvelope } from "./db.js";
import type { ServerEvent } from "./protocol/schemas.js";
import { createServerMove, prependServerMove } from "./state/moves.js";
import { handleClientMessage } from "./network/router.js";

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
const CLIENT_MESSAGE_TTL_MS = 2 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────
export interface Session {
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
  pendingSeatTransfers: Map<
    string,
    { ws: WebSocket; requestedBy: string; requestedAtEpochMs: number; expiresAt: number }
  >;
  validReconnectVersions: Record<string, number>;
  connectionEpochByPlayer: Record<string, number>;
}

export interface ConnectionContext {
  currentSessionId: string | null;
  myPlayerId: string | null;
  myRole: SessionRole;
  myConnectionEpoch: number;
}

export interface ServerContext {
  sessions: Record<string, Session>;
  sessionOrchestrator: SessionOrchestrator<Session>;
  broadcastState: (sessionId: string) => void;
  sendStateToClient: (
    sessionId: string,
    ws: WebSocket,
    playerId: string | null,
  ) => void;
  ensureValidHost: (session: Session, previousHostId?: string | null) => void;
  transitionSessionLifecycle: (
    sessionId: string,
    session: Session,
    nextState: SessionLifecycleState,
    reason: string,
  ) => void;
  ensureLifecycleForCurrentState: (
    sessionId: string,
    session: Session,
    reason: string,
  ) => void;
  setPlayerConnected: (
    session: Session,
    playerId: string,
    connected: boolean,
  ) => boolean;
  hydrateSessionFromEnvelope: (
    envelope: PersistedSessionEnvelope,
  ) => Session;
  pruneSessionCaches: (session: Session) => void;
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
    pendingSeatTransfers: new Map(),
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
  for (const [token, transfer] of session.pendingSeatTransfers.entries()) {
    if (transfer.expiresAt <= now || transfer.ws.readyState !== WebSocket.OPEN) {
      session.pendingSeatTransfers.delete(token);
    }
  }
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

function broadcastState(sessionId: string) {
  const session = sessions[sessionId];
  if (!session) return;

  pruneSessionCaches(session);
  persistSessionState(sessionId, "broadcast-state");
  metrics.increment("state_broadcast_total", 1, { gameType: session.gameType });

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
    players: session.state.players.map((p) =>
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

const serverContext: ServerContext = {
  sessions,
  sessionOrchestrator,
  broadcastState,
  sendStateToClient,
  ensureValidHost,
  transitionSessionLifecycle,
  ensureLifecycleForCurrentState,
  setPlayerConnected,
  hydrateSessionFromEnvelope,
  pruneSessionCaches,
};

wss.on("connection", (ws) => {
  logEvent("info", "ws.connected");
  metrics.increment("ws_connections_total");
  wsAliveMap.set(ws, true);

  const connectionContext: ConnectionContext = {
    currentSessionId: null,
    myPlayerId: null,
    myRole: "SPECTATOR",
    myConnectionEpoch: 0,
  };

  const rateLimiter = new TokenBucket({
    capacity: RATE_LIMIT_BUCKET_CAPACITY,
    refillTokensPerSecond: RATE_LIMIT_REFILL_PER_SECOND,
  });

  ws.on("pong", () => {
    wsAliveMap.set(ws, true);
  });

  ws.on("message", (raw) => {
    const startedAt = performance.now();
    handleClientMessage(
      ws,
      raw.toString(),
      rateLimiter,
      connectionContext,
      serverContext,
      startedAt,
    );
  });

  ws.on("close", () => {
    metrics.increment("ws_disconnections_total");
    const currentSessionId = connectionContext.currentSessionId;
    const myPlayerId = connectionContext.myPlayerId;
    if (currentSessionId && sessions[currentSessionId]) {
      const session = sessions[currentSessionId];
      const disconnectedPlayerId = session.clients.get(ws) || null;
      session.clients.delete(ws);
      for (const [token, transfer] of session.pendingSeatTransfers.entries()) {
        if (transfer.ws === ws) {
          session.pendingSeatTransfers.delete(token);
        }
      }

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

      pruneDeadClients(session);

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

function getOperationalSnapshot() {
  const persistence = db.getPersistenceHealth();
  const orchestrator = sessionOrchestrator.getDiagnostics();
  return {
    timestamp: new Date().toISOString(),
    sessionsLoaded: Object.keys(sessions).length,
    persistence,
    orchestrator,
  };
}

app.get("/ping", (_req, res) => {
  res.send("pong");
});
app.get("/health", (_req, res) => {
  const snapshot = getOperationalSnapshot();
  const ok = snapshot.persistence.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    ...snapshot,
  });
});
app.get("/ready", (_req, res) => {
  const snapshot = getOperationalSnapshot();
  const ready = isServerListening && snapshot.persistence.ok && snapshot.orchestrator.running;
  res.status(ready ? 200 : 503).json({
    ready,
    listening: isServerListening,
    sessionsLoaded: snapshot.sessionsLoaded,
    orchestrator: snapshot.orchestrator,
    persistence: {
      ok: snapshot.persistence.ok,
      latestMigrationId: snapshot.persistence.latestMigrationId,
      appliedMigrationIds: snapshot.persistence.appliedMigrationIds,
    },
  });
});
app.get("/metrics", (_req, res) => {
  res.json({
    protocol: {
      minSupported: MIN_SUPPORTED_PROTOCOL_VERSION,
      maxSupported: MAX_SUPPORTED_PROTOCOL_VERSION,
    },
    metrics: metrics.snapshot(),
  });
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
      metrics.increment("server_start_total");
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
      metrics.increment("server_stop_total");
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
