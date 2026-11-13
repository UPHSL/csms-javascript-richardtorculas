import { ServiceRequest } from "../models/ServiceRequest.js";
import { ServiceRequestQueryService } from "../services/ServiceRequestQueryService.js";
import { parseRouteId, toNumberIfWhole } from "../utils/requestParsing.js";

/**
 * Fields accepted from the submission form (T09).  The Service Request id
 * and status are deliberately absent: persistence generates the id and a
 * new request always begins as Pending.
 */
const SUBMISSION_FIELDS = [
  "residentId",
  "serviceType",
  "description",
  "dateRequested"
];

/**
 * Named workflow operations offered by the interface.  Each one asks T10 for
 * a specific target status; whether that transition is permitted is decided
 * only by ServiceRequestStatusService.
 */
const WORKFLOW_ACTIONS = Object.freeze({
  start: { label: "Start Processing", targetStatus: "In Progress", notice: "started" },
  complete: { label: "Complete", targetStatus: "Completed", notice: "completed" },
  cancel: { label: "Cancel", targetStatus: "Cancelled", notice: "cancelled" }
});

/**
 * User-facing messages for the field keys reported by the T09
 * ServiceRequestValidator.  Presentation wording only.
 */
const VALIDATION_MESSAGES = Object.freeze({
  residentId: "Resident ID must be a positive whole number.",
  serviceType: "Service type is required.",
  description: "Description is required.",
  dateRequested: "Date requested must be a valid date (YYYY-MM-DD).",
  id: "A new Service Request cannot be submitted with an ID.",
  status: "A new Service Request must begin as Pending."
});

const RESIDENT_NOT_FOUND_MESSAGE = "Resident not found.";
const RESIDENT_INACTIVE_MESSAGE =
  "Inactive Residents cannot submit new Service Requests.";
const INVALID_TRANSITION_MESSAGE =
  "That action is not allowed for the Service Request's current status.";

/**
 * Success messages shown after a Post/Redirect/Get cycle.  Only known keys
 * are rendered, so arbitrary query text never reaches the page.
 */
const NOTICES = Object.freeze({
  submitted: "Service Request submitted successfully.",
  started: "Service Request is now In Progress.",
  completed: "Service Request completed successfully.",
  cancelled: "Service Request cancelled successfully."
});

/**
 * Read the submission fields from a form body, converting the Resident ID
 * text to a number so T09 can validate it as an identifier.
 *
 * @param {object|undefined} body - Parsed request body.
 * @returns {{ values: object, input: object }} Raw values for redisplay and
 *   converted input for the Service Request.
 */
function readSubmissionForm(body = {}) {
  const values = {};

  for (const field of SUBMISSION_FIELDS) {
    values[field] = body[field];
  }

  return {
    values,
    input: { ...values, residentId: toNumberIfWhole(values.residentId) }
  };
}

/**
 * Convert a T09 submission result into displayable messages.
 *
 * @param {object} result - ServiceRequestSubmissionService result.
 * @returns {{ field: string, message: string }[]}
 */
function toSubmissionMessages(result) {
  if (result.residentNotFound) {
    return [{ field: "residentId", message: RESIDENT_NOT_FOUND_MESSAGE }];
  }

  if (result.residentInactive) {
    return [{ field: "residentId", message: RESIDENT_INACTIVE_MESSAGE }];
  }

  return result.errors.map((field) => ({
    field,
    message: VALIDATION_MESSAGES[field] ?? `${field} is invalid.`
  }));
}

/**
 * Render the controlled Service Request not-found page.
 *
 * @param {import("express").Response} response Express response.
 */
function renderServiceRequestNotFound(response) {
  response.status(404).render("error", {
    title: "Service Request Not Found",
    message: "The requested Service Request does not exist.",
    backHref: "/service-requests",
    backLabel: "Service Request Management"
  });
}

/**
 * Create the Service Request Management presentation handlers.
 *
 * The handlers delegate every operation to the existing T09-T11 application
 * services and choose a view or redirect.  They contain no SQL, no
 * validation rules, no Resident eligibility rules, no transition rules, and
 * no search logic.
 *
 * @param {() => object} getServices - Returns the application services:
 *   serviceRequestQueryService, serviceRequestSubmissionService,
 *   serviceRequestStatusService.
 * @returns {object} Express request handlers.
 */
