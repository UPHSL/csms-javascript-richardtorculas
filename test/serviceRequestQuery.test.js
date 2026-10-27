import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { Resident } from "../src/models/Resident.js";
import { ServiceRequest } from "../src/models/ServiceRequest.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ServiceRequestRepository } from "../src/repositories/ServiceRequestRepository.js";
import { ServiceRequestValidator } from "../src/services/ServiceRequestValidator.js";
import { ServiceRequestSubmissionService }
  from "../src/services/ServiceRequestSubmissionService.js";
import { ServiceRequestStatusService }
  from "../src/services/ServiceRequestStatusService.js";
import { ServiceRequestQueryService }
  from "../src/services/ServiceRequestQueryService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t11-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Remove a temporary SQLite file after a test finishes.
function removeDatabase(databasePath) {
  if (fs.existsSync(databasePath)) {
    fs.unlinkSync(databasePath);
  }
}

// Build a valid Resident satisfying the T02 validation rules.
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

// Build a valid Service Request satisfying the T09 validation rules.
function makeValidServiceRequest(overrides = {}) {
  return new ServiceRequest({
    residentId: 25,
    serviceType: "Barangay Clearance",
    description: "Request for employment requirement",
    dateRequested: "2026-09-15",
    ...overrides
  });
}

// Assemble the real T09 persistence + T10 status + T11 query components
// against a temporary database.
function createQuerySetup() {
  const databasePath = createTemporaryDatabasePath();
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);
  const validator = new ServiceRequestValidator();
  const submissionService = new ServiceRequestSubmissionService(
    validator,
    serviceRequestRepository,
    residentRepository
  );
  const statusService = new ServiceRequestStatusService(serviceRequestRepository);
  const queryService = new ServiceRequestQueryService(serviceRequestRepository);
  return {
    databasePath,
    residentRepository,
    serviceRequestRepository,
    submissionService,
    statusService,
    queryService
  };
}

function createActiveResident(setup, overrides = {}) {
  return setup.residentRepository.save(makeValidResident({
    status: "Active",
    ...overrides
  }));
}

// Persist a new Service Request through the real T09 submission path.
function submitServiceRequest(setup, overrides = {}) {
  const request = makeValidServiceRequest(overrides);
  const result = setup.submissionService.submitServiceRequest(request);
  assert.equal(result.success, true);
  return result.serviceRequest;
}

// Persist a new Service Request and move it through the T10 workflow until it
// reaches the requested status.
async function submitServiceRequestWithStatus(setup, status, overrides = {}) {
  const persisted = submitServiceRequest(setup, overrides);

  if (status === "Pending") {
    return persisted;
  }

  if (status === "In Progress") {
    const result = await setup.statusService.changeStatus(persisted.id, "In Progress");
    assert.equal(result.success, true);
    return result.serviceRequest;
  }

  if (status === "Completed") {
    let result = await setup.statusService.changeStatus(persisted.id, "In Progress");
    assert.equal(result.success, true);
    result = await setup.statusService.changeStatus(persisted.id, "Completed");
    assert.equal(result.success, true);
    return result.serviceRequest;
  }

  if (status === "Cancelled") {
    const result = await setup.statusService.changeStatus(persisted.id, "Cancelled");
    assert.equal(result.success, true);
    return result.serviceRequest;
  }

  throw new Error(`Unknown status: ${status}`);
}


// ---------------------------------------------------------------------------
// T11 Test 1 - List All Persisted Service Requests
// ---------------------------------------------------------------------------

test("Test 1 - listServiceRequests returns every persisted Service Request", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);

    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      dateRequested: "2026-09-10"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Community Assistance",
      dateRequested: "2026-09-12"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Business Permit",
      dateRequested: "2026-09-14"
    });

    const requests = setup.queryService.listServiceRequests();
    const serviceTypes = requests.map((r) => r.serviceType);

    assert.equal(requests.length, 3);
    assert.ok(serviceTypes.includes("Barangay Clearance"));
    assert.ok(serviceTypes.includes("Community Assistance"));
    assert.ok(serviceTypes.includes("Business Permit"));
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 2 - Empty Listing Returns an Empty Collection
// ---------------------------------------------------------------------------

