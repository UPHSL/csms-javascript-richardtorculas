import { Resident } from "../models/Resident.js";

/**
 * Coordinates retrieval, validation, and update of an existing Resident.
 *
 * T06 composes the existing T02 ResidentValidator and T03 ResidentRepository
 * (including findById) into a single update operation:
 *
 *   Resident ID + proposed editable information
 *     -> repository.findById         (not-found stops here)
 *     -> preserve existing ID and status
 *     -> build update candidate from proposed editable information
 *     -> ResidentValidator           (invalid information stops here)
 *     -> repository.update           (persist the permitted changes)
 *     -> updated persisted Resident
 *
 * The service deliberately contains no validation rules and no SQL.  Those
 * responsibilities remain with the validator and the repository.  It never
 * generates Resident IDs, never changes status, never creates a new Resident,
 * and never calls the registration service.
 *
 * The result object distinguishes three outcomes:
 *   - success:            { success: true,  resident, errors: [], notFound: false }
 *   - validation failure: { success: false, resident: null, errors,    notFound: false }
 *   - not found:          { success: false, resident: null, errors: [], notFound: true }
 */
export class ResidentUpdateService {
  constructor(validator, repository) {
    this.validator = validator;
    this.repository = repository;
  }

  /**
   * Update the permitted information of an existing persisted Resident.
   *
   * @param {number} residentId - The persisted id of the Resident to update.
   * @param {object} proposedInformation - Object supplying the editable
   *   fields (firstName, lastName, address, contactNumber, email).  Any
   *   id or status present in this object is ignored.
   * @returns {object} The structured result described on the class docs.
   */
  updateResident(residentId, proposedInformation = {}) {
    const existing = this.repository.findById(residentId);

    if (!existing) {
      return {
        success: false,
        resident: null,
        errors: [],
        notFound: true
      };
    }

    const candidate = new Resident({
      id: existing.id,
      firstName: proposedInformation.firstName,
      lastName: proposedInformation.lastName,
      address: proposedInformation.address,
      contactNumber: proposedInformation.contactNumber,
      email: proposedInformation.email,
      status: existing.status
    });

    const errors = this.validator.validate(candidate);

    if (errors.length > 0) {
      return {
        success: false,
        resident: null,
        errors,
        notFound: false
      };
    }

    const updatedResident = this.repository.update(existing.id, candidate);

    return {
      success: true,
      resident: updatedResident,
      errors: [],
      notFound: false
    };
  }
}