# Integration Scenarios
This section gives you end-to-end API roadmaps for the most common integration paths on the HIE platform. Each scenario maps a real clinical use case to the exact sequence of API calls across all services - from authentication through to claim submission.
Use the decision matrix below to identify which scenario matches the intervention you are integrating, then follow the step-by-step walkthrough for that path.
## General API Flow
In most cases, every integration on a visit flow starts with an eligibility check - verifying whether the patient is eligible for SHA and what services they can receive at the hospital. These can be seen as four prerequisite steps regardless of which scenario follows. They establish the patient's identity, their coverage, and the specific services available to them at your facility.
 | Step | Action | Service | Endpoint | Key Inputs | Key Output
 | 1 | Get Access Token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient Search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - use as patient_id; also returns demographics for HMIS registration
 | 3 | Check SHA Eligibility | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of their various schemes under SHA
 | 4 | Sub-Benefit Coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention Coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | Intervention list with flags (see below)
### Read the Intervention Flags
The response from Step 5 (Intervention Coverage) contains the fields that determine which scenario applies. Check these on every intervention before proceeding:
- paymentMechanism - PER_DIEM or FEE_FOR_SERVICE
- needsPreauth - true or false
- needsManualPreauthApproval - true = elective preauth required
- accessPoint - IP (inpatient), OP (outpatient), or both
- fund - SHIF, UHC, etc.
## Scenario Decision Matrix
 | Scenario | Fund | Access Point | Payment Mechanism | Needs Preauth | Elective Preauth | Claim Dispatch
 | Scenario 1: SHIF IP Per Diem | SHIF | Inpatient | Per Diem | No | N/A | Discharge
 | Scenario 2: SHIF IP FFS Normal Preauth | SHIF | Inpatient | Fee for Service | Yes | No | Discharge
 | Scenario 3: SHIF IP FFS Elective Preauth | SHIF | Inpatient | Fee for Service | Yes | Yes | Discharge
 | Scenario 4: SHIF OP FFS Elective Preauth | SHIF | Outpatient | Fee for Service | Yes | Yes | Submit
 | Scenario 5: SHIF OP FFS Normal Preauth | SHIF | Outpatient | Fee for Service | Yes | No | Submit
 | Scenario 6: UHC OP Capitation | UHC | Outpatient | Capitation | N/A | N/A | Submit
 | Scenario 7: ECCIF Emergency Identified | ECCIF | OP / IP | Fee for Service / Fixed FFS | No (doctor consent) | N/A | Submit (24h)
 | Scenario 8: ECCIF Emergency Unidentified | ECCIF | OP / IP | Fee for Service / Fixed FFS | No (doctor consent) | N/A | Submit (24h)
### Emergency claims follow a separate flow
Scenarios 7 and 8 (ECCIF emergency) are not selected from the intervention-flag decision tree below. Emergency care is initiated directly under the Emergency, Chronic and Critical Illness Fund (ECCIF): the claim can be created before the patient is identified, is billed by approved protocols, uses doctor consent (via OTP) instead of preauth, and must be submitted within 24 hours. Use Scenario 7 when the patient is identified at presentation and Scenario 8 when they are not.
## Consent: OTP vs Biometrics
All scenarios require patient consent to start a visit. The consent flow is the same regardless of scenario - only the authorization method differs. Both methods are documented separately below.
### OTP Flow
 | Step | Action | Service | Endpoint | Notes
 | A | Get patient contacts | Consent | GET /api/v1/patients/contacts | Returns a list of masked contact numbers. Show the patient their masked number(s) and confirm which they want to use. Take the id of that contact.
 | B | Send OTP | Consent | POST /api/v1/claims/otp | Pass the contact_id from Step A to target a specific contact. If omitted, the patient's default contact is used.
 | C | Use OTP in visit creation | eClaims | POST /api/v1/claims/visit | Pass the OTP directly when creating the claim.
For elective scenarios only, the OTP is also used in a pre-visit /authorize call before the day of the actual visit (see Scenarios 3 and 4).
### OTP consent: example contacts response
Code 
{
  "count": 1,
  "results": [
    {
      "id": 675590,
      "contactValue": "+254714***898",
      "contactType": "PHO",
      "isConfirmed": true,
      "active": true
    }
  ]
}
Confirm the masked number with the patient, then use the id as contact_id in the Send OTP call.
### Biometrics Flow
 | Step | Action | Service | Endpoint | Notes
 | A | Create authorization | Consent | POST /api/v1/claims/authorize | Provide biometric-specific fields. Authorization is created in PENDING status. Response includes an iframe link where fingerprint matching is initiated and feedback is shown.
 | B | Patient matches fingerprints | - | (via iframe) | After successful matching, authorization transitions to AUTHORIZED (standard visit) or AUTHORIZED_PENDING_VISIT (elective service).
 | C | Use auth_guid in visit creation | eClaims | POST /api/v1/claims/visit | Pass the auth_guid from the authorization. No second consent step is needed on the day of visit.
### token is your consent identifier
The token field in the POST /api/v1/claims/authorize response is used as the consent_token parameter in all downstream eClaims endpoints. Store it immediately - it is required for every action on the visit.
For biometrics, you also store the guid to reference the authorization by auth_guid in visit and discharge endpoints.
### Biometrics Discharge
Discharge can also be performed via biometrics. The process mirrors the start-visit biometrics flow:
- Hit POST /api/v1/claims/authorize with biometric fields
- Match the patient's fingerprints via the iframe (authorization goes from PENDING to AUTHORIZED)
- Call POST /api/v1/claims/discharge - remove the otp field and replace with auth_guid, providing the GUID of the authorization where fingerprints were matched
## Claim Dispatch Reference
 | Visit Type | Action | Endpoint
 | Outpatient | Submit claim | POST /api/v1/claims/submit
 | Inpatient / Outpatient | Send discharge OTP | POST /api/v1/claims/otp/discharge
 | Inpatient | Discharge patient (submits claim) | POST /api/v1/claims/discharge
 | Any | Discard claim | POST /api/v1/claims/close
Last modified on September 28, 2026
