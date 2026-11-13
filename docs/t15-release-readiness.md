# T15 Release Readiness — System Hardening and Regression Testing

## 1. Developer Information

| Field | Value |
|---|---|
| Name | Richard O. Torculas |
| GitHub Username | richardtorculas |
| Technology Stack | JavaScript with Express.js (EJS views, `node:sqlite`, `node:test` + supertest) |
| T15 Branch | `feature/t15-system-hardening` |

## 2. Release Candidate Baseline

Checked on `main` after T14 (PR #15) was merged, **before** any T15 change.

| Item | Status before T15 | Notes |
|---|---|---|
| Application startup | Working | `node src/server.js` started normally |
| `/health` | Working | `200 {"status":"ok", ...}` |
| Dashboard | Working | `GET /dashboard` → 200 |
| Resident Management | Working | `GET /residents` → 200 |
| Service Request Management | Working | `GET /service-requests` → 200 |
| Starter through T14 automated tests | Working | `npm test`: 190 tests, 190 pass, 0 fail, 0 skipped |

No test was failing at the baseline. The defects listed in Section 3 were found during the T15 review; the existing tests did not cover them.

## 3. Hardening Changes

| Area | Issue or Risk Found | Action Taken | Files Changed | Test/Evidence |
|---|---|---|---|---|
| 1. Full regression | Reviewed — no defect identified. All 190 baseline tests passed and every T01–T14 manual scenario worked. | None needed; added a cross-feature regression test. | — | Test 4; Sections 5 and 6 |
| 2. Invalid / missing input | **Defect:** a POST with a malformed request body (e.g. broken JSON) is a client error that Express's body parser marks as status 400. The T12 error handler ignored that status, returned **500 "Something Went Wrong"**, and printed a full stack trace to the server log. | The error handler now keeps 4xx statuses from Express and the body parsers and renders a generic "Invalid Request" page. Real server failures still log and return a generic 500. No internal details reach the browser. | `src/middleware/errorHandler.js` | Test 1 (fails on the old code, passes now); manual: malformed JSON → 400 |
| 2. Invalid / missing input | Reviewed: malformed IDs (`/residents/abc/edit`, `/service-requests/not-a-number`), oversized IDs (`99999999999999999999999`), missing records (`999999`), repeated query/form parameters, empty POST bodies, unsupported status filters. All already returned controlled 404/422/400 responses. | No change needed. | — | Manual probes; T12/T13 not-found tests |
| 3. Persistence integrity | Reviewed — no defect identified. Rejected registration, update, submission (invalid / missing / Inactive Resident), and invalid or terminal transitions leave the database unchanged. A Resident update is checked by the validator before a single `UPDATE`, so it cannot be partially saved. | Added an on-disk atomicity test that reads back through a separate database connection. | — | Test 2; manual S2, S5, S7, S8 |
| 4. HTTP / mutation safety | Reviewed — no defect identified. Every state change is a POST that redirects afterwards (Post/Redirect/Get, 303). GET versions of the mutation URLs return 404. Refreshing after a redirect only repeats the GET. Repeated deactivation is idempotent. | No change needed. | — | Test 3; T12/T13/T14 GET-safety tests; manual S3, S10 |
| 5. Query / database safety | **Defect:** Resident search (T05) and Service Request search (T11) bound the search text as a parameter, but placed it inside a `LIKE` pattern without escaping. The SQL wildcards `%` and `_` typed by a user therefore changed the matching rules: searching `%` or `_` returned **every** record, and `50%` matched `500`. User input was acting as query structure rather than plain data. | Added `containsPattern()`, which escapes `\`, `%` and `_`. Both search queries now use `LIKE :pattern ESCAPE '\'`. Normal partial, case-insensitive, trimmed searching is unchanged. | `src/database/likePattern.js` (new), `src/repositories/ResidentRepository.js`, `src/repositories/ServiceRequestRepository.js` | Test 5 (fails on the old code, passes now); all T05/T11/T12/T13 search tests still pass |
| 5. Query / database safety | Reviewed: every value in SQL is a bound parameter. The only `${...}` inside SQL strings is the constant T11 `ORDER BY`. The dashboard still uses `COUNT(*)` / `GROUP BY` / `LIMIT`. | No change needed. | — | Test 3 (SQL-injection-style search text); T14 aggregate tests |
| 6. Workflow / lifecycle | **Risk:** the four Service Request statuses were defined in two places (`ServiceRequestStatusService` for T10 and `ServiceRequestQueryService` for T11), so the two lists could drift apart. | `ServiceRequestStatusService` now exports one frozen `SUPPORTED_SERVICE_REQUEST_STATUSES` list, and the query service references it. The values and transition rules are unchanged. | `src/services/ServiceRequestStatusService.js`, `src/services/ServiceRequestQueryService.js` | All T10/T11/T13 tests pass unchanged |
| 6. Workflow / lifecycle | Reviewed — no defect identified. Active → Inactive only, no reactivation, no physical delete. Pending → Completed, same-state, unsupported, and terminal transitions are rejected by T10 even through crafted POSTs. | No change needed. | — | Test 4; T10/T13 tests; manual S7, S8 |
| 7. Interface / navigation | Reviewed — no defect identified. Every page has a title and the shared Dashboard / Residents / Service Requests navigation. Every internal link on the main pages resolves (200). User text is escaped by EJS (`<%= %>`). | No change needed. | — | Manual S12 link check; T12/T13 escaping tests |
| 8. Test reliability | Reviewed — no defect identified. Every database test uses its own random temporary SQLite file, closes its connections, and deletes the file. No test uses hardcoded generated IDs or depends on run order, and none touches the development database. | No change needed. | — | Two full runs (Section 5); 0 leftover `csms-*` temp files |
| 9. Repository hygiene | Reviewed. A mis-indented doc comment in `ResidentRepository.js` was the only cleanup needed. | Fixed the indentation. | `src/repositories/ResidentRepository.js` | Section 7 |

## 4. Five New T15 Hardening Tests

All five are in `test/systemHardening.test.js`.

| # | Test Name | Category | What It Verifies | Why It Adds Value Beyond Existing Tests |
|---|---|---|---|---|
| 1 | `T15: malformed request bodies get a controlled 400 and change nothing` | 1 — Invalid or malformed input | Broken JSON sent to `POST /residents/register`, `POST /residents/:id/update` and `POST /service-requests` gets a 400 "Invalid Request" page with no `SyntaxError` or stack details. All Residents and Service Requests are unchanged. | Earlier tests only sent well-formed form data. This covers input that fails **before** a controller runs, and it caught a real 500 defect (it fails on the pre-T15 code). |
| 2 | `T15: a partly valid Resident update is rejected atomically on disk` | 2 — Rejected mutation protects persistence | An update with a valid name, address and email but an invalid contact number is rejected with only `["contactNumber"]`. A **separate, new database connection** then reads back the exact original Resident, and the Resident count is still 1. | Earlier update tests checked state through the same repository object. Reading through an independent connection proves nothing was written to the SQLite file, which is the literal "no partial update" scenario from the T15 brief. |
| 3 | `T15: hostile search text on read-only pages never mutates data` | 3 — Read-only request safety | SQL-injection-style search terms (`'; DELETE FROM residents; --`, `x' OR '1'='1`, an `UPDATE` attempt) on the Resident and Service Request pages show normal "No ... found" results. The Dashboard, edit and details pages also load. A full snapshot and the aggregate counts are unchanged afterwards. | Earlier GET-safety tests used ordinary input. This shows that hostile input on every read-only page is treated purely as search data and can neither change nor widen what is read. |
| 4 | `T15: deactivating a Resident blocks new requests but not existing workflow` | 4 — Cross-feature regression | Deactivating through T12 makes a T13/T09 submission fail with eligibility feedback and creates no request. The Resident's **existing** request still moves Pending → In Progress → Completed through T13/T10 with all other fields preserved. The T14 dashboard shows Active 0, Inactive 1, Completed 1, Open 0. | It crosses four modules in one flow (T07/T12 → T09/T13 → T10/T13 → T14). It also checks a boundary no earlier test covered: deactivation must not freeze or hide requests submitted while the Resident was Active. |
| 5 | `T15: LIKE wildcard characters in searches are matched literally` | 5 — Boundary behavior | `%` finds no Residents. `o_a` finds only `Jo_Ann`, not `Joann`. `50%` finds only the "50% discount" request, not "500 pesos". Ordinary partial, case-insensitive, trimmed searches still behave as T05/T11 require. | It covers the boundary between search text and SQL pattern syntax. It caught a real defect (it fails on the pre-T15 code) and protects the T05/T11 search contract from future regressions. |

## 5. Full Regression Test Results

| Item | Result |
|---|---|
| Test command | `npm test` (runs `node --test`) |
| Node.js version used | v22.20.0 |
| Run 1 | **PASS** — tests 195, pass 195, fail 0, cancelled 0, skipped 0, todo 0 (≈4.5 s) |
| Run 2 (immediately after Run 1) | **PASS** — tests 195, pass 195, fail 0, cancelled 0, skipped 0, todo 0 (≈4.8 s) |
| Total passing tests | **195** (190 Starter–T14 + 5 T15) |
| Leftover temporary test databases after both runs | 0 |

No existing test was deleted, skipped, weakened, or changed.

## 6. Manual Release Verification

Performed against the running application (`node src/server.js`) and the development database. Results were checked over HTTP and by reading the SQLite rows directly. The test records were deleted afterwards.

| Verification | Result | Notes |
|---|---|---|
| Application starts | PASS | Started normally; no errors in the server log during the whole check |
| /health works | PASS | `{"status":"ok","application":"Community Services Management System","version":"0.1.0"}` |
| Dashboard loads | PASS | 200 |
| Resident listing/search works | PASS | Search found the Resident; Inactive Resident still listed |
| Valid Resident registration works | PASS | 303 redirect; row saved with a generated ID and status Active |
| Invalid Resident registration is rejected | PASS | 422; Resident count unchanged |
| Resident update works | PASS | Address changed; a submitted `id=999` / `status=Inactive` was ignored, so ID and status were preserved. An invalid update (422) left the name and address unchanged |
| Resident deactivation works and record remains visible | PASS | Status Inactive; still searchable; repeat deactivation → "already Inactive" notice, no change |
| Valid Service Request submission for Active Resident works | PASS | Generated ID, correct `resident_id`, status Pending |
| Missing/Inactive Resident submission is rejected | PASS | Both 422; Service Request count unchanged |
| Service Request search/filter/details work | PASS | Search, status filter, combined search + filter, and details (200) all correct |
| Valid Service Request workflow works | PASS | Pending → In Progress → Completed |
| Invalid/terminal transition is rejected | PASS | Pending → Completed → 409, still Pending; Cancel on a Completed request → 409 |
| Dashboard reflects Resident/Service Request changes | PASS | Before: Active 2 / Inactive 0 / Pending 1 / Open 1. After the deactivation and completion: Active 1 / Inactive 1 / Completed 1 / Open 0; totals unchanged |
| Read-only GET operations do not modify persistence | PASS | Full table contents identical after 15 GETs across the Dashboard, searches, filters, details and edit pages |

Additional manual checks:
- **Missing records:** `/residents/999999/edit`, `/residents/abc/edit`, `/service-requests/999999` and `/service-requests/not-a-number` all returned a controlled 404 page.
- **Navigation:** the Dashboard, Residents, Service Requests, register and submit pages all show the shared navigation, and every internal link on them returned 200.
- **Malformed JSON body:** returned 400.

## 7. Repository Hygiene Review

| Check | Reviewed | Result / Cleanup |
|---|---|---|
| Debug output | Yes | No `console.log`, `console.debug` or `debugger` in `src`. The only logging is `server.js` startup and the error handler's server-side log for real 500s; client 4xx errors are no longer logged as crashes |
| Temporary files | Yes | None tracked; tests leave no temp files |
| Generated build/runtime artifacts | Yes | None tracked; `node_modules/` is ignored |
| Accidental local database files | Yes | `src/database/data/csms.db` exists locally but is ignored by `.gitignore` (`*.db`) and is not committed; only `src/database/data/.gitkeep` is tracked |
| Commented-out abandoned code | Yes | None found in `src` or `test` |
| Secrets/credentials | Yes | None. The only keyword match is the `# Environment files and secrets` comment in `.gitignore` |
| Broken navigation/links | Yes | None; all internal links resolved |
| Direct SQL parameter binding | Yes | All values are bound parameters; `LIKE` wildcards are now escaped (Section 3) |
| Code tidiness | Yes | Fixed one mis-indented doc comment in `ResidentRepository.js` |

The starter placeholders `src/services/ResidentService.js`, `src/services/RequestService.js` and `src/utils/validators.js` were left in place on purpose, because they are part of the starter repository structure.

## 8. Known Limitations

These are outside the T01–T15 requirements and were deliberately not implemented during the feature freeze:

1. **Unknown URLs return JSON, not an HTML page.** The starter contract (checked by the starter test) answers unknown routes with `{"status":"error","message":"Resource not found"}`. Resident and Service Request not-found cases inside the interface use HTML pages, but a mistyped URL in a browser shows the JSON.
2. **No CSRF protection or authentication.** Authentication and authorization are out of scope for the CSMS. Without them, any page that can reach the server could submit the POST forms.
3. **Case-insensitive search covers ASCII letters only.** SQLite's `LIKE` treats only ASCII letters case-insensitively, so letters such as `Ñ`/`ñ` match only in the same case. This behavior comes from T05/T11.
4. **No concurrent-edit detection.** If two staff members edit the same Resident at once, the last save wins. Locking was never part of the CSMS requirements.
5. **Runtime version.** `package.json` and `.nvmrc` target Node.js 24. This release candidate was verified on Node.js 22.20.0, where `node:sqlite` prints an "experimental feature" warning at startup; the warning is harmless.

No known release-blocking limitations identified within the defined CSMS scope. This does not mean the software has no possible defects.

## 9. Release Candidate Statement

**READY FOR T16 FINAL EXAM**
