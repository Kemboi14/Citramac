# Scenario 7: ECCIF - Emergency - Identified Patient
A patient presents at a facility for emergency care and can be identified at the point of care. The claim is created under SHA's Emergency, Chronic and Critical Illness Fund (ECCIF), billed by approved protocols, and submitted within 24 hours. Emergency claims do not use the normal eligibility/preauth gating - care is initiated first and reconciled through the emergency flow.
## Claim Properties
 | Property | Value
 | Fund | ECCIF (Emergency, Chronic and Critical Illness Fund)
 | Access Point | Outpatient (OP) and Inpatient (IP)
 | Payment Mechanism | Fee for Service / Fixed Fee for Service (billed against approved protocol tariffs)
 | Needs Preauth | No (doctor consent is requested instead)
 | Patient Identity | Identified (beneficiary_cr_id + patient OTP)
 | Interventions | Exactly one per emergency claim
 | Consent | OTP only (no biometrics, no discharge OTP)
 | Claim Dispatch | Submit, within 24 hours
How to identify this scenario: Emergency interventions are identifiable by the SHA-01 intervention-code prefix (for example SHA-01-005, Shock states). The patient's identity is confirmed at presentation, so the emergency claim can be created with beneficiary_cr_id and a patient otp.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: Access & Patient Identity
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as beneficiary_cr_id
### Phase 2: Patient Consent (OTP)
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 3 | Get patient contacts | Consent | GET /api/v1/patients/contacts | patient_id | Masked contact list with id - confirm contact with patient
 | 4 | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, contact_id (optional) | OTP sent to patient
### Phase 3: Create the Emergency Claim
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 5 | Create emergency claim | eClaims | POST /api/v1/claims/emergency | interventions (single code), beneficiary_cr_id, otp, mode_of_arrival, brought_by, reference_number, identification_number, identification_type, regulation_body | authorization_code (use as consent_token); a doctor consent request is sent to the practitioner via OTP
### Phase 4: Doctor Consent
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6 | (Doctor approves the consent request received via OTP) | - | - | - | Doctor consent recorded
 | 6b | (Optional) Resend doctor consent | eClaims | POST /api/v1/claims/doctor-consent | practitioner_registration_number, request_type: "EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST", consent_token, intervention_code | Consent request re-sent
### Phase 5: Resolve & Add Protocols
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 7 | Get emergency protocols | eClaims | GET /api/v1/claims/emergency/protocols | intervention_code, active=true | Approved protocols with protocolCode and applicableTariff
 | 8 | Add combined protocol details | eClaims | POST /api/v1/claims/emergency/protocols | consent_token, protocol_code, intervention_code, unit_price, quantity, diagnoses, attachments | Protocol line saved; amount validated against tariff
### Phase 6: Submit (within 24 hours)
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 9 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 10 | Submit emergency claim | eClaims | POST /api/v1/claims/submit | consent_token, discharge_reason, invoice_number | Emergency claim submitted to SHA under ECCIF
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | beneficiary_cr_id | Step 2 | beneficiary_cr_id in Step 5
 | OTP | Patient receives via SMS | otp field in Step 5
 | authorization_code (consent_token) | Step 5 | Steps 6b, 8, 9, 10
 | intervention_code | Chosen for the emergency case | Steps 5, 6b, 7, 8
 | protocolCode + applicableTariff | Step 7 | protocol_code and unit_price in Step 8
## Important Notes
### One Intervention, Submit Within 24 Hours
An emergency claim covers exactly one intervention, and per SHA rules it must be submitted within 24 hours. The discharge_reason (one of RECOVERED, REFERRED, ABSCONDED, OTHER) is required at submission. DECEASED is not accepted here - POST /api/v1/claims/submit takes the four-value outpatient reason set. DECEASED exists only on the inpatient POST /api/v1/claims/discharge.
### OTP Only - No Biometrics, No Discharge OTP
Emergency consent uses OTP only. There is no biometrics path and no inpatient-style discharge OTP in the emergency flow.
### Practitioner Details Trigger Doctor Consent
The attending practitioner details sent at claim creation cause a doctor consent request to be delivered by OTP (request_type: EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST). If the doctor misses it, resend with POST /api/v1/claims/doctor-consent; to change the doctor, remove and re-add via POST / DELETE /api/v1/claims/doctors.
### Protocol-Based Billing
Emergency interventions are billed by protocol, not free-form line items. Always fetch the approved protocols and their applicableTariff first, then bill within the approved amount. Attachments are at the intervention level and must use the intervention's applicableDocumentTypes.
## See Also
- Emergency Case Claims Process Overview
- Create an Emergency Case Claim
- Get Emergency Case Protocols
- Add Emergency Case Protocols
- Submit an Emergency Case Claim
- Scenario 8: ECCIF Emergency Unidentified Patient
Last modified on September 28, 2026
