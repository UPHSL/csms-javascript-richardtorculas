import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { Resident } from "../src/models/Resident.js";
import { ResidentRepository } from "../src/repositories/ResidentRepository.js";
import { ResidentQueryService } from "../src/services/ResidentQueryService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Unique temporary SQLite file for each test so tests never share state.
function createTemporaryDatabasePath() {
  const fileName = `csms-t05-${crypto.randomUUID()}.sqlite`;
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

// Assemble repository + query service against a temporary database.
function createQuerySetup() {
  const databasePath = createTemporaryDatabasePath();
  const repository = new ResidentRepository(databasePath);
  const service = new ResidentQueryService(repository);
  return { databasePath, repository, service };
}

// ---------------------------------------------------------------------------
// T05 Tests
// ---------------------------------------------------------------------------

test("listResidents returns every persisted resident", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Juan", email: "juan@example.com" }));
    repository.save(makeValidResident({ firstName: "Maria", email: "maria@example.com" }));
    repository.save(makeValidResident({ firstName: "Pedro", email: "pedro@example.com" }));

    const residents = service.listResidents();
    const firstNames = residents.map((r) => r.firstName);

    assert.equal(residents.length, 3);
    assert.ok(firstNames.includes("Juan"));
    assert.ok(firstNames.includes("Maria"));
    assert.ok(firstNames.includes("Pedro"));
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("listResidents returns an empty collection for an empty database", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    const residents = service.listResidents();

    assert.deepEqual(residents, []);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("listResidents orders by last name, first name, then id", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Ana", lastName: "Santos", email: "ana@example.com", contactNumber: "09171111001" }));
    repository.save(makeValidResident({ firstName: "Pedro", lastName: "Cruz", email: "pedro@example.com", contactNumber: "09171111002" }));
    repository.save(makeValidResident({ firstName: "Maria", lastName: "Andres", email: "maria@example.com", contactNumber: "09171111003" }));
    repository.save(makeValidResident({ firstName: "Juan", lastName: "Cruz", email: "juan@example.com", contactNumber: "09171111004" }));

    const names = service.listResidents().map((r) => `${r.lastName}, ${r.firstName}`);

    assert.deepEqual(names, [
      "Andres, Maria",
      "Cruz, Juan",
      "Cruz, Pedro",
      "Santos, Ana"
    ]);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("search matches a partial first name case-insensitively", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Juan", lastName: "Dela Cruz", email: "juan@example.com" }));

    const residents = service.searchResidents("jUa");

    assert.equal(residents.length, 1);
    assert.equal(residents[0].firstName, "Juan");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("search matches a partial last name case-insensitively", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Juan", lastName: "Dela Cruz", email: "juan@example.com" }));

    const residents = service.searchResidents("cRuZ");

    assert.equal(residents.length, 1);
    assert.equal(residents[0].lastName, "Dela Cruz");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("blank search returns all residents like the normal listing", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Juan", email: "juan@example.com" }));
    repository.save(makeValidResident({ firstName: "Maria", email: "maria@example.com" }));

    const expected = service.listResidents();
    const actual = service.searchResidents("   ");

    assert.equal(actual.length, 2);
    assert.deepEqual(actual.map((r) => r.id), expected.map((r) => r.id));
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("search with no match returns an empty collection", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Juan", lastName: "Dela Cruz", email: "juan@example.com" }));

    const residents = service.searchResidents("ZzzUnknownResident");

    assert.deepEqual(residents, []);
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("search results preserve all resident information", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    const saved = repository.save(makeValidResident({
      firstName: "Juan",
      lastName: "Dela Cruz",
      address: "Barangay Santo Tomas",
      contactNumber: "09171234567",
      email: "juan@example.com",
      status: "Active"
    }));

    const residents = service.searchResidents("Juan");
    const found = residents.find((r) => r.id === saved.id);

    assert.ok(found);
    assert.equal(found.firstName, "Juan");
    assert.equal(found.lastName, "Dela Cruz");
    assert.equal(found.address, "Barangay Santo Tomas");
    assert.equal(found.contactNumber, "09171234567");
    assert.equal(found.email, "juan@example.com");
    assert.equal(found.status, "Active");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("both Active and Inactive residents are returned", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ email: "active@example.com", status: "Active", contactNumber: "09171111001" }));
    repository.save(makeValidResident({ firstName: "Ana", email: "inactive@example.com", status: "Inactive", contactNumber: "09171111002" }));

    const residents = service.listResidents();

    assert.equal(residents.length, 2);
    assert.ok(residents.some((r) => r.status === "Active"));
    assert.ok(residents.some((r) => r.status === "Inactive"));
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});

test("a matching resident appears only once in search results", () => {
  const { databasePath, repository, service } = createQuerySetup();

  try {
    repository.save(makeValidResident({ firstName: "Cruz", lastName: "Cruz", email: "cruz@example.com", contactNumber: "09171234567" }));

    const residents = service.searchResidents("cruz");

    assert.equal(residents.length, 1);
    assert.equal(residents[0].firstName, "Cruz");
    assert.equal(residents[0].lastName, "Cruz");
  } finally {
    repository.close();
    removeDatabase(databasePath);
  }
});
