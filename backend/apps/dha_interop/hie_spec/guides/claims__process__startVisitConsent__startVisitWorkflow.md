# Start Visit Process Guide: Start Visit Workflow
## Start Visit Process Guide: Start Visit Workflow
### 1. Overview: Initiating the Patient Visit and Confirming Consent
This guide details the Start Visit Workflow, the final and crucial step in the overall Start Visit Process. This integrated workflow is responsible for two primary actions: securely verifying patient consent using an OTP, and then officially initiating the patient's visit within a healthcare facility.
It brings together all prior validations, checks and the patient's explicit authorisation to formally record the start of a patient encounter.
1.1. What This Workflow Does
The Start Visit Workflow completes the patient journey by confirming consent and registering the visit. It involves:
- Receiving All Visit-Related Inputs: It takes patient identifiers, the One-Time Password (OTP) provided by the patient or beneficiary, the type of service being offered, and the planned interventions.
- OTP Verification: It validates the patient's OTP by linking it to the previously initiated consent request.
- Confirming Patient Consent & Authorisation: Upon successful OTP verification, the system confirms the patient's authorisation and provides a unique token. This token is critical for all subsequent actions related to this visit.
- Formal Visit Initiation: Using the confirmed consent and all gathered visit details, the system officially records the patient's visit, creating a formal claim. This typically involves updating internal records and possibly interacting with SHA's visit-related services.
- Providing Final Status: It communicates whether the visit was successfully started and provides the token for future use.
1.2. Why This Workflow Is Critical
This workflow is vital because it is the point of formal patient encounter registration and final consent confirmation. Its criticality stems from:
- Official Visit Claim: It creates the official claim for the patient's visit in the system, enabling subsequent billing, clinical documentation, and data exchange.
- Legal & Ethical Compliance: By integrating OTP verification, it ensures that the visit is initiated only with the patient's explicit and verifiable consent, adhering to data privacy regulations and ethical healthcare practices.
- Enabling Subsequent Actions: The token generated upon successful creation of a visit is the key to unlocking actions requiring some authorisation, such as submitting claims. Without this token, critical follow-up processes for the visit cannot proceed.
- Completing the Patient Journey: It marks the successful conclusion of the "Start Visit Process," transitioning the patient to an active encounter.
This workflow formalises the healthcare encounter with explicit consent and provides the necessary authorisation for comprehensive care delivery while meeting compliance with SHA.
## 2. Workflow Details: Start Visit Process
This section details the complete process for initiating a patient's visit, including the integrated OTP verification.
### 2.1. Step-by-Step System Behavior
The visit can be initiated via one of two consent paths - OTP or Biometrics. Both paths lead to a formally registered visit claim. Use the eligibility response flags (whitelistedForOTP and facilityBiometricsEnforced) to decide which path applies.
OTP Path
See Send OTP for how the OTP is generated and delivered.
- Input Reception
The system receives all necessary inputs to start a visit, including the service type, beneficiary CR ID, the one-time password (OTP) provided by the patient, an optional beneficiary contact ID, and an array of interventions.
### Beneficiary contact is optional and OTP-only
Supplying a specific beneficiary contact is optional. If you do not supply one, the beneficiary's default contact is used for the OTP. This applies only to the OTP path - see Get Beneficiary Valid Contact.
Internal Data Lookup & Consent Reference Retrieval
Using the beneficiary CR ID, the system retrieves the patient's details. It also identifies and retrieves the unique consent request ID that was generated when the OTP was initially sent. This consent request ID is essential for validating the OTP.
OTP Verification
The system validates the OTP using the consent request ID and the OTP entered by the patient. It checks whether the OTP matches the one sent for that specific request and verifies that it is still valid (i.e., not expired or already used).
Confirm Consent & Obtain Authorisation Token
Upon successful validation of the OTP, the patient's consent is confirmed, and an authorisation token is provided along with its expiration details. This authorisation token serves as proof of the patient's active consent for this visit and related interactions. If OTP verification fails at this point due to an incorrect OTP or an expired OTP, the workflow stops, and the failure is reported.
Formal Visit Initiation
After successful OTP verification and receipt of the authorisation token, the system proceeds to formally initiate the visit. It compiles all visit details: beneficiary CR ID, service type, interventions, and the newly acquired authorisation token. The system then creates the official visit claim, linking it to the patient and the services to be rendered.
Biometrics Path
For the full device setup and end-to-end flow, see the Biometrics Integration Guide.
- Call the Authorize Endpoint
Before starting the visit, call POST /api/v1/claims/authorize with biometrics-specific fields:
- workstationID: obtained from your Hardware Server /status endpoint (e.g. https://localhost:18065/status)
- Biometrics agent National ID and other required authorization fields
See the Authorize (Biometrics/OTP) API Reference for the full request schema.
Receive PENDING Authorization
The system creates an authorization record in PENDING status. The response includes an iframe link to the fingerprint capture UI.
Render the Iframe in Your UI
Display the iframe to the patient-facing screen. The iframe shows the patient's enrolled fingerprints and a Start button. The patient places their finger on the connected biometrics device.
Fingerprint Capture and Match
The device captures and matches the fingerprint against the enrolled template. On a successful match, the authorization record transitions automatically from PENDING to AUTHORIZED.
### No usable fingerprints
If eCitizen has no usable fingerprints for an adult patient, the authorization moves to REJECTED with authorizationReason set to BIOMETRICS_NOT_FOUND_OTP_ALLOWED. The patient may then start the visit on the OTP path above. See OTP Fallback When No Usable Fingerprints Are Found.
- Formal Visit Initiation with auth_guid
Call POST /api/v1/claims/visit and include auth_guid (the GUID of the now-AUTHORIZED authorization) instead of the otp field. The system validates the authorization status and creates the official visit claim.
See the Create Claim / Start Visit API Reference for the full request schema.
### 2.2. Key Validations
These are essential checks performed throughout this workflow to ensure a successful and compliant visit initiation:
Valid Patient Identification (beneficiary_cr_id): The provided beneficiary_cr_id must be a legitimate, active identifier in the Client Registry. This identifier is crucial, as it serves as the core identifier for the patient and is necessary for all subsequent data lookups and SHA interactions.
Valid Service Type: The service_type must be one of the predefined acceptable types: INPATIENT, OUTPATIENT, CAPITATION, or EMERGENCY. This classification ensures that the visit is categorised accurately and that the correct rules apply.
Valid and Current OTP: The one-time password (OTP) provided by the patient must be accurate, correspond to an active consent_request_id, and not be expired. This step is vital as it serves as direct proof of patient consent and is a fundamental security requirement.
Valid Interventions: The interventions array must contain valid and recognised intervention codes that are applicable to the service_type. This ensures that the requested services are correctly documented and can be tracked and billed appropriately.
Successful OTP Verification by SHA: SHA's validation service must confirm that the OTP is correct and issue an authorisation token. Without this step, patient consent is not officially confirmed, and the visit cannot be formally initiated with SHA.
Successful Visit Creation/Registration: The system must successfully create the visitʼs claim and/or confirm its registration with SHA. This step is the ultimate goal of the workflow, marking the official commencement of the patientʼs encounter.
### 2.3. Workflow Data Dictionary (Conceptual)
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Options | Required | Purpose
 | service_type | The category of service being offered for the visit. | INPATIENT, OUTPATIENT, CAPITATION, EMERGENCY | Yes | Defines the type of patient encounter, impacting facility operations, billing, and clinical pathways.
 | beneficiary_cr_id | The patient's unique Client Registry ID. |  | Yes | The core identifier links the visit to the specific patient. Used to retrieve necessary details and manage consent.
 | otp | The numerical One-Time Password provided by the patient. |  | Required for OTP path | Patient's explicit verification of consent. It must match the OTP sent earlier for the current consent request. Not used when auth_guid is provided.
 | auth_guid | The GUID of an AUTHORIZED biometrics authorization. |  | Required for biometrics path | Used instead of otp when the patient has consented via fingerprint biometrics. The referenced authorization must be in AUTHORIZED status.
 | beneficiary_contact_id | An optional identifier for a specific patient contact (OTP path only). If omitted, the beneficiary's default contact is used. |  | No | Targets a specific contact for the OTP; not used on the biometrics path.
 | interventions | An array of codes representing the chosen services or procedures to be performed during this visit. |  | Yes | Details the specific medical/healthcare actions for which the visit is being initiated, essential for planning, resource allocation, and clinical documentation.
### The authorization_code IS the consent_token
The authorization_code returned in the Start Visit response is the consent_token used by subsequent API calls (for example when adding diagnoses, line items, or creating a preauth). Store it securely and reuse it.
### Attaching the doctor (optional here)
The treating practitioner may optionally be attached at start visit. Only one doctor is required on the claim, and that doctor can be added via any one of start visit, add diagnosis, or add line item - you do not need to add it at start visit if it is added later. See Adding a Claim Doctor.
### 2.6. Expected Outcomes
The outcomes for the Start Visit Workflow reflect the final status of the visit initiation process.
Success: Visit Initiated & Consent Granted:
- All inputs were valid, the OTP was successfully verified by SHA (or the biometrics authorization was AUTHORIZED), and the patient's visit was formally recorded. A valid token is issued. With this, the patient's visit has officially begun. The token should be securely stored and used for all subsequent authenticated interactions with SHA related to this visit.
Failure: Invalid Input Data:
- One or more of the initial inputs (beneficiary_cr_id, service_type, interventions, or beneficiary_contact_id) were invalid, missing, or malformed. The visit cannot be initiated. The system should log the specific input error, and the user interface should prompt staff to correct the invalid data.
Failure: OTP Verification Failed:
- The OTP provided by the patient was incorrect, or the OTP/consent request had expired before verification could be completed. In this case, patient consent could not be verified. The visit cannot proceed. The user might need to re-enter the OTP or, if expired, start a new consent process from the "Send OTP" phase.
## 3. Critical Success Factors for Start Visit Integration
For your integration with the Start Visit Workflow to be successful and reliable, keep these key points firmly in mind:
- Accurate Data Flow from Preceding Workflows: Ensure that validated patient identifiers (beneficiary_cr_id, beneficiary_contact_id) and the consent_request_id are correctly carried forward and available as inputs to this workflow.
- OTP Handling: Implement a user-friendly mechanism for patients to input the OTP. Ensure proper error handling for incorrect or expired OTPs.
- Secure Authorisation Token Management: Upon successful visit initiation, securely store the token and its expiry details. This token is crucial for all subsequent authorised interactions with SHA.
- Comprehensive Input Validation: Validate all incoming parameters (service_type, beneficiary_cr_id, otp, interventions) thoroughly before attempting to process the visit. This minimises errors and ensures data integrity.
- Clear Error Messaging & Recovery: Be prepared to handle all documented failure scenarios from both the OTP verification.
Last modified on September 28, 2026
