import { WebSocket } from "ws";
import crypto from "crypto";
import { parseClientMessage, type ClientMessage } from "../protocol/schemas.js";
import { sendAck, sendError, sendServerEvent } from "../protocol/respond.js";
import { metrics } from "../infra/metrics.js";
import { logEvent } from "../infra/logger.js";
import type { TokenBucket } from "./tokenBucket.js";
import {
  issueInviteToken,
  issueReconnectToken,
  issueSessionToken,
  verifyToken,
  type SessionRole,
} from "../security/tokens.js";
import { createEmptyState } from "../state/gameState.js";
import { dispatchGameAction } from "../games/dispatcher.js";
import {
  SERVER_ERROR_CODES,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  MAX_SUPPORTED_PROTOCOL_VERSION,
} from "../../src/shared/protocolContracts.js";
import * as db from "../db.js";
import { handleHostAction } from "../games/hostActions.js";
import { capMoveLog } from "../state/moves.js";
import type { Session, ServerContext, ConnectionContext } from "../index.js";

const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const PENDING_JOIN_NONCE_TTL_MS = 20 * 60 * 1000;
const SEAT_TRANSFER_TOKEN_TTL_MS = 60 * 1000;

const MAX_PLAYERS: Record<string, number> = {
  LITERATURE: 8,
  COUP: 6,
  SECRET_HITLER: 10,
  HANABI: 5,
  LOVE_LETTER: 4,
  SPADES: 4,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractRequestId(data: ClientMessage): string | undefined {
  if ("requestId" in data && typeof data.requestId === "string") {
    return data.requestId;
  }
  if ("messageId" in data && typeof data.messageId === "string") {
    return data.messageId;
  }
  return undefined;
}

function extractRequestIdFromRaw(raw: unknown): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (typeof raw.requestId === "string") {
    return raw.requestId;
  }
  if (typeof raw.messageId === "string") {
    return raw.messageId;
  }
  return undefined;
}

function extractProtocolVersion(raw: unknown): number | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const version = raw.protocolVersion;
  return typeof version === "number" ? version : undefined;
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
    type === "HOST_ACTION" ||
    type === "REQUEST_SEAT_TRANSFER"
  );
}

function markProcessedMessage(
  session: Session,
  messageId: string,
  serverContext: ServerContext,
) {
  serverContext.pruneSessionCaches(session);
  session.processedMessageIds.set(messageId, Date.now());
}

function hasProcessedMessage(
  session: Session,
  messageId: string,
  serverContext: ServerContext,
): boolean {
  serverContext.pruneSessionCaches(session);
  return session.processedMessageIds.has(messageId);
}

