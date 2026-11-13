import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

import request from "supertest";

import { createApp } from "../src/app.js";
import { applicationConfig } from "../src/config/application.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ServiceRequestRepository }
  from "../src/repositories/ServiceRequestRepository.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const RELEASE_VERSION = "1.0.0";

// Build the application over a temporary database so rendering the
// management pages never touches the development database.
function createReleaseSetup() {
  const databasePath = path.join(
    os.tmpdir(),
    `csms-t16-release-${crypto.randomUUID()}.sqlite`
  );
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);

  return {
    app: createApp({ residentRepository, serviceRequestRepository }),
    cleanup() {
      residentRepository.close();
      serviceRequestRepository.close();

      if (fs.existsSync(databasePath)) {
        fs.unlinkSync(databasePath);
      }
    }
  };
}

test("T16: package.json is the single source of the 1.0.0 release version", () => {
  assert.equal(packageJson.version, RELEASE_VERSION);
  assert.equal(applicationConfig.version, packageJson.version);
  assert.equal(applicationConfig.name, "Community Services Management System");
  assert.equal(applicationConfig.shortName, "CSMS");
});

test("T16: /health reports CSMS, version 1.0.0, and ok status — nothing more", async () => {
  const setup = createReleaseSetup();

  try {
    const response = await request(setup.app).get("/health");

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /application\/json/);
    assert.deepEqual(response.body, {
      status: "ok",
      application: "Community Services Management System",
      version: RELEASE_VERSION
    });

    // No internal details such as paths, environment values, or secrets.
    assert.doesNotMatch(
      response.text,
      /[A-Za-z]:\\|\/home\/|\.sqlite|password|secret|token|env|stack/i
    );
  } finally {
    setup.cleanup();
  }
});

test("T16: every browser page shows v1.0.0 and no other version", async () => {
  const setup = createReleaseSetup();

  try {
    const pages = [
      "/dashboard",
      "/residents",
      "/residents/register",
      "/service-requests",
      "/service-requests/new",
      "/service-requests/999999"
    ];

    for (const url of pages) {
      const response = await request(setup.app).get(url);

      assert.match(
        response.text,
        /<footer class="app-footer">[\s\S]*Community Services Management System[\s\S]*<span class="release-version">v1\.0\.0<\/span>/,
        `${url} should show the release footer`
      );
      assert.doesNotMatch(response.text, /0\.1\.0/, `${url} shows an old version`);
    }

    const home = await request(setup.app).get("/");
    assert.match(home.text, /<dd>1\.0\.0<\/dd>/);
    assert.doesNotMatch(home.text, /0\.1\.0/);
  } finally {
    setup.cleanup();
  }
});
