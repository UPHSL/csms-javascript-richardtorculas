/**
 * Represents a community service request associated with a Resident.
 *
 * T08 defines only how a Service Request is represented.  It does not
 * validate, persist, submit, search, or manage Service Request statuses —
 * those behaviors belong to succeeding tickets.
 *
 * The association to the Resident domain is expressed purely through
 * residentId; the Resident's personal and contact information is not
 * duplicated here.
 *
 * A newly created Service Request:
 *   - begins with an unassigned id (null) until persistence assigns one
 *   - preserves the supplied residentId, serviceType, description, and
 *     dateRequested
 *   - defaults to the "Pending" status unless the caller supplies one
 */
export class ServiceRequest {
  constructor({
    id = null,
    residentId,
    serviceType,
    description,
    dateRequested,
    status = "Pending"
  }) {
    this.id = id;
    this.residentId = residentId;
    this.serviceType = serviceType;
    this.description = description;
    this.dateRequested = dateRequested;
    this.status = status;
  }
}
