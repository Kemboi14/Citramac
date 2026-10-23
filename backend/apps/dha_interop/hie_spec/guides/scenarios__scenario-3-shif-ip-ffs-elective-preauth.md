# Scenario 3: SHIF - Inpatient - Fee for Service - Elective Preauth
A patient is scheduled for a planned inpatient procedure that requires prior approval before the visit begins (elective preauthorization). The preauth is created and approved in advance. On the day of the actual visit, the claim is created using the same patient and intervention - no new consent or authorization step is needed.
## Intervention Properties
 | Property | Value
 | Fund | SHIF
 | Access Point | Inpatient (IP)
 | Payment Mechanism | Fee for Service
 | Needs Preauth | Yes (needsPreauth: true)
 | Elective Preauth | Yes (needsManualPreauthApproval: true)
 | Tariff Type | Overall / KEPH Level
How to identify this scenario: After calling GET /api/v1/patients/benefits/interventions, the intervention has paymentMechanism: "FEE_FOR_SERVICE", needsPreauth: true, and needsManualPreauthApproval: true with accessPoint: "IP".
## Complete Flow
This scenario has two distinct phases separated in time.
## Step-by-Step API Calls
### Pre-Visit Phase
Phase 1: General API Flow
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as patient_id
 | 3 | SHA eligibility check | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of schemes under SHA
 | 4 | Sub-benefit coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | intervention_code, needsManualPreauthApproval: true confirmed
Phase 2: Authorization for Preauth
OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6a | Get patient contacts | Consent | GET /api/v1/patients/contacts | patient_id | Masked contact list with id - confirm contact with patient
 | 7a | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, intervention_codes, contact_id (optional) | OTP sent
 | 8a | Create authorization | Consent | POST /api/v1/claims/authorize | patient_id, otp | Authorization token (status: AUTHORIZED_PENDING_VISIT)
Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6b | Create authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields | Authorization PENDING; guid; token; iframe link
 | 7b | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED_PENDING_VISIT
Phase 3: Create & Await Preauth
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 9 | Create preauth | eClaims | POST /api/v1/preauths | consent_token (authorization token), intervention_code, preauth form, doctor details, diagnosis, requested amount, attachments | Preauth created (status: PENDING_DOCTOR_APPROVAL)
 | 10 | Poll preauth status | eClaims | GET /api/v1/preauths | consent_token | status - repeat until FINALISED
### Day of Actual Visit
### No New Consent Required on Day of Visit
On the day of the actual visit, you do not need to call POST /api/v1/claims/authorize again. The system checks that:
- The same patient_id is used
- The same intervention_code is used
- An existing authorization in AUTHORIZED status exists
- An approved preauth exists for this patient and intervention
For OTP: send a fresh OTP and pass it directly in POST /api/v1/claims/visit.
For biometrics: pass the auth_guid from the pre-visit authorization directly in POST /api/v1/claims/visit.
Phase 4: Create Claim
OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11a | Send fresh OTP | Consent | POST /api/v1/claims/otp | patient_id, intervention_codes | OTP sent
 | 12a | Create IP claim | eClaims | POST /api/v1/claims/visit | otp, intervention_code, service_type: "INPATIENT" | IP claim created; consent_token returned
Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 12b | Create IP claim | eClaims | POST /api/v1/claims/visit | auth_guid (from pre-visit authorization), intervention_code, service_type: "INPATIENT" | IP claim created; consent_token returned
Phase 5: Add Combined Billing Details
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 13 | Add combined billing details | eClaims | POST /api/v1/claims/lines | consent_token, intervention_code, unit_price, quantity, diagnoses, attachments | Billing saved
Phase 6: Preview & Discharge
OTP discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 14 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 15 | Send discharge OTP | Consent | POST /api/v1/claims/otp/discharge | consent_token | OTP sent for discharge
 | 16 | Discharge patient | eClaims | POST /api/v1/claims/discharge | otp (discharge OTP) | Claim submitted to SHA
Biometrics discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 14 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 15 | Create discharge authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields | Authorization PENDING + iframe link
 | 16 | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 17 | Discharge patient | eClaims | POST /api/v1/claims/discharge | auth_guid (from Step 15) | Claim submitted to SHA
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | patient.id | Step 2 | patient_id in all subsequent steps
 | intervention_code | Step 5 | Preauth, claim, billing steps
 | token (OTP path) | Step 8a | consent_token in POST /api/v1/preauths
 | token (Biometrics path) | Step 6b | consent_token in POST /api/v1/preauths
 | guid (Biometrics path) | Step 6b | auth_guid in Day-of-Visit claim creation
 | consent_token | From claim creation (Step 12) | Billing, preview, discharge steps
## Important Notes
### Elective Preauth - Doctor Approval Required
For elective preauths, the doctor must approve before the preauth proceeds. The status flow is:
- PENDING_DOCTOR_APPROVAL - created; awaiting doctor confirmation
- ACTIVE - doctor approved; sent to payer for review
- FINALISED - payer approved; preauth is now valid for claim creation
The POST /api/v1/claims/doctor-consent endpoint is available as a fallback to resend the consent request if the doctor reports they did not receive it.
### Authorization Status: AUTHORIZED_PENDING_VISIT
When you call POST /api/v1/claims/authorize during the pre-visit phase, the authorization is created in AUTHORIZED_PENDING_VISIT status. This is correct and expected - it means the patient has consented but no claim exists yet.
Once the preauth is approved (FINALISED), the authorization transitions to AUTHORIZED status, signaling that a claim can now be created for this patient and intervention.
### Same Patient and Intervention on the Day of Visit
The system automatically links the approved preauth to the new claim. For this to work, use the same patient_id and the same intervention_code that were used during the pre-visit phase.
## See Also
- Elective Preauth Guide - Detailed elective preauth walkthrough
- Understanding Preauth Statuses
- Start Visit Consent Process
- Billing Process Overview
- Inpatient Claim Dispatch
Last modified on September 28, 2026
