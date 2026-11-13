import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { DatabaseSync } from "node:sqlite";

import { Resident } from "../src/models/Resident.js";
import { ResidentValidator } from "../src/services/ResidentValidator.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ResidentUpdateService } from "../src/services/ResidentUpdateService.js";
import { ResidentQueryService } from "../src/services/ResidentQueryService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t06-${crypto.randomUUID()}.sqlite`;
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

// Assemble the T06 components against a temporary database.
function createUpdateSetup() {
  const databasePath = createTemporaryDatabasePath();
  const repository = new ResidentRepository(databasePath);
  const validator = new ResidentValidator();
  const service = new ResidentUpdateService(validator, repository);
  const queryService = new ResidentQueryService(repository);
  return { databasePath, repository, validator, service, queryService };
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
// T06 Tests
// ---------------------------------------------------------------------------
test("Test 1 - valid Resident update succeeds", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());

    const result = service.updateResident(saved.id, {
      firstName: "Juan Miguel",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

    assert.equal(result.success, true);
    assert.ok(result.resident);
    assert.deepEqual(result.errors, []);
    assert.equal(result.notFound, false);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 2 - Resident ID is preserved after a valid update", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());
    const originalId = saved.id;

    const result = service.updateResident(originalId, {
      firstName: "Juan Miguel",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

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

test("Test 3 - all permitted Resident information is persisted", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());
    const originalId = saved.id;

    const result = service.updateResident(originalId, {
      firstName: "Maria Clara",
      lastName: "Santos",
      address: "Barangay San Isidro",
      contactNumber: "09181234567",
      email: "maria.santos@example.com"
    });

    assert.equal(result.success, true);

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.firstName, "Maria Clara");
    assert.equal(stored.lastName, "Santos");
    assert.equal(stored.address, "Barangay San Isidro");
    assert.equal(stored.contactNumber, "09181234567");
    assert.equal(stored.email, "maria.santos@example.com");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 4 - Resident status is preserved (Active remains Active)", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));

    const result = service.updateResident(saved.id, {
      firstName: "Juan Miguel",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com",
      status: "Inactive"
    });

    assert.equal(result.success, true);
    assert.equal(result.resident.status, "Active");

    const stored = repository.findById(saved.id);
    assert.equal(stored.status, "Active");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 4 - Resident status is preserved (Inactive remains Inactive)", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Inactive" }));

    const result = service.updateResident(saved.id, {
      firstName: "Juan Miguel",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com",
      status: "Active"
    });

    assert.equal(result.success, true);
    assert.equal(result.resident.status, "Inactive");

    const stored = repository.findById(saved.id);
    assert.equal(stored.status, "Inactive");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});
test("Test 5 - invalid update fails with validation errors", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());

    const result = service.updateResident(saved.id, {
      firstName: "",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

    assert.equal(result.success, false);
    assert.equal(result.resident, null);
    assert.equal(result.notFound, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.includes("firstName"));
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 6 - invalid update does not modify persisted information", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());
    const originalId = saved.id;

    const result = service.updateResident(originalId, {
      firstName: "",
      lastName: "ShouldNotSave",
      address: "Should Not Save",
      contactNumber: "ABC",
      email: "juan@example.com"
    });

    assert.equal(result.success, false);
    assert.ok(result.errors.includes("firstName"));
    assert.ok(result.errors.includes("contactNumber"));

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(stored.firstName, "Juan");
    assert.equal(stored.lastName, "Dela Cruz");
    assert.equal(stored.address, "Barangay Santo Tomas");
    assert.equal(stored.contactNumber, "09171234567");
    assert.equal(stored.email, "juan@example.com");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 7 - updating a nonexistent Resident is handled safely", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const result = service.updateResident(999999, {
      firstName: "Miguel",
      lastName: "Santos",
      address: "Barangay San Isidro",
      contactNumber: "09181234567",
      email: "miguel@example.com"
    });

    assert.equal(result.success, false);
    assert.equal(result.resident, null);
    assert.deepEqual(result.errors, []);
    assert.equal(result.notFound, true);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 8 - nonexistent Resident update does not create a Resident", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const countBefore = countResidents(databasePath);

    const result = service.updateResident(999999, {
      firstName: "Miguel",
      lastName: "Santos",
      address: "Barangay San Isidro",
      contactNumber: "09181234567",
      email: "miguel@example.com"
    });

    const countAfter = countResidents(databasePath);

    assert.equal(result.success, false);
    assert.equal(result.notFound, true);
    assert.equal(countAfter, countBefore);
    assert.equal(repository.findById(999999), null);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});
