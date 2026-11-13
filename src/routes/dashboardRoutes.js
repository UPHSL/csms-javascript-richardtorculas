import { Router } from "express";

import { createDashboardController } from "../controllers/dashboardController.js";

/**
 * CSMS Dashboard routes (T14).  The dashboard is read-only, so only GET is
 * exposed.
 *
 * @param {() => object} getServices - Returns the application services.
 * @returns {import("express").Router}
 */
export function createDashboardRoutes(getServices) {
  const router = Router();
  const controller = createDashboardController(getServices);

  router.get("/dashboard", controller.showDashboard);

  return router;
}
