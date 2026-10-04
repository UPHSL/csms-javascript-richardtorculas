const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PENDING_STATUS = "Pending";

/**
 * Validates the intrinsic information of a Service Request.
 *
 * T09 separates intrinsic data validation from cross-domain business rules:
 * this validator checks the Service Request values themselves and never
 * performs Resident database lookups.  Resident existence and Active-status
 * eligibility are verified by ServiceRequestSubmissionService using the
 * existing ResidentRepository.
 *
 * Validation rules (a field name is added to the returned errors array when
 * the corresponding requirement fails):
 *   - id:            must be unassigned (null) because T09 submits new requests
 *                    and persistence generates the Service Request ID
 *   - residentId:    must be a structurally valid positive integer identifier
 *   - serviceType:   required, must not be null/empty/whitespace-only
 *   - description:   required, must not be null/empty/whitespace-only
 *   - dateRequested: required and must be a valid date (Date object or
 *                    YYYY-MM-DD text)
 *   - status:        must be "Pending" — a new request cannot begin in a
 *                    later workflow state
 */
export class ServiceRequestValidator {
  validate(serviceRequest) {
    const errors = [];

    if (serviceRequest.id !== null && serviceRequest.id !== undefined) {
      errors.push("id");
    }

    if (!this.isValidResidentId(serviceRequest.residentId)) {
      errors.push("residentId");
    }

    if (this.isBlank(serviceRequest.serviceType)) {
      errors.push("serviceType");
    }

    if (this.isBlank(serviceRequest.description)) {
      errors.push("description");
    }

    if (!this.isValidDate(serviceRequest.dateRequested)) {
      errors.push("dateRequested");
    }

    if (serviceRequest.status !== PENDING_STATUS) {
      errors.push("status");
    }

    return errors;
  }

  isValid(serviceRequest) {
    return this.validate(serviceRequest).length === 0;
  }

  isBlank(value) {
    return (
      typeof value !== "string" ||
      value.trim().length === 0
    );
  }

  isValidResidentId(value) {
    return (
      Number.isInteger(value) &&
      value > 0
    );
  }

  isValidDate(value) {
    if (value === null || value === undefined) {
      return false;
    }

    if (value instanceof Date) {
      return !Number.isNaN(value.getTime());
    }

    if (typeof value === "string") {
      if (!DATE_PATTERN.test(value)) {
        return false;
      }

      const date = new Date(`${value}T00:00:00Z`);

      if (Number.isNaN(date.getTime())) {
        return false;
      }

      // Reject rollover dates such as 2026-02-31.
      return date.toISOString().slice(0, 10) === value;
    }

    return false;
  }
}