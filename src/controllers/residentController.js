import { Resident } from "../models/Resident.js";
import { parseRouteId } from "../utils/requestParsing.js";

/**
 * Editable Resident fields accepted from browser forms (T04/T06).
 * ID and status are deliberately absent: they are never read from a form.
 */
const EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "address",
  "contactNumber",
  "email"
];

/**
 * User-facing messages for the field keys reported by the T02
 * ResidentValidator.  This is presentation wording only; the validation
 * rules themselves remain inside ResidentValidator.
 */
const VALIDATION_MESSAGES = Object.freeze({
  firstName: "First name is required.",
  lastName: "Last name is required.",
  address: "Address is required.",
  contactNumber: "Contact number must follow the format 09XXXXXXXXX.",
  email: "Email address is invalid.",
  status: "Resident status is invalid."
});

/**
 * Success/information messages shown after a Post/Redirect/Get cycle.
 * Only known keys are rendered, so arbitrary query text never reaches the page.
 */
const NOTICES = Object.freeze({
  registered: "Resident registered successfully.",
  updated: "Resident information updated successfully.",
  deactivated: "Resident deactivated successfully.",
  "already-inactive": "Resident is already Inactive."
});

/**
 * Read the editable Resident fields from a submitted form body.
 *
 * @param {object|undefined} body - Parsed request body.
 * @returns {object} Only the editable fields, as submitted.
 */
function readResidentForm(body = {}) {
  const values = {};

  for (const field of EDITABLE_FIELDS) {
    values[field] = body[field];
  }

  return values;
}

/**
 * Convert validator field keys into displayable messages.
 *
 * @param {string[]} errorFields - Field keys from ResidentValidator.
 * @returns {{ field: string, message: string }[]}
 */
function toValidationMessages(errorFields) {
  return errorFields.map((field) => ({
    field,
    message: VALIDATION_MESSAGES[field] ?? `${field} is invalid.`
  }));
}

/**
 * Render the controlled Resident not-found page.
 *
 * @param {import("express").Response} response Express response.
 */
function renderResidentNotFound(response) {
  response.status(404).render("error", {
    title: "Resident Not Found",
    message: "The requested Resident does not exist."
  });
}

/**
 * Create the Resident Management presentation handlers.
 *
 * The handlers receive browser requests, delegate every operation to the
 * existing T04-T07 application services, and choose a view or redirect.
 * They contain no SQL, no validation rules, and no search logic.
 *
 * @param {() => object} getServices - Returns the Resident application
 *   services: registrationService, queryService, updateService,
 *   deactivationService.
 * @returns {object} Express request handlers.
 */
export function createResidentController(getServices) {
  return {
    /**
     * GET /residents — list or search Residents through T05.
     */
    listResidents(request, response) {
      const { queryService } = getServices();
      const search = typeof request.query.search === "string"
        ? request.query.search
        : "";

      const residents = queryService.searchResidents(search);

      response.status(200).render("residents/index", {
        title: "Resident Management",
        residents,
        search,
        notice: NOTICES[request.query.notice] ?? null
      });
    },

    /**
     * GET /residents/register — show an empty registration form.
     */
    showRegistrationForm(request, response) {
      response.status(200).render("residents/register", {
        title: "Register Resident",
        values: {},
        errors: []
      });
    },

    /**
     * POST /residents/register — register a Resident through T04.
     */
    registerResident(request, response) {
      const { registrationService } = getServices();
      const values = readResidentForm(request.body);

      const result = registrationService.registerResident(
        new Resident(values)
      );

      if (!result.success) {
        response.status(422).render("residents/register", {
          title: "Register Resident",
          values,
          errors: toValidationMessages(result.errors)
        });
        return;
      }

      response.redirect(303, "/residents?notice=registered");
    },

    /**
     * GET /residents/:id/edit — show the prefilled edit form.
     */
    showEditForm(request, response) {
      const { queryService } = getServices();
      const residentId = parseRouteId(request.params.id);
      const resident = residentId === null
        ? null
        : queryService.findResidentById(residentId);

      if (!resident) {
        renderResidentNotFound(response);
        return;
      }

      response.status(200).render("residents/edit", {
        title: "Edit Resident",
        resident,
        values: readResidentForm(resident),
        errors: []
      });
    },

    /**
     * POST /residents/:id/update — update a Resident through T06.
     */
    updateResident(request, response) {
      const { queryService, updateService } = getServices();
      const residentId = parseRouteId(request.params.id);

      if (residentId === null) {
        renderResidentNotFound(response);
        return;
      }

      const values = readResidentForm(request.body);
      const result = updateService.updateResident(residentId, values);

      if (result.notFound) {
        renderResidentNotFound(response);
        return;
      }

      if (!result.success) {
        response.status(422).render("residents/edit", {
          title: "Edit Resident",
          resident: queryService.findResidentById(residentId),
          values,
          errors: toValidationMessages(result.errors)
        });
        return;
      }

      response.redirect(303, "/residents?notice=updated");
    },

    /**
     * POST /residents/:id/deactivate — soft-deactivate through T07.
     */
    deactivateResident(request, response) {
      const { deactivationService } = getServices();
      const residentId = parseRouteId(request.params.id);

      if (residentId === null) {
        renderResidentNotFound(response);
        return;
      }

      const result = deactivationService.deactivateResident(residentId);

      if (result.notFound) {
        renderResidentNotFound(response);
        return;
      }

      const notice = result.alreadyInactive ? "already-inactive" : "deactivated";
      response.redirect(303, `/residents?notice=${notice}`);
    }
  };
}
