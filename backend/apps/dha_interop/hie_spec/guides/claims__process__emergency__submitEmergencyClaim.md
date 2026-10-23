# Emergency Case Claims Process Guide: Submit an Emergency Case Claim Workflow
## 1. Overview: Sending the Emergency Claim to SHA
This guide focuses on the Submit an Emergency Case Claim workflow, the final step in the Emergency Case Claims Process. Once the claim has been created and the performed protocols billed, this workflow submits it to SHA for reimbursement under ECCIF - whether the patient ended up identified or remains unidentified.
### 1.1. What This Workflow Does
The Submit an Emergency Case Claim workflow submits the completed emergency claim via POST /api/v1/claims/submit, using the claim's consent_token, a discharge_reason, and the provider's invoice_number. When the patient is still unidentified at submission, the request additionally carries a reason_for_unknown_patient.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Submission is the time-sensitive act that puts the claim in front of SHA:
- Triggers Reimbursement: Until the claim is submitted, the facility cannot be paid for the emergency care.
- Locks In the Record: It finalises the documented care, protocols, and amounts for SHA review.
- Meets the SHA Time Bar: Emergency claims must be submitted promptly to remain payable.
### Submit within 24 hours
Per SHA rules, emergency case claims must be submitted within 24 hours. Submitting outside this window risks the claim being rejected and the facility not being reimbursed for the emergency care.
## 2. Workflow Details: Submit an Emergency Case Claim
### 2.1. Workflow Description: Step-by-Step System Behavior
When a submission request comes into the system, here is what unfolds:
- Input Reception: The system receives the consent_token, the discharge_reason, and the invoice_number. For an unidentified patient it also receives reason_for_unknown_patient.
- Claim Validation: The system confirms the consent_token belongs to a complete emergency claim ready for submission.
- Identity Handling: If the patient is identified, the claim is submitted as a known-patient claim. If still unidentified, the reason_for_unknown_patient is recorded with the submission.
- Submission: The claim is submitted to SHA under ECCIF with the recorded discharge_reason.
### 2.2. Key Validations: Our System's Essential Checks
- Valid Claim Token:
- What it means: The consent_token must belong to an emergency claim that is ready to submit.
- Why it's important: Only a complete claim can be submitted.
- Valid Discharge Reason:
- What it means: A discharge_reason must be supplied, and it must be one of RECOVERED, REFERRED, ABSCONDED, or OTHER. This applies to both identified and unidentified submissions.
- Why it's important: It records how the emergency case concluded for the patient.
- Invoice Number Present:
- What it means: A provider invoice_number must be supplied.
- Why it's important: It ties the submission to the provider's internal billing record.
- Reason Required for Unknown Patient:
- What it means: When submitting for a patient who is still unidentified, reason_for_unknown_patient must be provided and must be one of SHA_UNREGISTERED or DECEASED.
- Why it's important: SHA requires justification for reimbursing an unidentified emergency case.
- Doctor Consent Approved:
- What it means: The claim's doctor consent status must be APPROVED before the submission is accepted. This check replaces the visit-end patient authorisation used by ordinary claims.
- Why it's important: In an emergency the patient often cannot consent at the point of care, so the attending doctor's approval is what authorises the claim. See Resend Doctor Consent Request if the request is still pending.
### DECEASED is not an outpatient discharge reason
DECEASED is not accepted for discharge_reason on this endpoint. It is an inpatient discharge reason supplied on POST /claims/discharge, and it is separately a valid value for reason_for_unknown_patient. See the Deceased Patient Workflow.
### No OTP or biometric fields for emergency claims
Emergency submissions skip the visit-end authorisation block entirely, so otp, beneficiary_contact_id, discharge_auth_guid and notes are not read. Do not send them. The gate is doctor consent, described above.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The token returned when the emergency claim was created (the authorization_code). | string | Yes | Identifies the emergency claim being submitted.
 | discharge_reason | How the emergency case concluded. Options: RECOVERED, REFERRED, ABSCONDED, OTHER. | string (enum) | Yes | Records the outcome of the visit for both identified and unidentified patients.
 | invoice_number | The provider's internal invoice number for the claim. | string | Yes | Ties the submission to the provider's billing record.
 | reason_for_unknown_patient | The reason the patient remains unidentified. Options: SHA_UNREGISTERED, DECEASED. | string (enum) | Unidentified only | Justifies submitting an emergency claim for an unidentified patient.
### 2.4. Expected Outcomes from this Workflow
- Success: The emergency claim is submitted to SHA under ECCIF.
- Failure: Invalid claim token - the consent_token is invalid or the claim is not ready to submit.
- Failure: Missing or invalid discharge reason - discharge_reason is absent or not a recognised value.
- Failure: Missing invoice number - no invoice_number was supplied.
- Failure: Missing or invalid reason - an unidentified-patient submission omits reason_for_unknown_patient or uses a value other than SHA_UNREGISTERED or DECEASED.
## 3. Supported Enumerations
 | Field | Accepted Values | Applies To
 | discharge_reason | RECOVERED, REFERRED, ABSCONDED, OTHER | All submissions
 | reason_for_unknown_patient | SHA_UNREGISTERED, DECEASED | Unidentified patient only
DECEASED appears only on reason_for_unknown_patient here. As a discharge reason it belongs to inpatient discharge (POST /claims/discharge), covered in the Deceased Patient Workflow.
## 4. Critical Success Factors for Submit an Emergency Case Claim Integration
- Submit Within 24 Hours: Treat the SHA 24-hour window as a hard deadline.
- Use the Claim's consent_token: Submit against the same token used throughout the case.
- Supply a Reason When Unidentified: Always include reason_for_unknown_patient for a still-unknown patient.
- Identify First Where Possible: Where the patient can be recognised, run Identify an Unknown Emergency Patient before submitting.
## 5. Related Resources
- Emergency Case Claims Process Overview
- Add Emergency Case Protocols
- Identify an Unknown Emergency Patient
- Claims & Preauths API Reference
Last modified on September 28, 2026
