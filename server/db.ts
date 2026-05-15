import crypto from "crypto";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import type { GameType } from "../src/shared/types.js";
import type { SessionLifecycleState } from "./sessionLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "../sessions.db");
const db = new Database(dbPath);

const PERSISTENCE_SCHEMA_VERSION = 2;
const MAX_EVENTS_PER_SESSION = Number(
  process.env.CARDIO_EVENT_LOG_LIMIT ?? 2000,
);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    gameType TEXT NOT NULL,
    state JSON NOT NULL,
    hostPlayerId TEXT,
    schemaVersion INTEGER NOT NULL DEFAULT 1,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_snapshots (
    sessionId TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    schemaVersion INTEGER NOT NULL,
    payload TEXT NOT NULL,
    payloadChecksum TEXT NOT NULL,
    updatedAtEpochMs INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    eventType TEXT NOT NULL,
    payload TEXT,
    payloadChecksum TEXT,
    createdAtEpochMs INTEGER NOT NULL,
    UNIQUE(sessionId, sequence)
  );

  CREATE INDEX IF NOT EXISTS idx_session_events_session_sequence
    ON session_events(sessionId, sequence);
`);

export interface PersistedSessionEnvelope {
  sessionId: string;
  gameType: GameType;
  state: unknown;
  hostPlayerId: string | null;
  stateVersion: number;
  lifecycleState: SessionLifecycleState;
  lifecycleUpdatedAt: number;
  lifecycleReason: string;
  lastActionTimestamp: number;
  validReconnectVersions: Record<string, number>;
  connectionEpochByPlayer: Record<string, number>;
  inviteToken?: string;
  persistedAtEpochMs: number;
}

export interface RecoveryReport {
  sessions: PersistedSessionEnvelope[];
  corruptedSessionIds: string[];
  replayedFromEvents: number;
}

interface SnapshotRow {
  sessionId: string;
  sequence: number;
  schemaVersion: number;
  payload: string;
  payloadChecksum: string;
}

interface EventRow {
  sessionId: string;
  sequence: number;
  eventType: string;
  payload: string | null;
  payloadChecksum: string | null;
}

function checksum(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toStringRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) {
      output[key] = item;
    }
  }
  return output;
}

function parseEnvelopePayload(
  sessionId: string,
  schemaVersion: number,
  payload: string,
  payloadChecksum: string,
): PersistedSessionEnvelope | null {
  if (schemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
    return null;
  }
  if (checksum(payload) !== payloadChecksum) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const envelopeSessionId = toString(parsed.sessionId, sessionId);
  if (envelopeSessionId !== sessionId) {
    return null;
  }
  const gameType = toString(parsed.gameType) as GameType;
  if (!gameType) {
    return null;
  }
  const lifecycleState = toString(
    parsed.lifecycleState,
    "LOBBY",
  ) as SessionLifecycleState;
  const hostPlayerId =
    typeof parsed.hostPlayerId === "string" ? parsed.hostPlayerId : null;

  return {
    sessionId: envelopeSessionId,
    gameType,
    state: parsed.state ?? {},
    hostPlayerId,
    stateVersion: toNumber(parsed.stateVersion),
    lifecycleState,
    lifecycleUpdatedAt: toNumber(parsed.lifecycleUpdatedAt),
    lifecycleReason: toString(parsed.lifecycleReason, "recovered"),
    lastActionTimestamp: toNumber(parsed.lastActionTimestamp, Date.now()),
    validReconnectVersions: toStringRecord(parsed.validReconnectVersions),
    connectionEpochByPlayer: toStringRecord(parsed.connectionEpochByPlayer),
    inviteToken:
      typeof parsed.inviteToken === "string" ? parsed.inviteToken : undefined,
    persistedAtEpochMs: toNumber(parsed.persistedAtEpochMs, Date.now()),
  };
}

function toPersistablePayload(envelope: PersistedSessionEnvelope): string {
  return JSON.stringify({
    sessionId: envelope.sessionId,
    gameType: envelope.gameType,
    state: envelope.state,
    hostPlayerId: envelope.hostPlayerId,
    stateVersion: envelope.stateVersion,
    lifecycleState: envelope.lifecycleState,
    lifecycleUpdatedAt: envelope.lifecycleUpdatedAt,
    lifecycleReason: envelope.lifecycleReason,
    lastActionTimestamp: envelope.lastActionTimestamp,
    validReconnectVersions: envelope.validReconnectVersions,
    connectionEpochByPlayer: envelope.connectionEpochByPlayer,
    inviteToken: envelope.inviteToken,
    persistedAtEpochMs: envelope.persistedAtEpochMs,
  });
}

export function persistSessionSnapshot(
  envelope: PersistedSessionEnvelope,
  eventType: string,
): { ok: true; sequence: number } | { ok: false; error: string } {
  const safeEventType = eventType.slice(0, 80) || "state-update";
  const payload = toPersistablePayload(envelope);
  const payloadChecksum = checksum(payload);

  try {
    const txn = db.transaction(() => {
      const previous = db
        .prepare("SELECT sequence FROM session_snapshots WHERE sessionId = ?")
        .get(envelope.sessionId) as { sequence: number } | undefined;
      const nextSequence = (previous?.sequence ?? 0) + 1;
      const nowMs = Date.now();

      db.prepare(
        `
          INSERT INTO session_events (sessionId, sequence, eventType, payload, payloadChecksum, createdAtEpochMs)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        envelope.sessionId,
        nextSequence,
        safeEventType,
        payload,
        payloadChecksum,
        nowMs,
      );

      db.prepare(
        `
          INSERT INTO session_snapshots (sessionId, sequence, schemaVersion, payload, payloadChecksum, updatedAtEpochMs)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(sessionId) DO UPDATE SET
            sequence = excluded.sequence,
            schemaVersion = excluded.schemaVersion,
            payload = excluded.payload,
            payloadChecksum = excluded.payloadChecksum,
            updatedAtEpochMs = excluded.updatedAtEpochMs
        `,
      ).run(
        envelope.sessionId,
        nextSequence,
        PERSISTENCE_SCHEMA_VERSION,
        payload,
        payloadChecksum,
        nowMs,
      );

      db.prepare(
        `
          INSERT INTO sessions (id, gameType, state, hostPlayerId, schemaVersion, updatedAt)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            gameType = excluded.gameType,
            state = excluded.state,
            hostPlayerId = excluded.hostPlayerId,
            schemaVersion = excluded.schemaVersion,
            updatedAt = CURRENT_TIMESTAMP
        `,
      ).run(
        envelope.sessionId,
        envelope.gameType,
        JSON.stringify(envelope.state),
        envelope.hostPlayerId,
        PERSISTENCE_SCHEMA_VERSION,
      );

      if (nextSequence > MAX_EVENTS_PER_SESSION) {
        db.prepare(
          `
            DELETE FROM session_events
            WHERE sessionId = ? AND sequence <= ?
          `,
        ).run(envelope.sessionId, nextSequence - MAX_EVENTS_PER_SESSION);
      }

      return nextSequence;
    });

    const sequence = txn();
    return { ok: true, sequence };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown persistence error";
    return { ok: false, error: message };
  }
}

