import { Resident } from "../models/Resident.js";
import { openDatabase } from "../database/database.js";

/**
 * Handles persistence of Resident records using SQLite.
 *
 * Accepts an optional dbPath so that automated tests can supply a
 * temporary isolated database file instead of the default development one.
 */
export class ResidentRepository {
  /**
   * @param {string} [dbPath] - Path to the SQLite database file.
   *   When omitted the default development database is used.
   */
  constructor(dbPath) {
    this._db = openDatabase(dbPath);
  }

  /**
   * Persist a Resident to SQLite.
   *
   * Uses a prepared INSERT statement so that Resident data is never
   * concatenated directly into SQL — protecting against injection and
   * ensuring correct type handling for the contact_number text column.
   *
   * SQLite generates the id via AUTOINCREMENT.  After the insert the
   * generated id is read from lastInsertRowid and assigned back to the
   * resident so callers can see the database-assigned identifier.
   *
   * @param {Resident} resident - A Resident instance to save.
   * @returns {Resident} The same resident with its id now set.
   */
  save(resident) {
    const insert = this._db.prepare(`
      INSERT INTO residents
        (first_name, last_name, address, contact_number, email, status)
      VALUES
        (:firstName, :lastName, :address, :contactNumber, :email, :status)
    `);

    const result = insert.run({
      firstName:     resident.firstName,
      lastName:      resident.lastName,
      address:       resident.address,
      contactNumber: resident.contactNumber,
      email:         resident.email,
      status:        resident.status
    });

    resident.id = Number(result.lastInsertRowid);
    return resident;
  }

  /**
   * Retrieve a Resident by its database-generated identifier.
   *
   * Converts the raw SQLite row (snake_case columns) back into the
   * existing Resident domain model (camelCase properties).
   *
   * @param {number} residentId - The id to look up.
   * @returns {Resident|null} The matching Resident, or null when not found.
   */
  findById(residentId) {
    const query = this._db.prepare(`
      SELECT id, first_name, last_name, address, contact_number, email, status
      FROM   residents
      WHERE  id = :id
    `);

    const row = query.get({ id: residentId });

    if (!row) {
      return null;
    }

    return this._rowToResident(row);
  }

/**
   * Update the permitted editable information of an existing persisted Resident.
   *
   * T06 deliberately touches only the editable columns:
   *   first_name, last_name, address, contact_number, email
   *
   * The id and status columns are NOT part of the SET clause, so this
   * operation can never change a Resident's identity or its status.  The
   * UPDATE is always scoped by id (WHERE id = :id), so exactly one Resident
   * row is targeted and unrelated Residents are left untouched.  No unbounded
   * update is ever produced.
   *
   * Uses a prepared statement with bound parameters so Resident data is never
   * concatenated directly into SQL.  After the update the affected row is
   * re-read through findById so the returned Resident always reflects the
   * actual persisted state.
   *
   * @param {number} residentId - The id of the existing Resident to update.
   * @param {Resident} resident - A Resident whose editable fields supply the
   *   proposed updated values.
   * @returns {Resident|null} The updated persisted Resident, or null when no
   *   Resident exists for the supplied id.
   */
  update(residentId, resident) {
    const update = this._db.prepare(`
      UPDATE residents
      SET    first_name     = :firstName,
             last_name      = :lastName,
             address        = :address,
             contact_number = :contactNumber,
             email          = :email
      WHERE  id = :id
    `);

    update.run({
      id:           residentId,
      firstName:    resident.firstName,
      lastName:     resident.lastName,
      address:      resident.address,
      contactNumber: resident.contactNumber,
      email:        resident.email
    });

    return this.findById(residentId);
  }

  /**
   * List all persisted Residents in deterministic order.
   *
   * T05 requires predictable ordering independent of insertion order:
   * lastName ascending, then firstName ascending, then id ascending.
   * COLLATE NOCASE makes the ordering case-insensitive where possible.
   *
   * @returns {Resident[]} All Resident records, or an empty array when none.
   */
  listResidents() {
    const query = this._db.prepare(`
      SELECT id, first_name, last_name, address, contact_number, email, status
      FROM   residents
      ORDER BY last_name  COLLATE NOCASE ASC,
               first_name COLLATE NOCASE ASC,
               id ASC
    `);

    return query.all()
      .map((row) => this._rowToResident(row));
  }

  /**
   * Search persisted Residents by first name or last name.
   *
   * The search term is passed as a bound parameter, never concatenated
   * into the SQL text.  SQLite's LIKE is case-insensitive for ASCII, so
   * partial matches are case-insensitive by default.  Results use the
   * same deterministic ordering as listResidents().
   *
   * @param {string} searchTerm - Trimmed, non-blank name text to search for.
   * @returns {Resident[]} Matching Resident records, or an empty array.
   */
  searchResidents(searchTerm) {
    const query = this._db.prepare(`
      SELECT id, first_name, last_name, address, contact_number, email, status
      FROM   residents
      WHERE  first_name LIKE :pattern OR last_name LIKE :pattern
      ORDER BY last_name  COLLATE NOCASE ASC,
               first_name COLLATE NOCASE ASC,
               id ASC
    `);

    const pattern = `%${searchTerm}%`;

    return query.all({ pattern })
      .map((row) => this._rowToResident(row));
  }

  /**
   * Map a raw SQLite row to a Resident domain object.
   *
   * The database stores names in snake_case (first_name, last_name,
   * contact_number) while the Resident model uses camelCase.  This
   * method bridges that gap explicitly so the rest of the application
   * continues to work with resident.firstName, resident.contactNumber, etc.
   *
   * @param {object} row - A raw row returned by DatabaseSync.
   * @returns {Resident}
   * @private
   */
  _rowToResident(row) {
    return new Resident({
      id:            row.id,
      firstName:     row.first_name,
      lastName:      row.last_name,
      address:       row.address,
      contactNumber: row.contact_number,
      email:         row.email,
      status:        row.status
    });
  }

  /**
   * Close the underlying database connection.
   * Should be called when the repository is no longer needed —
   * especially important in tests to release file locks.
   */
  close() {
    this._db.close();
  }
}
