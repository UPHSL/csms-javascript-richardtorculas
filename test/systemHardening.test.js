import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import request from "supertest";

import { createApp } from "../src/app.js";
import { Resident } from "../src/models/Resident.js";
import { ServiceRequest } from "../src/models/ServiceRequest.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ServiceRequestRepository }
  from "../src/repositories/ServiceRequestRepository.js";
import { ResidentRegistrationService }
  from "../src/services/ResidentRegistrationService.js";
import { ResidentUpdateService } from "../src/services/ResidentUpdateService.js";
import { ResidentValidator } from "../src/services/ResidentValidator.js";
import { ServiceRequestSubmissionService }
  from "../src/services/ServiceRequestSubmissionService.js";
import { ServiceRequestValidator }
  from "../src/services/ServiceRequestValidator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t15-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Build the real application over a temporary database, plus the existing
// business services used to arrange test data.
function createHardeningSetup() {
  const databasePath = createTemporaryDatabasePath();
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);
  const residentValidator = new ResidentValidator();

  return {
    databasePath,
    app: createApp({ residentRepository, serviceRequestRepository }),
    residentRepository,
    serviceRequestRepository,
    registrationService: new ResidentRegistrationService(
      residentValidator,
      residentRepository
    ),
    updateService: new ResidentUpdateService(residentValidator, residentRepository),
    submissionService: new ServiceRequestSubmissionService(
      new ServiceRequestValidator(),
      serviceRequestRepository,
      residentRepository
    ),
    cleanup() {
      residentRepository.close();
      serviceRequestRepository.close();

      if (fs.existsSync(databasePath)) {
        fs.unlinkSync(databasePath);
      }
    }
  };
}

// Persist a Resident through the established T04 registration capability.
function registerResident(setup, overrides = {}) {
  const result = setup.registrationService.registerResident(new Resident({
    firstName: "Maria",
    lastName: "Santos",
    address: "Barangay Santo Tomas",
    contactNumber: "09181234567",
    email: "maria@example.com",
    ...overrides
  }));

  assert.equal(result.success, true, "test Resident fixture must be valid");
  return result.resident;
}

// Persist a Service Request through the established T09 submission capability.
function submitRequest(setup, residentId, overrides = {}) {
  const result = setup.submissionService.submitServiceRequest(new ServiceRequest({
    residentId,
    serviceType: "Barangay Clearance",
    description: "Requesting barangay clearance for employment requirements.",
    dateRequested: "2026-11-01",
    ...overrides
  }));

  assert.equal(result.success, true, "test Service Request fixture must be valid");
  return result.serviceRequest;
}

// Complete persisted state, read back through the repositories.
function snapshot(setup) {
  return {
    residents: setup.residentRepository.listResidents(),
    serviceRequests: setup.serviceRequestRepository.listServiceRequests()
  };
}

// Ids shown in a rendered management table, in display order.
function renderedIds(html, basePath) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const pattern = new RegExp(`href="${basePath}/(\\d+)(?:/edit)?"`, "g");

  return [...new Set([...body.matchAll(pattern)].map((match) => Number(match[1])))];
}

// ---------------------------------------------------------------------------
// Category 1 - Invalid or malformed input
// ---------------------------------------------------------------------------

