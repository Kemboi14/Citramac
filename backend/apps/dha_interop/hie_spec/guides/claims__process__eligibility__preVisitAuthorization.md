# Eligibility Process Guide: Pre-Visit Authorization Workflow
## Eligibility Process Guide: Pre-Visit Authorization Workflow
### 1. Overview: Authorizing an Elective Case Before the Visit
This guide covers the Pre-Visit Authorization workflow (POST /claims/authorize). For elective (planned, non-urgent) cases, the facility needs an authorization before the patient's visit day - there is no visit or claim yet. This workflow creates that authorization and returns it in AUTHORIZED_PENDING_VISIT status.
The token carried by that authorization object is what you later use to create the elective preauth, which is submitted before any visit exists. In other words, pre-visit authorization is the consent step that unlocks elective preauthorization.
### How this differs from Start Visit consent
The same POST /claims/authorize endpoint is used to obtain patient consent. On a normal same-day visit the resulting authorization is consumed immediately by the Start Visit call. For an elective case, the authorization is created ahead of time and returned as AUTHORIZED_PENDING_VISIT; its token is held and used to create the elective preauth before the patient arrives.
1.1. What This Workflow Does
- Confirms Patient Consent Up Front: Verifies the patient's agreement via OTP or biometrics, just like the visit-day consent step.
- Creates a Pending-Visit Authorization: Produces an authorization in AUTHORIZED_PENDING_VISIT status that represents consent obtained before the visit.
- Issues the Token for the Elective Preauth: The authorization's token is passed as the consent_token when creating the elective preauth.
1.2. Why This Workflow Is Critical
- Enables Planning Ahead: Lets facilities secure authorization and preauthorization for planned procedures before the patient's visit day.
- Preserves Consent Integrity: Ensures elective preauths are still backed by verifiable patient consent (OTP or biometrics).
- Bridges to Elective Preauth: Provides the token that the Elective Preauthorization workflow depends on.
### 2. Workflow Details: Pre-Visit Authorization
2.1. Workflow Description
- Input Reception: The system receives the patient_id, the service_type (INPATIENT or OUTPATIENT), the interventions, and the consent fields - either an otp (OTP path) or biometrics fields (work_station_id, agent_id).
- Consent Verification: It verifies the OTP or the biometrics fingerprint match for the patient.
- Authorization Creation: For an elective case (no visit yet), it creates an authorization in AUTHORIZED_PENDING_VISIT status.
- Outcome Delivery: It returns the authorization object, whose token is used to create the elective preauth.
2.2. Key Validations
- Patient Must Be Identified: A valid patient_id is required.
- Valid Service Type: service_type must be INPATIENT or OUTPATIENT.
- Interventions Required: At least one valid intervention must be supplied.
- Consent Must Be Verified: Either a valid otp (OTP path) or valid biometrics fields (work_station_id, agent_id) must be provided and verified.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | patient_id | The patient's identifier. | String | Yes | Identifies the patient being authorized.
 | service_type | The category of service: INPATIENT or OUTPATIENT. | String | Yes | Classifies the planned encounter.
 | interventions | The planned interventions for the elective case. | Array | Yes | Details the services the authorization covers.
 | otp | The One-Time Password provided by the patient. | String | OTP path | Verifies patient consent on the OTP path.
 | work_station_id | The workstation ID from the Hardware Server. | String | Biometrics path | Identifies the biometrics device/workstation.
 | agent_id | The biometrics agent's National ID. | String | Biometrics path | Identifies the agent facilitating biometrics capture.
2.4. Expected Outcomes
- Authorization Created (AUTHORIZED_PENDING_VISIT): Consent was verified and an authorization was created ahead of the visit. Its token is used to create the elective preauth.
- Consent Verification Failed: The OTP was incorrect/expired or the biometrics match failed. No authorization is created.
- Input Error: A missing or invalid patient_id, service_type, or interventions prevented the request.
### 3. Critical Success Factors for Pre-Visit Authorization Integration
- Choose the Right Consent Path: Supply either otp or the biometrics fields (work_station_id, agent_id), based on the patient/facility. See the Biometrics Integration Guide.
- Hold the Token Securely: Store the authorization token so it can be passed as the consent_token when creating the elective preauth.
- Use With Elective Preauths Only: The AUTHORIZED_PENDING_VISIT flow is specifically for elective cases created before a visit exists. See Elective Preauthorization.
## 4. Related Resources
- Elective Preauthorization
- Biometrics Integration Guide
- Start Visit Workflow
- Eligibility Check Workflow
Last modified on September 28, 2026
