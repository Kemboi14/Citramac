# Scenario 5: SHIF - Outpatient - Fee for Service - Normal/Special Preauth
A patient presents for an outpatient service that requires a non-elective preauthorization raised within the same visit. The claim is created first, then the preauth is created within the visit context. Billing proceeds once the preauth is approved. The claim is submitted at the end of the visit.
## Intervention Properties
 | Property | Value
 | Fund | SHIF
 | Access Point | Outpatient (OP)
 | Payment Mechanism | Fee for Service
 | Needs Preauth | Yes (needsPreauth: true)
 | Elective Preauth | No (needsManualPreauthApproval: false)
 | Tariff Type | Overall / KEPH Level
How to identify this scenario: After calling GET /api/v1/patients/benefits/interventions, the intervention has paymentMechanism: "FEE_FOR_SERVICE", needsPreauth: true, needsManualPreauthApproval: false, and accessPoint: "OP".
This scenario is the outpatient equivalent of Scenario 2 - the preauth flow is the same, but the claim is an outpatient claim and dispatch ends with a consent-verified visit-end submit (capturing the discharge reason) rather than the inpatient discharge flow.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: General API Flow
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as patient_id
 | 3 | SHA eligibility check | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of schemes under SHA
 | 4 | Sub-benefit coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | intervention_code, needsPreauth, needsManualPreauthApproval, preauth type flags
### Phase 2: Patient Consent
OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6a | Get patient contacts | Consent | GET /api/v1/patients/contacts | patient_id | Masked contact list with id - confirm contact with patient
 | 7a | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, intervention_codes, contact_id (optional) | OTP sent
 | 8a | Create claim with OTP | eClaims | POST /api/v1/claims/visit | otp, intervention_code, service_type: "OUTPATIENT" | OP claim created
Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6b | Create authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields, service_type: "OUTPATIENT" | Authorization PENDING; guid; iframe link
 | 7b | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 8b | Create claim with auth_guid | eClaims | POST /api/v1/claims/visit | auth_guid, intervention_code, service_type: "OUTPATIENT" | OP claim created
### Phase 3: Create & Await Preauth
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 9 | Create preauth | eClaims | POST /api/v1/preauths | consent_token, intervention_code, preauth form fields (normal or special), doctor details, diagnosis, attachments, requested amount | Preauth created (no doctor approval step)
 | 10 | Poll preauth status | eClaims | GET /api/v1/preauths | consent_token | status - repeat until FINALISED
### Phase 4: Add Combined Billing Details
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11 | Add combined billing details | eClaims | POST /api/v1/claims/lines | consent_token, intervention_code, unit_price, quantity, diagnoses, attachments | Billing saved; amount validated against tariff
### Phase 5: Preview & Visit End
Preview the claim, then end the visit. The visit-end submit captures the discharge reason and requires fresh patient consent (a discharge OTP or a biometrics authorization). See Outpatient Claim Dispatch.
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 12 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
Visit end - OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 13a | Send discharge OTP | Consent | POST /api/v1/claims/otp/discharge | consent_token, patient_id | OTP sent
 | 14a | Submit outpatient claim | eClaims | POST /api/v1/claims/submit | consent_token, invoice_number, discharge_reason, otp | Claim submitted to SHA
Visit end - Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 13b | Create visit-end authorization | Consent | POST /api/v1/claims/authorize | consent_token, biometric fields | Authorization AUTHORIZED; discharge_auth_guid
 | 14b | Submit outpatient claim | eClaims | POST /api/v1/claims/submit | consent_token, invoice_number, discharge_reason, discharge_auth_guid | Claim submitted to SHA
discharge_reason is one of RECOVERED, REFERRED, ABSCONDED, OTHER.
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | patient.id | Step 2 | patient_id in Steps 3-8
 | sub_benefit_code | Step 4 | Step 5
 | intervention_code | Step 5 | Steps 8, 9, 11
 | OTP (OTP path) | Patient receives via SMS | otp field in POST /api/v1/claims/visit
 | guid (Biometrics path) | Step 6b authorize | auth_guid in POST /api/v1/claims/visit
 | consent_token | From claim creation (Step 8) | Steps 9-14
 | discharge OTP (OTP path) | Step 13a | otp field in POST /api/v1/claims/submit
 | discharge_auth_guid (Biometrics path) | Step 13b | discharge_auth_guid in POST /api/v1/claims/submit
## Choosing the Right Preauth Form
 | Preauth Type | When to Use | Intervention Flag
 | Normal Preauth | General services | All special flags = false
 | Surgical Preauth | Surgical procedures | requiresSurgicalPreauth: true
 | Oncology Preauth | Cancer treatments | requiresOncologyPreauth: true
 | Renal Preauth | Dialysis and renal care | requiresRenalPreauth: true
 | Imaging Preauth | Radiology / imaging | requiresRadiologyPreauth: true
 | Optical Preauth | Eye care | requiresOpticalPreauth: true
## Important Notes
### Billing Requires an Approved Preauth
You cannot add billing details until the preauth status is FINALISED. Poll GET /api/v1/preauths?consent_token=... and wait for approval before calling POST /api/v1/claims/lines.
### Doctor Info Required, But No Approval Step for Non-Elective Preauths
When you call POST /api/v1/preauths for a non-elective preauth, doctor information is required in the payload. However, the doctor does not need to approve the preauth. The system processes it directly without waiting for doctor confirmation.
Doctor approval (which puts the preauth into PENDING_DOCTOR_APPROVAL status) is only required for elective preauths - see Scenarios 3 and 4.
### Claim Doctor Required Before Submit
The visit-end submit is rejected if no doctor is attached to the claim. A doctor must have been added earlier via start-visit, add-diagnosis, or add-line. See Adding a Claim Doctor.
### Difference from Scenario 2 (Inpatient)
This scenario is structurally identical to Scenario 2. The only differences are:
- service_type: "OUTPATIENT" in the claim creation step
- Claim dispatch uses the outpatient visit-end submit (POST /api/v1/claims/submit with discharge_reason plus OTP or biometrics consent) instead of the two-step inpatient discharge
## See Also
- Scenario 2: SHIF IP FFS Normal Preauth - Same flow, inpatient variant
- Normal Preauth
- Preauth Doctor Consent
- Understanding Preauth Statuses
- Outpatient Claim Dispatch
Last modified on September 28, 2026
