const SUPPORTED_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];

const ALLOWED_TRANSITIONS = {
  "Pending": ["In Progress", "Cancelled"],
  "In Progress": ["Completed", "Cancelled"],
  "Completed": [],
  "Cancelled": []
};

export class ServiceRequestStatusResult {
  constructor({ success, serviceRequest, notFound, unsupportedStatus, invalidTransition }) {
    this.success = success;
    this.serviceRequest = serviceRequest;
    this.notFound = notFound;
    this.unsupportedStatus = unsupportedStatus;
    this.invalidTransition = invalidTransition;
  }

  static success(serviceRequest) {
    return new ServiceRequestStatusResult({
      success: true,
      serviceRequest,
      notFound: false,
      unsupportedStatus: false,
      invalidTransition: false
    });
  }

  static notFound() {
    return new ServiceRequestStatusResult({
      success: false,
      serviceRequest: null,
      notFound: true,
      unsupportedStatus: false,
      invalidTransition: false
    });
  }

  static unsupportedStatus() {
    return new ServiceRequestStatusResult({
      success: false,
      serviceRequest: null,
      notFound: false,
      unsupportedStatus: true,
      invalidTransition: false
    });
  }

  static invalidTransition() {
    return new ServiceRequestStatusResult({
      success: false,
      serviceRequest: null,
      notFound: false,
      unsupportedStatus: false,
      invalidTransition: true
    });
  }
}

export class ServiceRequestStatusService {
  constructor(serviceRequestRepository) {
    this.serviceRequestRepository = serviceRequestRepository;
  }

  isSupportedStatus(status) {
    return SUPPORTED_STATUSES.includes(status);
  }

  isAllowedTransition(currentStatus, requestedStatus) {
    if (currentStatus === requestedStatus) {
      return false;
    }
    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(requestedStatus) : false;
  }

  async changeStatus(serviceRequestId, requestedStatus) {
    if (!this.isSupportedStatus(requestedStatus)) {
      return ServiceRequestStatusResult.unsupportedStatus();
    }

    const serviceRequest = this.serviceRequestRepository.findById(serviceRequestId);

    if (!serviceRequest) {
      return ServiceRequestStatusResult.notFound();
    }

    const currentStatus = serviceRequest.status;

    if (!this.isAllowedTransition(currentStatus, requestedStatus)) {
      return ServiceRequestStatusResult.invalidTransition();
    }

    const updated = this.serviceRequestRepository.updateStatus(serviceRequestId, requestedStatus);

    if (!updated) {
      return ServiceRequestStatusResult.notFound();
    }

    const updatedServiceRequest = this.serviceRequestRepository.findById(serviceRequestId);
    return ServiceRequestStatusResult.success(updatedServiceRequest);
  }
}