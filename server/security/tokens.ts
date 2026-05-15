import crypto from "crypto";

export type SessionRole = "HOST" | "PLAYER" | "SPECTATOR";
export type TokenKind = "invite" | "session" | "reconnect";

interface BaseTokenClaims {
  typ: TokenKind;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface InviteTokenClaims extends BaseTokenClaims {
  typ: "invite";
  capability: "JOIN_SESSION";
}

export interface SessionTokenClaims extends BaseTokenClaims {
  typ: "session";
  joinNonce: string;
  role: Exclude<SessionRole, "HOST">;
}

export interface ReconnectTokenClaims extends BaseTokenClaims {
  typ: "reconnect";
  pid: string;
  role: SessionRole;
  reconnectVersion: number;
}

type TokenClaims =
  | InviteTokenClaims
  | SessionTokenClaims
  | ReconnectTokenClaims;

const TOKEN_SECRET =
  process.env.CARDIO_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.CARDIO_TOKEN_SECRET) {
  console.warn(
    "CARDIO_TOKEN_SECRET is not set. Generated ephemeral token secret for this process.",
  );
}

const SESSION_TOKEN_TTL_SECONDS = 15 * 60;
const INVITE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const RECONNECT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadEncoded: string): string {
  return crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payloadEncoded)
    .digest("base64url");
}

function generateToken<T extends TokenClaims>(
  claims: Omit<T, "iat" | "exp" | "jti">,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(12).toString("hex"),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function issueInviteToken(sessionId: string): string {
  return generateToken<InviteTokenClaims>(
    {
      typ: "invite",
      sid: sessionId,
      capability: "JOIN_SESSION",
    },
    INVITE_TOKEN_TTL_SECONDS,
  );
}

export function issueSessionToken(
  sessionId: string,
  joinNonce: string,
  role: Exclude<SessionRole, "HOST"> = "PLAYER",
): string {
  return generateToken<SessionTokenClaims>(
    {
      typ: "session",
      sid: sessionId,
      joinNonce,
      role,
    },
    SESSION_TOKEN_TTL_SECONDS,
  );
}

export function issueReconnectToken(
  sessionId: string,
  playerId: string,
  role: SessionRole,
  reconnectVersion: number,
): string {
  return generateToken<ReconnectTokenClaims>(
    {
      typ: "reconnect",
      sid: sessionId,
      pid: playerId,
      role,
      reconnectVersion,
    },
    RECONNECT_TOKEN_TTL_SECONDS,
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isTokenClaims(value: unknown): value is TokenClaims {
  if (!value || typeof value !== "object") {
    return false;
  }
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.typ === "string" &&
    typeof claims.sid === "string" &&
    typeof claims.iat === "number" &&
    typeof claims.exp === "number" &&
    typeof claims.jti === "string"
  );
}

export function verifyToken<T extends TokenKind>(
  token: string,
  expectedKind: T,
):
  | { ok: true; claims: Extract<TokenClaims, { typ: T }> }
  | { ok: false; error: string } {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "Missing token." };
  }

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return { ok: false, error: "Malformed token." };
  }

  const expectedSignature = sign(payloadEncoded);
  if (!safeEqual(expectedSignature, signature)) {
    return { ok: false, error: "Invalid token signature." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(payloadEncoded));
  } catch {
    return { ok: false, error: "Malformed token payload." };
  }

  if (!isTokenClaims(parsed)) {
    return { ok: false, error: "Invalid token payload." };
  }

  const claims = parsed as TokenClaims;
  if (claims.typ !== expectedKind) {
    return { ok: false, error: "Unexpected token kind." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return { ok: false, error: "Token expired." };
  }

  return {
    ok: true,
    claims: claims as Extract<TokenClaims, { typ: T }>,
  };
}