export function handleClientMessage(
  ws: WebSocket,
  rawMessage: string,
  rateLimiter: TokenBucket,
  connectionContext: ConnectionContext,
  serverContext: ServerContext,
  startedAt: number,
) {
  const payloadBytes = Buffer.byteLength(rawMessage, "utf8");
  metrics.observe("ws_payload_bytes", payloadBytes);

  if (payloadBytes > MAX_WS_MESSAGE_BYTES) {
    sendError(
      ws,
      "Payload too large.",
      {
        sessionId: connectionContext.currentSessionId ?? undefined,
        playerId: connectionContext.myPlayerId,
      },
      { code: SERVER_ERROR_CODES.VALIDATION },
    );
    try {
      ws.close(1009, "Payload too large");
    } catch (closeError) {
      logEvent("warn", "ws.payload_large_close_failed", {
        errorClass: "SOCKET_CLOSE",
        detail:
          closeError instanceof Error
            ? closeError.message
            : "unknown close error",
      });
    }
    return;
  }

  const receivedAt = Date.now();
  if (!rateLimiter.consume(1, receivedAt)) {
    metrics.increment("ws_rejected_total", 1, { reason: "rate_limit" });
    sendError(ws, "Rate limit exceeded.", {
      sessionId: connectionContext.currentSessionId ?? undefined,
      playerId: connectionContext.myPlayerId,
    });
    return;
  }

  // Define helpers scoped to this connection/context
  const bindSocketToPlayer = (
    sessionId: string,
    session: Session,
    playerId: string,
    socket: WebSocket = ws,
  ) => {
    for (const [oldWs, oldPid] of session.clients.entries()) {
      if (oldPid === playerId && oldWs !== socket) {
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

    session.clients.set(socket, playerId);
    serverContext.sessionOrchestrator.cancelCleanup(sessionId);
    serverContext.sessionOrchestrator.cancelDisconnect(sessionId, playerId);

    const connectedChanged = serverContext.setPlayerConnected(
      session,
      playerId,
      true,
    );
    if (connectedChanged) {
      session.stateVersion += 1;
    }

    const nextEpoch = (session.connectionEpochByPlayer[playerId] ?? 0) + 1;
    session.connectionEpochByPlayer[playerId] = nextEpoch;

    if (socket === ws) {
      connectionContext.myPlayerId = playerId;
      connectionContext.myRole =
        session.hostPlayerId === playerId ? "HOST" : "PLAYER";
      connectionContext.myConnectionEpoch = nextEpoch;
    }
  };

  const bindSocketAsUnclaimed = (
    sessionId: string,
    session: Session,
    role: SessionRole = "PLAYER",
  ) => {
    session.clients.set(ws, "");
    serverContext.sessionOrchestrator.cancelCleanup(sessionId);
    connectionContext.myPlayerId = null;
    connectionContext.myRole = role;
    connectionContext.myConnectionEpoch = 0;
  };

  const sendCurrentStateToSocket = () => {
    if (!connectionContext.currentSessionId) {
      return;
    }
    const liveSession =
      serverContext.sessions[connectionContext.currentSessionId];
    if (!liveSession) {
      return;
    }
    const playerId = liveSession.clients.get(ws) || null;
    serverContext.sendStateToClient(
      connectionContext.currentSessionId,
      ws,
      playerId,
    );
  };

  try {
    const parsedRaw: unknown = JSON.parse(rawMessage);
    const envelopeRequestId = extractRequestIdFromRaw(parsedRaw);
    const protocolVersion = extractProtocolVersion(parsedRaw);
    if (
      protocolVersion !== undefined &&
      (protocolVersion < MIN_SUPPORTED_PROTOCOL_VERSION ||
        protocolVersion > MAX_SUPPORTED_PROTOCOL_VERSION)
    ) {
      sendError(
        ws,
        `Unsupported protocol version ${protocolVersion}.`,
        {
          sessionId: connectionContext.currentSessionId ?? undefined,
          playerId: connectionContext.myPlayerId,
          requestId: envelopeRequestId,
        },
        { code: SERVER_ERROR_CODES.UNSUPPORTED_PROTOCOL },
      );
      return;
    }

    const parsedMessage = parseClientMessage(parsedRaw);
    if (!parsedMessage.ok) {
      metrics.increment("ws_rejected_total", 1, { reason: "schema" });
      sendError(
        ws,
        parsedMessage.error,
        {
          sessionId: connectionContext.currentSessionId ?? undefined,
          playerId: connectionContext.myPlayerId,
          requestId: envelopeRequestId,
        },
        { code: SERVER_ERROR_CODES.VALIDATION },
      );
      return;
    }

    const data = parsedMessage.data;
    const requestId = extractRequestId(data);
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    metrics.observe("ws_message_latency_ms", latencyMs, { type: data.type });
    metrics.increment("ws_messages_total", 1, { type: data.type });
    logEvent("debug", "ws.message_received", {
      sessionId: connectionContext.currentSessionId ?? undefined,
      playerId: connectionContext.myPlayerId ?? undefined,
      messageType: data.type,
      payloadBytes,
      latencyMs,
      requestId,
    });

    const session = connectionContext.currentSessionId
      ? serverContext.sessions[connectionContext.currentSessionId]
      : null;
    if (
      session &&
      isMutatingMessageType(data.type) &&
      "messageId" in data &&
      data.messageId &&
      hasProcessedMessage(session, data.messageId, serverContext)
    ) {
      sendAck(ws, {
        requestId,
        messageType: data.type,
        stateVersion: session.stateVersion,
      });
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
          sessionId: connectionContext.currentSessionId ?? undefined,
          playerId: connectionContext.myPlayerId,
          messageType: data.type,
          requestId,
        },
        { code: SERVER_ERROR_CODES.STALE_STATE },
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
      markProcessedMessage(session, data.messageId, serverContext);
    }

    switch (data.type) {
      case "CREATE_SESSION": {
        const gameType = data.gameType;
        const generateSessionId = () => {
          let id: string;
          let attempts = 0;
          do {
            if (attempts++ > 100)
              throw new Error("Could not generate unique session ID");
            id = crypto.randomBytes(2).toString("hex").toUpperCase();
          } while (serverContext.sessions[id]);
          return id;
        };
        const sessionId = generateSessionId();
        const joinNonce = crypto.randomBytes(12).toString("hex");
        const inviteToken = issueInviteToken(sessionId);
        serverContext.sessions[sessionId] = {
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
          pendingSeatTransfers: new Map(),
          validReconnectVersions: {},
          connectionEpochByPlayer: {},
        };
        const createdSession = serverContext.sessions[sessionId];
        connectionContext.currentSessionId = sessionId;
        connectionContext.myRole = "PLAYER";
        connectionContext.myPlayerId = null;

        const sessionToken = issueSessionToken(sessionId, joinNonce, "PLAYER");
        sendServerEvent(ws, {
          type: "SESSION_CREATED",
          sessionId,
          gameType,
          inviteToken,
          sessionToken,
          requestId,
        });
        sendAck(ws, {
          requestId,
          messageType: data.type,
          stateVersion: createdSession.stateVersion,
        });
        serverContext.transitionSessionLifecycle(
          sessionId,
          createdSession,
          "LOBBY",
          "session-created",
        );
        serverContext.broadcastState(sessionId);
        break;
      }

      case "JOIN_SESSION": {
        const sid = data.sessionId.toUpperCase();
        if (!serverContext.sessions[sid]) {
          const persisted = db.recoverSession(sid);
          if (persisted) {
            serverContext.sessions[sid] =
              serverContext.hydrateSessionFromEnvelope(persisted);
            serverContext.sessions[sid].lifecycleReason =
              "session-restored-on-demand";
            serverContext.ensureValidHost(serverContext.sessions[sid]);
          } else {
            sendError(
              ws,
              "Session not found.",
              {
                sessionId: sid,
                playerId: connectionContext.myPlayerId,
                messageType: data.type,
                requestId,
              },
              { code: SERVER_ERROR_CODES.NOT_FOUND },
            );
            break;
          }
        }

        const targetSession = serverContext.sessions[sid];
        serverContext.sessionOrchestrator.cancelCleanup(sid);
        serverContext.pruneSessionCaches(targetSession);
        connectionContext.currentSessionId = sid;

        if (data.reconnectToken) {
          const reconnectTraceId = crypto.randomBytes(6).toString("hex");
          const verified = verifyToken(data.reconnectToken, "reconnect");
          if (!verified.ok) {
            sendError(ws, verified.error, {
              sessionId: sid,
              playerId: connectionContext.myPlayerId,
              messageType: data.type,
              reconnectTraceId,
              requestId,
            });
            break;
          }
          if (verified.claims.sid !== sid) {
            sendError(
              ws,
              "Reconnect token does not match this session.",
              {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
                requestId,
              },
              { code: SERVER_ERROR_CODES.AUTHENTICATION },
            );
            break;
          }

          const reconnectingPlayer = targetSession.state.players.find(
            (p) => p.id === verified.claims.pid,
          );
          if (!reconnectingPlayer) {
            sendError(
              ws,
              "Reconnect token refers to a missing player.",
              {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
                requestId,
              },
              { code: SERVER_ERROR_CODES.NOT_FOUND },
            );
            break;
          }

          const knownVersion =
            targetSession.validReconnectVersions[verified.claims.pid];
          if (
            knownVersion !== undefined &&
            knownVersion !== verified.claims.reconnectVersion
          ) {
            sendError(
              ws,
              "Stale reconnect token.",
              {
                sessionId: sid,
                playerId: verified.claims.pid,
                messageType: data.type,
                reconnectTraceId,
                requestId,
              },
              { code: SERVER_ERROR_CODES.STALE_STATE },
            );
            break;
          }

          targetSession.validReconnectVersions[verified.claims.pid] =
            verified.claims.reconnectVersion + 1;

          bindSocketToPlayer(sid, targetSession, verified.claims.pid);
          serverContext.ensureValidHost(targetSession);
          serverContext.ensureLifecycleForCurrentState(
            sid,
            targetSession,
            "player-reconnected",
          );
          metrics.increment("reconnect_success_total");
          logEvent("info", "session.reconnect_resumed", {
            sessionId: sid,
            playerId: verified.claims.pid,
            reconnectTraceId,
            lifecycleState: targetSession.lifecycleState,
          });

          const reconnectToken = issueReconnectToken(
            sid,
            verified.claims.pid,
            connectionContext.myRole,
            targetSession.validReconnectVersions[verified.claims.pid],
          );

          sendServerEvent(ws, {
            type: "SESSION_JOINED",
            sessionId: sid,
            gameType: targetSession.gameType,
            stateVersion: targetSession.stateVersion,
            lifecycleState: targetSession.lifecycleState,
            resumed: true,
            role: connectionContext.myRole,
            reconnectToken,
            requestId,
          });
          sendAck(ws, {
            requestId,
            messageType: data.type,
            stateVersion: targetSession.stateVersion,
          });
          serverContext.broadcastState(sid);
          break;
        }

        if (!data.inviteToken) {
          sendError(
            ws,
            "inviteToken is required for new session joins.",
            {
              sessionId: sid,
              playerId: connectionContext.myPlayerId,
              messageType: data.type,
              requestId,
            },
            { code: SERVER_ERROR_CODES.AUTHENTICATION },
          );
          break;
        }
        const inviteCheck = verifyToken(data.inviteToken, "invite");
        if (!inviteCheck.ok) {
          sendError(ws, inviteCheck.error, {
            sessionId: sid,
            playerId: connectionContext.myPlayerId,
            messageType: data.type,
            requestId,
          });
          break;
        }
        if (inviteCheck.claims.sid !== sid) {
          sendError(
            ws,
            "Invite token does not match this session.",
            {
              sessionId: sid,
              playerId: connectionContext.myPlayerId,
              messageType: data.type,
              requestId,
            },
            { code: SERVER_ERROR_CODES.AUTHENTICATION },
          );
          break;
        }

        const requestedRole =
          data.joinAs === "SPECTATOR" ? "SPECTATOR" : "PLAYER";
        if (
          requestedRole === "PLAYER" &&
          targetSession.state.phase !== "LOBBY"
        ) {
          sendError(
            ws,
            "Game already in progress. Use a reconnect token to reclaim your seat.",
            {
              sessionId: sid,
              playerId: connectionContext.myPlayerId,
              messageType: data.type,
              requestId,
            },
            { code: SERVER_ERROR_CODES.SESSION_STATE },
          );
          break;
        }

        bindSocketAsUnclaimed(sid, targetSession, requestedRole);
        serverContext.ensureValidHost(targetSession);
        serverContext.ensureLifecycleForCurrentState(
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
          requestId,
        });
        sendAck(ws, {
          requestId,
          messageType: data.type,
          stateVersion: targetSession.stateVersion,
        });
        sendCurrentStateToSocket();
        break;
      }

      case "JOIN_LOBBY": {
        if (!session || !connectionContext.currentSessionId) {
          sendError(ws, "Join a session first.", {
            requestId,
            messageType: data.type,
          });
          break;
        }
        if (connectionContext.myPlayerId) {
          sendError(ws, "Already joined as a player.", {
            requestId,
            messageType: data.type,
          });
          break;
        }

        const tokenCheck = verifyToken(data.sessionToken, "session");
        if (!tokenCheck.ok) {
          sendError(ws, tokenCheck.error, {
            requestId,
            messageType: data.type,
          });
          break;
        }
        if (tokenCheck.claims.sid !== connectionContext.currentSessionId) {
          sendError(
            ws,
            "Session token does not match this session.",
            {
              requestId,
              messageType: data.type,
            },
            { code: SERVER_ERROR_CODES.AUTHENTICATION },
          );
          break;
        }
        if (tokenCheck.claims.role !== "PLAYER") {
          sendError(
            ws,
            "Spectators cannot join the lobby as players.",
            {
              requestId,
              messageType: data.type,
            },
            { code: SERVER_ERROR_CODES.AUTHORIZATION },
          );
          break;
        }
        const nonceExpiry = session.pendingJoinNonces.get(
          tokenCheck.claims.joinNonce,
        );
        if (!nonceExpiry || nonceExpiry <= Date.now()) {
          sendError(
            ws,
            "Session token has already been used or expired.",
            {
              requestId,
              messageType: data.type,
            },
            { code: SERVER_ERROR_CODES.AUTHENTICATION },
          );
          break;
        }
        session.pendingJoinNonces.delete(tokenCheck.claims.joinNonce);

        if (session.state.phase !== "LOBBY") {
          sendError(ws, "Game already in progress.", {
            requestId,
            messageType: data.type,
            sessionId: connectionContext.currentSessionId,
          });
          break;
        }

        const maxPlayers = MAX_PLAYERS[session.gameType] || 10;
        if (session.state.players.length >= maxPlayers) {
          sendError(ws, `Lobby is full (${maxPlayers} players max).`, {
            requestId,
            messageType: data.type,
            sessionId: connectionContext.currentSessionId,
          });
          break;
        }

        const trimmedName = data.player.name.trim();
        const nameLower = trimmedName.toLowerCase();
        if (
          session.state.players.some((p) => p.name.toLowerCase() === nameLower)
        ) {
          sendError(ws, "That name is already taken.", {
            requestId,
            messageType: data.type,
          });
          break;
        }

        const generatePlayerId = () => crypto.randomBytes(6).toString("hex");
        let playerId = generatePlayerId();
        while (session.state.players.some((p) => p.id === playerId)) {
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
        bindSocketToPlayer(
          connectionContext.currentSessionId,
          session,
          playerId,
        );
        serverContext.ensureValidHost(session);
        serverContext.ensureLifecycleForCurrentState(
          connectionContext.currentSessionId,
          session,
          "player-joined-lobby",
        );
        sendAck(ws, {
          requestId,
          messageType: data.type,
          stateVersion: session.stateVersion,
        });
        serverContext.broadcastState(connectionContext.currentSessionId);
        break;
      }

      case "REQUEST_SEAT_TRANSFER": {
        if (!session || !connectionContext.currentSessionId) {
          sendError(ws, "Join a session first.", {
            requestId,
            messageType: data.type,
          });
          break;
        }
        if (
          connectionContext.myRole !== "SPECTATOR" ||
          connectionContext.myPlayerId
        ) {
          sendError(
            ws,
            "Only spectators can request seat transfer.",
            { requestId, messageType: data.type },
            { code: SERVER_ERROR_CODES.AUTHORIZATION },
          );
          break;
        }
        const transferToken = crypto.randomBytes(24).toString("hex");
        const requestedAtEpochMs = Date.now();
        const expiresAt = requestedAtEpochMs + SEAT_TRANSFER_TOKEN_TTL_MS;
        const requestedBy = data.displayName?.trim() || "Spectator";
        session.pendingSeatTransfers.set(transferToken, {
          ws,
          requestedBy,
          requestedAtEpochMs,
          expiresAt,
        });

        const event = {
          type: "SEAT_TRANSFER_REQUEST" as const,
          transferToken,
          requestedBy,
          requestedAtEpochMs,
          expiresAtEpochMs: expiresAt,
          requestId,
        };

        for (const [clientWs, pid] of session.clients.entries()) {
          if (
            pid === session.hostPlayerId &&
            clientWs.readyState === WebSocket.OPEN
          ) {
            sendServerEvent(clientWs, event);
          }
        }
        sendServerEvent(ws, event);
        sendAck(ws, {
          requestId,
          messageType: data.type,
          stateVersion: session.stateVersion,
        });
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
        if (!session || !connectionContext.currentSessionId) {
          sendError(ws, "Join a session first.", {
            requestId,
            messageType: data.type,
          });
          break;
        }
        if (
          !connectionContext.myPlayerId ||
          (connectionContext.myRole !== "HOST" &&
            connectionContext.myRole !== "PLAYER")
        ) {
          sendError(ws, "Join the lobby before sending actions.", {
            requestId,
            messageType: data.type,
          });
          break;
        }
        const latestEpoch =
          session.connectionEpochByPlayer[connectionContext.myPlayerId] ?? 0;
        if (connectionContext.myConnectionEpoch !== latestEpoch) {
          sendError(ws, "Stale connection. Reconnect and try again.", {
            requestId,
            messageType: data.type,
          });
          sendCurrentStateToSocket();
          break;
        }

        const dispatch = (
          actionData: Record<string, unknown>,
          shouldSendActionError = false,
        ) => {
          const liveSession = connectionContext.currentSessionId
            ? serverContext.sessions[connectionContext.currentSessionId]
            : null;
          if (!liveSession || !connectionContext.currentSessionId) {
            return;
          }
          const result = dispatchGameAction(
            liveSession.gameType,
            liveSession.state,
            actionData,
            { broadcastState: serverContext.broadcastState, dispatch },
          );

          if (result.error && shouldSendActionError) {
            sendError(ws, result.error, {
              sessionId: connectionContext.currentSessionId,
              playerId: connectionContext.myPlayerId,
              messageType: data.type,
              requestId,
            });
          } else if (result.state) {
            liveSession.state = capMoveLog(result.state);
            liveSession.lastActionTimestamp = Date.now();
            liveSession.stateVersion += 1;
            serverContext.ensureValidHost(liveSession);
            serverContext.ensureLifecycleForCurrentState(
              connectionContext.currentSessionId,
              liveSession,
              "game-action",
            );
            sendAck(ws, {
              requestId,
              messageType: data.type,
              stateVersion: liveSession.stateVersion,
            });
            serverContext.broadcastState(connectionContext.currentSessionId);
          }
        };

        if (data.type === "START_GAME") {
          if (
            connectionContext.myRole !== "HOST" ||
            connectionContext.myPlayerId !== session.hostPlayerId
          ) {
            sendError(ws, "Only the host can start the game.", {
              requestId,
              messageType: data.type,
            });
            break;
          }
        }

        dispatch({ ...data, actorId: connectionContext.myPlayerId }, true);
        break;
      }

      case "HOST_ACTION": {
        if (!session || !connectionContext.currentSessionId) {
          sendError(ws, "Join a session first.", {
            requestId,
            messageType: data.type,
          });
          break;
        }
        if (
          connectionContext.myRole !== "HOST" ||
          connectionContext.myPlayerId !== session.hostPlayerId
        ) {
          sendError(ws, "Only the host can perform administrative actions.", {
            requestId,
            messageType: data.type,
          });
          break;
        }

        handleHostAction(
          ws,
          data,
          session,
          connectionContext.currentSessionId,
          connectionContext.myPlayerId,
          requestId,
          serverContext,
        );
        break;
      }
    }
  } catch (error) {
    const isSyntaxError = error instanceof SyntaxError;
    metrics.increment("ws_rejected_total", 1, {
      reason: isSyntaxError ? "invalid_json" : "internal",
    });
    sendError(
      ws,
      isSyntaxError ? "Invalid JSON payload." : "Message processing failed.",
      {
        sessionId: connectionContext.currentSessionId ?? undefined,
        playerId: connectionContext.myPlayerId,
      },
      {
        code: isSyntaxError
          ? SERVER_ERROR_CODES.VALIDATION
          : SERVER_ERROR_CODES.INTERNAL,
      },
    );
  }
}
