# T03 Preliminary Examination Checkpoint

## Developer Information

Name: Richard Torculas
GitHub Username: richardtorculas
Primary Technology Stack: JavaScript with Express.js
T03 Branch: feature/t03-resident-persistence

---

## My T03 Implementation

The SQLite database file is stored at `src/database/data/csms.db` relative to
the project root. This path is resolved at runtime by `src/database/database.js`
using `import.meta.url` so it is always relative to the module, not the working
directory.

The `ResidentRepository` class in `src/repositories/ResidentRepository.js`
handles all Resident persistence. It opens the database through `openDatabase()`
on construction and exposes `save()` and `findById()` as its public interface.

When `save()` is called, a prepared INSERT statement is executed with named
parameters bound to the Resident's properties. SQLite generates the id via
`AUTOINCREMENT`, and the generated value is obtained from `result.lastInsertRowid`
and assigned back to `resident.id` before returning.

`findById()` executes a prepared SELECT statement with the given id as a named
parameter. If the row is found it is passed to the private `_rowToResident()`
helper which maps snake_case column names back to the camelCase Resident model.
If no row is found `query.get()` returns `undefined`, and the method returns
`null` to signal a normal not-found condition without throwing.

---

## My Persistence Design Decision

**Decision:** Place database-opening and table-initialisation logic in its own
module `src/database/database.js` that exports a single `openDatabase(dbPath)`
function, rather than putting that logic inside `ResidentRepository` or `app.js`.

**Why:** `ResidentRepository` should only know how to run SQL against an already-
open database — not how to locate, open, or initialise one. Keeping those concerns
separate makes the repository easier to test (tests pass a different path) and
easier to extend (a future repository for service requests reuses the same
`openDatabase()` call). Putting it in `app.js` would couple the HTTP layer to
database bootstrapping, which felt wrong for a layered architecture.

**Alternative considered:** Calling `new DatabaseSync()` directly inside the
`ResidentRepository` constructor and hard-coding the path there. That would
work but would make it impossible for tests to inject a different database
without monkey-patching the module, so I rejected it.

---

## My Database Initialization Design

Database initialization file or module: `src/database/database.js`

Where the database path comes from: Callers pass the path explicitly to
`openDatabase(dbPath)`. The default value is computed once inside the module
using `path.join(currentDirectory, "data", "csms.db")`. Tests pass a temporary
path obtained from `fs.mkdtempSync` and `os.tmpdir()`.

How the Resident table is initialized: `db.exec()` runs a
`CREATE TABLE IF NOT EXISTS residents (...)` statement immediately after the
database is opened.

How repeated initialization is handled: `IF NOT EXISTS` in the CREATE TABLE
statement makes the call idempotent — running it multiple times against the same
database file is safe and will never destroy existing rows or raise an error.

**Why I designed it this way:** Using `IF NOT EXISTS` is the standard SQLite
pattern for safe schema bootstrapping. It means the application can call
`openDatabase()` on every startup without needing a separate migration step or
a flag file to track whether the schema was already created.

---

## Files I Changed

File: `src/database/database.js`
Purpose: Opens the SQLite connection and creates the residents table if it does
not already exist. Exports `openDatabase(dbPath)` so callers can control the
database location.

File: `src/repositories/ResidentRepository.js`
Purpose: Implements Resident persistence. Provides `save(resident)` to insert a
new row and assign the generated id, `findById(residentId)` to retrieve a Resident
by its database id, and `close()` to release the database connection.

File: `test/residentRepository.test.js`
Purpose: Contains all nine automated persistence tests (seven required scenarios
plus one student-designed scenario). Each test uses an isolated temporary SQLite
file so tests never interfere with each other or with the development database.

File: `.gitignore`
Purpose: Added `*.db`, `*.sqlite`, `*.sqlite3`, and `src/database/data/*.db` so
the generated SQLite database file is never committed to Git.

---

## SQL I Can Explain

```sql
INSERT INTO residents
  (first_name, last_name, address, contact_number, email, status)
VALUES
  (:firstName, :lastName, :address, :contactNumber, :email, :status)
```

**What it does:** Inserts one new row into the `residents` table with the six
data columns. The `id` column is omitted because SQLite generates it automatically
via `AUTOINCREMENT`.

**What each placeholder represents:**
- `:firstName` — the resident's given name (`resident.firstName`)
- `:lastName` — the resident's family name (`resident.lastName`)
- `:address` — the residential address (`resident.address`)
- `:contactNumber` — the 11-digit contact number as text (`resident.contactNumber`)
- `:email` — the email address (`resident.email`)
- `:status` — either `"Active"` or `"Inactive"` (`resident.status`)

The named placeholders (`:name` syntax) are passed as an object to
`statement.run({ firstName: ..., ... })`. The `node:sqlite` `DatabaseSync` API
substitutes them safely without any string concatenation, which prevents SQL
injection and also ensures `:contactNumber` is stored as text so the leading
zero of values like `09171234567` is preserved.

**Which operation uses it:** `ResidentRepository.save()`.

---

## My Resident Mapping

When `findById()` retrieves a row from SQLite, the raw object has properties
named after the database columns: `id`, `first_name`, `last_name`, `address`,
`contact_number`, `email`, and `status`.

The private `_rowToResident(row)` method creates a new `Resident` instance by
passing a mapping object to the constructor:

```js
return new Resident({
  id:            row.id,
  firstName:     row.first_name,   // snake_case → camelCase
  lastName:      row.last_name,    // snake_case → camelCase
  address:       row.address,
  contactNumber: row.contact_number, // snake_case → camelCase
  email:         row.email,
  status:        row.status
});
```

The most obvious naming difference is `first_name` (database) vs `firstName`
(JavaScript). `contact_number` → `contactNumber` and `last_name` → `lastName`
follow the same pattern. The mapping is explicit so the Resident model is never
modified just to accommodate the database schema.

---

## Problem I Encountered

**Problem or error:** On the first test run, `application.test.js` threw
`ERR_MODULE_NOT_FOUND: Cannot find package 'supertest'`.

**Cause:** Node.js had just been installed on this machine and `npm install` had
not yet been run, so the `node_modules` folder was empty and `supertest` was not
available.

**How I resolved it:** Ran `npm install` to download all declared dependencies
(`express`, `ejs`, `supertest`). After that the full suite of 26 tests passed
with 0 failures.

---

## My Student-Designed Test

**Test name:** `multiple residents are stored and retrieved independently by their own id`

**What it verifies:** Two residents with different data are saved to the same
database. The test then calls `findById()` with each generated id and asserts
that resident A's data comes back from A's id and resident B's data comes back
from B's id. It also asserts that the two generated ids are different.

**Why I chose this scenario:** A common defect in a new persistence layer is
that every INSERT overwrites the same row, or that `findById()` always returns
the most-recently inserted record regardless of which id is requested. This test
would fail immediately in either of those cases, exposing the bug before it
reaches any higher-level feature work.

---

## Tools and References Used

- Node.js 24 official documentation — `node:sqlite` module (`DatabaseSync`,
  `prepare`, `run`, `get`, `lastInsertRowid`)
- Node.js official documentation — `node:test`, `node:assert/strict`, `node:fs`,
  `node:os`, `node:path`
- SQLite documentation — `CREATE TABLE IF NOT EXISTS`, `INTEGER PRIMARY KEY
  AUTOINCREMENT`, column type affinity for TEXT
- Kiro AI (IDE assistant) — helped scaffold the implementation structure,
  database module, repository class, and test file based on the requirements
  described in the T03 guide. All SQL statements, mapping logic, and test
  assertions were reviewed and understood before submission.
