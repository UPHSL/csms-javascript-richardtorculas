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