test("Test 2 - listing an empty database returns an empty collection", () => {
  const setup = createQuerySetup();

  try {
    const requests = setup.queryService.listServiceRequests();

    assert.deepEqual(requests, []);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 3 - Listing Uses Required Ordering (dateRequested DESC, id DESC)
// ---------------------------------------------------------------------------

test("Test 3 - listing orders by dateRequested DESC then id DESC", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);

    // Insertion order differs from the required result order.
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Clearance Alpha",
      dateRequested: "2026-09-15"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Clearance Beta",
      dateRequested: "2026-09-18"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Clearance Gamma",
      dateRequested: "2026-09-18"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Clearance Delta",
      dateRequested: "2026-09-10"
    });

    const requests = setup.queryService.listServiceRequests();

    assert.equal(requests.length, 4);
    assert.deepEqual(
      requests.map((r) => r.dateRequested),
      ["2026-09-18", "2026-09-18", "2026-09-15", "2026-09-10"]
    );
    // The two 2026-09-18 requests are ordered by id DESC.
    assert.ok(requests[0].id > requests[1].id);
    assert.equal(requests[0].serviceType, "Clearance Gamma");
    assert.equal(requests[1].serviceType, "Clearance Beta");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 4 - View Existing Service Request by ID
// ---------------------------------------------------------------------------

test("Test 4 - viewServiceRequest returns the Service Request with the matching id", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const persisted = submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });

    const found = setup.queryService.viewServiceRequest(persisted.id);

    assert.ok(found);
    assert.equal(found.id, persisted.id);
    assert.equal(found.residentId, resident.id);
    assert.equal(found.serviceType, "Barangay Clearance");
    assert.equal(found.description, "Employment requirement");
    assert.equal(found.dateRequested, "2026-09-15");
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 5 - Viewing an Unknown ID Is Handled Safely
// ---------------------------------------------------------------------------

test("Test 5 - viewing an unknown id returns null and creates no record", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    submitServiceRequest(setup, { residentId: resident.id });

    const before = setup.queryService.listServiceRequests();
    assert.equal(before.length, 1);

    const found = setup.queryService.viewServiceRequest(99999);

    assert.equal(found, null);

    // No new Service Request was created by the failed lookup.
    const after = setup.queryService.listServiceRequests();
    assert.equal(after.length, 1);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 6 - Partial Service-Type Search Is Case-Insensitive
// ---------------------------------------------------------------------------

test("Test 6 - partial service-type search is case-insensitive", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const clearance = submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Community Assistance",
      description: "Medical support",
      dateRequested: "2026-09-16"
    });

    const requests = setup.queryService.searchServiceRequests("cLeAr");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, clearance.id);
    assert.equal(requests[0].serviceType, "Barangay Clearance");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 7 - Partial Description Search Is Case-Insensitive
// ---------------------------------------------------------------------------

test("Test 7 - partial description search is case-insensitive", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const employment = submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Requesting barangay clearance for employment requirements.",
      dateRequested: "2026-09-15"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Medical Assistance",
      description: "Requesting financial help for a medical procedure.",
      dateRequested: "2026-09-16"
    });

    const requests = setup.queryService.searchServiceRequests("EMPLOY");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, employment.id);
    assert.equal(requests[0].description,
      "Requesting barangay clearance for employment requirements.");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});


// ---------------------------------------------------------------------------
// T11 Test 8 - Blank Search Returns All Service Requests
// ---------------------------------------------------------------------------

test("Test 8 - blank search returns the same records as the normal listing", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      dateRequested: "2026-09-15"
    });
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Community Assistance",
      dateRequested: "2026-09-14"
    });

    const expected = setup.queryService.listServiceRequests();
    const actual = setup.queryService.searchServiceRequests("      ");

    assert.equal(actual.length, 2);
    assert.deepEqual(
      actual.map((r) => r.id),
      expected.map((r) => r.id)
    );
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 9 - No Text Match Returns an Empty Collection
// ---------------------------------------------------------------------------

