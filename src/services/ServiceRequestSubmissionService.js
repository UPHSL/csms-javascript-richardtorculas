/**
 * Coordinates validation, Resident eligibility verification, persistence,
 * and submission results for a new Service Request.
 *
 * T09 composes the existing components into one transaction:
 *
 *   ServiceRequest
 *     -> ServiceRequestValidator       (invalid intrinsic info stops here)
 *     -> ResidentRepository.findById   (Resident-not-found stops here)
 *     -> Resident status check         (Inactive Resident stops here)
 *     -> ServiceRequestRepository.save (generates the Service Request ID)
 *     -> persisted ServiceRequest with status Pending
 *
 * The service contains no validation rules and no SQL.  It never generates
 * a Service Request ID (persistence does), never modifies the Resident, and
 * never changes the Service Request status away from Pending.  A failed
 * submission never reaches persistence.
 *
 * The result object distinguishes four outcomes:
 *   - success:            { success: true,  serviceRequest, errors: [], residentNotFound: false, residentInactive: false }
 *   - validation failure: { success: false, serviceRequest: null, errors,    residentNotFound: false, residentInactive: false }
 *   - resident not found: { success: false, serviceRequest: null, errors: [], residentNotFound: true,  residentInactive: false }
 *   - resident inactive:  { success: false, serviceRequest: null, errors: [], residentNotFound: false, residentInactive: true }
 */
export class ServiceRequestSubmissionService {
  constructor(serviceRequestValidator, serviceRequestRepository, residentRepository) {
    this.serviceRequestValidator = serviceRequestValidator;
    this.serviceRequestRepository = serviceRequestRepository;
    this.residentRepository = residentRepository;
  }

  /**
   * Submit a new Service Request for an eligible Active Resident.
   *
   * @param {ServiceRequest} serviceRequest - The new Service Request to submit.
   * @returns {object} The structured result described on the class docs.
   */
  submitServiceRequest(serviceRequest) {
    const errors = this.serviceRequestValidator.validate(serviceRequest);

    if (errors.length > 0) {
      return {
        success: false,
        serviceRequest: null,
        errors,
        residentNotFound: false,
        residentInactive: false
      };
    }

    const resident = this.residentRepository.findById(serviceRequest.residentId);

    if (!resident) {
      return {
        success: false,
        serviceRequest: null,
        errors: [],
        residentNotFound: true,
        residentInactive: false
      };
    }

    if (resident.status === "Inactive") {
      return {
        success: false,
        serviceRequest: null,
        errors: [],
        residentNotFound: false,
        residentInactive: true
      };
    }

    const persistedServiceRequest = this.serviceRequestRepository.save(serviceRequest);

    return {
      success: true,
      serviceRequest: persistedServiceRequest,
      errors: [],
      residentNotFound: false,
      residentInactive: false
    };
  }
}