export function markSessionDeleted(
  sessionId: string,
  reason = "session-deleted",
) {
  try {
    const txn = db.transaction(() => {
      const previous = db
        .prepare("SELECT sequence FROM session_snapshots WHERE sessionId = ?")
        .get(sessionId) as { sequence: number } | undefined;
      const nextSequence = (previous?.sequence ?? 0) + 1;
      const nowMs = Date.now();

      db.prepare(
        `
          INSERT INTO session_events (sessionId, sequence, eventType, payload, payloadChecksum, createdAtEpochMs)
          VALUES (?, ?, ?, NULL, NULL, ?)
        `,
      ).run(sessionId, nextSequence, reason.slice(0, 80), nowMs);

      db.prepare("DELETE FROM session_snapshots WHERE sessionId = ?").run(
        sessionId,
      );
      db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    });
    txn();
  } catch {
    // keep runtime behavior resilient even when persistence delete fails
  }
}

function readSnapshot(sessionId: string): SnapshotRow | undefined {
  return db
    .prepare(
      `
        SELECT sessionId, sequence, schemaVersion, payload, payloadChecksum
        FROM session_snapshots
        WHERE sessionId = ?
      `,
    )
    .get(sessionId) as SnapshotRow | undefined;
}

function readEvents(sessionId: string, afterSequence: number): EventRow[] {
  return db
    .prepare(
      `
        SELECT sessionId, sequence, eventType, payload, payloadChecksum
        FROM session_events
        WHERE sessionId = ? AND sequence > ?
        ORDER BY sequence ASC
      `,
    )
    .all(sessionId, afterSequence) as EventRow[];
}