test("Test 9 - a search with no text match returns an empty collection", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });

    const requests = setup.queryService.searchServiceRequests("ZzzNoSuchTerm");

    assert.deepEqual(requests, []);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 10 - Status Filter Returns Only Matching Status
// ---------------------------------------------------------------------------

test("Test 10 - status filtering returns only requests with the matching status", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);

    await submitServiceRequestWithStatus(setup, "Pending", {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      dateRequested: "2026-09-15"
    });
    await submitServiceRequestWithStatus(setup, "In Progress", {
      residentId: resident.id,
      serviceType: "Community Assistance",
      dateRequested: "2026-09-16"
    });
    await submitServiceRequestWithStatus(setup, "Completed", {
      residentId: resident.id,
      serviceType: "Business Permit",
      dateRequested: "2026-09-17"
    });
    await submitServiceRequestWithStatus(setup, "Cancelled", {
      residentId: resident.id,
      serviceType: "Medical Assistance",
      dateRequested: "2026-09-18"
    });

    const pending = setup.queryService.searchServiceRequests("", "Pending");

    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, "Pending");
    assert.equal(pending[0].serviceType, "Barangay Clearance");

    const completed = setup.queryService.searchServiceRequests("", "Completed");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, "Completed");
    assert.equal(completed[0].serviceType, "Business Permit");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});


// ---------------------------------------------------------------------------
// T11 Test 11 - Unfiltered Query Includes All Statuses
// ---------------------------------------------------------------------------

test("Test 11 - an unfiltered listing includes every lifecycle status", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);

    const pending = await submitServiceRequestWithStatus(setup, "Pending", {
      residentId: resident.id,
      serviceType: "Pending Type",
      dateRequested: "2026-09-10"
    });
    const inProgress = await submitServiceRequestWithStatus(setup, "In Progress", {
      residentId: resident.id,
      serviceType: "Progress Type",
      dateRequested: "2026-09-11"
    });
    const completed = await submitServiceRequestWithStatus(setup, "Completed", {
      residentId: resident.id,
      serviceType: "Completed Type",
      dateRequested: "2026-09-12"
    });
    const cancelled = await submitServiceRequestWithStatus(setup, "Cancelled", {
      residentId: resident.id,
      serviceType: "Cancelled Type",
      dateRequested: "2026-09-13"
    });

    const requests = setup.queryService.listServiceRequests();
    const ids = requests.map((r) => r.id);

    assert.ok(ids.includes(pending.id));
    assert.ok(ids.includes(inProgress.id));
    assert.ok(ids.includes(completed.id));
    assert.ok(ids.includes(cancelled.id));

    const statuses = requests.map((r) => r.status);
    assert.ok(statuses.includes("Pending"));
    assert.ok(statuses.includes("In Progress"));
    assert.ok(statuses.includes("Completed"));
    assert.ok(statuses.includes("Cancelled"));
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 12 - Combined Text Search and Status Filter
// ---------------------------------------------------------------------------

test("Test 12 - combined text search and status filter require both conditions", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);

    // Matches text AND status.
    const requestA = await submitServiceRequestWithStatus(setup, "Pending", {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });
    // Matches text only.
    await submitServiceRequestWithStatus(setup, "Completed", {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Scholarship requirement",
      dateRequested: "2026-09-16"
    });
    // Matches status only.
    await submitServiceRequestWithStatus(setup, "Pending", {
      residentId: resident.id,
      serviceType: "Community Assistance",
      description: "Employment support",
      dateRequested: "2026-09-17"
    });
    // Matches neither.
    await submitServiceRequestWithStatus(setup, "In Progress", {
      residentId: resident.id,
      serviceType: "Health Services",
      description: "Medical checkup",
      dateRequested: "2026-09-18"
    });

    const results = setup.queryService.searchServiceRequests("clearance", "Pending");

    assert.equal(results.length, 1);
    assert.equal(results[0].id, requestA.id);
    assert.equal(results[0].serviceType, "Barangay Clearance");
    assert.equal(results[0].status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// T11 Test 13 - Matching Service Request Is Not Duplicated
// ---------------------------------------------------------------------------

test("Test 13 - a request matching in both fields appears exactly once", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const assistance = submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Community Assistance",
      description: "Assistance requested for medical support",
      dateRequested: "2026-09-15"
    });

    const results = setup.queryService.searchServiceRequests("assistance");

    assert.equal(results.length, 1);
    assert.equal(results[0].id, assistance.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});


