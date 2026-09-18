/**
 * Coordinates Resident listing and search operations.
 *
 * T05 separates application/query decisions from persistence queries:
 *
 *   - This service decides how to treat the submitted search text
 *     (trimming it, and treating a blank search as a plain listing).
 *   - The T03 ResidentRepository performs the actual database query,
 *     ordering, and row-to-Resident mapping through SQL.
 *
 * The service contains no SQL and no in-memory Resident collections —
 * every non-blank search is executed by the persistence layer.
 */
export class ResidentQueryService {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * List all persisted Residents.
   *
   * @returns {Resident[]} All persisted Resident records.
   */
  listResidents() {
    return this.repository.listResidents();
  }

  /**
   * Search persisted Residents by first name or last name.
   *
   * Leading and trailing whitespace in the search term is ignored.
   * A search that is blank after trimming behaves as a normal listing
   * of all Residents.
   *
   * @param {string|null|undefined} searchTerm - The name text to search for.
   * @returns {Resident[]} Matching Resident records (or all when blank).
   */
  searchResidents(searchTerm) {
    const normalized = String(searchTerm ?? "").trim();

    if (normalized.length === 0) {
      return this.listResidents();
    }

    return this.repository.searchResidents(normalized);
  }
}