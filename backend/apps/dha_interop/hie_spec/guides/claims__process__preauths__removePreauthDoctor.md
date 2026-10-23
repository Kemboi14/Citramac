# Preauths Process Guide: Remove Preauth Doctor Workflow
## Preauths Process Guide: Remove Preauth Doctor
### 1. Overview
This guide covers removing a doctor (practitioner) from an existing pre-authorization
(DELETE /preauths/doctors). Doctors are attached when the preauth is created (via POST /preauths);
this endpoint lets a facility take one practitioner back off a preauth that is still being assembled,
without cancelling the whole request.
1.1. What This Workflow Does
Detaches a practitioner from a preauth. The practitioner is identified by their
practitioner_registration_number, and the target preauth is scoped by the consent_token and
intervention_code in the body. One doctor is removed per call.
1.2. Why This Workflow Is Critical
- Correcting Mistakes: Lets a facility fix a doctor added in error before the preauth is submitted,
without cancelling and rebuilding it.
- Data Integrity: Keeps the preauth's attending doctors an accurate reflection of the intended
request.
- Auditability: Provides a clear, per-item trail of removals.
### 2. Workflow Details
2.1. Workflow Description
- Input Reception: The system receives the practitioner_registration_number, consent_token,
and intervention_code in the body.
- Preauth Identification: The system locates the preauth using the consent_token and
intervention_code.
- Doctor Removal: The matching practitioner is detached from the preauth.
- Outcome Delivery: A confirmation is returned.
2.2. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | practitioner_registration_number | Regulatory registration number of the practitioner. | String | Yes | Identifies the doctor to detach.
 | consent_token | Token authorising the action on the beneficiary's preauth. | String | Yes | Identifies the active preauth context.
 | intervention_code | SHA intervention code the doctor is associated with. | String | Yes | Scopes the removal to one intervention.
2.3. Expected Outcomes
 | Outcome | Description
 | Success: Doctor Removed | The practitioner was detached from the preauth.
 | Failure: Invalid Request | A required field was missing or malformed.
 | Failure: Unauthorized | The authentication token was missing or invalid.
 | Failure: Forbidden | Tenant/facility context is required and was not satisfied.
### 3. Critical Success Factors for Integration
- Scope Precisely: The consent_token and intervention_code must match the preauth the doctor
was added to.
- Identify the Right Doctor: Use the practitioner's practitioner_registration_number exactly as
recorded on the preauth.
- Cancel vs Remove: To withdraw an entire preauth, use Cancel Preauth
instead of removing every item.
## See Also
- Preauths Process Overview
- Remove Preauth Diagnosis
- Cancel Preauth
- Claims and Preauths API reference
Last modified on September 28, 2026
