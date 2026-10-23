# Preauths Process Guide: Pre-Authorization Cancellation Workflow
## Preauths Process: Cancel Preauth
### 1. Overview
This guide explains the Pre-Authorization Cancellation workflow, which allows healthcare facilities to formally close or cancel a pending pre-authorization request that was initiated but will no longer be pursued or submitted to the Social Health Authority (SHA) for review.
This workflow is essential for maintaining data integrity, and clearing the facility's queue of open preauths that are no longer valid.This provides a true reflection of the patient's visit.
1.1. What This Workflow Does
The Pre-Authorization Cancellation workflow enables users to:
- Identify the Target Preauth: Use a valid, active consent_token and the specific intervention_code to uniquely identify the pending pre-authorization request.
- Validate Cancel Status: Ensure the identified pre-authorization is in a state that permits cancellation. The statuses valid for cancellation are exactly: DRAFT, PENDING_DOCTOR_APPROVAL, PENDING_SUBMISSION, CLARIFICATION_AFTER_AUTOMATIC_CHECKS, and FINALISED.
- Execute Status Change: Update the status of the pre-authorization request to CANCELLED.
Note: Cancellation also allows cancelling an approved (FINALISED) preauth that was not used, i.e. the service has not yet been billed for. Doing so releases the balance the payer reserved when they approved the preauth.
1.2. Why This Workflow Is Critical
- Data Integrity: Formally cancelling preauths opened by mistake ensures that the facility's records accurately reflect the services the patient is actually receiving or pursuing.
- Queue Management: Clears the system of unnecessary or erroneously opened preauth requests.
- Preventing Accidental Submissions: Avoids mistaken submission of an incorrect preauthorization requests for review by the payer.
- Auditability: Provides a clear audit trail for cancelled preauthorization requests.
### 2. Workflow Details: Cancelling a Preauth Request
2.1. Workflow Description
- Input Reception: The system receives the patient's current consent_token and the intervention_code linked to the preauthorization request to be cancelled.
- Preauth Identification: The system identifies the specific pending pre-authorization request using the provided information.
- Status Validation: The system verifies that the current status of the identified preauth is eligible for cancellation. The statuses valid for cancellation are exactly DRAFT, PENDING_DOCTOR_APPROVAL, PENDING_SUBMISSION, CLARIFICATION_AFTER_AUTOMATIC_CHECKS, and FINALISED.
- Status Update: If validation is successful, the preauth status is atomically updated to CANCELLED.
- Outcome Delivery: A confirmation message and the preauth_id of the cancelled request are returned.
2.2. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The active token linking to the patient's current visit | String | Yes | Identifies the active patient visit context
 | intervention_code | SHA-recognized code for the intervention | String | Yes | Uniquely identifies the specific intervention which the pre-authorization request is for.
2.3. Expected Outcomes
 | Outcome | Description
 | Success: Preauth Closed | The pre-authorization request was successfully identified and closed.
 | Failure: Invalid Consent/Visit | The consent_token was invalid, expired, or the visit is no longer active.
 | Failure: Preauth Not Found | No pending pre-authorization request matched the provided identifiers.
 | Failure: Invalid Status | The request cannot be closed because it is already in a final state.
 | Failure: Input Error | Missing or invalid required fields.
### 3. Critical Success Factors for Integration
- Token Accuracy: Ensure the provided consent_token is the correct, currently active token for the patient's visit.
- Intervention Code Precision: The intervention_code must precisely match the code used when the preauth request was originally opened.
- Status Handling: Communicate clearly why a request cannot be cancelled if it is already in a final state.
### 4. Cancel an approved preauth you will not use
An elective preauthorization is approved before the visit, and an approved elective preauth with no visit
created against it expires 7 days after approval. The member's balance is committed in the meantime.
So when a planned procedure falls through - the patient does not attend, or it is rescheduled beyond the
window - cancel the preauthorization rather than leaving it to expire. Cancelling is explicit and immediate;
expiry is a background process. An expired approval cannot be reused or extended, so a later visit needs a
fresh preauthorization and fresh pre-visit consent.
See
An approved elective preauth expires in 7 days
and, for the rule as SHA publishes it against a specific package,
Approved preauths expire in 7 days.
### 5. Related Resources
- Elective Preauthorizations - the pre-visit flow and the expiry clock.
- Medical Imaging Rules - the package whose rules state the 7-day expiry.
- Preauths Process Overview - how the preauth paths relate.
- Patient Utilization - confirming what has actually been consumed.
Last modified on September 28, 2026
