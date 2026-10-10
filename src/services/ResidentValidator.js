const CONTACT_NUMBER_PATTERN = /^09[0-9]{9}$/;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const SUPPORTED_STATUSES = new Set([
  "Active",
  "Inactive"
]);

export class ResidentValidator {
  validate(resident) {
    const errors = [];

    if (this.isBlank(resident.firstName)) {
      errors.push("firstName");
    }

    if (this.isBlank(resident.lastName)) {
      errors.push("lastName");
    }

    if (this.isBlank(resident.address)) {
      errors.push("address");
    }

    if (!this.isValidContactNumber(resident.contactNumber)) {
      errors.push("contactNumber");
    }

    if (!this.isValidEmail(resident.email)) {
      errors.push("email");
    }

    if (!this.isSupportedStatus(resident.status)) {
      errors.push("status");
    }

    return errors;
  }

  isValid(resident) {
    return this.validate(resident).length === 0;
  }

  isBlank(value) {
    return (
      typeof value !== "string" ||
      value.trim().length === 0
    );
  }

  isValidContactNumber(value) {
    return (
      typeof value === "string" &&
      CONTACT_NUMBER_PATTERN.test(value)
    );
  }

  isValidEmail(value) {
    return (
      typeof value === "string" &&
      EMAIL_PATTERN.test(value)
    );
  }

  isSupportedStatus(value) {
    return (
      typeof value === "string" &&
      SUPPORTED_STATUSES.has(value)
    );
  }
}