export function createServiceRequestController(getServices) {
  /**
   * Ask T10 which workflow actions are currently permitted.
   *
   * @param {ServiceRequest} serviceRequest - A persisted Service Request.
   * @returns {{ key: string, label: string }[]}
   */
  function availableActions(serviceRequest) {
    const { serviceRequestStatusService } = getServices();

    return Object.entries(WORKFLOW_ACTIONS)
      .filter(([, action]) => serviceRequestStatusService.isAllowedTransition(
        serviceRequest.status,
        action.targetStatus
      ))
      .map(([key, action]) => ({ key, label: action.label }));
  }

  /**
   * Render the details page for a persisted Service Request.
   */
  function renderDetails(response, serviceRequest, { statusCode = 200, notice = null, error = null } = {}) {
    response.status(statusCode).render("service-requests/show", {
      title: `Service Request #${serviceRequest.id}`,
      serviceRequest,
      actions: availableActions(serviceRequest),
      notice,
      error
    });
  }

  /**
   * Handle one named workflow action through T10.
   */
  async function performAction(actionKey, request, response) {
    const { serviceRequestQueryService, serviceRequestStatusService } = getServices();
    const action = WORKFLOW_ACTIONS[actionKey];
    const serviceRequestId = parseRouteId(request.params.id);

    if (serviceRequestId === null) {
      renderServiceRequestNotFound(response);
      return;
    }

    const result = await serviceRequestStatusService.changeStatus(
      serviceRequestId,
      action.targetStatus
    );

    if (result.notFound) {
      renderServiceRequestNotFound(response);
      return;
    }

    if (!result.success) {
      renderDetails(
        response,
        serviceRequestQueryService.viewServiceRequest(serviceRequestId),
        { statusCode: 409, error: INVALID_TRANSITION_MESSAGE }
      );
      return;
    }

    response.redirect(
      303,
      `/service-requests/${serviceRequestId}?notice=${action.notice}`
    );
  }

  return {
    /**
     * GET /service-requests — list, search, and filter through T11.
     */
    listServiceRequests(request, response) {
      const { serviceRequestQueryService } = getServices();
      const search = typeof request.query.search === "string"
        ? request.query.search
        : "";
      const status = typeof request.query.status === "string"
        ? request.query.status
        : "";

      const renderList = (statusCode, serviceRequests, error) => {
        response.status(statusCode).render("service-requests/index", {
          title: "Service Request Management",
          rows: serviceRequests.map((serviceRequest) => ({
            serviceRequest,
            actions: availableActions(serviceRequest)
          })),
          search,
          status,
          statuses: ServiceRequestQueryService.SUPPORTED_STATUSES,
          notice: NOTICES[request.query.notice] ?? null,
          error
        });
      };

      if (status !== "" && !serviceRequestQueryService.isSupportedStatus(status)) {
        renderList(400, [], "Please choose a valid status filter.");
        return;
      }

      renderList(
        200,
        serviceRequestQueryService.searchServiceRequests(search, status),
        null
      );
    },

    /**
     * GET /service-requests/new — show an empty submission form.
     */
    showSubmissionForm(request, response) {
      response.status(200).render("service-requests/new", {
        title: "Submit Service Request",
        values: {},
        errors: []
      });
    },

    /**
     * POST /service-requests — submit a Service Request through T09.
     */
    submitServiceRequest(request, response) {
      const { serviceRequestSubmissionService } = getServices();
      const { values, input } = readSubmissionForm(request.body);

      const result = serviceRequestSubmissionService.submitServiceRequest(
        new ServiceRequest(input)
      );

      if (!result.success) {
        response.status(422).render("service-requests/new", {
          title: "Submit Service Request",
          values,
          errors: toSubmissionMessages(result)
        });
        return;
      }

      response.redirect(303, "/service-requests?notice=submitted");
    },

    /**
     * GET /service-requests/:id — view one Service Request through T11.
     */
    showServiceRequest(request, response) {
      const { serviceRequestQueryService } = getServices();
      const serviceRequestId = parseRouteId(request.params.id);
      const serviceRequest = serviceRequestId === null
        ? null
        : serviceRequestQueryService.viewServiceRequest(serviceRequestId);

      if (!serviceRequest) {
        renderServiceRequestNotFound(response);
        return;
      }

      renderDetails(response, serviceRequest, {
        notice: NOTICES[request.query.notice] ?? null
      });
    },

    /**
     * POST /service-requests/:id/start — Pending -> In Progress (T10).
     */
    startProcessing(request, response) {
      return performAction("start", request, response);
    },

    /**
     * POST /service-requests/:id/complete — In Progress -> Completed (T10).
     */
    completeServiceRequest(request, response) {
      return performAction("complete", request, response);
    },

    /**
     * POST /service-requests/:id/cancel — Pending/In Progress -> Cancelled (T10).
     */
    cancelServiceRequest(request, response) {
      return performAction("cancel", request, response);
    }
  };
}
