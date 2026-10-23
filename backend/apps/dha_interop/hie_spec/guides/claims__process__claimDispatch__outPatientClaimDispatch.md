# Claim Dispatch / Visit End Process Guide: Outpatient Claim Dispatch Workflow
## 1. Overview: Finalising an Outpatient's Visit and Claim
This guide outlines the Outpatient claim dispatch workflow, which is the final step in our comprehensive Claim Dispatch/Visit End process. It serves as a final verification and checkout for a patient's outpatient visit. The primary purpose of this workflow is to ensure that a patient's visit is officially closed and that the claim is ready for dispatch. To obtain explicit patient consent for the end of the visit, two methods are supported: a One-Time Password (OTP) sent to the patient's registered contact, or a biometrics authorization via fingerprint matching.
### 1.1. What This Workflow Does
The Outpatient claim dispatch workflow's main function is to formalise an outpatient's visit conclusion. It supports two consent methods:
OTP path:
- Retrieving the beneficiary's contact details
- Sending an OTP to that contact
- Verifying the OTP
- Performing the "Outpatient Visit End" action
Biometrics path:
- Calling POST /api/v1/claims/authorize with biometrics fields to create a PENDING authorization
- Rendering the iframe so the patient can match their fingerprint, transitioning the authorization to AUTHORIZED
- Performing the "Outpatient Visit End" action using discharge_auth_guid instead of otp
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Finalising an outpatient visit correctly is essential for claim integrity and patient trust. Without a precise, patient-verified process, several risks arise:
- Unverified Claims: Claims submitted without patient confirmation may be disputed or rejected.
- Billing Discrepancies: Incomplete visit closures can cause inaccuracies in patient records.
- Lack of Patient Trust: Verifying the visit end with an OTP increases trust and transparency.
This workflow ensures every outpatient claim is backed by patient-verified consent.
## 2. Workflow Details: Outpatient Claim Dispatch
### 2.1. Workflow Description: Step-by-Step System Behavior
Get Beneficiary's Valid Contacts
The system retrieves the patient's valid contact info using:
- consent_token
- is_alive flag (to determine which contact to use)
Obtain Visit-End Consent
Option A: OTP
The system sends a unique OTP to the contact using:
- beneficiary_cr_id
- beneficiary_contact_id
- consent_token
- otp_type = discharge
Option B: Biometrics
As an alternative to OTP, consent can be obtained via biometrics:
- Call POST /api/v1/claims/authorize with biometrics-specific fields, including the workstationID from the biometrics hardware server and the biometrics agent's National ID. The authorization is created in PENDING status and the response includes an iframe link.
- Render the iframe so the patient can match their fingerprint. On a successful match, the authorization transitions from PENDING to AUTHORIZED.
- In the visit-end call (step 3), include discharge_auth_guid (the GUID of the AUTHORIZED authorization) instead of otp.
Outpatient Visit End
The system finalises the visit and prepares the claim for dispatch. This submit step captures the discharge reason and patient consent using:
- consent_token
- invoice_number
- discharge_reason (RECOVERED, REFERRED, ABSCONDED, OTHER)
- otp (OTP path) or discharge_auth_guid (biometrics path) for patient consent
- discharge_status (optional, PARTIAL or FULL, defaults to FULL) to choose between submitting the claim now and holding it back while documentation is assembled
### 2.2. Key Validations: Our System's Essential Checks
Valid Beneficiary Contacts
The system must retrieve a valid contact (phone/email). Without one, it cannot send the OTP.
OTP Match
The provided otp must match what was sent. This confirms the patient's consent to end the visit.
Biometrics Authorization Status (biometrics path)
The discharge_auth_guid must correspond to an AUTHORIZED authorization. PENDING or expired authorizations will be rejected.
Claim Doctor Attached
A claim cannot be submitted without doctor details attached. A doctor must have been added earlier via start-visit, add-diagnosis, or add-line. See Adding a Claim Doctor.
Valid consent_token
It must correspond to an active outpatient visit.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises and links action to a specific visit.
 | is_alive | Whether the patient is alive. | boolean | Yes | Determines which contacts to use for OTP.
 | beneficiary_cr_id | Client registry ID from eligibility check. | string | Yes | Identifies the patient in the client registry.
 | beneficiary_contact_id | ID of the contact (defaults to main contact). Optional throughout, including on the submit call. It is the contact id, not a phone number. | string | No | Indicates which contact receives the OTP.
 | otp_type | OTP context – should be "discharge" | string | Yes | Defines the purpose of the OTP.
 | invoice_number | Invoice reference from the provider. | string | Yes | Links the visit end to a specific claim.
 | discharge_reason | Reason for visit end: RECOVERED, REFERRED, ABSCONDED, OTHER | string | Yes | Captured at submit; used for compliance and reporting.
 | otp | The OTP provided by the beneficiary. | string | Conditional | Confirms patient consent to end the visit (OTP path).
 | discharge_auth_guid | GUID of an AUTHORIZED biometrics authorization. | string | Conditional | Used instead of otp when biometrics consent was used for visit end.
 | discharge_status | PARTIAL or FULL. Defaults to FULL. | string (enum) | No | FULL discharges and submits in one call. PARTIAL discharges the patient but holds the claim back for a later FULL call.
### 2.4. Expected Outcomes from this Workflow
Success: Visit Ended with OTP
The OTP is verified and the outpatient visit is officially ended.
Success: Visit Ended with Biometrics
The biometrics authorization is confirmed as AUTHORIZED and the outpatient visit is officially ended.
Failure: No Valid Contacts
The system cannot send the OTP due to missing contact info.
Failure: Incorrect OTP
The provided OTP does not match what was sent.
Failure: Invalid or Pending Biometrics Authorization
The discharge_auth_guid does not correspond to an AUTHORIZED authorization.
Failure: Missing Claim Doctor
The claim has no doctor details attached. Add a doctor via start-visit, add-diagnosis, or add-line before submission.
Failure: Missing Required Data
Any required field (consent_token, otp, or discharge_auth_guid) is missing or malformed.
### 2.5. Partial vs Full Discharge
By default the submit call does both things at once: it ends the visit and sends the claim to SHA, applying
all submission validations immediately. That requires the facility to have its attachments, claim doctor
and invoice complete before the patient can leave.
Sending discharge_status: PARTIAL splits the two. The consent and discharge reason are taken as normal
and the patient leaves, but the claim is held back. A second call carrying only the consent_token and
discharge_status: FULL then submits it once the paperwork is ready. invoice_number is still required on
the first call.
See Partial and Full Discharge for the full flow, the
validations the second call defers, and the 7-day window SHA expects it within.
## 3. Related Guides and Scenarios
- Partial and Full Discharge
- Scenario 4: SHIF OP FFS Elective Preauth
- Scenario 5: SHIF OP FFS Normal Preauth
- Scenario 6: UHC OP Capitation
Last modified on September 28, 2026
