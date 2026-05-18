import type Database from "better-sqlite3";
import type { SqliteMigration } from "./migrations.js";

function migration001(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      gameType TEXT NOT NULL,
      state JSON NOT NULL,
      hostPlayerId TEXT,
      schemaVersion INTEGER NOT NULL DEFAULT 1,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migration002(db: Database.Database) {
  db.exec(`
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
}

function migration003(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seat_transfer_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      transferToken TEXT NOT NULL,
      sourcePlayerId TEXT NOT NULL,
      assignedAtEpochMs INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_seat_transfer_audit_session
      ON seat_transfer_audit(sessionId, assignedAtEpochMs DESC);
  `);
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    id: 1,
    name: "create-legacy-sessions",
    up: migration001,
  },
  {
    id: 2,
    name: "create-session-snapshots-events",
    up: migration002,
  },
  {
    id: 3,
    name: "create-seat-transfer-audit",
    up: migration003,
  },
];
