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
import { DashboardService } from "../src/services/DashboardService.js";
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
  const fileName = `csms-t14-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Build the real application around temporary-database repositories, plus
// the existing business services used to arrange test data.
function createDashboardSetup() {
  const databasePath = createTemporaryDatabasePath();
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);

  const setup = {
    app: createApp({ residentRepository, serviceRequestRepository }),
    residentRepository,
    serviceRequestRepository,
    registrationService: new ResidentRegistrationService(
      new ResidentValidator(),
      residentRepository
    ),
    deactivationService: new ResidentDeactivationService(residentRepository),
    submissionService: new ServiceRequestSubmissionService(
      new ServiceRequestValidator(),
      serviceRequestRepository,
      residentRepository
    ),
    statusService: new ServiceRequestStatusService(serviceRequestRepository),
    cleanup() {
      residentRepository.close();
      serviceRequestRepository.close();

      if (fs.existsSync(databasePath)) {
        fs.unlinkSync(databasePath);
      }
    }
  };

  return setup;
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

// Register `active` Active and `inactive` Inactive Residents (T04 + T07).
function registerResidents(setup, { active = 0, inactive = 0 }) {
  const residents = [];

  for (let index = 0; index < active + inactive; index += 1) {
    const resident = registerResident(setup, { firstName: `Resident${index}` });

    if (index >= active) {
      setup.deactivationService.deactivateResident(resident.id);
    }

    residents.push(resident);
  }

  return residents;
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

// Create one request in each status: counts of { pending, inProgress, completed, cancelled }.
async function createRequestsByStatus(setup, residentId, counts) {
  const plan = [
    ["pending", []],
    ["inProgress", ["In Progress"]],
    ["completed", ["In Progress", "Completed"]],
    ["cancelled", ["Cancelled"]]
  ];

  for (const [key, steps] of plan) {
    for (let index = 0; index < (counts[key] ?? 0); index += 1) {
      const serviceRequest = submitRequest(setup, residentId);
      await transition(setup, serviceRequest.id, ...steps);
    }
  }
}

// Read every rendered metric card from the dashboard HTML.
function readMetrics(html) {
  const pattern =
    /data-metric="([^"]+)">\s*<span class="stat-label">[^<]*<\/span>\s*<span class="stat-value">(\d+)<\/span>/g;

  return Object.fromEntries(
    [...html.matchAll(pattern)].map((match) => [match[1], Number(match[2])])
  );
}

// Request the dashboard and return its metrics.
async function getDashboardMetrics(app) {
  const response = await request(app).get("/dashboard");
  assert.equal(response.statusCode, 200);
  return readMetrics(response.text);
}

// Extract the recent Service Request table from the dashboard HTML.
function recentTable(html) {
  const match = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return match ? match[1] : "";
}

// Ids of recent Service Requests in display order (from each View link).
function recentIds(html) {
  return [...recentTable(html).matchAll(/href="\/service-requests\/(\d+)"/g)]
    .map((match) => Number(match[1]));
}

// Snapshot of all persisted data, used to prove the dashboard is read-only.
function snapshot(setup) {
  return {
    residents: setup.residentRepository.listResidents(),
    serviceRequests: setup.serviceRequestRepository.listServiceRequests()
  };
}

// ---------------------------------------------------------------------------
// Test 1 - Dashboard loads successfully
// ---------------------------------------------------------------------------

test("T14: dashboard loads with all sections and navigation", async () => {
  const setup = createDashboardSetup();

  try {
    const response = await request(setup.app).get("/dashboard");

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(response.text, /<h1>CSMS Dashboard<\/h1>/);
    assert.match(response.text, /Resident Summary/);
    assert.match(response.text, /Service Request Summary/);
    assert.match(response.text, /Open Service Requests/);
    assert.match(response.text, /Recent Service Requests/);
    assert.match(response.text, /href="\/dashboard">Dashboard</);
    assert.match(response.text, /href="\/residents">Residents</);
    assert.match(response.text, /href="\/service-requests">Service Requests</);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 2 - Empty dashboard displays zero counts
// ---------------------------------------------------------------------------

test("T14: empty dashboard shows zero counts and a safe empty state", async () => {
  const setup = createDashboardSetup();

  try {
    const response = await request(setup.app).get("/dashboard");

    assert.deepEqual(readMetrics(response.text), {
      "residents-total": 0,
      "residents-active": 0,
      "residents-inactive": 0,
      "service-requests-open": 0,
      "service-requests-total": 0,
      "service-requests-pending": 0,
      "service-requests-in-progress": 0,
      "service-requests-completed": 0,
      "service-requests-cancelled": 0
    });

    assert.match(response.text, /No Service Requests available\./);
    assert.doesNotMatch(response.text, /<tbody>/);
    assert.doesNotMatch(response.text, /null|undefined|NaN/);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 3 - Total Resident count is correct
// ---------------------------------------------------------------------------

test("T14: total Resident count matches persisted Residents", async () => {
  const setup = createDashboardSetup();

  try {
    registerResidents(setup, { active: 4 });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["residents-total"], 4);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 4 - Resident status counts are correct
// ---------------------------------------------------------------------------

test("T14: Active and Inactive Resident counts reconcile with the total", async () => {
  const setup = createDashboardSetup();

  try {
    registerResidents(setup, { active: 3, inactive: 2 });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["residents-active"], 3);
    assert.equal(metrics["residents-inactive"], 2);
    assert.equal(metrics["residents-total"], 5);
    assert.equal(
      metrics["residents-total"],
      metrics["residents-active"] + metrics["residents-inactive"]
    );
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 5 - Total Service Request count is correct
// ---------------------------------------------------------------------------

test("T14: total Service Request count matches persisted requests", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    await createRequestsByStatus(setup, resident.id, { pending: 3, completed: 1 });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["service-requests-total"], 4);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests 6, 7, 8 - Status counts, reconciliation, and Open
// ---------------------------------------------------------------------------

test("T14: Service Request status counts are correct", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    await createRequestsByStatus(setup, resident.id, {
      pending: 4,
      inProgress: 3,
      completed: 2,
      cancelled: 1
    });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["service-requests-pending"], 4);
    assert.equal(metrics["service-requests-in-progress"], 3);
    assert.equal(metrics["service-requests-completed"], 2);
    assert.equal(metrics["service-requests-cancelled"], 1);
  } finally {
    setup.cleanup();
  }
});

test("T14: Service Request status counts reconcile with the total", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    await createRequestsByStatus(setup, resident.id, {
      pending: 2,
      inProgress: 1,
      completed: 3,
      cancelled: 2
    });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["service-requests-total"], 8);
    assert.equal(
      metrics["service-requests-total"],
      metrics["service-requests-pending"] +
        metrics["service-requests-in-progress"] +
        metrics["service-requests-completed"] +
        metrics["service-requests-cancelled"]
    );
  } finally {
    setup.cleanup();
  }
});

test("T14: Open equals Pending plus In Progress and excludes terminal requests", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    await createRequestsByStatus(setup, resident.id, {
      pending: 2,
      inProgress: 3,
      completed: 4,
      cancelled: 5
    });

    const metrics = await getDashboardMetrics(setup.app);

    assert.equal(metrics["service-requests-open"], 5);
    assert.equal(
      metrics["service-requests-open"],
      metrics["service-requests-pending"] + metrics["service-requests-in-progress"]
    );

    // Open is derived, never stored as a status.
    const storedStatuses = Object.keys(setup.serviceRequestRepository.countByStatus());
    assert.equal(storedStatuses.includes("Open"), false);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 9 - Resident deactivation is reflected
// ---------------------------------------------------------------------------

test("T14: Resident deactivation is reflected after refresh", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 2, inactive: 1 });
    const before = await getDashboardMetrics(setup.app);

    // Deactivate through the existing T12 interface (which uses T07).
    await request(setup.app).post(`/residents/${resident.id}/deactivate`);

    const after = await getDashboardMetrics(setup.app);

    assert.equal(after["residents-total"], before["residents-total"]);
    assert.equal(after["residents-active"], before["residents-active"] - 1);
    assert.equal(after["residents-inactive"], before["residents-inactive"] + 1);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 10 - Service Request transition is reflected
// ---------------------------------------------------------------------------

test("T14: Pending to In Progress is reflected after refresh", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    const serviceRequest = submitRequest(setup, resident.id);
    await createRequestsByStatus(setup, resident.id, { pending: 1, completed: 1 });

    const before = await getDashboardMetrics(setup.app);

    await transition(setup, serviceRequest.id, "In Progress");

    const after = await getDashboardMetrics(setup.app);

    assert.equal(after["service-requests-pending"], before["service-requests-pending"] - 1);
    assert.equal(
      after["service-requests-in-progress"],
      before["service-requests-in-progress"] + 1
    );
    assert.equal(after["service-requests-completed"], before["service-requests-completed"]);
    assert.equal(after["service-requests-total"], before["service-requests-total"]);
    assert.equal(after["service-requests-open"], before["service-requests-open"]);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 11 - Terminal transition updates Open
// ---------------------------------------------------------------------------

test("T14: completing or cancelling an In Progress request lowers Open", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    const toComplete = submitRequest(setup, resident.id);
    const toCancel = submitRequest(setup, resident.id);
    await transition(setup, toComplete.id, "In Progress");
    await transition(setup, toCancel.id, "In Progress");

    const before = await getDashboardMetrics(setup.app);

    // Complete through the existing T13 interface (which uses T10).
    await request(setup.app).post(`/service-requests/${toComplete.id}/complete`);
    const afterComplete = await getDashboardMetrics(setup.app);

    assert.equal(afterComplete["service-requests-open"], before["service-requests-open"] - 1);
    assert.equal(
      afterComplete["service-requests-in-progress"],
      before["service-requests-in-progress"] - 1
    );
    assert.equal(
      afterComplete["service-requests-completed"],
      before["service-requests-completed"] + 1
    );
    assert.equal(afterComplete["service-requests-total"], before["service-requests-total"]);

    await request(setup.app).post(`/service-requests/${toCancel.id}/cancel`);
    const afterCancel = await getDashboardMetrics(setup.app);

    assert.equal(afterCancel["service-requests-open"], before["service-requests-open"] - 2);
    assert.equal(
      afterCancel["service-requests-cancelled"],
      before["service-requests-cancelled"] + 1
    );
    assert.equal(afterCancel["service-requests-total"], before["service-requests-total"]);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 12 - Recent requests return no more than five
// ---------------------------------------------------------------------------

test("T14: recent Service Requests show at most five", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });

    for (let day = 1; day <= 8; day += 1) {
      submitRequest(setup, resident.id, {
        dateRequested: `2026-11-${String(day).padStart(2, "0")}`
      });
    }

    const response = await request(setup.app).get("/dashboard");

    assert.equal(recentIds(response.text).length, 5);
    assert.equal(readMetrics(response.text)["service-requests-total"], 8);

    // Fewer than five: all are shown.
    const smallSetup = createDashboardSetup();

    try {
      const [smallResident] = registerResidents(smallSetup, { active: 1 });
      submitRequest(smallSetup, smallResident.id);
      submitRequest(smallSetup, smallResident.id);

      const smallResponse = await request(smallSetup.app).get("/dashboard");
      assert.equal(recentIds(smallResponse.text).length, 2);
    } finally {
      smallSetup.cleanup();
    }
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 13 - Recent requests use T11 ordering
// ---------------------------------------------------------------------------

test("T14: recent Service Requests use dateRequested DESC then id DESC", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    const submit = (dateRequested) => submitRequest(setup, resident.id, { dateRequested });

    const oldest = submit("2026-10-01");
    const sameDayFirst = submit("2026-11-10");
    const newest = submit("2026-11-12");
    const sameDaySecond = submit("2026-11-10");
    const middle = submit("2026-10-15");
    const sameDayThird = submit("2026-11-10");

    const response = await request(setup.app).get("/dashboard");

    assert.deepEqual(recentIds(response.text), [
      newest.id,
      sameDayThird.id,
      sameDaySecond.id,
      sameDayFirst.id,
      middle.id
    ]);
    assert.equal(recentIds(response.text).includes(oldest.id), false);

    // Each row shows the required fields and links to the T13 details page.
    const rows = recentTable(response.text);
    assert.match(rows, new RegExp(`<td>${newest.id}</td>`));
    assert.match(rows, new RegExp(`<td>${resident.id}</td>`));
    assert.match(rows, />Barangay Clearance</);
    assert.match(rows, />2026-11-12</);
    assert.match(rows, />Pending</);

    const details = await request(setup.app).get(`/service-requests/${newest.id}`);
    assert.equal(details.statusCode, 200);
    assert.match(details.text, new RegExp(`Service Request #${newest.id}`));
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 14 - Terminal requests may appear in recent results
// ---------------------------------------------------------------------------

