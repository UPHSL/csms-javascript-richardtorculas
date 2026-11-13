import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { ResidentRepository } from "./repositories/ResidentRepository.js";
import mainRoutes from "./routes/index.js";
import { createResidentRoutes } from "./routes/residentRoutes.js";
import { ResidentDeactivationService } from "./services/ResidentDeactivationService.js";
import { ResidentQueryService } from "./services/ResidentQueryService.js";
import { ResidentRegistrationService } from "./services/ResidentRegistrationService.js";
import { ResidentUpdateService } from "./services/ResidentUpdateService.js";
import { ResidentValidator } from "./services/ResidentValidator.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

/**
 * Build the existing T04-T07 Resident application services around a
 * single repository.  The repository is created on first use so that
 * starting the app (or importing it in tests) does not open the default
 * database until a Resident page is actually requested.
 *
 * @param {ResidentRepository} [residentRepository] Optional repository,
 *   e.g. one backed by a temporary database in automated tests.
 * @returns {() => object} Accessor returning the Resident services.
 */
function createResidentServices(residentRepository) {
  let services = null;

  return () => {
    if (services === null) {
      const repository = residentRepository ?? new ResidentRepository();
      const validator = new ResidentValidator();

      services = {
        registrationService: new ResidentRegistrationService(validator, repository),
        queryService: new ResidentQueryService(repository),
        updateService: new ResidentUpdateService(validator, repository),
        deactivationService: new ResidentDeactivationService(repository)
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
 *   the Resident Management interface.  Defaults to the development database.
 * @returns {import("express").Express} Configured Express application.
 */
export function createApp({ residentRepository } = {}) {
  const app = express();

  app.disable("x-powered-by");

  app.set("views", path.join(currentDirectory, "views"));
  app.set("view engine", "ejs");

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(currentDirectory, "..", "public")));

  app.use(mainRoutes);
  app.use(createResidentRoutes(createResidentServices(residentRepository)));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
