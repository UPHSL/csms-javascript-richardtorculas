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
import { ResidentDeactivationService }
  from "../src/services/ResidentDeactivationService.js";
import { ResidentRegistrationService }
  from "../src/services/ResidentRegistrationService.js";
import { ResidentValidator } from "../src/services/ResidentValidator.js";
import { ServiceRequestStatusService }
  from "../src/services/ServiceRequestStatusService.js";
import { ServiceRequestSubmissionService }
  from "../src/services/ServiceRequestSubmissionService.js";
import { ServiceRequestValidator }
  from "../src/services/ServiceRequestValidator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t13-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Build the real application around temporary-database repositories, so
// every request travels route -> controller -> service -> validator -> SQLite.
function createInterfaceSetup() {
  const databasePath = createTemporaryDatabasePath();
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);
  const app = createApp({ residentRepository, serviceRequestRepository });

  const submissionService = new ServiceRequestSubmissionService(
    new ServiceRequestValidator(),
    serviceRequestRepository,
    residentRepository
  );
  const statusService = new ServiceRequestStatusService(serviceRequestRepository);

  const cleanup = () => {
    residentRepository.close();
    serviceRequestRepository.close();

    if (fs.existsSync(databasePath)) {
      fs.unlinkSync(databasePath);
    }
  };

  return {
    app,
    residentRepository,
    serviceRequestRepository,
    submissionService,
    statusService,
    cleanup
  };
}

