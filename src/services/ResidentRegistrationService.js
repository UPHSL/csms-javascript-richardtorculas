/**
 * Coordinates Resident validation and persistence for registration.
 *
 * T04 composes the existing T02 ResidentValidator and T03
 * ResidentRepository into a single registration operation:
 *
 *   Resident
 *     -> ResidentValidator  (invalid information stops here)
 *     -> ResidentRepository (persists valid information)
 *     -> persisted Resident with database-generated ID
 *
 * The service deliberately contains no validation rules and no SQL.
 * Those responsibilities remain with the validator and repository.
 */
export class ResidentRegistrationService {
  constructor(validator, repository) {
    this.validator = validator;
    this.repository = repository;
  }

  registerResident(resident) {
    const errors = this.validator.validate(resident);

    if (errors.length > 0) {
      return {
        success: false,
        resident: null,
        errors
      };
    }

    const persistedResident =
      this.repository.save(resident);

    return {
      success: true,
      resident: persistedResident,
      errors: []
    };
  }
}