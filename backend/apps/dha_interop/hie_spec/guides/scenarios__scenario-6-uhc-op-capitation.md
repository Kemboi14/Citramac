# Scenario 6: UHC - Outpatient - Capitation
A patient presents at a facility for a UHC-covered outpatient service under a capitation payment mechanism. No preauthorization is required. This path also covers PHC (Primary Healthcare Fund) outpatient visits at Level 2, Level 3, and select Level 4 (primarily government-owned) facilities, where attachments are not mandatory.
## Intervention Properties
 | Property | Value
 | Fund | UHC (or PHC for Level 2/3 and select Level 4 facilities)
 | Access Point | Outpatient (OP)
 | Payment Mechanism | Capitation
 | Needs Preauth | N/A
 | Elective Preauth | N/A
 | Tariff Type | N/A
How to identify this scenario: After calling GET /api/v1/patients/benefits/interventions, the intervention has paymentMechanism: "CAPITATION" and fund = UHC.
For PHC claims at Level 2, Level 3, and select Level 4 (primarily government-owned) facilities, the flow is the same but attachments are not required.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: General API Flow
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as patient_id
 | 3 | SHA eligibility check | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of schemes under SHA
 | 4 | Sub-benefit coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | intervention_code, paymentMechanism: "CAPITATION" confirmed
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
### Phase 3: Add Combined Billing Details
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 9 | Add combined billing details | eClaims | POST /api/v1/claims/lines | consent_token, intervention_code, unit_price, quantity, diagnoses (ICD-11 array), attachments (optional for PHC) | Billing saved
### Phase 4: Preview & Visit End
Preview the claim, then end the visit. The visit-end submit captures the discharge reason and requires fresh patient consent (a discharge OTP or a biometrics authorization). See Outpatient Claim Dispatch.
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 10 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
Visit end - OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11a | Send discharge OTP | Consent | POST /api/v1/claims/otp/discharge | consent_token, patient_id | OTP sent
 | 12a | Submit outpatient claim | eClaims | POST /api/v1/claims/submit | consent_token, invoice_number, discharge_reason, otp | Claim submitted to SHA
Visit end - Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11b | Create visit-end authorization | Consent | POST /api/v1/claims/authorize | consent_token, biometric fields | Authorization AUTHORIZED; discharge_auth_guid
 | 12b | Submit outpatient claim | eClaims | POST /api/v1/claims/submit | consent_token, invoice_number, discharge_reason, discharge_auth_guid | Claim submitted to SHA
discharge_reason is one of RECOVERED, REFERRED, ABSCONDED, OTHER.
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | patient.id | Step 2 | patient_id in Steps 3-8
 | sub_benefit_code | Step 4 | Step 5
 | intervention_code | Step 5 | Steps 8, 9, 10
 | OTP (OTP path) | Patient receives via SMS | otp field in POST /api/v1/claims/visit
 | guid (Biometrics path) | Step 6b authorize | auth_guid in POST /api/v1/claims/visit
 | consent_token | From claim creation (Step 8) | Steps 9-12
 | discharge OTP (OTP path) | Step 11a | otp field in POST /api/v1/claims/submit
 | discharge_auth_guid (Biometrics path) | Step 11b | discharge_auth_guid in POST /api/v1/claims/submit
## Important Notes
### PHC Claims: Attachments Are Optional
For Primary Healthcare (PHC) claims at Level 2, Level 3, and select Level 4 (primarily government-owned) facilities, attachments are not required when calling POST /api/v1/claims/lines. You can submit just the line item and diagnosis.
For standard UHC outpatient claims, include attachments as required by the intervention.
### No Preauthorization Required
Capitation interventions do not require any preauthorization step. After creating the claim, proceed directly to billing.
### Claim Doctor Required Before Submit
The visit-end submit is rejected if no doctor is attached to the claim. A doctor must have been added earlier via start-visit, add-diagnosis, or add-line. See Adding a Claim Doctor.
### Capitation vs Per Diem
Capitation (this scenario) and Per Diem (Scenario 1) are both non-preauth flows, but they differ in important ways:
 |  | Capitation (Scenario 6) | Per Diem (Scenario 1)
 | Access point | Outpatient | Inpatient
 | Fund | UHC / PHC | SHIF
 | Line item | Manually submitted | Auto-generated
 | Dispatch | Submit (POST /claims/submit) | Discharge (POST /claims/discharge)
## See Also
- Start Visit Consent Process
- Outpatient Claim Dispatch
- Billing Process Overview
- Understanding Benefits and Intervention Codes
Last modified on September 28, 2026
