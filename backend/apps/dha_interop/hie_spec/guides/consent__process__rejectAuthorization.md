# Consent Services Process Guide: Reject Authorization Workflow
## 1. Overview: Clear a Stuck PENDING Authorization
This guide details the Reject Authorization workflow, which transitions a stuck PENDING authorization out of PENDING so it no longer blocks the flow. It calls POST /api/v1/claims/authorizations/{consent_token}/reject, where the consent_token is a path parameter and no request body is required. You use it in the biometrics consent flow to recover when a capture never completes - most commonly when the capture iframe timer expires before the patient's fingerprint is captured.
### 1.1. What This Workflow Does
The Reject Authorization workflow rejects a single authorization identified by its consent token. It does this by:
- Accepting the Consent Token: You supply the authorization's consent_token in the URL path.
- Rejecting the Authorization: The system transitions the authorization out of PENDING, freeing you to create a fresh authorization for the same context.
### 1.2. Why This Workflow Is Critical
A stuck PENDING authorization blocks you from creating a new authorization for the same context, which halts the visit, preauth, or discharge flow. This workflow is critical because it:
- Unblocks the Flow: Rejecting the stuck authorization releases the context so a new authorization can be created.
- Enables a Clean Retry: After rejecting, you create a fresh authorization and retry the fingerprint matching from the start.
- Prevents Orphaned PENDING Records: It keeps authorization state clean rather than leaving abandoned PENDING records in place.
### When to reject: this is chiefly a biometrics tool
The scenario this endpoint exists for is an expired biometric capture. The capture iframe is time
limited. When its timer runs out before the patient's fingerprint is captured, the authorization is
left sitting in PENDING - and in that state you can do neither of the two things you need to do:
prints can no longer be matched against it, and a fresh authorization cannot be created for the same
context while it is there.
Rejecting the stuck authorization is what unblocks you. Reject it, create a new authorization, render a
new iframe, and capture again. The
Biometrics Integration Guide walks the full capture flow
and ends on exactly this recovery path.
## 2. Workflow Details: Reject Authorization
### 2.1. Step-by-Step System Behavior
Receive Request: The system receives a POST request to /api/v1/claims/authorizations/{consent_token}/reject, with the consent_token in the path and no body.
Locate the Authorization: The system looks up the authorization identified by the consent_token.
Transition Out of PENDING: The system transitions the authorization to a rejected state so it no longer blocks the context.
Return Result: The system confirms the authorization was rejected.
Create a Fresh Authorization: You create a new authorization via POST /api/v1/claims/authorize and retry the matching process.
### 2.2. Key Validations
Valid Consent Token:
- The consent_token in the path must correspond to an existing authorization.
- Without a valid consent token, the system cannot locate the authorization to reject.
Rejectable State:
- The authorization should be in a state that can be rejected (typically a stuck PENDING). Use Get Authorizations first to confirm the current status.
### 2.3. Workflow Data Dictionary
This table outlines the input this workflow uses:
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / What it Means (to the Business)
 | consent_token | The consent token of the authorization to reject. Supplied as a path parameter in the URL. | String | Yes | Identifies which authorization to transition out of PENDING.
### No request body
The consent_token is passed in the URL path. This endpoint does not require a request body.
### 2.4. Expected Outcomes
Success: Authorization Rejected
- The authorization was transitioned out of PENDING. You can now create a fresh authorization for the same context and retry the biometrics capture.
Failure: Authorization Not Found
- The provided consent_token did not match an existing authorization. Verify the token; use Get Authorizations to look it up.
## 3. Critical Success Factors for Integration
- Confirm State First: Use Get Authorizations to confirm the authorization is stuck at PENDING before rejecting it.
- Reject, Then Recreate: After a successful reject, create a fresh authorization via POST /api/v1/claims/authorize and render a new iframe to retry.
- Do Not Leave Authorizations in PENDING: Always clear a stuck PENDING so it does not block subsequent authorizations for the same context.
## 4. Related Resources
- Get Authorizations - check an authorization's current status.
- Biometrics Consent - the biometrics authorization flow.
- Biometrics Integration Guide - the end-to-end walkthrough.
- Consent Services API Reference
Last modified on September 28, 2026
