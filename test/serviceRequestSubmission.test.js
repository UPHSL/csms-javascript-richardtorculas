import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { DatabaseSync } from "node:sqlite";

import { Resident } from "../src/models/Resident.js";
import { ServiceRequest } from "../src/models/ServiceRequest.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ServiceRequestRepository } from "../src/repositories/ServiceRequestRepository.js";
import { ServiceRequestValidator } from "../src/services/ServiceRequestValidator.js";
import { ServiceRequestSubmissionService }
  from "../src/services/ServiceRequestSubmissionService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t09-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Remove a temporary SQLite file after a test finishes.
function removeDatabase(databasePath) {
  if (fs.existsSync(databasePath)) {
    fs.unlinkSync(databasePath);
  }
}

// Build a valid Resident satisfying all T02 validation rules.
function makeValidResident(overrides = {}) {
  return new Resident({
    firstName: "Juan",
    lastName: "Dela Cruz",
    address: "Barangay Santo Tomas",
    contactNumber: "09171234567",
    email: "juan@example.com",
    status: "Active",
    ...overrides
  });
}

// Build a valid Service Request satisfying all T09 validation rules.
function makeValidServiceRequest(overrides = {}) {
  return new ServiceRequest({
    residentId: 25,
    serviceType: "Barangay Clearance",
    description: "Request for employment requirement",
    dateRequested: "2026-09-15",
    ...overrides
  });
}

// Assemble the T09 components against a temporary database.
function createSubmissionSetup() {
  const databasePath = createTemporaryDatabasePath();
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);
  const validator = new ServiceRequestValidator();
  const service = new ServiceRequestSubmissionService(
    validator,
    serviceRequestRepository,
    residentRepository
  );
  return {
    databasePath,
    residentRepository,
    serviceRequestRepository,
    validator,
    service
  };
}

// Count Service Request rows directly in SQLite (test-only).
function countServiceRequests(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const statement = database.prepare(
      "SELECT COUNT(*) AS count FROM service_requests"
    );
    const row = statement.get();
    return Number(row.count);
  } finally {
    database.close();
  }
}

// ---------------------------------------------------------------------------
// T09 Tests
// ---------------------------------------------------------------------------

test("Test 1 - valid Service Request submission succeeds", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, true);
    assert.ok(result.serviceRequest);
    assert.deepEqual(result.errors, []);
    assert.equal(result.residentNotFound, false);
    assert.equal(result.residentInactive, false);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 2 - submitted Service Request receives a generated ID", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    assert.equal(serviceRequest.id, null);

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, true);
    assert.equal(typeof result.serviceRequest.id, "number");
    assert.notEqual(result.serviceRequest.id, null);

    const secondRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "Certificate Request",
      description: "Second request for certificate"
    });
    const secondResult = setup.service.submitServiceRequest(secondRequest);
    assert.equal(secondResult.success, true);
    assert.notEqual(secondResult.serviceRequest.id, result.serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 3 - submitted Service Request is persisted and retrievable", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    const result = setup.service.submitServiceRequest(serviceRequest);
    assert.equal(result.success, true);

    const found = setup.serviceRequestRepository.findById(result.serviceRequest.id);
    assert.ok(found);
    assert.equal(found.id, result.serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 4 - submitted Service Request information is preserved", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    const result = setup.service.submitServiceRequest(serviceRequest);
    assert.equal(result.success, true);

    const found = setup.serviceRequestRepository.findById(result.serviceRequest.id);
    assert.ok(found);
    assert.equal(found.residentId, resident.id);
    assert.equal(found.serviceType, "Barangay Clearance");
    assert.equal(found.description, "Request for employment requirement");
    assert.equal(found.dateRequested, "2026-09-15");
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 5 - submitted Service Request status is Pending", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, true);
    assert.equal(result.serviceRequest.status, "Pending");

    const found = setup.serviceRequestRepository.findById(result.serviceRequest.id);
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 6 - blank service type fails validation", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "   "
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.ok(result.errors.includes("serviceType"));
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 7 - blank description fails validation", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      description: ""
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.ok(result.errors.includes("description"));
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 8 - invalid request does not reach persistence", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const countBefore = countServiceRequests(setup.databasePath);

    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "   ",
      description: ""
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    const countAfter = countServiceRequests(setup.databasePath);

    assert.equal(result.success, false);
    assert.equal(countAfter, countBefore);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 9 - nonexistent Resident prevents submission", () => {
  const setup = createSubmissionSetup();

  try {
    const countBefore = countServiceRequests(setup.databasePath);

    const serviceRequest = makeValidServiceRequest({ residentId: 999999 });

    const result = setup.service.submitServiceRequest(serviceRequest);

    const countAfter = countServiceRequests(setup.databasePath);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.deepEqual(result.errors, []);
    assert.equal(result.residentNotFound, true);
    assert.equal(result.residentInactive, false);
    assert.equal(countAfter, countBefore);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 10 - Inactive Resident cannot submit a new Service Request", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Inactive" }));
    const countBefore = countServiceRequests(setup.databasePath);

    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });

    const result = setup.service.submitServiceRequest(serviceRequest);

    const countAfter = countServiceRequests(setup.databasePath);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.deepEqual(result.errors, []);
    assert.equal(result.residentNotFound, false);
    assert.equal(result.residentInactive, true);
    assert.equal(countAfter, countBefore);

    const storedResident = setup.residentRepository.findById(resident.id);
    assert.equal(storedResident.status, "Inactive");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 11 - non-Pending initial status is rejected", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const countBefore = countServiceRequests(setup.databasePath);

    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      status: "Completed"
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    const countAfter = countServiceRequests(setup.databasePath);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.ok(result.errors.includes("status"));
    assert.equal(countAfter, countBefore);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 12 - Service Request persists across repository access", (t) => {
  const setup = createSubmissionSetup();

  t.after(() => {
    removeDatabase(setup.databasePath);
  });

  let savedId;
  let residentId;

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    residentId = resident.id;

    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "Certificate Request",
      description: "Request for a copy of the certificate"
    });

    const result = setup.service.submitServiceRequest(serviceRequest);
    assert.equal(result.success, true);
    savedId = result.serviceRequest.id;
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
  }

  const secondRepository = new ServiceRequestRepository(setup.databasePath);
  try {
    const found = secondRepository.findById(savedId);
    assert.ok(found);
    assert.equal(found.id, savedId);
    assert.equal(found.residentId, residentId);
    assert.equal(found.serviceType, "Certificate Request");
    assert.equal(found.description, "Request for a copy of the certificate");
    assert.equal(found.status, "Pending");
  } finally {
    secondRepository.close();
  }
});

