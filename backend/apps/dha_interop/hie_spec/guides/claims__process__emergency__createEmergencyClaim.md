# Emergency Case Claims Process Guide: Create an Emergency Case Claim Workflow
## 1. Overview: Initiating an Emergency Visit
This guide focuses on the Create an Emergency Case Claim workflow, the foundational first step in the broader Emergency Case Claims Process. Think of it as the action that opens an emergency visit and registers it under SHA's Emergency, Chronic and Critical Illness Fund (ECCIF). This workflow's primary role is to create the claim that anchors all subsequent emergency actions.
### 1.1. What This Workflow Does
The Create an Emergency Case Claim workflow's primary function is to initiate an emergency visit by creating a claim against POST /api/v1/claims/emergency. It records the single intervention being treated, how the patient arrived, who brought them, and the attending practitioner's identification. It supports two scenarios:
- Identified patient: the patient is known at presentation, so the request carries the patient's beneficiary_cr_id and a patient otp for consent.
- Unidentified patient: the patient cannot be identified yet (for example, brought in unconscious), so the request omits beneficiary_cr_id and otp.
In both cases the call returns an authorization_code that is used as the consent_token for every later step of the claim.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Getting the emergency claim created correctly from the start is essential, because everything else hangs off it. Without an accurate creation step:
- Care cannot be recorded under ECCIF: No claim means no reimbursable record of the emergency intervention.
- Subsequent steps have nothing to anchor to: Protocol billing, patient identification, and submission all require the consent_token this step returns.
- The wrong identity path blocks reimbursement: Choosing the identified path without a real beneficiary_cr_id, or never resolving an unidentified patient, can prevent the claim from being paid.
In short, this workflow is the foundation of the emergency case. It ensures every later step is built on a valid, ECCIF-anchored claim.
## 2. Workflow Details: Create an Emergency Case Claim
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to create an emergency claim comes into the system, here is the internal process that unfolds:
- Input Reception: The system receives the emergency details - the interventions being treated, mode_of_arrival, brought_by, reference_number, the attending practitioner's identification_number, identification_type, and regulation_body, and optional notes. For an identified patient it also receives beneficiary_cr_id and otp.
- Identity Path Determination: If beneficiary_cr_id and otp are present, the claim is created for an identified patient. If they are absent, the claim is created for an unidentified patient.
- Practitioner Validation: The system validates the attending practitioner against the provided identification_type and regulation_body.
- Claim Creation Under ECCIF: The system creates the emergency claim, links the intervention(s), and returns an authorization_code (the consent_token) used for all subsequent actions.
### One intervention per emergency claim
An emergency case claim covers exactly one intervention. Although interventions is an array, supply a single intervention code; you cannot bundle multiple interventions onto one emergency claim.
### OTP only - no biometrics or discharge OTP
Emergency consent uses OTP only. There is no biometrics path and no discharge OTP in the emergency flow. For an identified patient, send the OTP to the patient using the standard send-OTP step and include it as otp in this request.
### Practitioner details trigger a doctor consent request
The attending practitioner details sent here cause a doctor consent request to be delivered to that doctor via OTP (with request_type: EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST). If the doctor does not see it, re-send it with Resend Doctor Consent. To change the doctor, use Remove a Doctor then Add a Doctor.
### 2.2. Key Validations: Our System's Essential Checks
- Valid Intervention Codes:
- What it means: Each entry in interventions must be a recognised emergency intervention code.
- Why it's important: The intervention determines which protocols (and approved amounts) can later be billed.
- Valid Practitioner Identification:
- What it means: The identification_number must match the supplied identification_type and regulation_body.
- Why it's important: It records the attending health professional responsible for the emergency care.
- Consistent Identity Path:
- What it means: For an identified patient, both beneficiary_cr_id and a valid otp must be supplied together.
- Why it's important: It ensures patient consent is captured correctly when the patient is known.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | interventions | The intervention code for the emergency case. An emergency claim covers a single intervention, so supply one code in this array. | array of string | Yes | Identifies the emergency service being treated and the protocols billable against it.
 | mode_of_arrival | How the patient arrived at the facility. Options: AMBULANCE, WALK-IN, OTHER. | string (enum) | Yes | Records the arrival mode for the emergency record.
 | brought_by | Who brought the patient to the facility. Options: RELATIVE, UNKNOWN, SAMARITAN, PARAMEDICS. | string (enum) | Yes | Captures the accompanying party, useful for unidentified cases.
 | reference_number | A unique reference number for the emergency case claim. | string | Yes | Ties the claim to the provider's internal emergency case reference.
 | identification_number | The identification number of the attending health professional. | string | Yes | Identifies the practitioner responsible for the emergency care.
 | identification_type | The practitioner's identification type. Options: registration_number, National ID, Alien ID, Refugee ID. | string (enum) | Yes | Tells the system how to validate the practitioner's identification.
 | regulation_body | The practitioner's regulatory body. Options: KMPDC, COC, NCK. | string (enum) | Yes | Confirms the practitioner is registered with the correct body.
 | beneficiary_cr_id | The patient's Client Registry ID. | string | Identified only | Links the claim to a known patient. Omit for an unidentified patient.
 | otp | The one-time password sent to the patient for consent. | string | Identified only | Captures patient consent for a known patient. Omit for an unidentified patient.
 | notes | Additional notes about the emergency case. | string | No | Records any extra context for the case.
### 2.4. Expected Outcomes from this Workflow
- Success: Emergency claim created - the system returns an authorization_code (the consent_token) to use for all subsequent steps.
- Failure: Missing required fields - a required field (for example interventions, mode_of_arrival, reference_number, or the practitioner identification fields) is absent or malformed (400 Bad Request).
- Failure: Tenant context required - the facility context is missing from the request (403 Forbidden).
## 3. Supported Enumerations
 | Field | Accepted Values
 | mode_of_arrival | AMBULANCE, WALK-IN, OTHER
 | brought_by | RELATIVE, UNKNOWN, SAMARITAN, PARAMEDICS
 | identification_type | registration_number, National ID, Alien ID, Refugee ID
 | regulation_body | KMPDC, COC, NCK
## 4. Critical Success Factors for Create an Emergency Case Claim Integration
- Choose the Right Identity Path: Supply beneficiary_cr_id and otp only when the patient is genuinely identified; otherwise create as unidentified and resolve identity later.
- Capture the authorization_code: Store the returned token immediately - it is the consent_token required by every following step.
- Use Valid Intervention Codes: Provide intervention codes that exist for emergency care so protocols can be resolved and billed.
- Provide Accurate Practitioner Details: Ensure identification_type and regulation_body match the practitioner's real registration.
## 5. Related Resources
- Emergency Case Claims Process Overview
- Get Emergency Case Protocols
- Resend Doctor Consent
- Identify an Unknown Emergency Patient
- Claims & Preauths API Reference
Last modified on September 28, 2026
