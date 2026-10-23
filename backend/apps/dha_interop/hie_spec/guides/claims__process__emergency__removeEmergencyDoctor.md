# Emergency Case Claims Process Guide: Remove a Doctor from an Emergency Case Claim Workflow
## 1. Overview: Detaching a Doctor from the Claim
This guide focuses on the Remove a Doctor from an Emergency Case Claim workflow. If a doctor no longer wants to be on the claim - for example, they rejected the case - you can remove them. This is typically followed by adding a new doctor so the claim still has a valid attending doctor.
### 1.1. What This Workflow Does
The Remove a Doctor from an Emergency Case Claim workflow detaches the doctor from an existing emergency claim via DELETE /api/v1/claims/doctors, identified by the claim's consent_token.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Being able to remove a doctor keeps the claim accurate:
- Reflects Reality: A doctor who declined or is no longer involved should not remain on the claim.
- Enables Replacement: Removing the current doctor clears the way to add the correct one.
- Maintains Claim Integrity: The attending doctor on the claim should match who actually consents to the emergency care.
## 2. Workflow Details: Remove a Doctor from an Emergency Case Claim
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to remove a doctor comes into the system, here is what unfolds:
- Input Reception: The system receives the claim's consent_token.
- Claim Validation: The system confirms the consent_token belongs to an active emergency claim.
- Detachment: The doctor is removed from the claim.
### Remove, then add a replacement
After removing a doctor, add a new doctor so the emergency claim retains a valid attending doctor before submission.
### 2.2. Key Validations: Our System's Essential Checks
- Active Claim Token:
- What it means: The consent_token must belong to an open emergency claim.
- Why it's important: Doctor changes can only be made on an active emergency case.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The token returned when the emergency claim was created. | string | Yes | Identifies the emergency claim to remove the doctor from.
### 2.4. Expected Outcomes from this Workflow
- Success: The doctor is removed from the emergency claim (204 No Content).
- Failure: Invalid claim token - the consent_token is invalid or the claim is closed.
## 3. Critical Success Factors for Remove a Doctor Integration
- Add a Replacement: After removing a doctor, attach a valid replacement so the claim can progress.
- Use the Claim's consent_token: Operate against the same token used throughout the case.
## 4. Related Resources
- Emergency Case Claims Process Overview
- Add a Doctor to an Emergency Case Claim
- Resend Doctor Consent
- Claims & Preauths API Reference
Last modified on September 28, 2026
