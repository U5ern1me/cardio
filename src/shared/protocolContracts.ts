export const PROTOCOL_VERSION = 1 as const;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1 as const;
export const MAX_SUPPORTED_PROTOCOL_VERSION = 1 as const;

export const SERVER_ERROR_CODES = {
  VALIDATION: "VALIDATION",
  AUTHENTICATION: "AUTHENTICATION",
  AUTHORIZATION: "AUTHORIZATION",
  NOT_FOUND: "NOT_FOUND",
  STALE_STATE: "STALE_STATE",
  RATE_LIMIT: "RATE_LIMIT",
  SESSION_STATE: "SESSION_STATE",
  CONFLICT: "CONFLICT",
  INTERNAL: "INTERNAL",
  UNSUPPORTED_PROTOCOL: "UNSUPPORTED_PROTOCOL",
} as const;

export type ServerErrorCode =
  (typeof SERVER_ERROR_CODES)[keyof typeof SERVER_ERROR_CODES];

export interface ProtocolEnvelopeMetadata {
  protocolVersion?: number;
  requestId?: string;
  correlationId?: string;
}
