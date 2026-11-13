# Final Development Checkpoint — CSMS v1.0.0 (T16)

## 1. Developer Information

| | |
|---|---|
| Name | Richard O. Torculas |
| GitHub Username | richardtorculas |
| Technology Stack | JavaScript with Express.js (EJS views, SQLite through `node:sqlite`, `node:test` + supertest) |
| T16 Branch | `feature/t16-final-release` |
| Final Release Version | 1.0.0 |

## 2. My Final Release Implementation

I made `package.json` the one place where the release version is written. I set it to `1.0.0` with `npm version 1.0.0 --no-git-tag-version`, which also updated `package-lock.json`.

This fits a Node.js project because `package.json` is where npm and Node tools already expect the version to be. Before T16, the version was written twice: once in `package.json` and once in `src/config/application.js`.

Now `src/config/application.js` does not keep its own copy. It reads the version from `package.json` and puts it in `applicationConfig`, next to the application name and the short name "CSMS".

The `/health` controller already built its JSON from `applicationConfig`, so I did not need to change it. It now reports version `1.0.0` automatically.

For the browser, `src/app.js` puts the name and version into `app.locals.release` once. This is the Express way to give a value to every template. The shared footer used by the Dashboard, Residents and Service Requests pages then shows "Community Services Management System · v1.0.0". The header's "CSMS" name comes from the same place.

Because every place reads from the same chain (`package.json` → `applicationConfig` → `/health` and the page footer), a future release such as 1.0.1 only needs `npm version 1.0.1`. Nothing else has to be edited by hand.

## 3. Files I Changed

| File | Purpose of my change |
|---|---|
| `package.json` | Set the release version to `1.0.0`. This is now the single source of truth. |
| `package-lock.json` | Updated by `npm version` so its version matches `package.json`. |
| `src/config/application.js` | Reads the version from `package.json` instead of hardcoding `0.1.0`, and adds the short name `CSMS`. |
| `src/app.js` | Shares the release name and version with every page through `app.locals.release`. |
| `src/views/partials/footer.ejs` | Shows the shared release footer, "Community Services Management System · v1.0.0", on every page. |
| `src/views/partials/header.ejs` | The page title and the brand link now use the short name from the release information instead of hardcoded text. |
| `public/css/style.css` | Small styles for the new footer. |
| `test/application.test.js` | Updated the two starter checks from the old version `0.1.0` to the new release version `1.0.0` (see Section 6). |
| `test/releaseIdentity.test.js` | New automated release-version tests. |
| `test/finalReleaseIntegration.test.js` | New Final Examination integration test. |
| `docs/project-overview.md` | Added a "Current Release" section (1.0.0) and kept the "Starter Version" section as history. |
| `docs/release-v1.0.0.md` | New official release notes. |
| `docs/final-checkpoint.md` | This document. |

## 4. My Final Examination Test

| | |
|---|---|
| **Test Name** | `a Resident's complete service history stays consistent across every view and survives an application restart` |
| **File** | `test/finalReleaseIntegration.test.js` |
| **Modules/Responsibilities Covered** | Resident validation, registration, update and deactivation (T02, T04, T06, T07); Service Request submission and Resident eligibility (T08, T09); status workflow (T10); search, filter and details (T05, T11); browser interfaces (T12, T13); Dashboard counts (T14); and real SQLite persistence (T03), including a restart. |
| **Starting State** | A brand-new, empty SQLite database file (0 Residents, 0 Service Requests). |
| **Operations Performed** | See the list below. |
| **Expected Final State** | See the list below. |

**Operations performed** (all through the real HTTP routes):
1. Register two Residents, Lorna and Danilo, through the registration form.
2. Submit four Service Requests: three for Lorna and one for Danilo, two of them on the same date.
3. Run the workflow:
   - Clearance: Start, then Complete.
   - Streetlight: Cancel.
   - Garbage: Start.
   - Then try to Cancel the Completed Clearance, which must be refused with a 409.
4. Update Lorna's contact number, then deactivate her.
5. Try to submit a new request for Lorna, which must be refused with a 422 because she is now Inactive.
6. **Restart the application:** close every database connection and start a new app on the same database file.

**Expected final state** (checked after the restart):
- **Residents:**
  - Lorna has the new contact number and is Inactive.
  - Danilo is Active.
  - There are exactly 2 Residents.
- **Service Requests:**
  - Each one has the right status: Completed, Cancelled, In Progress and Pending.
  - Every other field is exactly as submitted, including the Resident link.
  - The refused request does not exist, and there are exactly 4 requests.
