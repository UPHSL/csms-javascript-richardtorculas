import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import request from "supertest";

import { createApp } from "../src/app.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ServiceRequestRepository }
  from "../src/repositories/ServiceRequestRepository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Start the real CSMS application on an existing SQLite file.  Calling this
// twice on the same file simulates stopping and restarting the application.
function startApplication(databasePath) {
  const residentRepository = new ResidentRepository(databasePath);
  const serviceRequestRepository = new ServiceRequestRepository(databasePath);

  return {
    app: createApp({ residentRepository, serviceRequestRepository }),
    residentRepository,
    serviceRequestRepository,
    stop() {
      residentRepository.close();
      serviceRequestRepository.close();
    }
  };
}

// Register a Resident through the T12 browser form (T04 + T02 underneath).
async function registerThroughInterface(app, form) {
  const response = await request(app)
    .post("/residents/register")
    .type("form")
    .send(form);

  assert.equal(response.statusCode, 303, `registration of ${form.firstName}`);
}

// Submit a Service Request through the T13 browser form (T09 underneath).
async function submitThroughInterface(app, form) {
  return request(app).post("/service-requests").type("form").send(form);
}

// Read every dashboard metric card as numbers.
function readMetrics(html) {
  const pattern =
    /data-metric="([^"]+)">\s*<span class="stat-label">[^<]*<\/span>\s*<span class="stat-value">(\d+)<\/span>/g;

  return Object.fromEntries(
    [...html.matchAll(pattern)].map((match) => [match[1], Number(match[2])])
  );
}

// Service Request ids shown in a rendered table, in display order.
function renderedRequestIds(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";

  return [...body.matchAll(/href="\/service-requests\/(\d+)"/g)]
    .map((match) => Number(match[1]));
}

// ---------------------------------------------------------------------------
// T16 Final Examination integration test
// ---------------------------------------------------------------------------

