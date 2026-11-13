import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import request from "supertest";

import { createApp } from "../src/app.js";
import { Resident } from "../src/models/Resident.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ResidentRegistrationService }
  from "../src/services/ResidentRegistrationService.js";
import { ResidentDeactivationService }
  from "../src/services/ResidentDeactivationService.js";
import { ResidentValidator } from "../src/services/ResidentValidator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t12-${crypto.randomUUID()}.sqlite`;
  return path.join(os.tmpdir(), fileName);
}

// Build the real application around a temporary-database repository, so
// every request travels route -> controller -> service -> validator -> SQLite.
function createInterfaceSetup() {
  const databasePath = createTemporaryDatabasePath();
  const repository = new ResidentRepository(databasePath);
  const app = createApp({ residentRepository: repository });

  const cleanup = () => {
    repository.close();

    if (fs.existsSync(databasePath)) {
      fs.unlinkSync(databasePath);
    }
  };

  return { app, repository, cleanup };
}

// Valid registration form input satisfying all T02 rules.
function validFormInput(overrides = {}) {
  return {
    firstName: "Juan",
    lastName: "Dela Cruz",
    address: "Barangay Santo Tomas",
    contactNumber: "09171234567",
    email: "juan@example.com",
    ...overrides
  };
}

// Persist a Resident through the established T04 registration capability.
function registerResident(repository, overrides = {}) {
  const service = new ResidentRegistrationService(
    new ResidentValidator(),
    repository
  );

  const result = service.registerResident(
    new Resident(validFormInput(overrides))
  );

  assert.equal(result.success, true, "test fixture must be valid");
  return result.resident;
}

// Persist the standard trio of Residents used by list/search tests.
function registerSampleResidents(repository) {
  return {
    maria: registerResident(repository, {
      firstName: "Maria",
      lastName: "Santos",
      contactNumber: "09181234567",
      email: "maria@example.com"
    }),
    pedro: registerResident(repository, {
      firstName: "Pedro",
      lastName: "Reyes",
      contactNumber: "09191234567",
      email: "pedro@example.com"
    }),
    ana: registerResident(repository, {
      firstName: "Ana",
      lastName: "Cruz",
      contactNumber: "09201234567",
      email: "ana@example.com"
    })
  };
}