test("Test 13 - submission does not modify the Resident", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({
      firstName: "Juan",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com",
      status: "Active"
    }));
    const originalId = resident.id;

    const serviceRequest = makeValidServiceRequest({ residentId: resident.id });
    const result = setup.service.submitServiceRequest(serviceRequest);
    assert.equal(result.success, true);

    const stored = setup.residentRepository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.id, originalId);
    assert.equal(stored.firstName, "Juan");
    assert.equal(stored.lastName, "Dela Cruz");
    assert.equal(stored.address, "Barangay Santo Tomas");
    assert.equal(stored.contactNumber, "09171234567");
    assert.equal(stored.email, "juan@example.com");
    assert.equal(stored.status, "Active");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("invalid or absent request date is rejected and not persisted", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const countBefore = countServiceRequests(setup.databasePath);

    const invalidText = makeValidServiceRequest({
      residentId: resident.id,
      dateRequested: "not-a-date"
    });
    const resultText = setup.service.submitServiceRequest(invalidText);
    assert.equal(resultText.success, false);
    assert.ok(resultText.errors.includes("dateRequested"));

    const invalidDateObject = makeValidServiceRequest({
      residentId: resident.id,
      dateRequested: new Date("invalid")
    });
    const resultDateObject = setup.service.submitServiceRequest(invalidDateObject);
    assert.equal(resultDateObject.success, false);
    assert.ok(resultDateObject.errors.includes("dateRequested"));

    const missingDate = makeValidServiceRequest({
      residentId: resident.id,
      dateRequested: undefined
    });
    const resultMissing = setup.service.submitServiceRequest(missingDate);
    assert.equal(resultMissing.success, false);
    assert.ok(resultMissing.errors.includes("dateRequested"));

    const countAfter = countServiceRequests(setup.databasePath);
    assert.equal(countAfter, countBefore);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("a valid Date object is persisted as YYYY-MM-DD request date", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));

    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      dateRequested: new Date("2026-09-15")
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    assert.equal(result.success, true);

    const found = setup.serviceRequestRepository.findById(result.serviceRequest.id);
    assert.equal(found.dateRequested, "2026-09-15");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("a Service Request with an assigned ID is not treated as a new submission", () => {
  const setup = createSubmissionSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const countBefore = countServiceRequests(setup.databasePath);

    const serviceRequest = makeValidServiceRequest({
      residentId: resident.id,
      id: 77
    });

    const result = setup.service.submitServiceRequest(serviceRequest);

    const countAfter = countServiceRequests(setup.databasePath);

    assert.equal(result.success, false);
    assert.equal(result.serviceRequest, null);
    assert.ok(result.errors.includes("id"));
    assert.equal(countAfter, countBefore);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("submission result distinguishes success, validation failure, not found, and inactive", () => {
  const setup = createSubmissionSetup();

  try {
    const activeResident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const inactiveResident = setup.residentRepository.save(makeValidResident({
      firstName: "Ana",
      email: "ana@example.com",
      contactNumber: "09171110001",
      status: "Inactive"
    }));

    const successful = setup.service.submitServiceRequest(
      makeValidServiceRequest({ residentId: activeResident.id })
    );

    const validationFailure = setup.service.submitServiceRequest(
      makeValidServiceRequest({ residentId: activeResident.id, serviceType: "" })
    );

    const notFound = setup.service.submitServiceRequest(
      makeValidServiceRequest({ residentId: 999999 })
    );

    const inactive = setup.service.submitServiceRequest(
      makeValidServiceRequest({ residentId: inactiveResident.id })
    );

    assert.equal(successful.success, true);
    assert.equal(successful.residentNotFound, false);
    assert.equal(successful.residentInactive, false);
    assert.deepEqual(successful.errors, []);

    assert.equal(validationFailure.success, false);
    assert.ok(validationFailure.errors.includes("serviceType"));
    assert.equal(validationFailure.residentNotFound, false);
    assert.equal(validationFailure.residentInactive, false);

    assert.equal(notFound.success, false);
    assert.equal(notFound.residentNotFound, true);
    assert.equal(notFound.residentInactive, false);
    assert.deepEqual(notFound.errors, []);

    assert.equal(inactive.success, false);
    assert.equal(inactive.residentNotFound, false);
    assert.equal(inactive.residentInactive, true);
    assert.deepEqual(inactive.errors, []);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});