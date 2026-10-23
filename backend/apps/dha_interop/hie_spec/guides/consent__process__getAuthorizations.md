# Consent Services Process Guide: Get Authorizations Workflow
## 1. Overview: Check an Authorization's Current Status
This guide details the Get Authorizations workflow, which retrieves an authorization record so you can check its current status. It calls GET /api/v1/claims/authorizations with one or more query parameters that identify the authorization. You use it throughout the biometrics consent flow - most commonly after a fingerprint capture, to confirm the authorization has moved from PENDING to AUTHORIZED (standard visit) or AUTHORIZED_PENDING_VISIT (elective preauth).
### 1.1. What This Workflow Does
The Get Authorizations workflow looks up an authorization and returns its record, including its current status. It does this by:
- Accepting an Identifier: You supply the token or guid of the authorization, or the patient_id, to locate the record.
- Optionally Narrowing the Response: You can pass fields to limit the response to specific fields.
- Returning the Authorization: It returns the authorization record, including its status.
### 1.2. Why This Workflow Is Critical
Confirming an authorization's status before you act on it prevents using a consent that is not actually in place. This workflow is critical because it:
- Confirms Capture Success: After a biometrics capture, it tells you whether the authorization moved to AUTHORIZED or AUTHORIZED_PENDING_VISIT - the states you need before creating a visit, preauth, or discharge.
- Detects Stuck Authorizations: It reveals authorizations still stuck at PENDING (for example, when the iframe expired before a capture) so you can clear them.
- Supports Troubleshooting: It gives you a reliable way to verify state when the flow does not behave as expected.
## 2. Workflow Details: Get Authorizations
### 2.1. Step-by-Step System Behavior
Receive Query: The system receives a query with one or more of token, guid, patient_id, and (optionally) fields.
Validate Input: The system checks that enough identifying parameters are present to locate an authorization.
Search for Authorization: The system searches for the authorization matching the provided identifiers.
Return Results: If found, the system returns the authorization record including its status. If not found, an error is returned.
### 2.2. Key Validations
Identifier Provided:
- At least one of token, guid, or patient_id must be supplied so the system can locate the authorization.
- Supplying the token or guid targets a specific authorization; patient_id looks up the patient's authorization.
Parameter Format:
- All parameters must be correctly formatted so the query resolves reliably.
### 2.3. Workflow Data Dictionary
This table outlines the query parameters this workflow accepts:
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / What it Means (to the Business)
 | token | The consent token of the authorization. | String | No | Targets a specific authorization by its consent token.
 | guid | The GUID of the authorization. | String | No | Targets a specific authorization by its GUID.
 | patient_id | The patient's unique identifier. | String | No | Looks up the authorization for a given patient.
 | fields | A selection of fields to return. | String | No | Narrows the response to only the fields you need.
### Supply an identifier
Provide the token or guid to look up a specific authorization, or the patient_id to look up the patient's authorization.
### 2.4. Expected Outcomes
Success: Authorization Retrieved
- The system returns the authorization record, including its status. Possible statuses:
 | Status | Meaning
 | PENDING | Authorization created; waiting for a successful fingerprint match.
 | AUTHORIZED | Fingerprint matched; ready for a standard visit or discharge.
 | AUTHORIZED_PENDING_VISIT | Fingerprint matched (elective); waiting for visit creation after preauth approval.
 | REJECTED | The authorization was rejected (all retries failed, or it was explicitly rejected).
Read authorizationReason alongside status. On a REJECTED authorization, BIOMETRICS_NOT_FOUND_OTP_ALLOWED means eCitizen has no usable fingerprints for the patient and they may consent by OTP instead. See OTP Fallback When No Usable Fingerprints Are Found.
Failure: Authorization Not Found
- No authorization matched the supplied identifiers. Verify the token, guid, or patient_id used.
## 3. Critical Success Factors for Integration
- Supply a Precise Identifier: Use the token or guid when you know the specific authorization; fall back to patient_id otherwise.
- Poll After Capture: After a biometrics capture, check the status to confirm it moved to AUTHORIZED or AUTHORIZED_PENDING_VISIT before proceeding.
- Handle a Stuck PENDING: If the status is still PENDING, clear it with Reject Authorization and create a fresh authorization.
- Check the Reason on a Rejection: If a REJECTED authorization has authorizationReason BIOMETRICS_NOT_FOUND_OTP_ALLOWED, switch the patient to OTP rather than retrying biometrics.
## 4. Related Resources
- Biometrics Consent - the biometrics authorization flow.
- Reject Authorization - clear a stuck PENDING authorization.
- OTP Fallback When No Usable Fingerprints Are Found - what to do when a rejection carries BIOMETRICS_NOT_FOUND_OTP_ALLOWED.
- Biometrics Integration Guide - the end-to-end walkthrough.
- Consent Services API Reference
Last modified on September 28, 2026
