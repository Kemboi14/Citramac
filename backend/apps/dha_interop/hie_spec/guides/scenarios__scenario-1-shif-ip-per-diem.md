# Scenario 1: SHIF - Inpatient - Per Diem - No Preauth
A patient is admitted to a ward and the intervention is charged on a per-day tariff. No preauthorization is required. The claim is submitted at discharge.
## Intervention Properties
 | Property | Value
 | Fund | SHIF
 | Access Point | Inpatient (IP)
 | Payment Mechanism | Per Diem
 | Needs Preauth | No (needsPreauth: false)
 | Elective Preauth | N/A
 | Tariff Type | Hospital Level Tariff
How to identify this scenario: After calling GET /api/v1/patients/benefits/interventions, the intervention has paymentMechanism: "PER_DIEM" and needsPreauth: false.
Examples: General Ward Admission (Management of Medical Cases), HDU, ICU transfers.
## Hospital Level Tariff
Per diem interventions use a Hospital Level Tariff. SHA sets specific tariff amounts for each hospital based on their KEPH level as determined by KMPDC. The tariff fields in the intervention response correspond to each level:
 | Field | KEPH Level
 | level2Tariff | Level 2 (lowest)
 | level3Tariff | Level 3
 | level4Tariff | Level 4
 | level5Tariff | Level 5
 | level6Tariff | Level 6 (highest)
Your facility's applicable tariff is determined by its KEPH level. When submitting unit_price in POST /api/v1/claims/lines, use the tariff value for your facility's level. If the submitted amount exceeds the tariff for your level, the request is rolled back.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: General API Flow
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as patient_id; demographics for HMIS registration
 | 3 | SHA eligibility check | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of schemes under SHA
 | 4 | Sub-benefit coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | intervention_code, paymentMechanism, needsPreauth, tariff fields per KEPH level
### Phase 2: Patient Consent
OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6a | Get patient contacts | Consent | GET /api/v1/patients/contacts | patient_id | Masked contact list with id - confirm contact with patient
 | 7a | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, intervention_codes, contact_id (optional) | OTP delivered to patient
 | 8a | Create claim with OTP | eClaims | POST /api/v1/claims/visit | otp, intervention_code, service_type: "INPATIENT" | Claim created
Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6b | Create authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields, service_type: "INPATIENT" | Authorization in PENDING status; guid; iframe link for fingerprint matching
 | 7b | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 8b | Create claim with auth_guid | eClaims | POST /api/v1/claims/visit | auth_guid, intervention_code, service_type: "INPATIENT" | Claim created
### Phase 3: Create Claim
See Phase 2 above - the claim is created as part of the consent step (OTP or auth_guid passed directly into POST /api/v1/claims/visit).
### Phase 4: Add Combined Billing Details
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 10 | Add combined billing details | eClaims | POST /api/v1/claims/lines | consent_token, intervention_code, unit_price (your KEPH level tariff value for validation), diagnoses (ICD-11 array), attachments (files + metadata) | Tariff validation result
### Phase 5: Preview & Dispatch
OTP discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 12 | Send discharge OTP | Consent | POST /api/v1/claims/otp/discharge | consent_token | OTP sent for discharge consent
 | 13 | Discharge patient | eClaims | POST /api/v1/claims/discharge | otp (discharge OTP) | Claim submitted to SHA
Biometrics discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 11 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 12 | Create discharge authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields | Authorization in PENDING status + iframe link
 | 13 | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 14 | Discharge patient | eClaims | POST /api/v1/claims/discharge | auth_guid (from Step 12 authorization) | Claim submitted to SHA
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header for all subsequent requests
 | patient.id (beneficiary CR ID) | Step 2 | patient_id in Steps 3, 4, 5, 6, 7, 8
 | sub_benefit_code | Step 4 | sub_benefit_code in Step 5
 | intervention_code | Step 5 | interventions in Step 8; intervention_code in Steps 9, 10
 | token (OTP path) | n/a - OTP used directly | otp field in POST /api/v1/claims/visit
 | guid (Biometrics path) | Step 6b authorize | auth_guid in POST /api/v1/claims/visit and biometrics discharge
## Important Notes
### Per Diem: Do Not Add a Manual Line Item
For per diem interventions, the system automatically generates the claim line item based on the accrued days and the applicable tariff. You do not need to specify a separate line item when calling POST /api/v1/claims/lines.
Submit diagnoses and attachments only. The unit_price field you send is used purely for tariff validation - it is compared against the intervention's Hospital Level Tariff for your facility's KEPH level. If the submitted amount exceeds the tariff, the entire request is rolled back and an error is returned.
### One Active Per Diem Intervention at a Time
A claim cannot have more than one active per diem intervention at the same time. If the patient needs to transfer between wards (e.g., General Ward → ICU), you must switch the intervention using POST /api/v1/claims/interventions/switch rather than adding a new one alongside the existing active intervention.
See the intervention management guides for details on switching.
### Discharge Submits the Claim
The discharge step (POST /api/v1/claims/discharge) both discharges the patient and simultaneously submits the claim to SHA. There is no separate submit step for inpatient claims.
Before discharging, always run POST /api/v1/claims/preview to verify the claim is complete and correct.
## See Also
- Inpatient Benefit Rules - the overnight-stay requirement, the 180-day household cap, and which packages can be added mid-admission
- Special Benefit Rules - the per-package rules that gate a per-diem claim
- Start Visit Consent Process - Detailed OTP and biometrics authorization walkthrough
- Intervention Coverage - How to read intervention flags
- Billing Process Overview - Combined billing details
- Inpatient Claim Dispatch - Discharge flow details
- Add Intervention - Managing multiple interventions on a visit
- Switch Intervention - Ward transfer / per diem switching rules
Last modified on September 28, 2026