export function recoverSession(
  sessionId: string,
): PersistedSessionEnvelope | null {
  const snapshot = readSnapshot(sessionId);
  let recovered: PersistedSessionEnvelope | null = null;
  let fromSequence = 0;
  let deleted = false;

  if (snapshot) {
    recovered = parseEnvelopePayload(
      snapshot.sessionId,
      snapshot.schemaVersion,
      snapshot.payload,
      snapshot.payloadChecksum,
    );
    if (recovered) {
      fromSequence = snapshot.sequence;
    }
  }

  const events = readEvents(sessionId, fromSequence);
  for (const eventRow of events) {
    if (
      eventRow.eventType === "session-deleted" ||
      eventRow.eventType === "host-ended-game"
    ) {
      deleted = true;
      recovered = null;
      continue;
    }
    if (!eventRow.payload || !eventRow.payloadChecksum) {
      continue;
    }
    const parsed = parseEnvelopePayload(
      eventRow.sessionId,
      PERSISTENCE_SCHEMA_VERSION,
      eventRow.payload,
      eventRow.payloadChecksum,
    );
    if (parsed) {
      recovered = parsed;
      deleted = false;
    }
  }

  if (deleted) {
    return null;
  }
  return recovered;
}

export function recoverAllSessions(): RecoveryReport {
  const ids = db
    .prepare(
      `
        SELECT sessionId as id FROM session_snapshots
        UNION
        SELECT DISTINCT sessionId as id FROM session_events
      `,
    )
    .all() as Array<{ id: string }>;

  const sessions: PersistedSessionEnvelope[] = [];
  const corruptedSessionIds: string[] = [];
  let replayedFromEvents = 0;

  for (const { id } of ids) {
    const snapshot = readSnapshot(id);
    const recovered = recoverSession(id);
    if (!recovered) {
      if (snapshot) {
        corruptedSessionIds.push(id);
      }
      continue;
    }
    const snapshotEnvelope = snapshot
      ? parseEnvelopePayload(
          snapshot.sessionId,
          snapshot.schemaVersion,
          snapshot.payload,
          snapshot.payloadChecksum,
        )
      : null;
    if (!snapshotEnvelope && snapshot) {
      replayedFromEvents += 1;
      corruptedSessionIds.push(id);
    }
    sessions.push(recovered);
  }

  return { sessions, corruptedSessionIds, replayedFromEvents };
}

// Legacy-compatible wrappers retained for callers not yet migrated.
export function saveSession(
  sessionId: string,
  gameType: string,
  state: unknown,
  hostPlayerId: string | null,
) {
  persistSessionSnapshot(
    {
      sessionId,
      gameType: gameType as GameType,
      state,
      hostPlayerId,
      stateVersion: 0,
      lifecycleState: "LOBBY",
      lifecycleUpdatedAt: Date.now(),
      lifecycleReason: "legacy-save",
      lastActionTimestamp: Date.now(),
      validReconnectVersions: {},
      connectionEpochByPlayer: {},
      persistedAtEpochMs: Date.now(),
    },
    "legacy-save",
  );
}

export function loadSession(sessionId: string) {
  const recovered = recoverSession(sessionId);
  if (!recovered) {
    return null;
  }
  return {
    id: recovered.sessionId,
    gameType: recovered.gameType,
    state: recovered.state,
    hostPlayerId: recovered.hostPlayerId,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
  };
}

export function deleteSession(sessionId: string) {
  markSessionDeleted(sessionId, "session-deleted");
}

export function getAllSessions() {
  return recoverAllSessions().sessions.map((session) => ({
    id: session.sessionId,
    gameType: session.gameType,
    state: session.state,
    hostPlayerId: session.hostPlayerId,
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
  }));
}

export function __dangerouslyCorruptSnapshotForTest(sessionId: string) {
  db.prepare(
    `
      UPDATE session_snapshots
      SET payload = ?, payloadChecksum = ?
      WHERE sessionId = ?
    `,
  ).run("{bad-json", "bad-checksum", sessionId);
}