// Extract the rendered Resident table rows from a list page.
function tableBody(html) {
  const match = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// Test 1 - Resident Management page loads successfully
// ---------------------------------------------------------------------------

test("T12: Resident Management page loads successfully", async () => {
  const { app, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app).get("/residents");

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(response.text, /<h1>Resident Management<\/h1>/);
    assert.match(response.text, /href="\/residents\/register"/);
    assert.match(response.text, /Register Resident/);
    assert.match(response.text, /name="search"/);
    assert.match(response.text, /No Residents found\./);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 2 - Resident list displays persisted Residents (T05 ordering)
// ---------------------------------------------------------------------------

test("T12: Resident list displays persisted Residents in T05 order", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const { maria, pedro, ana } = registerSampleResidents(repository);

    const response = await request(app).get("/residents");
    const rows = tableBody(response.text);

    assert.equal(response.statusCode, 200);

    for (const resident of [maria, pedro, ana]) {
      assert.match(rows, new RegExp(`>${resident.firstName}<`));
      assert.match(rows, new RegExp(`>${resident.lastName}<`));
      assert.match(rows, new RegExp(resident.contactNumber));
      assert.match(rows, new RegExp(resident.email));
      assert.match(rows, new RegExp(`href="/residents/${resident.id}/edit"`));
    }

    assert.match(rows, /Barangay Santo Tomas/);
    assert.match(rows, /Active/);

    // lastName ASC: Cruz, Reyes, Santos
    const order = ["Cruz", "Reyes", "Santos"].map((name) => rows.indexOf(name));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 3 - Search uses existing T05 behavior
// ---------------------------------------------------------------------------

test("T12: Resident search is partial and case-insensitive", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    registerSampleResidents(repository);

    const response = await request(app)
      .get("/residents")
      .query({ search: "  SAN  " });

    const rows = tableBody(response.text);

    assert.equal(response.statusCode, 200);
    assert.match(rows, /Santos/);
    assert.doesNotMatch(rows, /Reyes/);
    assert.doesNotMatch(rows, /Cruz/);

    const firstNameResponse = await request(app)
      .get("/residents")
      .query({ search: "ped" });

    assert.match(tableBody(firstNameResponse.text), /Pedro/);
    assert.doesNotMatch(tableBody(firstNameResponse.text), /Maria/);
  } finally {
    cleanup();
  }
});

test("T12: no-match search renders safely with a message", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    registerSampleResidents(repository);

    const response = await request(app)
      .get("/residents")
      .query({ search: "zzz-no-match" });

    assert.equal(response.statusCode, 200);
    assert.match(response.text, /No Residents found\./);
    assert.doesNotMatch(response.text, /<tbody>/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 4 - Blank search displays all Residents
// ---------------------------------------------------------------------------

test("T12: blank or whitespace search displays all Residents", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    registerSampleResidents(repository);

    for (const search of ["", " ", "       "]) {
      const response = await request(app).get("/residents").query({ search });
      const rows = tableBody(response.text);

      assert.equal(response.statusCode, 200);
      assert.match(rows, /Santos/);
      assert.match(rows, /Reyes/);
      assert.match(rows, /Cruz/);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 5 - Registration form is accessible
// ---------------------------------------------------------------------------

test("T12: registration form renders with labelled Resident fields", async () => {
  const { app, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app).get("/residents/register");

    assert.equal(response.statusCode, 200);
    assert.match(response.text, /method="post" action="\/residents\/register"/);

    for (const [name, label] of [
      ["firstName", "First Name"],
      ["lastName", "Last Name"],
      ["address", "Address"],
      ["contactNumber", "Contact Number"],
      ["email", "Email"]
    ]) {
      assert.match(response.text, new RegExp(`<label for="${name}">${label}</label>`));
      assert.match(response.text, new RegExp(`name="${name}"`));
    }

    assert.doesNotMatch(response.text, /name="id"/);
    assert.doesNotMatch(response.text, /name="status"/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 6 - Valid registration persists Resident
// ---------------------------------------------------------------------------

test("T12: valid registration persists an Active Resident and redirects", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app)
      .post("/residents/register")
      .type("form")
      .send(validFormInput({ firstName: "Lorna", lastName: "Garcia" }));

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/residents?notice=registered");

    const residents = repository.listResidents();
    assert.equal(residents.length, 1);
    assert.equal(Number.isInteger(residents[0].id), true);
    assert.equal(residents[0].id > 0, true);
    assert.equal(residents[0].firstName, "Lorna");
    assert.equal(residents[0].status, "Active");

    const listResponse = await request(app).get(response.headers.location);
    assert.match(listResponse.text, /Resident registered successfully\./);
    assert.match(tableBody(listResponse.text), /Lorna/);
    assert.match(tableBody(listResponse.text), /Garcia/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 7 - Invalid registration shows feedback and does not persist
// ---------------------------------------------------------------------------

test("T12: invalid registration shows feedback, keeps values, persists nothing", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app)
      .post("/residents/register")
      .type("form")
      .send(validFormInput({ contactNumber: "12345", email: "not-an-email" }));

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /Contact number must follow the format 09XXXXXXXXX\./);
    assert.match(response.text, /Email address is invalid\./);
    assert.doesNotMatch(response.text, /First name is required\./);

    // Non-sensitive entered values are preserved for correction.
    assert.match(response.text, /value="Juan"/);
    assert.match(response.text, /value="Dela Cruz"/);
    assert.match(response.text, /value="Barangay Santo Tomas"/);

    assert.equal(repository.listResidents().length, 0);
  } finally {
    cleanup();
  }
});

test("T12: blank registration fields bypassing the browser are rejected", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app)
      .post("/residents/register")
      .type("form")
      .send({ firstName: "   " });

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /First name is required\./);
    assert.match(response.text, /Last name is required\./);
    assert.match(response.text, /Address is required\./);
    assert.equal(repository.listResidents().length, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 8 - Edit form displays existing Resident information
// ---------------------------------------------------------------------------

test("T12: edit form is prefilled and does not offer ID or status as inputs", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);

    const response = await request(app).get(`/residents/${resident.id}/edit`);

    assert.equal(response.statusCode, 200);
    assert.match(response.text, /value="Juan"/);
    assert.match(response.text, /value="Dela Cruz"/);
    assert.match(response.text, /value="Barangay Santo Tomas"/);
    assert.match(response.text, /value="09171234567"/);
    assert.match(response.text, /value="juan@example.com"/);
    assert.match(
      response.text,
      new RegExp(`action="/residents/${resident.id}/update"`)
    );

    // ID and status are visible as read-only information only.
    assert.match(response.text, /Resident ID/);
    assert.match(response.text, /Active/);
    assert.doesNotMatch(response.text, /name="id"/);
    assert.doesNotMatch(response.text, /name="status"/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 9 - Valid update persists changes
// ---------------------------------------------------------------------------

test("T12: valid update persists changes and preserves ID and status", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);
    new ResidentDeactivationService(repository).deactivateResident(resident.id);

    const response = await request(app)
      .post(`/residents/${resident.id}/update`)
      .type("form")
      .send({
        ...validFormInput({
          address: "Barangay San Isidro",
          email: "juan.updated@example.com"
        }),
        // Tampered fields must be ignored by the interface and T06.
        id: "999",
        status: "Active"
      });

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/residents?notice=updated");

    const updated = repository.findById(resident.id);
    assert.equal(updated.id, resident.id);
    assert.equal(updated.address, "Barangay San Isidro");
    assert.equal(updated.email, "juan.updated@example.com");
    assert.equal(updated.status, "Inactive");
    assert.equal(repository.findById(999), null);
    assert.equal(repository.listResidents().length, 1);

    const listResponse = await request(app).get(response.headers.location);
    assert.match(listResponse.text, /Resident information updated successfully\./);
    assert.match(tableBody(listResponse.text), /Barangay San Isidro/);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 10 - Invalid update does not modify Resident
// ---------------------------------------------------------------------------

test("T12: invalid update shows feedback and leaves the Resident unchanged", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);

    const response = await request(app)
      .post(`/residents/${resident.id}/update`)
      .type("form")
      .send(validFormInput({ lastName: "", contactNumber: "0917ABC4567" }));

    assert.equal(response.statusCode, 422);
    assert.match(response.text, /Last name is required\./);
    assert.match(response.text, /Contact number must follow the format 09XXXXXXXXX\./);
    // The form remains available for correction with the submitted values.
    assert.match(response.text, /value="0917ABC4567"/);
    assert.match(
      response.text,
      new RegExp(`action="/residents/${resident.id}/update"`)
    );

    assert.deepEqual(repository.findById(resident.id), resident);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 11 - Missing Resident edit is handled safely
// ---------------------------------------------------------------------------

test("T12: missing Resident edit returns a controlled 404 page", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    for (const url of ["/residents/9999/edit", "/residents/abc/edit"]) {
      const response = await request(app).get(url);

      assert.equal(response.statusCode, 404);
      assert.match(response.text, /Resident Not Found/);
      assert.match(response.text, /href="\/residents"/);
      assert.doesNotMatch(response.text, /Error:|at .*\.js/);
    }

    const updateResponse = await request(app)
      .post("/residents/9999/update")
      .type("form")
      .send(validFormInput());

    assert.equal(updateResponse.statusCode, 404);

    const deactivateResponse = await request(app)
      .post("/residents/9999/deactivate");

    assert.equal(deactivateResponse.statusCode, 404);
    assert.equal(repository.listResidents().length, 0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 12 - Active Resident can be deactivated through the interface
// ---------------------------------------------------------------------------

test("T12: Active Resident is soft-deactivated through the interface", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);

    const response = await request(app)
      .post(`/residents/${resident.id}/deactivate`);

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/residents?notice=deactivated");

    const persisted = repository.findById(resident.id);
    assert.notEqual(persisted, null);
    assert.deepEqual(persisted, new Resident({ ...resident, status: "Inactive" }));

    const listResponse = await request(app).get(response.headers.location);
    assert.match(listResponse.text, /Resident deactivated successfully\./);
    assert.match(tableBody(listResponse.text), /Dela Cruz/);
  } finally {
    cleanup();
  }
});

test("T12: repeated direct deactivation stays safe and Inactive", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);

    await request(app).post(`/residents/${resident.id}/deactivate`);
    const response = await request(app)
      .post(`/residents/${resident.id}/deactivate`);

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/residents?notice=already-inactive");
    assert.equal(repository.findById(resident.id).status, "Inactive");
    assert.equal(repository.listResidents().length, 1);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 13 - Inactive Resident remains visible
// ---------------------------------------------------------------------------

test("T12: Inactive Resident remains listed and searchable with status text", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const { maria, pedro } = registerSampleResidents(repository);
    await request(app).post(`/residents/${maria.id}/deactivate`);

    for (const query of [{}, { search: "santos" }]) {
      const response = await request(app).get("/residents").query(query);
      const rows = tableBody(response.text);

      assert.equal(response.statusCode, 200);
      assert.match(rows, /Santos/);
      assert.match(rows, />\s*Inactive\s*</);
      // No Deactivate (or reactivate) action is offered for the Inactive Resident.
      assert.doesNotMatch(rows, new RegExp(`/residents/${maria.id}/deactivate`));
      assert.doesNotMatch(rows, /Reactivate|Activate</);
    }

    const listResponse = await request(app).get("/residents");
    assert.match(
      tableBody(listResponse.text),
      new RegExp(`/residents/${pedro.id}/deactivate`)
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 14 - GET requests do not modify Residents
// ---------------------------------------------------------------------------

test("T12: GET requests never change Resident state", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    const resident = registerResident(repository);

    await request(app).get("/residents");
    await request(app).get("/residents").query({ search: "juan" });
    await request(app).get("/residents/register");
    await request(app).get(`/residents/${resident.id}/edit`);

    // Deactivation and update are not reachable through GET.
    const getDeactivate = await request(app)
      .get(`/residents/${resident.id}/deactivate`);
    const getUpdate = await request(app)
      .get(`/residents/${resident.id}/update`);

    assert.equal(getDeactivate.statusCode, 404);
    assert.equal(getUpdate.statusCode, 404);

    assert.deepEqual(repository.findById(resident.id), resident);
    assert.equal(repository.findById(resident.id).status, "Active");
    assert.equal(repository.listResidents().length, 1);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Presentation safety
// ---------------------------------------------------------------------------

test("T12: Resident data is HTML-escaped when rendered", async () => {
  const { app, repository, cleanup } = createInterfaceSetup();

  try {
    registerResident(repository, { firstName: "<script>alert(1)</script>" });

    const response = await request(app).get("/residents");

    assert.doesNotMatch(response.text, /<script>alert\(1\)<\/script>/);
    assert.match(response.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    cleanup();
  }
});

test("T12: unknown notice values are not rendered", async () => {
  const { app, cleanup } = createInterfaceSetup();

  try {
    const response = await request(app)
      .get("/residents")
      .query({ notice: "<b>injected</b>" });

    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.text, /injected/);
  } finally {
    cleanup();
  }
});
