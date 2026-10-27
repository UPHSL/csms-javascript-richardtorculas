import test from "node:test";
import assert from "node:assert/strict";

import { ServiceRequest } from "../src/models/ServiceRequest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build a typical Service Request with sensible information.
// T08 is representation-only: no database, no validation, no persistence.
function makeServiceRequest(overrides = {}) {
  return new ServiceRequest({
    residentId: 25,
    serviceType: "Barangay Clearance",
    description: "Request for employment requirement",
    dateRequested: new Date("2026-09-25"),
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// T08 Tests
// ---------------------------------------------------------------------------

test("Test 1 - Service Request can be created", () => {
  const serviceRequest = makeServiceRequest();

  assert.ok(serviceRequest);
  assert.ok(serviceRequest instanceof ServiceRequest);
});

test("Test 2 - Service Request information is accessible", () => {
  const serviceRequest = makeServiceRequest();

  assert.equal(serviceRequest.residentId, 25);
  assert.equal(serviceRequest.serviceType, "Barangay Clearance");
  assert.equal(
    serviceRequest.description,
    "Request for employment requirement"
  );
  assert.equal(
    serviceRequest.dateRequested.toISOString(),
    new Date("2026-09-25").toISOString()
  );
});

test("Test 3 - Resident ID is preserved", () => {
  const serviceRequest = makeServiceRequest({ residentId: 25 });

  assert.equal(serviceRequest.residentId, 25);
});

test("Test 4 - new Service Request has an unassigned ID", () => {
  const serviceRequest = makeServiceRequest();

  assert.equal(serviceRequest.id, null);
});

test("Test 5 - new Service Request defaults to Pending", () => {
  const serviceRequest = makeServiceRequest();

  assert.equal(serviceRequest.status, "Pending");
});

test("Test 6 - Service Request information is independent between objects", () => {
  const first = makeServiceRequest({
    residentId: 25,
    serviceType: "Barangay Clearance",
    description: "Request for employment requirement",
    dateRequested: new Date("2026-09-25")
  });

  const second = makeServiceRequest({
    residentId: 40,
    serviceType: "Permit Request",
    description: "Request for a building permit",
    dateRequested: new Date("2026-09-26")
  });

  assert.equal(first.residentId, 25);
  assert.equal(first.serviceType, "Barangay Clearance");
  assert.equal(first.description, "Request for employment requirement");
  assert.equal(
    first.dateRequested.toISOString(),
    new Date("2026-09-25").toISOString()
  );

  assert.equal(second.residentId, 40);
  assert.equal(second.serviceType, "Permit Request");
  assert.equal(second.description, "Request for a building permit");
  assert.equal(
    second.dateRequested.toISOString(),
    new Date("2026-09-26").toISOString()
  );

  // Mutating one object must not leak into the other.
  first.description = "Updated first request";
  assert.equal(second.description, "Request for a building permit");
});

test("supplied status can be represented", () => {
  const serviceRequest = makeServiceRequest({
    status: "In Progress"
  });

  assert.equal(serviceRequest.status, "In Progress");
});

test("supplied ID can be represented after persistence assigns one", () => {
  const serviceRequest = makeServiceRequest({
    id: 7
  });

  assert.equal(serviceRequest.id, 7);
});