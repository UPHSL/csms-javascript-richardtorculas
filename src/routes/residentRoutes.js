import { Router } from "express";

import { createResidentController } from "../controllers/residentController.js";

/**
 * Resident Management routes (T12).
 *
 * GET requests only read state.  Every state-changing operation uses POST,
 * and deactivation is a soft status change — never an HTTP or SQL DELETE.
 *
 * @param {() => object} getServices - Returns the Resident application services.
 * @returns {import("express").Router}
 */
export function createResidentRoutes(getServices) {
  const router = Router();
  const controller = createResidentController(getServices);

  router.get("/residents", controller.listResidents);
  router.get("/residents/register", controller.showRegistrationForm);
  router.post("/residents/register", controller.registerResident);
  router.get("/residents/:id/edit", controller.showEditForm);
  router.post("/residents/:id/update", controller.updateResident);
  router.post("/residents/:id/deactivate", controller.deactivateResident);

  return router;
}
