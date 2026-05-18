import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SQLITE_MIGRATIONS } from "./migrationDefinitions.js";
import { applyMigrations, getAppliedMigrationIds } from "./migrations.js";

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table) as { name?: string } | undefined;
  return row?.name === table;
}

describe("sqlite migrations", () => {
  it("applies migrations and creates expected tables", () => {
    const db = new Database(":memory:");
    const report = applyMigrations(db, SQLITE_MIGRATIONS);
    expect(report.latestId).toBe(3);
    expect(tableExists(db, "schema_migrations")).toBe(true);
    expect(tableExists(db, "sessions")).toBe(true);
    expect(tableExists(db, "session_snapshots")).toBe(true);
    expect(tableExists(db, "session_events")).toBe(true);
    expect(tableExists(db, "seat_transfer_audit")).toBe(true);
    expect(getAppliedMigrationIds(db)).toEqual([1, 2, 3]);
    db.close();
  });

  it("is idempotent when re-applied", () => {
    const db = new Database(":memory:");
    applyMigrations(db, SQLITE_MIGRATIONS);
    const second = applyMigrations(db, SQLITE_MIGRATIONS);
    expect(second.appliedIds).toEqual([]);
    expect(getAppliedMigrationIds(db)).toEqual([1, 2, 3]);
    db.close();
  });
});
