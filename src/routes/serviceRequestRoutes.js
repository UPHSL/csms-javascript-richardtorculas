import { Router } from "express";

import { createServiceRequestController }
  from "../controllers/serviceRequestController.js";

/**
 * Service Request Management routes (T13).
 *
 * GET requests only read state.  Submission and every workflow action use
 * POST, and each workflow action is a named T10 operation rather than an
 * unrestricted "set status" endpoint.
 *
 * @param {() => object} getServices - Returns the application services.
 * @returns {import("express").Router}
 */
export function createServiceRequestRoutes(getServices) {
  const router = Router();
  const controller = createServiceRequestController(getServices);

  router.get("/service-requests", controller.listServiceRequests);
  router.get("/service-requests/new", controller.showSubmissionForm);
  router.post("/service-requests", controller.submitServiceRequest);
  router.get("/service-requests/:id", controller.showServiceRequest);
  router.post("/service-requests/:id/start", controller.startProcessing);
  router.post("/service-requests/:id/complete", controller.completeServiceRequest);
  router.post("/service-requests/:id/cancel", controller.cancelServiceRequest);

  return router;
}
