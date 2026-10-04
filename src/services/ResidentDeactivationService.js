/**
 * Coordinates the controlled soft deactivation of an existing Resident.
 *
 * T07 composes the existing T03 ResidentRepository (including findById) into
 * a single lifecycle operation:
 *
 *   Resident ID
 *     -> repository.findById          (not-found stops here)
 *     -> inspect current status
 *     -> if already Inactive: return safe already-inactive result
 *     -> if Active: repository.deactivate (persist status = Inactive)
 *     -> final persisted Resident
 *
 * The service deliberately contains no SQL and no validation rules.  Those
 * responsibilities remain with the repository and the T02 validator (which
 * is not re-run because T07 does not modify personal information).  It never
 * changes Resident ID, never modifies personal/contact information, never
 * physically deletes a Resident, never generates an ID, never creates a new
 * Resident, never calls registration, and never implements reactivation or
 * an Active/Inactive toggle.
 *
 * T07 business rule: only "Active becomes Inactive".  An already-Inactive
 * Resident stays Inactive (the operation is idempotent and safe to repeat).
 *
 * The result object distinguishes three outcomes:
 *   - newly deactivated: { success: true,  resident, notFound: false, alreadyInactive: false }
 *   - already Inactive:  { success: true,  resident, notFound: false, alreadyInactive: true }
 *   - not found:         { success: false, resident: null, notFound: true, alreadyInactive: false }
 */
export class ResidentDeactivationService {
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * Deactivate an existing Resident (Active -> Inactive).
   *
   * @param {number} residentId - The persisted id of the Resident to deactivate.
   * @returns {object} The structured result described on the class docs.
   */
  deactivateResident(residentId) {
    const existing = this.repository.findById(residentId);

    if (!existing) {
      return {
        success: false,
        resident: null,
        notFound: true,
        alreadyInactive: false
      };
    }

    if (existing.status === "Inactive") {
      return {
        success: true,
        resident: existing,
        notFound: false,
        alreadyInactive: true
      };
    }

    const deactivatedResident = this.repository.deactivate(existing.id);

    return {
      success: true,
      resident: deactivatedResident,
      notFound: false,
      alreadyInactive: false
    };
  }
}