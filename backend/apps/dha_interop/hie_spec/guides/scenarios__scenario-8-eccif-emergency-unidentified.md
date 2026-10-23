# Scenario 8: ECCIF - Emergency - Unidentified Patient
A patient presents for emergency care but cannot be identified at the point of care (for example, brought in unconscious and alone). The claim is created under SHA's Emergency, Chronic and Critical Illness Fund (ECCIF) as an unidentified patient, care is billed by protocol, and the patient may be identified later when they are recognised. The claim is submitted within 24 hours - either as an identified patient or, if still unknown, with a reason_for_unknown_patient.
## Claim Properties
 | Property | Value
 | Fund | ECCIF (Emergency, Chronic and Critical Illness Fund)
 | Access Point | Outpatient (OP) and Inpatient (IP)
 | Payment Mechanism | Fee for Service / Fixed Fee for Service (billed against approved protocol tariffs)
 | Needs Preauth | No (doctor consent is requested instead)
 | Patient Identity | Unidentified at creation; may be identified later
 | Interventions | Exactly one per emergency claim
 | Consent | OTP only (no biometrics, no discharge OTP)
 | Claim Dispatch | Submit, within 24 hours
How to identify this scenario: Emergency interventions are identifiable by the SHA-01 intervention-code prefix (for example SHA-01-005, Shock states). The patient cannot be identified at presentation, so the emergency claim is created without beneficiary_cr_id or a patient otp.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: Access
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
### Phase 2: Create the Emergency Claim (unidentified)
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 2 | Create emergency claim | eClaims | POST /api/v1/claims/emergency | interventions (single code), mode_of_arrival, brought_by, reference_number, identification_number, identification_type, regulation_body (no beneficiary_cr_id, no otp) | authorization_code (use as consent_token); doctor consent request sent via OTP
### Phase 3: Doctor Consent
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 3 | (Doctor approves the consent request received via OTP) | - | - | - | Doctor consent recorded
 | 3b | (Optional) Resend doctor consent | eClaims | POST /api/v1/claims/doctor-consent | practitioner_registration_number, request_type: "EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST", consent_token, intervention_code | Consent request re-sent
### Phase 4: Resolve & Add Protocols
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 4 | Get emergency protocols | eClaims | GET /api/v1/claims/emergency/protocols | intervention_code, active=true | Approved protocols with protocolCode and applicableTariff
 | 5 | Add combined protocol details | eClaims | POST /api/v1/claims/emergency/protocols | consent_token, protocol_code, intervention_code, unit_price, quantity, diagnoses, attachments | Protocol line saved; amount validated against tariff
### Phase 5: Identify the Unknown Patient (optional, when recognised)
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as beneficiary_cr_id
 | 7 | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, contact_id (optional) | OTP sent to patient
 | 8 | Identify the patient | eClaims | POST /api/v1/claims/emergency | original unidentified payload + beneficiary_cr_id + otp + consent_token | Claim moves from unknown to known patient
### Phase 6: Submit (within 24 hours)
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 9 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 10 | Submit emergency claim | eClaims | POST /api/v1/claims/submit | consent_token, discharge_reason, invoice_number, reason_for_unknown_patient (only if still unidentified) | Emergency claim submitted to SHA under ECCIF
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | authorization_code (consent_token) | Step 2 | Steps 3b, 5, 8, 9, 10
 | intervention_code | Chosen for the emergency case | Steps 2, 3b, 4, 5
 | protocolCode + applicableTariff | Step 4 | protocol_code and unit_price in Step 5
 | beneficiary_cr_id | Step 6 (if identified later) | beneficiary_cr_id in Step 8
 | OTP | Patient receives via SMS (Step 7) | otp in Step 8
## Two Submission Paths
### Identified Later vs Still Unknown
By the time you submit, the patient is in one of two states:
 | State | What you did | Submission field
 | Identified later | Ran Phase 5 to link the patient (unknown to known) | Omit reason_for_unknown_patient
 | Still unknown | Could not identify the patient during the visit | Include reason_for_unknown_patient - one of SHA_UNREGISTERED or DECEASED
In both cases discharge_reason (RECOVERED, REFERRED, ABSCONDED, OTHER) is required. Note that DECEASED is a valid reason_for_unknown_patient but not a valid discharge_reason on POST /api/v1/claims/submit.
## Important Notes
### One Intervention, Submit Within 24 Hours
An emergency claim covers exactly one intervention and must be submitted within 24 hours of the emergency, whether or not the patient was identified.
### Identification Re-uses the Create Endpoint
Identifying an unknown patient re-hits POST /api/v1/claims/emergency with the original unidentified payload plus beneficiary_cr_id, otp, and the consent_token of the unknown claim. It updates the same claim - the protocols already added are retained.
### OTP Only - No Biometrics
Emergency consent uses OTP only, including the identification step. There is no biometrics path and no discharge OTP in the emergency flow.
## See Also
- Emergency Case Claims Process Overview
- Create an Emergency Case Claim
- Identify an Unknown Emergency Patient
- Submit an Emergency Case Claim
- Scenario 7: ECCIF Emergency Identified Patient
Last modified on September 28, 2026
