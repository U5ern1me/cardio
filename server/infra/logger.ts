export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  sessionId?: string;
  playerId?: string;
  lifecycleState?: string;
  lifecycleReason?: string;
  messageType?: string;
  errorClass?: string;
  reconnectTraceId?: string;
  latencyMs?: number;
  payloadBytes?: number;
  detail?: string;
  [key: string]: unknown;
}

interface StructuredLogEntry extends LogContext {
  ts: string;
  level: LogLevel;
  event: string;
}

function write(level: LogLevel, line: string) {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logEvent(
  level: LogLevel,
  event: string,
  context: LogContext = {},
) {
  const entry: StructuredLogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  write(level, JSON.stringify(entry));
}

export function classifyError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("rate limit")) return "RATE_LIMIT";
  if (normalized.includes("token")) return "AUTH_TOKEN";
  if (normalized.includes("stale")) return "STALE_STATE";
  if (normalized.includes("invalid json")) return "INVALID_JSON";
  if (normalized.includes("invalid")) return "VALIDATION";
  if (normalized.includes("not found")) return "NOT_FOUND";
  if (normalized.includes("host")) return "AUTH_ROLE";
  return "GENERAL";
}
