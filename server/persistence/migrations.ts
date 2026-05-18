import type Database from "better-sqlite3";

export interface SqliteMigration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

export interface MigrationReport {
  appliedIds: number[];
  latestId: number;
}

function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAtEpochMs INTEGER NOT NULL
    );
  `);
}

export function applyMigrations(
  db: Database.Database,
  migrations: readonly SqliteMigration[],
): MigrationReport {
  ensureMigrationTable(db);
  const rows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{ id: number }>;
  const applied = new Set(rows.map((row) => row.id));
  const appliedIds: number[] = [];

  const tx = db.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        continue;
      }
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migrations (id, name, appliedAtEpochMs) VALUES (?, ?, ?)",
      ).run(migration.id, migration.name, Date.now());
      appliedIds.push(migration.id);
    }
  });
  tx();

  const latestId =
    migrations.length > 0 ? migrations[migrations.length - 1].id : 0;
  return { appliedIds, latestId };
}

export function getAppliedMigrationIds(db: Database.Database): number[] {
  ensureMigrationTable(db);
  const rows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{ id: number }>;
  return rows.map((row) => row.id);
}
