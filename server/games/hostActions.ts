import { WebSocket } from "ws";
import type { ClientMessage } from "../protocol/schemas.js";
import { sendAck, sendError, sendServerEvent } from "../protocol/respond.js";
import { SERVER_ERROR_CODES } from "../../src/shared/protocolContracts.js";
import { logEvent } from "../infra/logger.js";
import * as db from "../db.js";
import { issueReconnectToken, type SessionRole } from "../security/tokens.js";
import type { Session, ServerContext } from "../index.js";
import { createServerMove, prependServerMove } from "../state/moves.js";

export function handleHostAction(
  ws: WebSocket,
  data: Extract<ClientMessage, { type: "HOST_ACTION" }>,
  session: Session,
  currentSessionId: string,
  myPlayerId: string,
  requestId: string | undefined,
  serverContext: ServerContext,
) {
  const action = data.action;
  if (action === "END_GAME") {
    serverContext.transitionSessionLifecycle(
      currentSessionId,
      session,
      "ENDED",
      "host-ended-game",
    );
    db.markSessionDeleted(currentSessionId, "host-ended-game");
    for (const clientWs of session.clients.keys()) {
      sendError(clientWs, "The host has ended the game.");
      try {
        clientWs.close(1000, "Game ended by host");
      } catch (closeError) {
        logEvent("warn", "ws.host_end_game_close_failed", {
          sessionId: currentSessionId,
          errorClass: "SOCKET_CLOSE",
          detail: closeError instanceof Error ? closeError.message : "unknown close error",
        });
      }
    }
    sendAck(ws, {
      requestId,
      messageType: data.type,
      stateVersion: session.stateVersion,
    });
    delete serverContext.sessions[currentSessionId];
    serverContext.sessionOrchestrator.clearSession(currentSessionId);
  } else if (action === "KICK_PLAYER") {
    if (!data.targetId) {
      sendError(ws, "Invalid targetId.", {
        requestId,
        messageType: data.type,
      });
      return;
    }
    const targetId = data.targetId;
    if (targetId === myPlayerId) {
      sendError(ws, "Host cannot kick themselves.", {
        requestId,
        messageType: data.type,
      });
      return;
    }

    const removedIndex = session.state.players.findIndex(
      (p) => p.id === targetId,
    );
    if (removedIndex === -1) {
      sendError(ws, "Player not found.", {
        requestId,
        messageType: data.type,
      });
      return;
    }

    const nextPlayers = session.state.players.filter(
      (p) => p.id !== targetId,
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

    for (const [clientWs, pid] of session.clients.entries()) {
      if (pid === targetId) {
        sendError(clientWs, "You have been kicked by the host.");
        try {
          clientWs.close(1000, "Kicked by host");
        } catch (closeError) {
          logEvent("warn", "ws.kick_player_close_failed", {
            sessionId: currentSessionId,
            playerId: targetId,
            errorClass: "SOCKET_CLOSE",
            detail: closeError instanceof Error ? closeError.message : "unknown close error",
          });
        }
        session.clients.delete(clientWs);
      }
    }

    delete session.validReconnectVersions[targetId];
    delete session.connectionEpochByPlayer[targetId];
    serverContext.ensureValidHost(session, targetId);
    session.state = prependServerMove(
      session.state,
      createServerMove("Host removed a player from the session.", "Host"),
    );
    session.stateVersion += 1;
    serverContext.ensureLifecycleForCurrentState(
      currentSessionId,
      session,
      "host-kick-player",
    );
    session.lastActionTimestamp = Date.now();
    sendAck(ws, {
      requestId,
      messageType: data.type,
      stateVersion: session.stateVersion,
    });
    serverContext.broadcastState(currentSessionId);
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
      serverContext.ensureLifecycleForCurrentState(
        currentSessionId,
        session,
        "host-force-skip",
      );
      session.lastActionTimestamp = Date.now();
      sendAck(ws, {
        requestId,
        messageType: data.type,
        stateVersion: session.stateVersion,
      });
      serverContext.broadcastState(currentSessionId);
    }
  } else if (action === "REASSIGN_SEAT") {
    if (!data.targetId || !data.transferToken) {
      sendError(
        ws,
        "REASSIGN_SEAT requires targetId and transferToken.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.VALIDATION },
      );
      return;
    }
    const transferRequest = session.pendingSeatTransfers.get(
      data.transferToken,
    );
    if (!transferRequest || transferRequest.expiresAt <= Date.now()) {
      sendError(
        ws,
        "Seat transfer token has expired or is invalid.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.NOT_FOUND },
      );
      return;
    }
    if (session.clients.get(transferRequest.ws) !== "") {
      sendError(
        ws,
        "Seat transfer token is already claimed.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.CONFLICT },
      );
      return;
    }
    const targetPlayer = session.state.players.find(
      (p) => p.id === data.targetId,
    );
    if (!targetPlayer) {
      sendError(
        ws,
        "Target player was not found.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.NOT_FOUND },
      );
      return;
    }
    if (targetPlayer.isConnected !== false) {
      sendError(
        ws,
        "Seat can only be reassigned when the target player is disconnected.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.CONFLICT },
      );
      return;
    }
    const targetHasOpenSocket = Array.from(session.clients.entries()).some(
      ([clientWs, pid]) =>
        pid === data.targetId && clientWs.readyState === WebSocket.OPEN,
    );
    if (targetHasOpenSocket) {
      sendError(
        ws,
        "Target player already has an active connection.",
        { requestId, messageType: data.type },
        { code: SERVER_ERROR_CODES.CONFLICT },
      );
      return;
    }

    session.pendingSeatTransfers.delete(data.transferToken);
    const nextReconnectVersion =
      (session.validReconnectVersions[data.targetId] ?? 1) + 1;
    session.validReconnectVersions[data.targetId] = nextReconnectVersion;
    const targetRole: SessionRole =
      data.targetId === session.hostPlayerId ? "HOST" : "PLAYER";
    const reconnectToken = issueReconnectToken(
      currentSessionId,
      data.targetId,
      targetRole,
      nextReconnectVersion,
    );
    db.recordSeatTransferAudit(
      currentSessionId,
      data.transferToken,
      data.targetId,
    );
    sendServerEvent(transferRequest.ws, {
      type: "SEAT_TRANSFER_GRANTED",
      sessionId: currentSessionId,
      targetPlayerId: data.targetId,
      transferToken: data.transferToken,
      reconnectToken,
    });
    session.state = prependServerMove(
      session.state,
      createServerMove(
        `Host authorized seat transfer for player ${data.targetId}.`,
        "Host",
      ),
    );
    session.stateVersion += 1;
    session.lastActionTimestamp = Date.now();
    sendAck(ws, {
      requestId,
      messageType: data.type,
      stateVersion: session.stateVersion,
    });
    serverContext.broadcastState(currentSessionId);
  } else {
    sendError(ws, `Unsupported host action: ${action}`, {
      requestId,
      messageType: data.type,
    });
  }
}