- **Dashboard:**
  - All nine counts are exactly right: 2 total / 1 active / 1 inactive Residents; 4 total / 1 pending / 1 in progress / 1 completed / 1 cancelled / 2 open requests.
  - The recent list is in the right order: newest date first, and for the same date, the higher ID first.
- **Search, filter and details:**
  - Searching "STREET" with status Cancelled finds only the Streetlight request.
  - The Clearance details page shows Lorna's ID, the Completed status, and no workflow buttons.
  - Searching Residents for "villa" shows Lorna with her new number and Inactive status.

**Why this test is meaningful:**
- A simple unit test checks one piece alone, for example "the validator rejects a bad email". This test checks that all the pieces still agree with each other after many real actions.
- It uses the real routes, services, rules and SQLite file, so it can catch problems that only appear when modules work together. For example, a deactivated Resident could accidentally lose her old requests, or the Dashboard could count a refused request.
- The restart step adds something no earlier test checked. It proves the data is really saved in the database file, not just kept in memory, so the release keeps working after the server is stopped and started again.

## 5. My Final Technical Decision

| | |
|---|---|
| **Decision** | Use `package.json` as the single source of truth for the version, and have `src/config/application.js` read it from there. |
| **Alternative Considered** | Keep the version written directly in `src/config/application.js` and just change `"0.1.0"` to `"1.0.0"` there. |
| **Reason for My Decision** | See below. |

With the alternative, the project would still have **two** versions written by hand: one in `package.json` and one in the config file. They could easily drift apart in a future release, which is exactly the inconsistency T16 warns about.

`package.json` is the normal place for a Node.js project's version. Tools like `npm version` already update it, together with `package-lock.json`. Reading from it means the running app, npm and the lock file always agree.

I also chose not to change the shape of the `/health` JSON. It keeps the same three fields (`status`, `application`, `version`), and only the version value changed. Anything already reading `/health` keeps working, and the response still shows only what is needed: which app, which version, and that it is OK.

## 6. Problem or Verification Issue Encountered

| | |
|---|---|
| **Problem** | After I changed the version to 1.0.0, two of the original starter tests in `test/application.test.js` failed: "home page displays the CSMS starter details" and "health endpoint returns the expected payload". |
| **Cause or Investigation** | See below. |
| **Resolution** | See below. |

**Cause or investigation:** I read the failure messages. Both tests had the old starter version `0.1.0` written directly into them. The app was now correctly reporting `1.0.0`, so the tests were checking an out-of-date requirement, not catching a bug. Following the course rule "explicit ticket requirement first", the T16 ticket clearly says the running application must be version 1.0.0.

**Resolution:** I changed only the expected version value in those two tests, from `0.1.0` to `1.0.0`, and added a short comment explaining why. I did not make the tests weaker. The health test still compares the full JSON response exactly, and the home page test still checks for the version text. To protect against this kind of mismatch in the future, my new `test/releaseIdentity.test.js` checks two things:
- the app's version is the same value as `package.json`
- no page still shows `0.1.0`

## 7. Final Regression Results

| | |
|---|---|
| **Test Command** | `npm test` (runs `node --test`) |
| **Final Regression Run 1** | PASS — 199 tests, 199 passed, 0 failed, 0 skipped |
| **Final Regression Run 2** | PASS — 199 tests, 199 passed, 0 failed, 0 skipped (run immediately after Run 1) |
| **Total Passing Tests Reported** | 199 (195 from Starter–T15 + 1 Final Examination integration test + 3 release-identity tests) |

No temporary test database files were left behind after the two runs. No earlier test was deleted, skipped or weakened.

## 8. Tools and References Used

- **AI coding assistant: I used Claude Code (Anthropic's Claude AI model) during T16** to help plan the version design, write the code, tests and documentation, and run the verification commands. I reviewed the changes and the test results, and I am responsible for understanding and explaining this implementation.
- Visual Studio Code (IDE).
- Node.js documentation (`node:module` `createRequire`, `node:test` test runner, `node:sqlite`).
- Express.js documentation (`app.locals`, routing, error handling).
- EJS documentation (templates and includes).
- npm documentation (`npm version`).
- Git and GitHub documentation (branches, Pull Requests, annotated tags, GitHub Releases).
- My existing CSMS repository documentation (`README.md`, `docs/developer-handbook.md`, `docs/t15-release-readiness.md`) and the T01–T16 ticket instructions.

## 9. Final Release Declaration

**CSMS v1.0.0 - READY FOR RELEASE**