test(
  "a Resident's complete service history stays consistent across every view " +
    "and survives an application restart",
  async () => {
    const databasePath = path.join(
      os.tmpdir(),
      `csms-t16-final-${crypto.randomUUID()}.sqlite`
    );

    let running = startApplication(databasePath);

    try {
      // -- Starting state: a brand-new, empty CSMS database. --------------
      assert.equal(running.residentRepository.countAll(), 0);
      assert.equal(running.serviceRequestRepository.countAll(), 0);

      // -- 1. Residents register through the browser (T02, T04, T12). -----
      await registerThroughInterface(running.app, {
        firstName: "Lorna",
        lastName: "Villanueva",
        address: "Purok 2, Barangay Santo Tomas",
        contactNumber: "09171112222",
        email: "lorna@example.com"
      });
      await registerThroughInterface(running.app, {
        firstName: "Danilo",
        lastName: "Aquino",
        address: "Purok 5, Barangay Santo Tomas",
        contactNumber: "09183334444",
        email: "danilo@example.com"
      });

      const [lorna] = running.residentRepository.searchResidents("Villanueva");
      const [danilo] = running.residentRepository.searchResidents("Aquino");

      // -- 2. Service Requests are submitted (T08, T09, T13). -------------
      const requestForms = [
        { owner: lorna, serviceType: "Barangay Clearance", date: "2026-11-10" },
        { owner: lorna, serviceType: "Streetlight Repair", date: "2026-11-12" },
        { owner: lorna, serviceType: "Garbage Collection", date: "2026-11-12" },
        { owner: danilo, serviceType: "Certificate of Indigency", date: "2026-11-11" }
      ];

      for (const form of requestForms) {
        const response = await submitThroughInterface(running.app, {
          residentId: String(form.owner.id),
          serviceType: form.serviceType,
          description: `${form.serviceType} requested by ${form.owner.firstName}.`,
          dateRequested: form.date
        });

        assert.equal(response.statusCode, 303, `submission of ${form.serviceType}`);
      }

      const byType = (serviceType) => running.serviceRequestRepository
        .searchServiceRequests(serviceType)[0];

      const clearance = byType("Barangay Clearance");
      const streetlight = byType("Streetlight Repair");
      const garbage = byType("Garbage Collection");
      const indigency = byType("Certificate of Indigency");

      // -- 3. Requests move through the controlled workflow (T10, T13). ---
      await request(running.app).post(`/service-requests/${clearance.id}/start`);
      await request(running.app).post(`/service-requests/${clearance.id}/complete`);
      await request(running.app).post(`/service-requests/${streetlight.id}/cancel`);
      await request(running.app).post(`/service-requests/${garbage.id}/start`);

      // A terminal request cannot be reopened, even by a crafted request.
      const reopen = await request(running.app)
        .post(`/service-requests/${clearance.id}/cancel`);
      assert.equal(reopen.statusCode, 409);

      // -- 4. Lorna's contact number changes, then she is deactivated -----
      //       (T06, T07, T12).
      const update = await request(running.app)
        .post(`/residents/${lorna.id}/update`)
        .type("form")
        .send({
          firstName: "Lorna",
          lastName: "Villanueva",
          address: "Purok 2, Barangay Santo Tomas",
          contactNumber: "09179998888",
          email: "lorna@example.com"
        });
      assert.equal(update.statusCode, 303);

      await request(running.app).post(`/residents/${lorna.id}/deactivate`);

      // An Inactive Resident can no longer submit (T09 eligibility).
      const rejected = await submitThroughInterface(running.app, {
        residentId: String(lorna.id),
        serviceType: "Business Permit",
        description: "Should be refused.",
        dateRequested: "2026-11-13"
      });
      assert.equal(rejected.statusCode, 422);

      // -- 5. Restart: close every connection and start a fresh app on ----
      //       the same database file.
      running.stop();
      running = startApplication(databasePath);

      // -- Expected final state, read back through the restarted app. -----

      // Persisted Residents (T03): identity kept, update and lifecycle saved.
      const storedLorna = running.residentRepository.findById(lorna.id);
      assert.equal(storedLorna.contactNumber, "09179998888");
      assert.equal(storedLorna.status, "Inactive");
      assert.equal(running.residentRepository.findById(danilo.id).status, "Active");
      assert.equal(running.residentRepository.countAll(), 2);

      // Persisted Service Requests: statuses saved, every other field and
      // the Resident relationship preserved, the refused request absent.
      const expectedStatuses = new Map([
        [clearance.id, "Completed"],
        [streetlight.id, "Cancelled"],
        [garbage.id, "In Progress"],
        [indigency.id, "Pending"]
      ]);

      for (const original of [clearance, streetlight, garbage, indigency]) {
        const stored = running.serviceRequestRepository.findById(original.id);

        assert.deepEqual(
          { ...stored },
          { ...original, status: expectedStatuses.get(original.id) }
        );
      }
      assert.equal(running.serviceRequestRepository.countAll(), 4);
      assert.equal(
        running.serviceRequestRepository.searchServiceRequests("Business Permit").length,
        0
      );

      // Dashboard aggregates (T14) agree with persistence.
      const dashboard = await request(running.app).get("/dashboard");
      assert.deepEqual(readMetrics(dashboard.text), {
        "residents-total": 2,
        "residents-active": 1,
        "residents-inactive": 1,
        "service-requests-open": 2,
        "service-requests-total": 4,
        "service-requests-pending": 1,
        "service-requests-in-progress": 1,
        "service-requests-completed": 1,
        "service-requests-cancelled": 1
      });

      // Recent requests keep T11 ordering: date DESC, then id DESC.
      assert.deepEqual(renderedRequestIds(dashboard.text), [
        garbage.id,
        streetlight.id,
        indigency.id,
        clearance.id
      ]);

      // Query views (T05, T11, T12, T13) agree with persistence.
      const cancelledStreetlight = await request(running.app)
        .get("/service-requests")
        .query({ search: "STREET", status: "Cancelled" });
      assert.deepEqual(renderedRequestIds(cancelledStreetlight.text), [streetlight.id]);

      const details = await request(running.app)
        .get(`/service-requests/${clearance.id}`);
      assert.match(details.text, new RegExp(`<dd>${lorna.id}</dd>`));
      assert.match(details.text, />Completed</);
      assert.match(details.text, /No further workflow actions are available\./);

      const residentSearch = await request(running.app)
        .get("/residents")
        .query({ search: "villa" });
      assert.match(residentSearch.text, /09179998888/);
      assert.match(residentSearch.text, />\s*Inactive\s*</);
    } finally {
      running.stop();

      if (fs.existsSync(databasePath)) {
        fs.unlinkSync(databasePath);
      }
    }
  }
);