// Persist a Resident through the established T04 registration capability.
function registerResident(residentRepository, overrides = {}) {
  const service = new ResidentRegistrationService(
    new ResidentValidator(),
    residentRepository
  );

  const result = service.registerResident(new Resident({
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

// Move a Service Request through legitimate T10 transitions.
async function transition(setup, serviceRequestId, ...statuses) {
  for (const status of statuses) {
    const result = await setup.statusService.changeStatus(serviceRequestId, status);
    assert.equal(result.success, true, `fixture transition to ${status} must succeed`);
  }
}

// Valid submission form input for the given Resident.
function validFormInput(residentId, overrides = {}) {
  return {
    residentId: String(residentId),
    serviceType: "Certificate of Indigency",
    description: "Needed for a medical assistance application.",
    dateRequested: "2026-11-10",
    ...overrides
  };
}

// Extract the rendered Service Request table rows from a list page.
function tableBody(html) {
  const match = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return match ? match[1] : "";
}

// Ids of the rendered rows in display order (from each row's View link).
function renderedIds(html) {
  return [...tableBody(html).matchAll(/href="\/service-requests\/(\d+)"/g)]
    .map((match) => Number(match[1]));
}

// ---------------------------------------------------------------------------
// Test 1 - Service Request Management page loads
// ---------------------------------------------------------------------------

test("T13: Service Request Management page loads successfully", async () => {
  const setup = createInterfaceSetup();

  try {
    const response = await request(setup.app).get("/service-requests");

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(response.text, /<h1>Service Request Management<\/h1>/);
    assert.match(response.text, /href="\/service-requests\/new"/);
    assert.match(response.text, /name="search"/);
    assert.match(response.text, /<select id="status" name="status">/);
    assert.match(response.text, /<option value="">All Statuses<\/option>/);

    for (const status of ["Pending", "In Progress", "Completed", "Cancelled"]) {
      assert.match(response.text, new RegExp(`<option value="${status}">`));
    }

    assert.match(response.text, /No Service Requests found\./);
    assert.match(response.text, /href="\/residents">Residents</);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 2 - Persisted Service Requests are displayed
// ---------------------------------------------------------------------------

test("T13: persisted Service Requests are displayed", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const clearance = submitRequest(setup, resident.id);
    const indigency = submitRequest(setup, resident.id, {
      serviceType: "Certificate of Indigency",
      description: "For scholarship requirements.",
      dateRequested: "2026-11-05"
    });

    const response = await request(setup.app).get("/service-requests");
    const rows = tableBody(response.text);

    assert.equal(response.statusCode, 200);
    assert.match(rows, />Barangay Clearance</);
    assert.match(rows, />Certificate of Indigency</);
    assert.match(rows, />2026-11-01</);
    assert.match(rows, />2026-11-05</);
    assert.match(rows, new RegExp(`<td>${resident.id}</td>`));
    assert.match(rows, />Pending</);
    assert.deepEqual(
      renderedIds(response.text).sort(),
      [clearance.id, indigency.id].sort()
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 3 - Required ordering is preserved
// ---------------------------------------------------------------------------

test("T13: listing preserves dateRequested DESC then id DESC", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const oldest = submitRequest(setup, resident.id, { dateRequested: "2026-10-01" });
    const newestFirst = submitRequest(setup, resident.id, { dateRequested: "2026-11-12" });
    const middle = submitRequest(setup, resident.id, { dateRequested: "2026-10-20" });
    const newestSecond = submitRequest(setup, resident.id, { dateRequested: "2026-11-12" });

    const response = await request(setup.app).get("/service-requests");

    assert.deepEqual(renderedIds(response.text), [
      newestSecond.id,
      newestFirst.id,
      middle.id,
      oldest.id
    ]);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 4 - Text search uses T11 behavior
// ---------------------------------------------------------------------------

test("T13: text search is partial, case-insensitive, and covers description", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const clearance = submitRequest(setup, resident.id);
    const repair = submitRequest(setup, resident.id, {
      serviceType: "Streetlight Repair",
      description: "Broken streetlight near the chapel."
    });

    const byType = await request(setup.app)
      .get("/service-requests")
      .query({ search: "   CLEAR   " });

    assert.equal(byType.statusCode, 200);
    assert.deepEqual(renderedIds(byType.text), [clearance.id]);

    const byDescription = await request(setup.app)
      .get("/service-requests")
      .query({ search: "Employ" });

    assert.deepEqual(renderedIds(byDescription.text), [clearance.id]);
    assert.doesNotMatch(tableBody(byDescription.text), /Streetlight/);

    const blank = await request(setup.app)
      .get("/service-requests")
      .query({ search: "     " });

    assert.equal(blank.statusCode, 200);
    assert.deepEqual(renderedIds(blank.text).sort(), [clearance.id, repair.id].sort());

    const noMatch = await request(setup.app)
      .get("/service-requests")
      .query({ search: "zzz-no-match" });

    assert.equal(noMatch.statusCode, 200);
    assert.match(noMatch.text, /No Service Requests found\./);
    // The submitted search stays visible.
    assert.match(noMatch.text, /value="zzz-no-match"/);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 5 - Status filter uses T11 behavior
// ---------------------------------------------------------------------------

test("T13: status filter shows only requests with that status", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const pending = submitRequest(setup, resident.id);
    const inProgress = submitRequest(setup, resident.id);
    const completed = submitRequest(setup, resident.id);
    const cancelled = submitRequest(setup, resident.id);

    await transition(setup, inProgress.id, "In Progress");
    await transition(setup, completed.id, "In Progress", "Completed");
    await transition(setup, cancelled.id, "Cancelled");

    const expected = {
      "Pending": pending.id,
      "In Progress": inProgress.id,
      "Completed": completed.id,
      "Cancelled": cancelled.id
    };

    for (const [status, id] of Object.entries(expected)) {
      const response = await request(setup.app)
        .get("/service-requests")
        .query({ status });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(renderedIds(response.text), [id], `filter ${status}`);
      // The selected status stays visible.
      assert.match(response.text, new RegExp(`<option value="${status}" selected>`));
    }

    const all = await request(setup.app)
      .get("/service-requests")
      .query({ status: "" });

    assert.equal(renderedIds(all.text).length, 4);
  } finally {
    setup.cleanup();
  }
});

test("T13: an unsupported status filter is handled without crashing", async () => {
  const setup = createInterfaceSetup();

  try {
    const response = await request(setup.app)
      .get("/service-requests")
      .query({ status: "Archived" });

    assert.equal(response.statusCode, 400);
    assert.match(response.text, /Please choose a valid status filter\./);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 6 - Combined search and status filter
// ---------------------------------------------------------------------------

test("T13: combined search and status filter require both to match", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);

    const both = submitRequest(setup, resident.id);
    const textOnly = submitRequest(setup, resident.id);
    submitRequest(setup, resident.id, {
      serviceType: "Streetlight Repair",
      description: "Broken streetlight near the chapel."
    });
    const neither = submitRequest(setup, resident.id, {
      serviceType: "Garbage Collection",
      description: "Missed garbage pickup."
    });

    await transition(setup, textOnly.id, "In Progress");
    await transition(setup, neither.id, "Cancelled");

    const response = await request(setup.app)
      .get("/service-requests")
      .query({ search: "clearance", status: "Pending" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(renderedIds(response.text), [both.id]);
    assert.match(response.text, /value="clearance"/);
    assert.match(response.text, /<option value="Pending" selected>/);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 7 - Submission form is accessible
// ---------------------------------------------------------------------------

test("T13: submission form has the required labelled fields only", async () => {
  const setup = createInterfaceSetup();

  try {
    const response = await request(setup.app).get("/service-requests/new");

    assert.equal(response.statusCode, 200);
    assert.match(response.text, /method="post" action="\/service-requests"/);

    for (const [name, label] of [
      ["residentId", "Resident ID"],
      ["serviceType", "Service Type"],
      ["description", "Description"],
      ["dateRequested", "Date Requested"]
    ]) {
      assert.match(response.text, new RegExp(`<label for="${name}">${label}</label>`));
      assert.match(response.text, new RegExp(`name="${name}"`));
    }

    assert.match(response.text, /<textarea\s+id="description"/);
    assert.match(response.text, /type="date"/);
    assert.doesNotMatch(response.text, /name="id"/);
    assert.doesNotMatch(response.text, /name="status"/);
    assert.match(response.text, /href="\/residents">View Residents</);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 8 - Valid submission persists a Pending request
// ---------------------------------------------------------------------------

test("T13: valid submission persists a Pending Service Request", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);

    const response = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send({ ...validFormInput(resident.id), status: "Completed", id: "77" });

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/service-requests?notice=submitted");

    const persisted = setup.serviceRequestRepository.listServiceRequests();
    assert.equal(persisted.length, 1);

    const [serviceRequest] = persisted;
    assert.equal(Number.isInteger(serviceRequest.id), true);
    assert.equal(serviceRequest.id > 0, true);
    assert.notEqual(serviceRequest.id, 77);
    assert.equal(serviceRequest.residentId, resident.id);
    assert.equal(serviceRequest.serviceType, "Certificate of Indigency");
    assert.equal(serviceRequest.description, "Needed for a medical assistance application.");
    assert.equal(serviceRequest.dateRequested, "2026-11-10");
    assert.equal(serviceRequest.status, "Pending");

    const listResponse = await request(setup.app).get(response.headers.location);
    assert.match(listResponse.text, /Service Request submitted successfully\./);
    assert.deepEqual(renderedIds(listResponse.text), [serviceRequest.id]);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 9 - Invalid submission shows validation feedback
// ---------------------------------------------------------------------------

test("T13: invalid submission shows feedback, keeps values, persists nothing", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);

    const response = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send(validFormInput(resident.id, {
        serviceType: "   ",
        description: "",
        dateRequested: "2026-02-31"
      }));

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /Service type is required\./);
    assert.match(response.text, /Description is required\./);
    assert.match(response.text, /Date requested must be a valid date/);
    assert.match(response.text, new RegExp(`value="${resident.id}"`));
    assert.match(response.text, /value="2026-02-31"/);

    const badResidentId = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send(validFormInput("abc"));

    assert.equal(badResidentId.statusCode, 422);
    assert.match(badResidentId.text, /Resident ID must be a positive whole number\./);

    assert.equal(setup.serviceRequestRepository.listServiceRequests().length, 0);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 10 - Missing Resident submission is rejected
// ---------------------------------------------------------------------------

test("T13: submission for a missing Resident is rejected", async () => {
  const setup = createInterfaceSetup();

  try {
    const response = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send(validFormInput(9999));

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /Resident not found\./);
    assert.match(response.text, /value="Certificate of Indigency"/);
    assert.equal(setup.serviceRequestRepository.listServiceRequests().length, 0);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 11 - Inactive Resident submission is rejected
// ---------------------------------------------------------------------------

test("T13: submission for an Inactive Resident is rejected", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    new ResidentDeactivationService(setup.residentRepository)
      .deactivateResident(resident.id);

    const response = await request(setup.app)
      .post("/service-requests")
      .type("form")
      .send(validFormInput(resident.id));

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /Inactive Residents cannot submit new Service Requests\./);
    assert.equal(setup.serviceRequestRepository.listServiceRequests().length, 0);
    // The Resident is not reactivated by the attempt.
    assert.equal(setup.residentRepository.findById(resident.id).status, "Inactive");
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 12 - Existing Service Request details can be viewed
// ---------------------------------------------------------------------------

test("T13: details page shows every persisted Service Request field", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const longDescription =
      "Requesting barangay clearance for employment requirements at the " +
      "municipal hall, including a certified copy for the employer.";
    const serviceRequest = submitRequest(setup, resident.id, {
      description: longDescription
    });

    const response = await request(setup.app)
      .get(`/service-requests/${serviceRequest.id}`);

    assert.equal(response.statusCode, 200);
    assert.match(response.text, new RegExp(`Service Request #${serviceRequest.id}`));
    assert.match(response.text, new RegExp(`<dd>${serviceRequest.id}</dd>`));
    assert.match(response.text, new RegExp(`<dd>${resident.id}</dd>`));
    assert.match(response.text, /<dd>Barangay Clearance<\/dd>/);
    assert.match(response.text, new RegExp(longDescription));
    assert.match(response.text, /<dd>2026-11-01<\/dd>/);
    assert.match(response.text, />Pending</);
    assert.match(response.text, />Start Processing</);
    assert.match(response.text, />Cancel</);
    assert.doesNotMatch(response.text, />Complete</);

    // The list shortens long descriptions; the full text stays on details.
    const listResponse = await request(setup.app).get("/service-requests");
    assert.doesNotMatch(tableBody(listResponse.text), new RegExp(longDescription));
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 13 - Missing Service Request view is handled safely
// ---------------------------------------------------------------------------

test("T13: missing Service Request view and actions return controlled 404", async () => {
  const setup = createInterfaceSetup();

  try {
    for (const url of ["/service-requests/9999", "/service-requests/abc"]) {
      const response = await request(setup.app).get(url);

      assert.equal(response.statusCode, 404);
      assert.match(response.text, /Service Request Not Found/);
      assert.match(response.text, /href="\/service-requests"/);
      assert.doesNotMatch(response.text, /Error:|at .*\.js/);
    }

    for (const action of ["start", "complete", "cancel"]) {
      const response = await request(setup.app)
        .post(`/service-requests/9999/${action}`);

      assert.equal(response.statusCode, 404);
      assert.match(response.text, /Service Request Not Found/);
    }

    assert.equal(setup.serviceRequestRepository.listServiceRequests().length, 0);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests 14-17 - Workflow actions through the interface (T10)
// ---------------------------------------------------------------------------

test("T13: Pending request can Start Processing", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id);

    const response = await request(setup.app)
      .post(`/service-requests/${serviceRequest.id}/start`);

    assert.equal(response.statusCode, 303);
    assert.equal(
      response.headers.location,
      `/service-requests/${serviceRequest.id}?notice=started`
    );

    const persisted = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.deepEqual(
      persisted,
      new ServiceRequest({ ...serviceRequest, status: "In Progress" })
    );

    const details = await request(setup.app).get(response.headers.location);
    assert.match(details.text, /Service Request is now In Progress\./);
    assert.match(details.text, />Complete</);
    assert.match(details.text, />Cancel</);
    assert.doesNotMatch(details.text, />Start Processing</);
  } finally {
    setup.cleanup();
  }
});

test("T13: Pending request can be Cancelled", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id);

    const response = await request(setup.app)
      .post(`/service-requests/${serviceRequest.id}/cancel`);

    assert.equal(response.statusCode, 303);

    const persisted = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.deepEqual(
      persisted,
      new ServiceRequest({ ...serviceRequest, status: "Cancelled" })
    );

    const details = await request(setup.app).get(response.headers.location);
    assert.match(details.text, /Service Request cancelled successfully\./);
  } finally {
    setup.cleanup();
  }
});

test("T13: In Progress request can be Completed", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id);

    await request(setup.app).post(`/service-requests/${serviceRequest.id}/start`);

    const response = await request(setup.app)
      .post(`/service-requests/${serviceRequest.id}/complete`);

    assert.equal(response.statusCode, 303);

    const persisted = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.deepEqual(
      persisted,
      new ServiceRequest({ ...serviceRequest, status: "Completed" })
    );

    const details = await request(setup.app).get(response.headers.location);
    assert.match(details.text, /Service Request completed successfully\./);
    assert.match(details.text, /No further workflow actions are available\./);
    assert.doesNotMatch(details.text, /action="\/service-requests\/\d+\/(start|complete|cancel)"/);
  } finally {
    setup.cleanup();
  }
});

test("T13: In Progress request can be Cancelled", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id);
    await transition(setup, serviceRequest.id, "In Progress");

    const response = await request(setup.app)
      .post(`/service-requests/${serviceRequest.id}/cancel`);

    assert.equal(response.statusCode, 303);

    const persisted = setup.serviceRequestRepository.findById(serviceRequest.id);
    assert.deepEqual(
      persisted,
      new ServiceRequest({ ...serviceRequest, status: "Cancelled" })
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 18 - Invalid direct transition is still rejected by T10
// ---------------------------------------------------------------------------

test("T13: direct invalid transitions are rejected and do not persist", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const pending = submitRequest(setup, resident.id);

    const response = await request(setup.app)
      .post(`/service-requests/${pending.id}/complete`);

    assert.equal(response.statusCode, 409);
    assert.match(
      response.text,
      /That action is not allowed for the Service Request&#39;s current status\./
    );
    assert.match(response.text, />Pending</);
    assert.equal(
      setup.serviceRequestRepository.findById(pending.id).status,
      "Pending"
    );

    // Terminal states stay terminal even for crafted requests.
    const completed = submitRequest(setup, resident.id);
    await transition(setup, completed.id, "In Progress", "Completed");

    for (const action of ["start", "complete", "cancel"]) {
      const attempt = await request(setup.app)
        .post(`/service-requests/${completed.id}/${action}`);

      assert.equal(attempt.statusCode, 409);
    }

    assert.equal(
      setup.serviceRequestRepository.findById(completed.id).status,
      "Completed"
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 19 - Completed and Cancelled requests remain visible
// ---------------------------------------------------------------------------

test("T13: terminal requests remain listed, searchable, filterable, viewable", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const completed = submitRequest(setup, resident.id, {
      serviceType: "Business Permit Endorsement"
    });
    const cancelled = submitRequest(setup, resident.id, {
      serviceType: "Business Permit Renewal"
    });

    await transition(setup, completed.id, "In Progress", "Completed");
    await transition(setup, cancelled.id, "Cancelled");

    const list = await request(setup.app).get("/service-requests");
    const rows = tableBody(list.text);
    assert.deepEqual(renderedIds(list.text).sort(), [completed.id, cancelled.id].sort());
    assert.match(rows, />Completed</);
    assert.match(rows, />Cancelled</);
    // No workflow actions are offered for terminal rows.
    assert.doesNotMatch(rows, /action="\/service-requests\/\d+\/(start|complete|cancel)"/);

    const search = await request(setup.app)
      .get("/service-requests")
      .query({ search: "permit" });
    assert.deepEqual(renderedIds(search.text).sort(), [completed.id, cancelled.id].sort());

    for (const [status, id] of [["Completed", completed.id], ["Cancelled", cancelled.id]]) {
      const filtered = await request(setup.app)
        .get("/service-requests")
        .query({ search: "permit", status });
      assert.deepEqual(renderedIds(filtered.text), [id]);

      const details = await request(setup.app).get(`/service-requests/${id}`);
      assert.equal(details.statusCode, 200);
      assert.match(details.text, new RegExp(`>${status}<`));
      assert.match(details.text, /No further workflow actions are available\./);
    }
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 20 - GET requests do not change Service Request state
// ---------------------------------------------------------------------------

test("T13: GET requests never create or modify Service Requests", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id);
    const before = setup.serviceRequestRepository.listServiceRequests();

    await request(setup.app).get("/service-requests");
    await request(setup.app).get("/service-requests").query({ search: "clear" });
    await request(setup.app).get("/service-requests").query({ status: "Pending" });
    await request(setup.app).get("/service-requests/new");
    await request(setup.app).get(`/service-requests/${serviceRequest.id}`);

    for (const action of ["start", "complete", "cancel"]) {
      const response = await request(setup.app)
        .get(`/service-requests/${serviceRequest.id}/${action}`);

      assert.equal(response.statusCode, 404);
    }

    assert.deepEqual(setup.serviceRequestRepository.listServiceRequests(), before);
    assert.equal(
      setup.serviceRequestRepository.findById(serviceRequest.id).status,
      "Pending"
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Presentation safety and navigation
// ---------------------------------------------------------------------------

test("T13: Service Request data is HTML-escaped when rendered", async () => {
  const setup = createInterfaceSetup();

  try {
    const resident = registerResident(setup.residentRepository);
    const serviceRequest = submitRequest(setup, resident.id, {
      serviceType: "<script>alert(1)</script>"
    });

    for (const url of ["/service-requests", `/service-requests/${serviceRequest.id}`]) {
      const response = await request(setup.app).get(url);

      assert.doesNotMatch(response.text, /<script>alert\(1\)<\/script>/);
      assert.match(response.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    }
  } finally {
    setup.cleanup();
  }
});

test("T13: Resident Management still works and links to Service Requests", async () => {
  const setup = createInterfaceSetup();

  try {
    registerResident(setup.residentRepository);

    const response = await request(setup.app).get("/residents");

    assert.equal(response.statusCode, 200);
    assert.match(response.text, /<h1>Resident Management<\/h1>/);
    assert.match(response.text, /Santos/);
    assert.match(response.text, /href="\/service-requests">Service Requests</);
  } finally {
    setup.cleanup();
  }
});
