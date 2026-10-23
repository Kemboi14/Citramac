# Emergency Case Claims Process Guide: Add a Doctor to an Emergency Case Claim Workflow
## 1. Overview: Attaching an Attending Doctor to the Claim
This guide focuses on the Add a Doctor to an Emergency Case Claim workflow. An attending doctor is captured when the emergency claim is created, but sometimes that doctor rejects the case or no longer wants to be on the claim. In that situation you remove the existing doctor and then add a new one with this workflow.
### 1.1. What This Workflow Does
The Add a Doctor to an Emergency Case Claim workflow attaches an attending doctor to an existing emergency claim via POST /api/v1/claims/doctors. It identifies the doctor by their identification_number, identification_type, and regulation_body, against the claim's consent_token.
### Adding a doctor sends a consent request
As with claim creation, adding a doctor sends a doctor consent request to that doctor via OTP (request_type: EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST). If the doctor does not see it, re-send it with Resend Doctor Consent.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
A valid attending doctor with consent is required for the emergency claim:
- Keeps the Claim Valid: When the original doctor declines, adding a replacement keeps the claim able to progress to submission.
- Records Clinical Responsibility: It captures the medical professional responsible for the emergency care.
- Triggers Consent: Adding the doctor initiates their consent request, a prerequisite for the claim.
## 2. Workflow Details: Add a Doctor to an Emergency Case Claim
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to add a doctor comes into the system, here is what unfolds:
- Input Reception: The system receives the claim's consent_token and the doctor's identification_number, identification_type, and regulation_body.
- Claim Validation: The system confirms the consent_token belongs to an active emergency claim.
- Doctor Validation: The system validates the doctor against the provided identification and regulatory body.
- Attach and Request Consent: The doctor is attached to the claim and a consent request is sent to them via OTP.
### 2.2. Key Validations: Our System's Essential Checks
- Active Claim Token:
- What it means: The consent_token must belong to an open emergency claim.
- Why it's important: Doctors can only be added to an active emergency case.
- Valid Doctor Identification:
- What it means: The identification_number must match the supplied identification_type and regulation_body.
- Why it's important: It ensures the correct, registered practitioner is attached.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The token returned when the emergency claim was created. | string | Yes | Authorises the action against the correct emergency claim.
 | identification_number | The doctor's identification number. | string | Yes | Identifies the doctor being attached.
 | identification_type | The doctor's identification type. Options: registration_number, National ID, Alien ID, Refugee ID. | string (enum) | Yes | Tells the system how to validate the doctor's identification.
 | regulation_body | The doctor's regulatory body. Options: KMPDC, COC, NCK. | string (enum) | Yes | Confirms the doctor is registered with the correct body.
### 2.4. Expected Outcomes from this Workflow
- Success: The doctor is attached to the emergency claim and a consent request is sent to them.
- Failure: Invalid claim token - the consent_token is invalid or the claim is closed.
- Failure: Invalid doctor identification - the identification_number, identification_type, or regulation_body do not validate.
## 3. Critical Success Factors for Add a Doctor Integration
- Remove Before Replacing: If a doctor declined, remove them before adding the replacement.
- Use Accurate Identification: Ensure identification_type and regulation_body match the doctor's real registration.
- Follow Up on Consent: If the doctor does not act on the consent request, resend it.
## 4. Related Resources
- Emergency Case Claims Process Overview
- Remove a Doctor from an Emergency Case Claim
- Resend Doctor Consent
- Claims & Preauths API Reference
Last modified on September 28, 2026
