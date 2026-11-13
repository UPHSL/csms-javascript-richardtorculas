import { createRequire } from "node:module";

/**
 * Shared CSMS application and server configuration.
 */

const require = createRequire(import.meta.url);

/**
 * package.json is the single source of truth for the release version.
 * npm, package-lock.json, and the running application all read the same
 * value, so a new release only needs `npm version <x.y.z>`.
 */
const { version } = require("../../package.json");

export const applicationConfig = Object.freeze({
  name: "Community Services Management System",
  shortName: "CSMS",
  version,
  currentSprint: "Sprint 0 - Developer Onboarding",
  technology: "JavaScript with Express.js"
});

export const serverConfig = Object.freeze({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000)
});
