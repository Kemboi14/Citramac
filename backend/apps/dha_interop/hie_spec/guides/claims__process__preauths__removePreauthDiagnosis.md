# Preauths Process Guide: Remove Preauth Diagnosis Workflow
## Preauths Process Guide: Remove Preauth Diagnosis
### 1. Overview
This guide covers removing a diagnosis from an existing pre-authorization
(DELETE /preauths/diagnoses/{icd_code}). Diagnoses are attached when the preauth is created (via
POST /preauths); this endpoint lets a facility take one diagnosis back off a preauth that is still
being assembled, without cancelling the whole request.
1.1. What This Workflow Does
Detaches a single ICD-11 diagnosis code from a preauth. The diagnosis is identified by the icd_code in
the path, and the target preauth is scoped by the consent_token and intervention_code in the body.
One diagnosis is removed per call.
1.2. Why This Workflow Is Critical
- Correcting Mistakes: Lets a facility fix a diagnosis added in error before the preauth is
submitted, without cancelling and rebuilding it.
- Data Integrity: Keeps the preauth's diagnoses an accurate reflection of the intended request.
- Auditability: Provides a clear, per-item trail of removals.
### 2. Workflow Details
2.1. Workflow Description
- Input Reception: The system receives the icd_code to remove in the path, and the
consent_token and intervention_code in the body.
- Preauth Identification: The system locates the preauth using the consent_token and
intervention_code.
- Diagnosis Removal: The matching ICD-11 diagnosis is detached from the preauth.
- Outcome Delivery: A confirmation is returned.
2.2. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | icd_code | ICD-11 diagnosis code to remove (path parameter, e.g. ca07.0). | String | Yes | Identifies the diagnosis to detach.
 | consent_token | Token authorising the action on the beneficiary's preauth. | String | Yes | Identifies the active preauth context.
 | intervention_code | SHA intervention code the diagnosis is associated with. | String | Yes | Scopes the removal to one intervention.
2.3. Expected Outcomes
 | Outcome | Description
 | Success: Diagnosis Removed | The diagnosis was detached from the preauth.
 | Failure: Invalid Request | A required field was missing or malformed.
 | Failure: Unauthorized | The authentication token was missing or invalid.
 | Failure: Forbidden | Tenant/facility context is required and was not satisfied.
### 3. Critical Success Factors for Integration
- Scope Precisely: The consent_token and intervention_code must match the preauth the diagnosis
was added to.
- Identify the Right Diagnosis: Use the exact ICD-11 icd_code as recorded on the preauth.
- Cancel vs Remove: To withdraw an entire preauth, use Cancel Preauth
instead of removing every item.
## See Also
- Preauths Process Overview
- Remove Preauth Doctor
- Cancel Preauth
- Claims and Preauths API reference
Last modified on September 28, 2026
