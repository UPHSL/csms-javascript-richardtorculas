# Midterm Checkpoint - T10: Manage Service Request Status

## Section 1 - Developer Information

**Name:** Richard Torculas
**GitHub Username:** richardtorculas
**Primary Technology Stack:** JavaScript (Node.js, Express, SQLite)
**T10 Branch:** feature/t10-service-request-status

---

## Section 2 - My T10 Implementation

The status workflow is managed by the new `ServiceRequestStatusService` class in `src/services/ServiceRequestStatusService.js`. This service orchestrates the status transition logic while delegating persistence to the existing `ServiceRequestRepository`. When a status change is requested, the service first validates that the target status is one of the four supported values (Pending, In Progress, Completed, Cancelled). It then retrieves the existing Service Request from the repository using `findById`. If the request is not found, a not-found result is returned immediately. The current persisted status is examined and compared against the allowed transition rules defined in the `ALLOWED_TRANSITIONS` object. Invalid transitions (including same-status requests) are rejected before any persistence modification occurs. Only valid transitions trigger the repository's `updateStatus` method, which executes a parameterized SQL UPDATE statement targeting the specific Service Request ID. After a successful update, the service retrieves the updated Service Request via `findById` and returns it wrapped in a structured `ServiceRequestStatusResult` object that clearly indicates success or the specific failure reason.

---

## Section 3 - My Transition Rules

The implementation enforces the following allowed transitions:

- **Pending to In Progress**: Allowed — staff begins processing the request
- **Pending to Cancelled**: Allowed — request is cancelled before processing starts
- **In Progress to Completed**: Allowed — processing finishes successfully
- **In Progress to Cancelled**: Allowed — processing is stopped before completion

The following transitions are explicitly rejected:

- **Pending to Completed**: Rejected because a request must first enter In Progress before it can be completed; this ensures the workflow reflects actual processing.
- **Completed is terminal**: Once Completed, no further transitions are allowed because the request represents a finished workflow that should not be reopened or modified.
- **Cancelled is terminal**: Once Cancelled, no further transitions are allowed because T10 does not implement reactivation of cancelled requests.
- **Same-status requests (e.g., Pending to Pending)**: Rejected as invalid transitions to ensure the system evaluates actual state-transition behavior rather than simple status assignment.
- **Unsupported status values (e.g., Approved, Rejected, Processing)**: Rejected at the validation step before any persistence lookup occurs.

---

## Section 4 - Files I Changed

**File:** `src/repositories/ServiceRequestRepository.js`  
**Purpose:** Added the `updateStatus(serviceRequestId, status)` method to persist status changes using a parameterized SQL UPDATE statement that targets the specific Service Request by its ID.

**File:** `src/services/ServiceRequestStatusService.js` (new)  
**Purpose:** Implements the complete status management workflow including supported status validation, transition rule enforcement, not-found handling, and coordination with the repository. Returns structured `ServiceRequestStatusResult` objects that distinguish between success, not-found, unsupported status, and invalid transition outcomes.

**File:** `test/serviceRequestStatus.test.js` (new)  
**Purpose:** Contains all 13 required T10 automated tests plus one student-designed test covering the complete status workflow, invalid transitions, terminal states, persistence preservation, and error handling.

---

## Section 5 - Problem I Encountered

**Problem:** Initially, the T10 tests for terminal state transitions (Completed and Cancelled) were failing because the `isAllowedTransition` method was not correctly handling the case where the current status is a terminal state. The `ALLOWED_TRANSITIONS` object had empty arrays for "Completed" and "Cancelled", but the method was returning `false` for any transition from these states, which is correct. However, the test was incorrectly expecting the transition to fail with `invalidTransition: true`, but the service was returning early with `notFound: true` because the repository's `findById` was returning null.

**Cause:** The test helper function `createCompletedServiceRequest` and `createCancelledServiceRequest` were not properly awaiting the async status change operations, causing the Service Request to not actually be in the expected terminal state when the test ran the invalid transition.

**Investigation:** I added debug logging to trace the status of the Service Request at each step and found that the async operations were not being awaited properly in the test helpers.

**Resolution:** I updated the test helper functions to be `async` and properly `await` each status change operation, ensuring the Service Request reaches the correct state before the test continues. This fixed the test flow and all 14 T10 tests now pass.

---

## Section 6 - My Student-Designed Test

**Test Name:** Student Test - Multiple Sequential Valid Transitions Preserve Data Integrity

**What the Test Verifies:** This test verifies that a Service Request can flow through the complete valid lifecycle (Pending → In Progress → Completed) while preserving all non-status fields (id, residentId, serviceType, description, dateRequested) at each step. It also confirms that the final persisted state matches the expected terminal state and that all original information remains intact.

**Why I Added This Test:** The required tests cover individual transitions in isolation, but this test validates the end-to-end workflow that a real Service Request would experience. It ensures that chaining multiple valid transitions does not accumulate data corruption or lose information, which is a critical real-world scenario for the CSMS application.

---

## Section 7 - Tools and References Used

- Official Node.js documentation (node:sqlite, node:test, node:assert)
- Express.js documentation
- SQLite documentation for parameterized queries
- Visual Studio Code (IDE) with integrated debugger
- Node.js built-in test runner
- Git for version control
- GitHub Classroom repository for submission