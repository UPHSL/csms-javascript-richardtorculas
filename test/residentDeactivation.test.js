import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { DatabaseSync } from "node:sqlite";

import { Resident } from "../src/models/Resident.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ResidentDeactivationService }
  from "../src/services/ResidentDeactivationService.js";
import { ResidentQueryService } from "../src/services/ResidentQueryService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t07-${crypto.randomUUID()}.sqlite`;
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

// Assemble the T07 components against a temporary database.
function createDeactivationSetup() {
  const databasePath = createTemporaryDatabasePath();
  const repository = new ResidentRepository(databasePath);
  const service = new ResidentDeactivationService(repository);
  const queryService = new ResidentQueryService(repository);
  return { databasePath, repository, service, queryService };
}

// Count Resident rows directly in SQLite (test-only; production uses the repo).
function countResidents(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const statement = database.prepare(
      "SELECT COUNT(*) AS count FROM residents"
    );
    const row = statement.get();
    return Number(row.count);
  } finally {
    database.close();
  }
}

// ---------------------------------------------------------------------------
// T07 Tests
// ---------------------------------------------------------------------------

test("Test 1 - Active Resident can be deactivated", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));

    const result = service.deactivateResident(saved.id);

    assert.equal(result.success, true);
    assert.ok(result.resident);
    assert.equal(result.notFound, false);
    assert.equal(result.alreadyInactive, false);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 2 - Resident status becomes Inactive in persistence", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));

    const result = service.deactivateResident(saved.id);

    assert.equal(result.success, true);
    assert.equal(result.resident.status, "Inactive");

    const stored = repository.findById(saved.id);
    assert.ok(stored);
    assert.equal(stored.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 3 - Resident ID is preserved after deactivation", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const originalId = saved.id;

    const result = service.deactivateResident(originalId);

    assert.equal(result.success, true);
    assert.equal(result.resident.id, originalId);

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.id, originalId);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 4 - Resident information is preserved after deactivation", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({
      firstName: "Juan",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com",
      status: "Active"
    }));
    const originalId = saved.id;

    const result = service.deactivateResident(originalId);

    assert.equal(result.success, true);

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.id, originalId);
    assert.equal(stored.firstName, "Juan");
    assert.equal(stored.lastName, "Dela Cruz");
    assert.equal(stored.address, "Barangay Santo Tomas");
    assert.equal(stored.contactNumber, "09171234567");
    assert.equal(stored.email, "juan@example.com");
    assert.equal(stored.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 5 - deactivated Resident remains persisted and retrievable", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const originalId = saved.id;

    const result = service.deactivateResident(originalId);

    assert.equal(result.success, true);

    const resident = repository.findById(originalId);
    assert.ok(resident);
    assert.equal(resident.id, originalId);
    assert.equal(resident.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 6 - deactivated Resident remains available through T05", () => {
  const { databasePath, repository, service, queryService } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({
      firstName: "Miguel",
      lastName: "Santos",
      status: "Active"
    }));
    const originalId = saved.id;

    const result = service.deactivateResident(originalId);
    assert.equal(result.success, true);

    const searchResults = queryService.searchResidents("Miguel");
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, originalId);
    assert.equal(searchResults[0].status, "Inactive");

    const listed = queryService.listResidents();
    const listedResident = listed.find((r) => r.id === originalId);
    assert.ok(listedResident);
    assert.equal(listedResident.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 7 - already-Inactive Resident is handled safely", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({
      firstName: "Ana",
      lastName: "Cruz",
      email: "ana@example.com",
      contactNumber: "09171110001",
      status: "Inactive"
    }));
    const originalId = saved.id;
    const countBefore = countResidents(databasePath);

    const result = service.deactivateResident(originalId);

    assert.equal(result.success, true);
    assert.equal(result.alreadyInactive, true);
    assert.equal(result.resident.id, originalId);
    assert.equal(result.resident.status, "Inactive");

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.id, originalId);
    assert.equal(stored.status, "Inactive");
    assert.equal(stored.firstName, "Ana");
    assert.equal(stored.lastName, "Cruz");
    assert.equal(stored.contactNumber, "09171110001");

    assert.equal(countResidents(databasePath), countBefore);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 8 - nonexistent Resident deactivation is handled safely", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const result = service.deactivateResident(999999);

    assert.equal(result.success, false);
    assert.equal(result.resident, null);
    assert.equal(result.notFound, true);
    assert.equal(result.alreadyInactive, false);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 9 - nonexistent deactivation does not create or delete records", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const countBefore = countResidents(databasePath);

    const result = service.deactivateResident(999999);

    const countAfter = countResidents(databasePath);

    assert.equal(result.success, false);
    assert.equal(result.notFound, true);
    assert.equal(countAfter, countBefore);

    const existing = repository.findById(saved.id);
    assert.ok(existing);
    assert.equal(existing.status, "Active");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 10 - deactivating one Resident does not affect another", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const first = repository.save(makeValidResident({
      firstName: "Juan",
      lastName: "Dela Cruz",
      email: "juan@example.com",
      contactNumber: "09171234567",
      status: "Active"
    }));

    const second = repository.save(makeValidResident({
      firstName: "Maria",
      lastName: "Santos",
      email: "maria@example.com",
      contactNumber: "09181110001",
      status: "Active"
    }));

    const third = repository.save(makeValidResident({
      firstName: "Pedro",
      lastName: "Reyes",
      email: "pedro@example.com",
      contactNumber: "09182220002",
      status: "Active"
    }));

    const result = service.deactivateResident(second.id);

    assert.equal(result.success, true);

    const firstStored = repository.findById(first.id);
    const secondStored = repository.findById(second.id);
    const thirdStored = repository.findById(third.id);

    assert.equal(firstStored.status, "Active");
    assert.equal(firstStored.firstName, "Juan");
    assert.equal(firstStored.lastName, "Dela Cruz");

    assert.equal(secondStored.status, "Inactive");
    assert.equal(secondStored.firstName, "Maria");
    assert.equal(secondStored.lastName, "Santos");

    assert.equal(thirdStored.status, "Active");
    assert.equal(thirdStored.firstName, "Pedro");
    assert.equal(thirdStored.lastName, "Reyes");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("deactivation does not physically delete the Resident record", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const countBefore = countResidents(databasePath);

    const result = service.deactivateResident(saved.id);

    assert.equal(result.success, true);
    assert.equal(countResidents(databasePath), countBefore);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("repeated deactivation is idempotent and safe", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const originalId = saved.id;
    const countBefore = countResidents(databasePath);

    const first = service.deactivateResident(originalId);
    const second = service.deactivateResident(originalId);
    const third = service.deactivateResident(originalId);

    assert.equal(first.success, true);
    assert.equal(first.alreadyInactive, false);

    assert.equal(second.success, true);
    assert.equal(second.alreadyInactive, true);

    assert.equal(third.success, true);
    assert.equal(third.alreadyInactive, true);

    const stored = repository.findById(originalId);
    assert.equal(stored.status, "Inactive");
    assert.equal(stored.id, originalId);
    assert.equal(countResidents(databasePath), countBefore);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("contact number retains its leading zero after deactivation", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const saved = repository.save(makeValidResident({
      contactNumber: "09181234567",
      status: "Active"
    }));

    const result = service.deactivateResident(saved.id);

    assert.equal(result.success, true);

    const stored = repository.findById(saved.id);
    assert.ok(stored);
    assert.equal(typeof stored.contactNumber, "string");
    assert.equal(stored.contactNumber, "09181234567");
    assert.equal(stored.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("deactivation result distinguishes newly deactivated, already Inactive, and not found", () => {
  const { databasePath, repository, service } = createDeactivationSetup();

  try {
    const active = repository.save(makeValidResident({ status: "Active" }));
    const inactive = repository.save(makeValidResident({
      firstName: "Ana",
      email: "ana@example.com",
      contactNumber: "09171110001",
      status: "Inactive"
    }));

    const newly = service.deactivateResident(active.id);
    const already = service.deactivateResident(inactive.id);
    const missing = service.deactivateResident(999999);

    assert.equal(newly.success, true);
    assert.equal(newly.alreadyInactive, false);
    assert.equal(newly.notFound, false);

    assert.equal(already.success, true);
    assert.equal(already.alreadyInactive, true);
    assert.equal(already.notFound, false);

    assert.equal(missing.success, false);
    assert.equal(missing.alreadyInactive, false);
    assert.equal(missing.notFound, true);
    assert.equal(missing.resident, null);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});