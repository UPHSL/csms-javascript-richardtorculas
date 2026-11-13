import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Resident } from "../src/models/Resident.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a unique temporary SQLite file path for each test so that tests
 * never share state.  The file is deleted in the after() hook.
 */
function makeTempDbPath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "csms-test-"));
  return path.join(tmpDir, "test.db");
}

/**
 * Build a valid Resident that satisfies all T02 validation rules.
 * Individual tests can override specific fields via the overrides argument.
 *
 * @param {object} [overrides]
 * @returns {Resident}
 */
function makeValidResident(overrides = {}) {
  return new Resident({
    firstName:     "Juan",
    lastName:      "Dela Cruz",
    address:       "Barangay Santo Tomas",
    contactNumber: "09171234567",
    email:         "juan@example.com",
    status:        "Active",
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Test 1 — Persist a Resident
// ---------------------------------------------------------------------------

test("persist a resident succeeds without throwing", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident();

  assert.doesNotThrow(() => {
    repo.save(resident);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Resident receives a database-generated identifier after save
// ---------------------------------------------------------------------------

test("resident id is null before save and non-null after save", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident();

  assert.equal(resident.id, null);

  repo.save(resident);

  assert.notEqual(resident.id, null);
  assert.equal(typeof resident.id, "number");
});

// ---------------------------------------------------------------------------
// Test 3 — Retrieve a Resident by identifier
// ---------------------------------------------------------------------------

test("findById returns the correct resident after save", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident();
  repo.save(resident);

  const found = repo.findById(resident.id);

  assert.notEqual(found, null);
  assert.equal(found.id, resident.id);
});

// ---------------------------------------------------------------------------
// Test 4 — All Resident information is preserved after save and retrieval
// ---------------------------------------------------------------------------

test("all resident fields are preserved through save and findById", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident({
    firstName:     "Maria",
    lastName:      "Santos",
    address:       "123 Rizal Street",
    contactNumber: "09181234567",
    email:         "maria@example.com",
    status:        "Active"
  });

  repo.save(resident);

  const found = repo.findById(resident.id);

  assert.equal(found.firstName,     "Maria");
  assert.equal(found.lastName,      "Santos");
  assert.equal(found.address,       "123 Rizal Street");
  assert.equal(found.contactNumber, "09181234567");
  assert.equal(found.email,         "maria@example.com");
  assert.equal(found.status,        "Active");
});

// ---------------------------------------------------------------------------
// Test 5 — Contact number preserves its leading zero
// ---------------------------------------------------------------------------

test("contact number retains leading zero after storage and retrieval", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident({ contactNumber: "09171234567" });
  repo.save(resident);

  const found = repo.findById(resident.id);

  assert.equal(found.contactNumber, "09171234567");
  assert.equal(found.contactNumber[0], "0");
});

// ---------------------------------------------------------------------------
// Test 6 — Active status is preserved
// ---------------------------------------------------------------------------

test("Active status is preserved after save and retrieval", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const resident = makeValidResident({ status: "Active" });
  repo.save(resident);

  const found = repo.findById(resident.id);

  assert.equal(found.status, "Active");
});

// ---------------------------------------------------------------------------
// Test 7 — findById returns null for a non-existent identifier
// ---------------------------------------------------------------------------

test("findById returns null when the resident does not exist", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const result = repo.findById(99999);

  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Test 8 — Real persistence: data survives across repository instances
// ---------------------------------------------------------------------------

test("resident data persists across separate repository instances (real SQLite file)", (t) => {
  const dbPath = makeTempDbPath();

  t.after(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  // First repository instance — save a resident
  const firstRepo = new ResidentRepository(dbPath);
  const resident  = makeValidResident({
    firstName: "Pedro",
    lastName:  "Reyes",
    email:     "pedro@example.com"
  });
  firstRepo.save(resident);
  const savedId = resident.id;
  firstRepo.close();

  // Second repository instance — same file, brand-new JS object
  const secondRepo = new ResidentRepository(dbPath);
  const found      = secondRepo.findById(savedId);
  secondRepo.close();

  assert.notEqual(found, null);
  assert.equal(found.id,        savedId);
  assert.equal(found.firstName, "Pedro");
  assert.equal(found.lastName,  "Reyes");
  assert.equal(found.email,     "pedro@example.com");
});

// ---------------------------------------------------------------------------
// Test 9 (Student-designed) — Multiple residents are stored independently
//
// Rationale: a common defect in persistence layers is an off-by-one in
// identifier assignment, where every INSERT overwrites the same row or
// findById always returns the last inserted record regardless of the id
// argument.  This test saves two residents with different data and verifies
// that each can be retrieved independently with the correct information,
// which would expose that class of bug.
// ---------------------------------------------------------------------------

test("multiple residents are stored and retrieved independently by their own id", (t) => {
  const dbPath = makeTempDbPath();
  const repo   = new ResidentRepository(dbPath);

  t.after(() => {
    repo.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const residentA = makeValidResident({
    firstName: "Ana",
    lastName:  "Cruz",
    email:     "ana@example.com",
    contactNumber: "09171110001"
  });

  const residentB = makeValidResident({
    firstName: "Carlos",
    lastName:  "Garcia",
    email:     "carlos@example.com",
    contactNumber: "09172220002"
  });

  repo.save(residentA);
  repo.save(residentB);

  // IDs must be different
  assert.notEqual(residentA.id, residentB.id);

  const foundA = repo.findById(residentA.id);
  const foundB = repo.findById(residentB.id);

  assert.equal(foundA.firstName, "Ana");
  assert.equal(foundA.email,     "ana@example.com");

  assert.equal(foundB.firstName, "Carlos");
  assert.equal(foundB.email,     "carlos@example.com");
});
