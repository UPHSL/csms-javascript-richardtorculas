import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/**
 * Default database file path — stored under src/database/data/csms.db
 * relative to this module so it is predictable for development but easy
 * to override in tests by passing a different dbPath.
 */
const DEFAULT_DB_PATH = path.join(currentDirectory, "data", "csms.db");

/**
 * Open a SQLite database at the given path and ensure the residents table
 * exists.  Using CREATE TABLE IF NOT EXISTS means repeated calls are safe
 * and will never destroy existing rows.
 *
 * @param {string} [dbPath] - Absolute path to the SQLite file.
 *   Defaults to the development database path when omitted.
 * @returns {DatabaseSync} An open, initialised SQLite database connection.
 */
export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS residents (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name     TEXT    NOT NULL,
      last_name      TEXT    NOT NULL,
      address        TEXT    NOT NULL,
      contact_number TEXT    NOT NULL,
      email          TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'Active'
    )
  `);

  return db;
}
