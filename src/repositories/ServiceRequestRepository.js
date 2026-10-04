import { ServiceRequest } from "../models/ServiceRequest.js";
import { openDatabase } from "../database/database.js";

/**
 * Handles persistence of Service Requests using SQLite.
 *
 * Accepts an optional dbPath so that automated tests can supply a
 * temporary isolated database file instead of the default development one.
 *
 * The repository does not decide whether a Resident exists, whether the
 * Resident is Active, or whether the Service Request information is valid —
 * those are application/validation responsibilities.
 */
export class ServiceRequestRepository {
  /**
   * @param {string} [dbPath] - Path to the SQLite database file.
   *   When omitted the default development database is used.
   */
  constructor(dbPath) {
    this._db = openDatabase(dbPath);
  }

  /**
   * Persist a Service Request to SQLite.
   *
   * Uses a prepared INSERT statement with bound parameters.  SQLite
   * generates the id via AUTOINCREMENT; after the insert the generated id is
   * read from lastInsertRowid and assigned back to the Service Request so
   * callers can see the database-assigned identifier.
   *
   * The date_requested column stores the request date in YYYY-MM-DD text.
   *
   * @param {ServiceRequest} serviceRequest - A Service Request instance to save.
   * @returns {ServiceRequest} The same Service Request with its id set.
   */
  save(serviceRequest) {
    const insert = this._db.prepare(`
      INSERT INTO service_requests
        (resident_id, service_type, description, date_requested, status)
      VALUES
        (:residentId, :serviceType, :description, :dateRequested, :status)
    `);

    const result = insert.run({
      residentId:   serviceRequest.residentId,
      serviceType:  serviceRequest.serviceType,
      description:  serviceRequest.description,
      dateRequested: this._toTextDate(serviceRequest.dateRequested),
      status:       serviceRequest.status
    });

    serviceRequest.id = Number(result.lastInsertRowid);
    return serviceRequest;
  }

  /**
   * Retrieve a Service Request by its database-generated identifier.
   *
   * @param {number} serviceRequestId - The id to look up.
   * @returns {ServiceRequest|null} The matching Service Request, or null
   *   when not found.
   */
  findById(serviceRequestId) {
    const query = this._db.prepare(`
      SELECT id, resident_id, service_type, description, date_requested, status
      FROM   service_requests
      WHERE  id = :id
    `);

    const row = query.get({ id: serviceRequestId });

    if (!row) {
      return null;
    }

    return this._rowToServiceRequest(row);
  }

  /**
   * Normalize a supported date value to YYYY-MM-DD text for storage.
   *
   * @param {Date|string} value - A Date object or an existing YYYY-MM-DD string.
   * @returns {string} The request date in YYYY-MM-DD format.
   * @private
   */
  _toTextDate(value) {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return value;
  }

  /**
   * Map a raw SQLite row to a ServiceRequest domain object.
   *
   * @param {object} row - A raw row returned by DatabaseSync.
   * @returns {ServiceRequest}
   * @private
   */
  _rowToServiceRequest(row) {
    return new ServiceRequest({
      id:           row.id,
      residentId:   row.resident_id,
      serviceType:  row.service_type,
      description:  row.description,
      dateRequested: row.date_requested,
      status:       row.status
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