test("T14: recent Completed and Cancelled requests are not hidden", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1 });
    submitRequest(setup, resident.id, { dateRequested: "2026-10-01" });
    const completed = submitRequest(setup, resident.id, { dateRequested: "2026-11-12" });
    const cancelled = submitRequest(setup, resident.id, { dateRequested: "2026-11-11" });

    await transition(setup, completed.id, "In Progress", "Completed");
    await transition(setup, cancelled.id, "Cancelled");

    const response = await request(setup.app).get("/dashboard");
    const ids = recentIds(response.text);

    assert.equal(ids[0], completed.id);
    assert.equal(ids[1], cancelled.id);
    assert.match(recentTable(response.text), />Completed</);
    assert.match(recentTable(response.text), />Cancelled</);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 15 - Dashboard GET does not modify persistence
// ---------------------------------------------------------------------------

test("T14: viewing the dashboard repeatedly does not modify persistence", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 2, inactive: 1 });
    await createRequestsByStatus(setup, resident.id, {
      pending: 1,
      inProgress: 1,
      completed: 1,
      cancelled: 1
    });

    const before = snapshot(setup);
    const firstMetrics = await getDashboardMetrics(setup.app);

    for (let index = 0; index < 3; index += 1) {
      assert.deepEqual(await getDashboardMetrics(setup.app), firstMetrics);
    }

    assert.deepEqual(snapshot(setup), before);

    // The dashboard exposes no state-changing method.
    const postResponse = await request(setup.app).post("/dashboard");
    assert.equal(postResponse.statusCode, 404);
    assert.deepEqual(snapshot(setup), before);
  } finally {
    setup.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Persistence-level aggregation
// ---------------------------------------------------------------------------

test("T14: repositories aggregate counts and recent rows in the database", async () => {
  const setup = createDashboardSetup();

  try {
    assert.equal(setup.residentRepository.countAll(), 0);
    assert.deepEqual(setup.residentRepository.countByStatus(), {});
    assert.equal(setup.serviceRequestRepository.countAll(), 0);
    assert.deepEqual(setup.serviceRequestRepository.countByStatus(), {});
    assert.deepEqual(setup.serviceRequestRepository.findRecent(5), []);

    const [resident] = registerResidents(setup, { active: 2, inactive: 1 });
    await createRequestsByStatus(setup, resident.id, {
      pending: 2,
      inProgress: 1,
      cancelled: 1
    });

    assert.equal(setup.residentRepository.countAll(), 3);
    assert.deepEqual(setup.residentRepository.countByStatus(), {
      Active: 2,
      Inactive: 1
    });
    assert.equal(setup.serviceRequestRepository.countAll(), 4);
    assert.deepEqual(setup.serviceRequestRepository.countByStatus(), {
      "Pending": 2,
      "In Progress": 1,
      "Cancelled": 1
    });

    // findRecent returns the same order as the T11 listing, cut to the limit.
    assert.deepEqual(
      setup.serviceRequestRepository.findRecent(3),
      setup.serviceRequestRepository.listServiceRequests().slice(0, 3)
    );
  } finally {
    setup.cleanup();
  }
});

test("T14: DashboardService never loads every record to count", async () => {
  const setup = createDashboardSetup();

  try {
    const [resident] = registerResidents(setup, { active: 1, inactive: 1 });
    await createRequestsByStatus(setup, resident.id, { pending: 1, completed: 1 });

    // Any attempt to load complete tables fails the test.
    const forbidLoadingAll = (repository, methods) => new Proxy(repository, {
      get(target, property) {
        if (methods.includes(property)) {
          return () => assert.fail(`DashboardService must not call ${property}()`);
        }

        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });

    const service = new DashboardService(
      forbidLoadingAll(setup.residentRepository, ["listResidents", "searchResidents"]),
      forbidLoadingAll(setup.serviceRequestRepository, [
        "listServiceRequests",
        "searchServiceRequests",
        "filterByStatus"
      ])
    );

    const summary = service.getSummary();

    assert.deepEqual(summary.residents, { total: 2, active: 1, inactive: 1 });
    assert.deepEqual(summary.serviceRequests, {
      total: 2,
      open: 1,
      pending: 1,
      inProgress: 0,
      completed: 1,
      cancelled: 0
    });
    assert.equal(summary.recentServiceRequests.length, 2);
  } finally {
    setup.cleanup();
  }
});

test("T14: Resident and Service Request pages show the shared navigation", async () => {
  const setup = createDashboardSetup();

  try {
    for (const url of ["/residents", "/service-requests"]) {
      const response = await request(setup.app).get(url);

      assert.equal(response.statusCode, 200);
      assert.match(response.text, /href="\/dashboard">Dashboard</);
    }
  } finally {
    setup.cleanup();
  }
});
