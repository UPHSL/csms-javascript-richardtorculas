/**
 * Coordinates Service Request listing, viewing, searching, and filtering.
 *
 * T11 separates application/query decisions from persistence queries:
 *
 *   - This service decides how to treat the submitted search text
 *     (trimming it, and treating a blank search as a plain listing).
 *   - It validates status-filter values against the supported lifecycle
 *     states established in T10.
 *   - The ServiceRequestRepository performs the actual database queries,
 *     ordering, and row-to-ServiceRequest mapping through SQL.
 *
 * The service contains no SQL and no in-memory Service Request collections —
 * every non-blank search/filter is executed by the persistence layer.
 */
export class ServiceRequestQueryService {
  /**
   * Supported Service Request lifecycle statuses (T10).
   */
  static SUPPORTED_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];

  constructor(serviceRequestRepository) {
    this.serviceRequestRepository = serviceRequestRepository;
  }

  /**
   * List all persisted Service Requests.
   *
   * @returns {ServiceRequest[]} All persisted Service Request records.
   */
  listServiceRequests() {
    return this.serviceRequestRepository.listServiceRequests();
  }

  /**
   * View one Service Request by its ID.
   *
   * Reuses the T09 findById() repository capability.
   *
   * @param {number} serviceRequestId - The id to look up.
   * @returns {ServiceRequest|null} The matching Service Request, or null when not found.
   */
  viewServiceRequest(serviceRequestId) {
    return this.serviceRequestRepository.findById(serviceRequestId);
  }

  /**
   * Search Service Requests by text (serviceType OR description) and optionally
   * filter by status.
   *
   * Leading and trailing whitespace in the search term is ignored.
   * A search that is blank after trimming behaves as a normal listing
   * of all Service Requests (optionally filtered by status).
   *
   * @param {string|null|undefined} searchTerm - The text to search for.
   * @param {string|null|undefined} statusFilter - Optional status to filter by.
   * @returns {ServiceRequest[]} Matching Service Request records (or all when blank).
   */
  searchServiceRequests(searchTerm, statusFilter = null) {
    const normalized = String(searchTerm ?? "").trim();

    // Validate status filter if provided.
    if (statusFilter !== null && statusFilter !== undefined && statusFilter !== "") {
      if (!this.isSupportedStatus(statusFilter)) {
        throw new Error(`Unsupported status filter: ${statusFilter}`);
      }
    }

    // Blank search behaves as a normal listing (optionally filtered by status).
    if (normalized.length === 0) {
      if (statusFilter !== null && statusFilter !== undefined && statusFilter !== "") {
        return this.serviceRequestRepository.filterByStatus(statusFilter);
      }
      return this.listServiceRequests();
    }

    // Non-blank search: normalize statusFilter to null when empty.
    const filter = (statusFilter !== null && statusFilter !== undefined && statusFilter !== "")
      ? statusFilter
      : null;

    return this.serviceRequestRepository.searchServiceRequests(normalized, filter);
  }

  /**
   * Check whether a status is a supported Service Request lifecycle state.
   *
   * @param {string} status - The status to check.
   * @returns {boolean} True when the status is supported.
   */
  isSupportedStatus(status) {
    return ServiceRequestQueryService.SUPPORTED_STATUSES.includes(status);
  }
}