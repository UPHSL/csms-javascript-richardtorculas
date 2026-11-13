import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { ResidentRepository } from "./repositories/ResidentRepository.js";
import { ServiceRequestRepository } from "./repositories/ServiceRequestRepository.js";
import { createDashboardRoutes } from "./routes/dashboardRoutes.js";
import mainRoutes from "./routes/index.js";
import { createResidentRoutes } from "./routes/residentRoutes.js";
import { createServiceRequestRoutes } from "./routes/serviceRequestRoutes.js";
import { DashboardService } from "./services/DashboardService.js";
import { ResidentDeactivationService } from "./services/ResidentDeactivationService.js";
import { ResidentQueryService } from "./services/ResidentQueryService.js";
import { ResidentRegistrationService } from "./services/ResidentRegistrationService.js";
import { ResidentUpdateService } from "./services/ResidentUpdateService.js";
import { ResidentValidator } from "./services/ResidentValidator.js";
import { ServiceRequestQueryService } from "./services/ServiceRequestQueryService.js";
import { ServiceRequestStatusService } from "./services/ServiceRequestStatusService.js";
import { ServiceRequestSubmissionService }
  from "./services/ServiceRequestSubmissionService.js";
import { ServiceRequestValidator } from "./services/ServiceRequestValidator.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/**
 * Build the existing Resident (T04-T07) and Service Request (T09-T11)
 * application services, plus the read-only T14 DashboardService.
 * Repositories are created on first use so that
 * starting the app (or importing it in tests) does not open the default
 * database until a management page is actually requested.
 *
 * @param {object} repositories
 * @param {ResidentRepository} [repositories.residentRepository]
 * @param {ServiceRequestRepository} [repositories.serviceRequestRepository]
 * @returns {() => object} Accessor returning the application services.
 */
function createServiceRegistry({ residentRepository, serviceRequestRepository }) {
  let services = null;

  return () => {
    if (services === null) {
      const residents = residentRepository ?? new ResidentRepository();
      const serviceRequests = serviceRequestRepository ?? new ServiceRequestRepository();
      const residentValidator = new ResidentValidator();

      services = {
        registrationService: new ResidentRegistrationService(residentValidator, residents),
        queryService: new ResidentQueryService(residents),
        updateService: new ResidentUpdateService(residentValidator, residents),
        deactivationService: new ResidentDeactivationService(residents),
        serviceRequestSubmissionService: new ServiceRequestSubmissionService(
          new ServiceRequestValidator(),
          serviceRequests,
          residents
        ),
        serviceRequestStatusService: new ServiceRequestStatusService(serviceRequests),
        serviceRequestQueryService: new ServiceRequestQueryService(serviceRequests),
        dashboardService: new DashboardService(residents, serviceRequests)
      };
    }

    return services;
  };
}

/**
 * Create and configure the CSMS Express application.
 *
 * @param {object} [options]
 * @param {ResidentRepository} [options.residentRepository] Repository used by
 *   the management interfaces.  Defaults to the development database.
 * @param {ServiceRequestRepository} [options.serviceRequestRepository]
 *   Repository used by the Service Request interface.  Defaults to the
 *   development database.
 * @returns {import("express").Express} Configured Express application.
 */
export function createApp({ residentRepository, serviceRequestRepository } = {}) {
  const app = express();
  const getServices = createServiceRegistry({
    residentRepository,
    serviceRequestRepository
  });

  app.disable("x-powered-by");

  app.set("views", path.join(currentDirectory, "views"));
  app.set("view engine", "ejs");

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(currentDirectory, "..", "public")));

  app.use(mainRoutes);
  app.use(createDashboardRoutes(getServices));
  app.use(createResidentRoutes(getServices));
  app.use(createServiceRequestRoutes(getServices));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
