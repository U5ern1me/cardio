import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  SERVER_ERROR_CODES,
  type ServerErrorCode,
} from "../../src/shared/protocolContracts.js";
import { classifyError, logEvent } from "../infra/logger.js";
import { parseServerEvent, type ServerEvent } from "./schemas.js";

export interface ResponseContext {
  sessionId?: string;
  playerId?: string | null;
  messageType?: string;
  requestId?: string;
  reconnectTraceId?: string;
}

function mapErrorClassToCode(errorClass: string): ServerErrorCode {
  switch (errorClass) {
    case "RATE_LIMIT":
      return SERVER_ERROR_CODES.RATE_LIMIT;
    case "AUTH_TOKEN":
      return SERVER_ERROR_CODES.AUTHENTICATION;
    case "AUTH_ROLE":
      return SERVER_ERROR_CODES.AUTHORIZATION;
    case "STALE_STATE":
      return SERVER_ERROR_CODES.STALE_STATE;
    case "NOT_FOUND":
      return SERVER_ERROR_CODES.NOT_FOUND;
    case "VALIDATION":
    case "INVALID_JSON":
      return SERVER_ERROR_CODES.VALIDATION;
    default:
      return SERVER_ERROR_CODES.SESSION_STATE;
  }
}

export function sendServerEvent(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const enriched = {
    protocolVersion: PROTOCOL_VERSION,
    ...event,
  };
  const parsed = parseServerEvent(enriched);
  if (!parsed.ok) {
    logEvent("error", "ws.invalid_server_event_blocked", {
      errorClass: "SERVER_EVENT_SCHEMA",
      detail: parsed.error,
    });
    return;
  }
  ws.send(JSON.stringify(parsed.data));
}

export function sendAck(
  ws: WebSocket,
  args: {
    requestId?: string;
    messageType: string;
    ackType?: "RECEIVED" | "APPLIED";
    stateVersion?: number;
  },
) {
  if (!args.requestId) {
    return;
  }
  sendServerEvent(ws, {
    type: "ACK",
    requestId: args.requestId,
    ackType: args.ackType ?? "APPLIED",
    messageType: args.messageType,
    stateVersion: args.stateVersion,
  });
}

export function sendError(
  ws: WebSocket,
  message: string,
  context: ResponseContext = {},
  options: { retryable?: boolean; code?: ServerErrorCode } = {},
) {
  const errorClass = classifyError(message);
  const code = options.code ?? mapErrorClassToCode(errorClass);
  logEvent("warn", "ws.error", {
    sessionId: context.sessionId,
    playerId: context.playerId ?? undefined,
    messageType: context.messageType,
    reconnectTraceId: context.reconnectTraceId,
    errorClass,
    detail: message,
    requestId: context.requestId,
    protocolCode: code,
  });

  if (context.requestId) {
    sendServerEvent(ws, {
      type: "REJECT",
      requestId: context.requestId,
      code,
      message,
      retryable: options.retryable ?? false,
    });
  }

  // Backward-compatible error event for older clients.
  sendServerEvent(ws, { type: "ERROR", message, requestId: context.requestId });
}