test("Test 9 - updated Resident is visible through T05 search and listing", () => {
  const { databasePath, repository, service, queryService } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident({
      firstName: "Juan",
      lastName: "Cruz",
      email: "juan@example.com"
    }));

    const result = service.updateResident(saved.id, {
      firstName: "Miguel",
      lastName: "Santos",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "miguel.santos@example.com"
    });

    assert.equal(result.success, true);

    const searchResults = queryService.searchResidents("Miguel");
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, saved.id);
    assert.equal(searchResults[0].firstName, "Miguel");
    assert.equal(searchResults[0].lastName, "Santos");

    const oldNameResults = queryService.searchResidents("Juan");
    assert.deepEqual(oldNameResults, []);

    const listed = queryService.listResidents();
    const listedUpdated = listed.find((r) => r.id === saved.id);
    assert.ok(listedUpdated);
    assert.equal(listedUpdated.firstName, "Miguel");
    assert.equal(listedUpdated.lastName, "Santos");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("Test 10 - updated information and contact number preserve leading zero", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident({ status: "Active" }));
    const originalId = saved.id;

    const result = service.updateResident(originalId, {
      firstName: "Rosa",
      lastName: "Dizon",
      address: "Barangay Manggahan",
      contactNumber: "09181234567",
      email: "rosa.dizon@example.com"
    });

    assert.equal(result.success, true);

    const stored = repository.findById(originalId);
    assert.ok(stored);
    assert.equal(typeof stored.contactNumber, "string");
    assert.equal(stored.contactNumber, "09181234567");
    assert.equal(stored.firstName, "Rosa");
    assert.equal(stored.lastName, "Dizon");
    assert.equal(stored.address, "Barangay Manggahan");
    assert.equal(stored.email, "rosa.dizon@example.com");
    assert.equal(stored.id, originalId);
    assert.equal(stored.status, "Active");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});
test("a valid update does not create another Resident row", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());
    const countBefore = countResidents(databasePath);

    const result = service.updateResident(saved.id, {
      firstName: "Juan Miguel",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

    const countAfter = countResidents(databasePath);

    assert.equal(result.success, true);
    assert.equal(countAfter, countBefore);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("updating one Resident does not modify another Resident", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const first = repository.save(makeValidResident({
      firstName: "Ana",
      lastName: "Cruz",
      email: "ana@example.com",
      contactNumber: "09171110001"
    }));

    const second = repository.save(makeValidResident({
      firstName: "Carlos",
      lastName: "Garcia",
      email: "carlos@example.com",
      contactNumber: "09172220002"
    }));

    const result = service.updateResident(first.id, {
      firstName: "Ana Marie",
      lastName: "Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171110001",
      email: "ana.marie@example.com"
    });

    assert.equal(result.success, true);

    const firstStored = repository.findById(first.id);
    const secondStored = repository.findById(second.id);

    assert.equal(firstStored.firstName, "Ana Marie");
    assert.equal(firstStored.email, "ana.marie@example.com");

    assert.equal(secondStored.firstName, "Carlos");
    assert.equal(secondStored.lastName, "Garcia");
    assert.equal(secondStored.address, "Barangay Santo Tomas");
    assert.equal(secondStored.contactNumber, "09172220002");
    assert.equal(secondStored.email, "carlos@example.com");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("update result distinguishes success, validation failure, and not found", () => {
  const { databasePath, repository, service } = createUpdateSetup();

  try {
    const saved = repository.save(makeValidResident());

    const successful = service.updateResident(saved.id, {
      firstName: "Juan",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

    const validationFailure = service.updateResident(saved.id, {
      firstName: "",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com"
    });

    const notFound = service.updateResident(999999, {
      firstName: "Miguel",
      lastName: "Santos",
      address: "Barangay San Isidro",
      contactNumber: "09181234567",
      email: "miguel@example.com"
    });

    assert.equal(successful.success, true);
    assert.equal(successful.notFound, false);
    assert.deepEqual(successful.errors, []);

    assert.equal(validationFailure.success, false);
    assert.equal(validationFailure.notFound, false);
    assert.ok(validationFailure.errors.length > 0);
    assert.ok(validationFailure.errors.includes("firstName"));

    assert.equal(notFound.success, false);
    assert.equal(notFound.notFound, true);
    assert.deepEqual(notFound.errors, []);
    assert.equal(notFound.resident, null);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("updated data survives a separate repository instance (real SQLite file)", (t) => {
  const databasePath = createTemporaryDatabasePath();

  t.after(() => {
    removeDatabase(databasePath);
  });

  const firstRepo = new ResidentRepository(databasePath);
  const validator = new ResidentValidator();
  const service = new ResidentUpdateService(validator, firstRepo);

  const saved = firstRepo.save(makeValidResident({ firstName: "Juan", lastName: "Cruz" }));
  const originalId = saved.id;

  const result = service.updateResident(originalId, {
    firstName: "Miguel",
    lastName: "Santos",
    address: "Barangay San Isidro",
    contactNumber: "09181234567",
    email: "miguel.santos@example.com"
  });

  assert.equal(result.success, true);
  firstRepo.close();

  const secondRepo = new ResidentRepository(databasePath);
  try {
    const found = secondRepo.findById(originalId);
    assert.ok(found);
    assert.equal(found.id, originalId);
    assert.equal(found.firstName, "Miguel");
    assert.equal(found.lastName, "Santos");
    assert.equal(found.address, "Barangay San Isidro");
    assert.equal(found.contactNumber, "09181234567");
    assert.equal(found.email, "miguel.santos@example.com");
  } finally {
    secondRepo.close();
  }
});
