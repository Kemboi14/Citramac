# Consent Services Process Guide: Send Discharge OTP Workflow
## 1. Overview: Securing Patient Consent for Discharge
This guide details the Send Discharge OTP workflow, which obtains the patient's explicit consent at the end of an encounter - the point of discharge (inpatient) or visit-end (outpatient). It calls POST /api/v1/claims/otp/discharge to send a One-Time Password (OTP) to the patient's registered contact. The patient then reads back the OTP, which you supply to the inpatient discharge or outpatient submit call to confirm the encounter is ending with the patient's agreement.
### 1.1. What This Workflow Does
The Send Discharge OTP workflow prepares and dispatches a discharge OTP to the patient's registered contact. It handles:
- Receiving the Consent Reference: It takes the consent_token from the authorization already established for the encounter, tying the discharge OTP to the correct consent record.
- Identifying the Patient: Using the patient_id, the system looks up the patient's registered contact.
- Requesting OTP Dispatch: The system generates a discharge OTP and sends it via SMS to the patient's registered contact.
- Providing Status: It communicates whether the discharge OTP was successfully requested and sent.
### 1.2. Why This Workflow Is Critical
Consent at discharge/visit-end confirms the patient agrees the encounter is complete before the claim is finalised. This workflow is critical because it:
- Confirms Patient Agreement at Close: The patient explicitly consents to the visit ending, mirroring the consent captured when the visit began.
- Protects Against Fraud: By requiring an OTP sent to the patient's registered contact, it ensures the discharge/visit-end is genuine and authorised.
- Enables Claim Finalisation: A verified discharge OTP is a prerequisite for the inpatient discharge and outpatient submit calls that finalise the claim.
## 2. Workflow Details: Send Discharge OTP
### 2.1. Step-by-Step System Behavior
Input Reception: The system receives the consent_token for the encounter and the patient's patient_id.
Consent Lookup: Using the consent_token, the system locates the consent/authorization record established for the encounter.
Patient Contact Lookup: Using the patient_id, the system resolves the patient's registered contact for OTP delivery.
Processing & Dispatch of OTP: The system generates a unique discharge OTP and sends it via SMS to the patient's registered contact.
Receive Response: The system returns a response indicating whether the discharge OTP was sent.
Outcome Processing: The patient reads back the OTP, which you supply to the inpatient discharge or outpatient submit call.
### 2.2. Key Validations
Valid Consent Token:
- The consent_token provided must correspond to an existing consent/authorization record for the encounter being closed.
- This ties the discharge OTP to the correct encounter and prevents dispatching an OTP for an unknown or mismatched consent.
Valid Patient Identifier:
- The patient_id must be a valid, existing identifier recognised by the system so the patient's registered contact can be resolved.
Registered Contact Available:
- The patient must have a valid registered contact for the OTP to be delivered. Without it, the discharge OTP cannot be sent.
### 2.3. Workflow Data Dictionary
This table outlines the key information used by this workflow:
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / What it Means (to the Business)
 | consent_token | The consent token from the authorization established for the encounter being closed. | String | Yes | Ties the discharge OTP to the correct consent/authorization record.
 | patient_id | The patient's unique identifier. | String | Yes | Identifies the patient so the system can resolve their registered contact for OTP delivery.
### 2.4. Expected Outcomes
Success: Discharge OTP Dispatched
- The system successfully requested the discharge OTP and it was sent to the patient's registered contact. The patient can now read back the OTP for the discharge/submit call.
Failure: Invalid Consent Token
- The provided consent_token did not match an existing consent record. The discharge OTP was not sent; verify the token used for the encounter.
Failure: No Valid Contact
- The patient record was found, but no valid registered contact is available. The discharge OTP cannot be delivered.
## 3. Critical Success Factors for Integration
- Reuse the Correct Consent Token: Supply the consent_token from the authorization that established the encounter, not a new one.
- Provide a Valid Patient Identifier: Ensure the patient_id is accurate so the OTP reaches the correct patient.
- Design an OTP Input Interface: Prompt the patient to read back the OTP and make it easy to enter into the discharge/submit call, including a re-send option that respects rate limits.
## 4. Related Resources
- Send OTP - send the consent OTP at the start of a visit.
- Inpatient Claim Dispatch - where the discharge OTP is supplied on discharge.
- Outpatient Claim Dispatch - where the OTP is supplied on submit.
- Consent Services API Reference
Last modified on September 28, 2026
