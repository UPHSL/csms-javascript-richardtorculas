/**
 * Number of recent Service Requests shown on the dashboard.
 */
export const RECENT_SERVICE_REQUEST_LIMIT = 5;

/**
 * Composes the read-only CSMS operational summary (T14).
 *
 *   Dashboard Controller
 *     -> DashboardService
 *          -> ResidentRepository        (COUNT / GROUP BY status)
 *          -> ServiceRequestRepository  (COUNT / GROUP BY status / recent LIMIT)
 *
 * All counting, grouping, ordering, and limiting is done by the database.
 * This service only combines those results and derives Open Service
 * Requests (Pending + In Progress) — Open is never stored as a status.
 *
 * The service is read-only: it never validates, registers, updates,
 * deactivates, submits, or changes the status of anything, and it contains
 * no SQL and no HTML.
 */
export class DashboardService {
  constructor(residentRepository, serviceRequestRepository) {
    this.residentRepository = residentRepository;
    this.serviceRequestRepository = serviceRequestRepository;
  }

  /**
   * Build the current dashboard summary from persisted data.
   *
   * @returns {{
   *   residents: { total: number, active: number, inactive: number },
   *   serviceRequests: {
   *     total: number, open: number, pending: number,
   *     inProgress: number, completed: number, cancelled: number
   *   },
   *   recentServiceRequests: ServiceRequest[]
   * }}
   */
  getSummary() {
    return {
      residents: this.getResidentSummary(),
      serviceRequests: this.getServiceRequestSummary(),
      recentServiceRequests: this.serviceRequestRepository.findRecent(
        RECENT_SERVICE_REQUEST_LIMIT
      )
    };
  }

  /**
   * Resident totals from database-level aggregation.
   */
  getResidentSummary() {
    const byStatus = this.residentRepository.countByStatus();

    return {
      total: this.residentRepository.countAll(),
      active: byStatus["Active"] ?? 0,
      inactive: byStatus["Inactive"] ?? 0
    };
  }

  /**
   * Service Request totals from database-level aggregation, plus the
   * derived Open count.
   */
  getServiceRequestSummary() {
    const byStatus = this.serviceRequestRepository.countByStatus();

    const pending = byStatus["Pending"] ?? 0;
    const inProgress = byStatus["In Progress"] ?? 0;

    return {
      total: this.serviceRequestRepository.countAll(),
      open: pending + inProgress,
      pending,
      inProgress,
      completed: byStatus["Completed"] ?? 0,
      cancelled: byStatus["Cancelled"] ?? 0
    };
  }
}