test("T15: malformed request bodies get a controlled 400 and change nothing", async () => {
  const setup = createHardeningSetup();

  try {
    const resident = registerResident(setup);
    const serviceRequest = submitRequest(setup, resident.id);
    const before = snapshot(setup);

    const targets = [
      "/residents/register",
      `/residents/${resident.id}/update`,
      "/service-requests"
    ];

    for (const url of targets) {
      const response = await request(setup.app)
        .post(url)
        .set("Content-Type", "application/json")
        .send('{"firstName": "Broken",');

      assert.equal(response.statusCode, 400, `${url} should reject malformed JSON`);
      assert.match(response.text, /<h1>Invalid Request<\/h1>/);
      assert.doesNotMatch(response.text, /SyntaxError|JSON\.parse|node_modules|at .*\.js/);
    }

    assert.deepEqual(snapshot(setup), before);
    assert.equal(
      setup.serviceRequestRepository.findById(serviceRequest.id).status,
      "Pending"
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Category 2 - Rejected mutation protects persistence
// ---------------------------------------------------------------------------

test("T15: a partly valid Resident update is rejected atomically on disk", async () => {
  const setup = createHardeningSetup();

  try {
    const resident = registerResident(setup);

    // Valid first name and email, but an invalid contact number.
    const result = setup.updateService.updateResident(resident.id, {
      firstName: "Mariana",
      lastName: "Santos",
      address: "Barangay San Isidro",
      contactNumber: "0918-123-4567",
      email: "mariana@example.com"
    });

    assert.equal(result.success, false);
    assert.deepEqual(result.errors, ["contactNumber"]);

    // Read back through a brand-new connection so the check reflects what is
    // actually stored in SQLite, not an object held in memory.
    const independentRepository = new ResidentRepository(setup.databasePath);

    try {
      assert.deepEqual(independentRepository.findById(resident.id), resident);
      assert.equal(independentRepository.countAll(), 1);
    } finally {
      independentRepository.close();
    }
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Category 3 - Read-only request safety
// ---------------------------------------------------------------------------

test("T15: hostile search text on read-only pages never mutates data", async () => {
  const setup = createHardeningSetup();

  try {
    const resident = registerResident(setup);
    registerResident(setup, { firstName: "Pedro", lastName: "Reyes" });
    const serviceRequest = submitRequest(setup, resident.id);
    const before = snapshot(setup);

    const hostileSearches = [
      "'; DELETE FROM residents; --",
      "x' OR '1'='1",
      "\"); UPDATE service_requests SET status = 'Completed'; --"
    ];

    for (const search of hostileSearches) {
      const residents = await request(setup.app).get("/residents").query({ search });
      const requests = await request(setup.app)
        .get("/service-requests")
        .query({ search, status: "Pending" });

      assert.equal(residents.statusCode, 200);
      assert.match(residents.text, /No Residents found\./);
      assert.equal(requests.statusCode, 200);
      assert.match(requests.text, /No Service Requests found\./);
    }

    for (const url of [
      "/dashboard",
      `/residents/${resident.id}/edit`,
      `/service-requests/${serviceRequest.id}`
    ]) {
      assert.equal((await request(setup.app).get(url)).statusCode, 200);
    }

    assert.deepEqual(snapshot(setup), before);
    assert.equal(setup.residentRepository.countAll(), 2);
    assert.deepEqual(setup.serviceRequestRepository.countByStatus(), { Pending: 1 });
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Category 4 - Cross-feature regression
// ---------------------------------------------------------------------------

test("T15: deactivating a Resident blocks new requests but not existing workflow", async () => {
  const setup = createHardeningSetup();

  try {
    const resident = registerResident(setup);
    const existing = submitRequest(setup, resident.id);

    // T12: deactivate through the Resident interface.
    await request(setup.app).post(`/residents/${resident.id}/deactivate`);

    // T13 + T09: a new submission for the now-Inactive Resident is refused.
    const submission = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send({
        residentId: String(resident.id),
        serviceType: "Certificate of Residency",
        description: "Needed for a bank account.",
        dateRequested: "2026-11-13"
      });

    assert.equal(submission.statusCode, 422);
    assert.match(submission.text, /Inactive Residents cannot submit new Service Requests\./);
    assert.equal(setup.serviceRequestRepository.countAll(), 1);

    // T10 + T13: the request submitted while Active still moves through
    // its workflow — deactivation does not freeze or delete it.
    await request(setup.app).post(`/service-requests/${existing.id}/start`);
    await request(setup.app).post(`/service-requests/${existing.id}/complete`);

    assert.deepEqual(
      setup.serviceRequestRepository.findById(existing.id),
      new ServiceRequest({ ...existing, status: "Completed" })
    );

    // T14: the dashboard reflects both modules' changes.
    const dashboard = await request(setup.app).get("/dashboard");
    const metric = (key) => Number(
      dashboard.text.match(
        new RegExp(`data-metric="${key}">[\\s\\S]*?stat-value">(\\d+)<`)
      )[1]
    );

    assert.equal(metric("residents-active"), 0);
    assert.equal(metric("residents-inactive"), 1);
    assert.equal(metric("service-requests-completed"), 1);
    assert.equal(metric("service-requests-open"), 0);
    assert.equal(metric("service-requests-total"), 1);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Category 5 - Boundary behavior
// ---------------------------------------------------------------------------

test("T15: LIKE wildcard characters in searches are matched literally", async () => {
  const setup = createHardeningSetup();

  try {
    const underscore = registerResident(setup, { firstName: "Jo_Ann", lastName: "Cruz" });
    const plain = registerResident(setup, { firstName: "Joann", lastName: "Reyes" });

    const discount = submitRequest(setup, underscore.id, {
      serviceType: "Senior Citizen Discount",
      description: "Apply the 50% discount."
    });
    submitRequest(setup, underscore.id, {
      serviceType: "Water Bill Assistance",
      description: "Bill of 500 pesos."
    });

    // "%" and "_" no longer act as "match anything" wildcards.
    const residentsByPercent = await request(setup.app)
      .get("/residents")
      .query({ search: "%" });
    assert.match(residentsByPercent.text, /No Residents found\./);

    const residentsByUnderscore = await request(setup.app)
      .get("/residents")
      .query({ search: "o_a" });
    assert.deepEqual(renderedIds(residentsByUnderscore.text, "/residents"), [underscore.id]);

    const requestsByPercent = await request(setup.app)
      .get("/service-requests")
      .query({ search: "50%" });
    assert.deepEqual(renderedIds(requestsByPercent.text, "/service-requests"), [discount.id]);

    // Ordinary T05/T11 partial, case-insensitive searching is unchanged.
    const residentsByName = await request(setup.app)
      .get("/residents")
      .query({ search: "  JOANN " });
    assert.deepEqual(renderedIds(residentsByName.text, "/residents"), [plain.id]);

    assert.equal(setup.residentRepository.searchResidents("jo").length, 2);
    assert.equal(setup.serviceRequestRepository.searchServiceRequests("BILL").length, 1);
  } finally {
    setup.cleanup();
  }
});
