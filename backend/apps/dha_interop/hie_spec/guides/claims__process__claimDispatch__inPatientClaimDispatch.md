# Claim Dispatch / Visit End Process Guide: In-patient Claim Dispatch Workflow
## 1. Overview: Finalising an Inpatient's Discharge and Claim
This guide focuses on the inpatient claim dispatch workflow, which is part of the final stages of the broader claim dispatch and visit end process. The workflow ensures a formal finalisation and checkout for a patient's inpatient stay. Its primary purpose is to guarantee that the patient is officially discharged and that all claim-related data, including special case information, is accurately captured and linked to the final claim.
### 1.1. What This Workflow Does
The Inpatient claim dispatch workflow's primary function is to formalise an inpatient's discharge from a facility. It achieves this by:
- Confirming the patient's identity via an OTP or biometrics authorization,
- Processing the discharge itself, and
- Executing a conditional step of ensuring a death certificate is attached to the claim if the discharge reason is "DECEASED".
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Getting an inpatient's discharge process right is key for both clinical accuracy and financial compliance. Without a precise process, several serious issues can arise:
- Inaccurate Records: An incomplete discharge can leave a patient's record in an "open" state.
- Non-Compliant Claims: Claims for deceased patients require a death certificate attached to the claim, or they risk rejection.
- Audit Scrutiny: Improper discharges may lead to issues during audit reviews.
- Financial Errors: Incomplete claims can lead to payment delays and reconciliation errors.
This workflow ensures compliant inpatient billing with accurate discharge data and procedural integrity.
## 2. Workflow Details: Inpatient Claim Dispatch
### 2.1. Workflow Description: Step-by-Step System Behavior
Get Beneficiary's Valid Contacts
The system retrieves patient contact info using consent_token and is_alive flag.
Send OTP (OTP path)
An OTP is sent to the retrieved contact using:
- beneficiary_cr_id
- beneficiary_contact_id
- consent_token
- otp_type = discharge
Biometrics path (alternative to OTP): Discharge consent can also be obtained via biometrics:
- Call POST /api/v1/claims/authorize with biometrics-specific fields, including the workstationID from the biometrics hardware server and the biometrics agent's National ID. The authorization is created in PENDING status and the response includes an iframe link.
- Render the iframe so the patient can match their fingerprint. On a successful match, the authorization transitions from PENDING to AUTHORIZED.
- In the discharge call (step 3), include discharge_auth_guid (the GUID of the AUTHORIZED authorization) in place of the otp field.
Inpatient Discharge
The discharge action is performed using:
- consent_token
- discharge_date
- invoice_number
- discharge_reason
- otp (OTP path) or discharge_auth_guid (biometrics path) for patient consent
Conditional Check
The system checks whether discharge_reason == DECEASED.
Attach Death Certificate (if deceased)
If discharge_reason == DECEASED, the provider must ensure the patient's death certificate is attached to the claim as a claim attachment before dispatch. See The Deceased Patient Workflow for details.
Confirmation
The system confirms successful discharge and the completion of required steps.
### 2.2. Key Validations: Our System's Essential Checks
Valid Discharge Date
discharge_date cannot be before admission date or in the future.
Death Certificate Attached (if deceased)
If discharge_reason == DECEASED, the death certificate must be attached to the claim as a claim attachment. See The Deceased Patient Workflow.
Claim Doctor Attached
A claim cannot be dispatched without doctor details attached. A doctor must have been added earlier via start-visit, add-diagnosis, or add-line. See Adding a Claim Doctor.
Valid consent_token
Must correspond to an active inpatient visit.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | Token for patient visit | string | Yes | Authorises finalisation and links to patient encounter
 | is_alive | Patient alive status | boolean | Yes | Determines contact retrieval logic for OTP
 | beneficiary_cr_id | Client registry ID | string | Yes | Identifies the beneficiary
 | beneficiary_contact_id | ID of the patient’s contact | string | No | Specifies the contact for OTP
 | otp_type | Should be set to discharge | string | Yes | Defines OTP context
 | discharge_date | Date of discharge (not before admission or in future) | ISO 8601 | Yes | Sets the patient’s discharge timestamp
 | invoice_number | Invoice reference from provider | string | Yes | Links the discharge to a specific claim
 | discharge_reason | Reason for discharge: RECOVERED, REFERRED, ABSCONDED, OTHER, DECEASED | string | Yes | Used for logic branching and compliance
 | otp | OTP provided by the beneficiary | string | Conditional | Confirms patient consent to discharge (OTP path)
 | discharge_auth_guid | GUID of an AUTHORIZED biometrics authorization | string | Conditional | Used instead of otp when biometrics consent was used for discharge
### 2.4. Expected Outcomes from this Workflow
Success: Discharge with OTP
Patient is successfully discharged; OTP was verified and all required steps completed.
Success: Discharge with Biometrics
Patient is successfully discharged; biometrics authorization was confirmed as AUTHORIZED and all required steps completed.
Failure: Incorrect OTP
OTP verification failed.
Failure: Invalid or Pending Biometrics Authorization
The discharge_auth_guid does not correspond to an AUTHORIZED authorization. Ensure the patient has completed fingerprint matching before submitting.
Failure: Missing Death Certificate
discharge_reason == DECEASED but the death certificate has not been attached to the claim.
Failure: Missing Claim Doctor
The claim has no doctor details attached. Add a doctor via start-visit, add-diagnosis, or add-line before dispatch.
Failure: Invalid Discharge Date
Discharge date is before admission or in the future.
Failure: Missing Required Data
Any required field (e.g., consent_token, discharge_reason) is missing or malformed.
## 3. Related Guides and Scenarios
- The overnight-stay requirement - the admission and discharge dates must differ for the per-diem rebate to apply
- Three dates must be captured separately - admission, procedure and discharge dates on a surgical episode
- Special Benefit Rules
- Scenario 1: SHIF IP Per Diem
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 3: SHIF IP FFS Elective Preauth
Last modified on September 28, 2026