// ---------------------------------------------------------------------------
// T11 Test 14 - Query Result Preserves Complete Service Request Information
// ---------------------------------------------------------------------------

test("Test 14 - query results preserve every Service Request field", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const original = await submitServiceRequestWithStatus(setup, "In Progress", {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });

    // Same record reached through list, search, and view.
    const listed = setup.queryService.listServiceRequests().find((r) => r.id === original.id);
    const searched = setup.queryService.searchServiceRequests("Barangay")[0];
    const viewed = setup.queryService.viewServiceRequest(original.id);

    assert.ok(listed);
    assert.ok(searched);
    assert.ok(viewed);

    for (const result of [listed, searched, viewed]) {
      assert.equal(result.id, original.id);
      assert.equal(result.residentId, resident.id);
      assert.equal(result.serviceType, "Barangay Clearance");
      assert.equal(result.description, "Employment requirement");
      assert.equal(result.dateRequested, "2026-09-15");
      assert.equal(result.status, "In Progress");
    }
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// ---------------------------------------------------------------------------
// Additional T11 behavior checks
// ---------------------------------------------------------------------------

test("search ignores leading and trailing whitespace around the search term", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const clearance = submitServiceRequest(setup, {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });

    const trimmed = setup.queryService.searchServiceRequests("clearance");
    const padded = setup.queryService.searchServiceRequests("   clearance   ");

    assert.deepEqual(
      padded.map((r) => r.id),
      trimmed.map((r) => r.id)
    );
    assert.equal(padded.length, 1);
    assert.equal(padded[0].id, clearance.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("a blank search term combined with a status filter returns only that status", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    await submitServiceRequestWithStatus(setup, "Pending", {
      residentId: resident.id,
      serviceType: "Clearance A",
      dateRequested: "2026-09-15"
    });
    await submitServiceRequestWithStatus(setup, "Completed", {
      residentId: resident.id,
      serviceType: "Clearance B",
      dateRequested: "2026-09-16"
    });

    const results = setup.queryService.searchServiceRequests("    ", "Completed");

    assert.equal(results.length, 1);
    assert.equal(results[0].serviceType, "Clearance B");
    assert.equal(results[0].status, "Completed");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("an unsupported non-empty status filter is not silently accepted", () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    submitServiceRequest(setup, { residentId: resident.id });

    assert.throws(
      () => setup.queryService.searchServiceRequests("clearance", "Approved"),
      /Unsupported status filter/
    );
    assert.throws(
      () => setup.queryService.searchServiceRequests("clearance", "Done"),
      /Unsupported status filter/
    );
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("terminal Completed and Cancelled requests remain queryable", async () => {
  const setup = createQuerySetup();

  try {
    const resident = createActiveResident(setup);
    const completed = await submitServiceRequestWithStatus(setup, "Completed", {
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      dateRequested: "2026-09-15"
    });
    const cancelled = await submitServiceRequestWithStatus(setup, "Cancelled", {
      residentId: resident.id,
      serviceType: "Community Assistance",
      dateRequested: "2026-09-16"
    });

    const byStatus = setup.queryService.searchServiceRequests("", "Completed");
    assert.equal(byStatus.length, 1);
    assert.equal(byStatus[0].id, completed.id);

    const byText = setup.queryService.searchServiceRequests("assistance");
    assert.equal(byText.length, 1);
    assert.equal(byText[0].id, cancelled.id);

    const byId = setup.queryService.viewServiceRequest(completed.id);
    assert.ok(byId);
    assert.equal(byId.status, "Completed");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

