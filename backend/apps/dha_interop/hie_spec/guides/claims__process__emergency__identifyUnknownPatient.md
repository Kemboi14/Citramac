# Emergency Case Claims Process Guide: Identify an Unknown Emergency Patient Workflow
## 1. Overview: Resolving an Unidentified Patient to a Known One
This guide focuses on the Identify an Unknown Emergency Patient workflow. Emergencies often begin before a patient can be identified, so a claim may be created for an unidentified patient. Once the patient is later recognised, this workflow links the claim to their confirmed identity - moving the claim from an unknown patient to a known patient with their details.
### 1.1. What This Workflow Does
This workflow resolves the identity of a patient on an emergency claim that was originally created as unidentified. It re-uses the Create an Emergency Case Claim endpoint (POST /api/v1/claims/emergency) with the unidentified payload, plus three additions:
- beneficiary_cr_id - the now-known patient's Client Registry ID,
- otp - the one-time password sent to the patient for consent, and
- consent_token - the token of the claim that was created for the unknown patient.
The rest of the payload remains the same as when the claim was created as unidentified.
### Same OTP path, no biometrics
Identification uses the normal send-OTP step to send the consent OTP to the patient, exactly as in an identified create. As with the rest of the emergency flow, there is no biometrics and no discharge OTP.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Resolving identity is what allows an unidentified emergency claim to be fully reimbursed:
- Links Care to a Real Member: Reimbursement under ECCIF ultimately needs the care tied to a confirmed patient.
- Preserves the Existing Claim: It updates the same claim (via its consent_token) rather than starting over, so protocols already added are retained.
- Captures Patient Consent: The otp records the now-identified patient's consent.
## 2. Workflow Details: Identify an Unknown Emergency Patient
### 2.1. Workflow Description: Step-by-Step System Behavior
When an identification request comes into the system, here is what unfolds:
- Send OTP to Patient: Using the standard send-OTP step, an OTP is sent to the now-identified patient for consent.
- Input Reception: The system receives the original unidentified payload plus beneficiary_cr_id, otp, and the consent_token of the unknown claim.
- Claim Match: The system locates the existing emergency claim by its consent_token.
- Identity Linking: The system links the claim to the patient identified by beneficiary_cr_id, validating consent against the otp.
- Claim Updated: The same emergency claim now reflects a known patient.
### 2.2. Key Validations: Our System's Essential Checks
- Existing Unknown Claim:
- What it means: The consent_token must belong to an emergency claim originally created as unidentified.
- Why it's important: Identification operates on the existing unknown claim, not a new one.
- Valid Patient Reference:
- What it means: The beneficiary_cr_id must reference a valid patient in the Client Registry.
- Why it's important: The claim is being linked to this confirmed identity.
- Valid Consent OTP:
- What it means: The otp must match the one sent to the patient.
- Why it's important: It captures the now-identified patient's consent.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The token of the claim created for the unknown patient. | string | Yes | Identifies the existing unidentified claim to update.
 | beneficiary_cr_id | The now-known patient's Client Registry ID. | string | Yes | Links the claim to the confirmed patient.
 | otp | The one-time password sent to the patient for consent. | string | Yes | Captures patient consent for the identification.
 | beneficiary_contact_id | The patient contact the OTP was sent to. | string | No | Specifies which contact received the consent OTP.
 | interventions | The intervention codes for the emergency case (unchanged). | array of string | Yes | Carried over from the original unidentified claim.
 | mode_of_arrival | How the patient arrived. Options: AMBULANCE, WALK-IN, OTHER. | string (enum) | Yes | Carried over from the original claim.
 | brought_by | Who brought the patient. Options: RELATIVE, UNKNOWN, SAMARITAN, PARAMEDICS. | string (enum) | Yes | Carried over from the original claim.
 | reference_number | The emergency case reference number. | string | Yes | Carried over from the original claim.
 | identification_number | The attending practitioner's identification number. | string | Yes | Carried over from the original claim.
 | identification_type | The practitioner's identification type. Options: registration_number, National ID, Alien ID, Refugee ID. | string (enum) | Yes | Carried over from the original claim.
 | regulation_body | The practitioner's regulatory body. Options: KMPDC, COC, NCK. | string (enum) | Yes | Carried over from the original claim.
 | notes | Additional notes about the case. | string | No | Carried over from the original claim.
### 2.4. Expected Outcomes from this Workflow
- Success: The emergency claim is linked to the identified patient and moves from unknown to known.
- Failure: Unknown claim not found - the consent_token does not match an existing unidentified emergency claim.
- Failure: Invalid patient reference - the beneficiary_cr_id is not a valid Client Registry patient.
- Failure: Invalid OTP - the otp does not match the one sent to the patient.
## 3. Critical Success Factors for Identify an Unknown Emergency Patient Integration
- Re-use the Unknown Claim's Token: Always include the consent_token of the originally-unidentified claim.
- Keep the Original Payload Intact: Carry over the same fields used at creation, adding only beneficiary_cr_id, otp, and consent_token.
- Send the OTP First: Use the standard send-OTP step to deliver the consent OTP before identifying.
## 4. Related Resources
- Emergency Case Claims Process Overview
- Create an Emergency Case Claim
- Submit an Emergency Case Claim
- Claims & Preauths API Reference
Last modified on September 28, 2026
