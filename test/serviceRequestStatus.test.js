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
import { ServiceRequestStatusService, ServiceRequestStatusResult }
  from "../src/services/ServiceRequestStatusService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTemporaryDatabasePath() {
  const fileName = `csms-t10-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

function removeDatabase(databasePath) {
  if (fs.existsSync(databasePath)) {
    fs.unlinkSync(databasePath);
  }
}

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

function makeValidServiceRequest(overrides = {}) {
  return new ServiceRequest({
    residentId: 25,
    serviceType: "Barangay Clearance",
    description: "Request for employment requirement",
    dateRequested: "2026-09-15",
    ...overrides
  });
}

function createStatusSetup() {
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
  return {
    databasePath,
    residentRepository,
    serviceRequestRepository,
    validator,
    submissionService,
    statusService
  };
}

async function createPendingServiceRequest(setup) {
  const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
  const serviceRequest = makeValidServiceRequest({ residentId: resident.id });
  const result = setup.submissionService.submitServiceRequest(serviceRequest);
  assert.equal(result.success, true);
  return result.serviceRequest;
}

async function createInProgressServiceRequest(setup) {
  const pending = await createPendingServiceRequest(setup);
  const result = await setup.statusService.changeStatus(pending.id, "In Progress");
  assert.equal(result.success, true);
  return result.serviceRequest;
}

async function createCompletedServiceRequest(setup) {
  const inProgress = await createInProgressServiceRequest(setup);
  const result = await setup.statusService.changeStatus(inProgress.id, "Completed");
  assert.equal(result.success, true);
  return result.serviceRequest;
}

async function createCancelledServiceRequest(setup) {
  const pending = await createPendingServiceRequest(setup);
  const result = await setup.statusService.changeStatus(pending.id, "Cancelled");
  assert.equal(result.success, true);
  return result.serviceRequest;
}

// ---------------------------------------------------------------------------
// T10 Tests
// ---------------------------------------------------------------------------

test("Test 1 - Pending Can Move to In Progress", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "In Progress");

    assert.equal(result.success, true);
    assert.ok(result.serviceRequest);
    assert.equal(result.serviceRequest.status, "In Progress");
    assert.equal(result.serviceRequest.id, serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 2 - Pending Can Move to Cancelled", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Cancelled");

    assert.equal(result.success, true);
    assert.ok(result.serviceRequest);
    assert.equal(result.serviceRequest.status, "Cancelled");
    assert.equal(result.serviceRequest.id, serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 3 - In Progress Can Move to Completed", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createInProgressServiceRequest(setup);
    assert.equal(serviceRequest.status, "In Progress");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Completed");

    assert.equal(result.success, true);
    assert.ok(result.serviceRequest);
    assert.equal(result.serviceRequest.status, "Completed");
    assert.equal(result.serviceRequest.id, serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 4 - In Progress Can Move to Cancelled", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createInProgressServiceRequest(setup);
    assert.equal(serviceRequest.status, "In Progress");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Cancelled");

    assert.equal(result.success, true);
    assert.ok(result.serviceRequest);
    assert.equal(result.serviceRequest.status, "Cancelled");
    assert.equal(result.serviceRequest.id, serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 5 - Pending Cannot Move Directly to Completed", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Completed");

    assert.equal(result.success, false);
    assert.equal(result.invalidTransition, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 6 - In Progress Cannot Return to Pending", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createInProgressServiceRequest(setup);
    assert.equal(serviceRequest.status, "In Progress");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Pending");

    assert.equal(result.success, false);
    assert.equal(result.invalidTransition, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "In Progress");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 7 - Completed Is Terminal", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createCompletedServiceRequest(setup);
    assert.equal(serviceRequest.status, "Completed");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "In Progress");

    assert.equal(result.success, false);
    assert.equal(result.invalidTransition, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Completed");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 8 - Cancelled Is Terminal", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createCancelledServiceRequest(setup);
    assert.equal(serviceRequest.status, "Cancelled");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Pending");

    assert.equal(result.success, false);
    assert.equal(result.invalidTransition, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Cancelled");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 9 - Unsupported Status Is Rejected", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Approved");

    assert.equal(result.success, false);
    assert.equal(result.unsupportedStatus, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 10 - Nonexistent Service Request Is Handled Safely", async () => {
  const setup = createStatusSetup();

  try {
    const result = await setup.statusService.changeStatus(999999, "In Progress");

    assert.equal(result.success, false);
    assert.equal(result.notFound, true);
    assert.equal(result.serviceRequest, null);

    const count = setup.serviceRequestRepository.findById(999999);
    assert.equal(count, null);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 11 - Successful Transition Preserves Service Request Information", async () => {
  const setup = createStatusSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({ status: "Active" }));
    const originalServiceRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "Barangay Clearance",
      description: "Employment requirement",
      dateRequested: "2026-09-15"
    });

    const submitResult = setup.submissionService.submitServiceRequest(originalServiceRequest);
    assert.equal(submitResult.success, true);
    const submittedRequest = submitResult.serviceRequest;

    const result = await setup.statusService.changeStatus(submittedRequest.id, "In Progress");

    assert.equal(result.success, true);
    const updated = result.serviceRequest;

    assert.equal(updated.id, submittedRequest.id);
    assert.equal(updated.residentId, submittedRequest.residentId);
    assert.equal(updated.serviceType, "Barangay Clearance");
    assert.equal(updated.description, "Employment requirement");
    assert.equal(updated.dateRequested, "2026-09-15");
    assert.equal(updated.status, "In Progress");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 12 - Invalid Transition Does Not Modify Persistence", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    await setup.statusService.changeStatus(serviceRequest.id, "Completed");

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Pending");
    assert.equal(found.residentId, serviceRequest.residentId);
    assert.equal(found.serviceType, serviceRequest.serviceType);
    assert.equal(found.description, serviceRequest.description);
    assert.equal(found.dateRequested, serviceRequest.dateRequested);
    assert.equal(found.id, serviceRequest.id);
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

test("Test 13 - Same-Status Request Is Rejected", async () => {
  const setup = createStatusSetup();

  try {
    const serviceRequest = await createPendingServiceRequest(setup);
    assert.equal(serviceRequest.status, "Pending");

    const result = await setup.statusService.changeStatus(serviceRequest.id, "Pending");

    assert.equal(result.success, false);
    assert.equal(result.invalidTransition, true);
    assert.equal(result.serviceRequest, null);

    const found = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.ok(found);
    assert.equal(found.status, "Pending");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});

// Student-Designed Test
test("Student Test - Multiple Sequential Valid Transitions Preserve Data Integrity", async () => {
  const setup = createStatusSetup();

  try {
    const resident = setup.residentRepository.save(makeValidResident({
      firstName: "Maria",
      lastName: "Santos",
      address: "Barangay San Jose",
      contactNumber: "09188765432",
      email: "maria@example.com",
      status: "Active"
    }));

    const originalServiceRequest = makeValidServiceRequest({
      residentId: resident.id,
      serviceType: "Business Permit",
      description: "New business registration",
      dateRequested: "2026-10-01"
    });

    const submitResult = setup.submissionService.submitServiceRequest(originalServiceRequest);
    assert.equal(submitResult.success, true);
    let currentRequest = submitResult.serviceRequest;
    assert.equal(currentRequest.status, "Pending");

    const toInProgress = await setup.statusService.changeStatus(currentRequest.id, "In Progress");
    assert.equal(toInProgress.success, true);
    currentRequest = toInProgress.serviceRequest;
    assert.equal(currentRequest.status, "In Progress");

    const toCompleted = await setup.statusService.changeStatus(currentRequest.id, "Completed");
    assert.equal(toCompleted.success, true);
    currentRequest = toCompleted.serviceRequest;
    assert.equal(currentRequest.status, "Completed");

    const finalRequest = setup.serviceRequestRepository.findById(currentRequest.id);
    assert.ok(finalRequest);
    assert.equal(finalRequest.id, currentRequest.id);
    assert.equal(finalRequest.residentId, resident.id);
    assert.equal(finalRequest.serviceType, "Business Permit");
    assert.equal(finalRequest.description, "New business registration");
    assert.equal(finalRequest.dateRequested, "2026-10-01");
    assert.equal(finalRequest.status, "Completed");
  } finally {
    setup.residentRepository.close();
    setup.serviceRequestRepository.close();
    removeDatabase(setup.databasePath);
  }
});