/**
 * Create the CSMS Dashboard presentation handlers (T14).
 *
 * The handler only asks the DashboardService for the current summary and
 * renders it.  It contains no SQL, no counting, and never changes data.
 *
 * @param {() => object} getServices - Returns the application services,
 *   including dashboardService.
 * @returns {object} Express request handlers.
 */
export function createDashboardController(getServices) {
  return {
    /**
     * GET /dashboard — show the read-only operational summary.
     */
    showDashboard(request, response) {
      const { dashboardService } = getServices();
      const summary = dashboardService.getSummary();

      response.status(200).render("dashboard", {
        title: "CSMS Dashboard",
        residents: summary.residents,
        serviceRequests: summary.serviceRequests,
        recentServiceRequests: summary.recentServiceRequests
      });
    }
  };
}
