# Emergency Case Claims Process Guide: Resend Doctor Consent Workflow
## 1. Overview: Re-sending the Doctor Consent Request
This guide focuses on the Resend Doctor Consent workflow for emergency claims. When you provide the attending practitioner's details - at claim creation or when adding a doctor - a doctor consent request is sent to that doctor via SMS with an approval code. If the doctor does not see the request, the provider can re-send it with this workflow.
### 1.1. What This Workflow Does
The Resend Doctor Consent workflow re-initiates a doctor consent request via POST /api/v1/claims/doctor-consent. For emergency claims, the request_type is EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST. It identifies the claim by emergency_claim_id (with its created timestamp) and consent_token, the service by intervention_code, and the doctor by identification_type, identification_number, and regulation_body.
### One endpoint, several request shapes
The same doctor-consent endpoint serves both preauth and emergency-claim flows, each with its own request shape. The emergency shape is selected by the presence of emergency_claim_id (without a service_type), and its request_type must be EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST. Do not send service_type - it selects a different request shape and will stop your request being read as an emergency one.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Doctor consent is a prerequisite for the emergency claim:
- Unblocks the Claim: If the doctor missed the original OTP request, re-sending lets them act on it.
- Avoids Re-work: It re-sends the request without recreating the claim or re-adding the doctor.
- Keeps Care Moving: In time-critical emergencies, a quick resend keeps the claim on track for the 24-hour submission window.
## 2. Workflow Details: Resend Doctor Consent
### 2.1. Workflow Description: Step-by-Step System Behavior
When a resend request comes into the system, here is what unfolds:
- Input Reception: The system receives the emergency_claim_id and its created timestamp, the claim's consent_token, the intervention_code, the request_type, and the doctor's identification details (identification_type, identification_number, regulation_body).
- Authorization Validation: The system confirms the consent_token resolves to an active (authorized or emergency-authorized) authorization owned by the requesting facility, and that the intervention_code exists on it.
- Doctor Resolution: The doctor is looked up in the Health Worker Registry using the identification details, with a check that they can perform the intervention.
- Resend: A fresh doctor consent request is sent to the doctor via SMS, carrying an approval code linked to the emergency_claim_id.
### 2.2. Key Validations: Our System's Essential Checks
- Emergency Shape Selection:
- What it means: The request must carry emergency_claim_id and must NOT carry service_type (that field selects a different request shape). request_type must be EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST.
- Why it's important: Without emergency_claim_id the system cannot classify the request and rejects it with "Kindly provide valid service type, emergency case unique identifier or request type for a valid doctor request."
- Valid Authorization and Intervention:
- What it means: The consent_token must resolve to an active authorization owned by your facility, and the intervention_code must exist on it.
- Why it's important: The request is re-sent for the correct case and service.
- Doctor Resolvable in the Health Worker Registry:
- What it means: The identification_type, identification_number, and regulation_body must match a registered practitioner permitted to perform the intervention.
- Why it's important: The consent request reaches a verified practitioner.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | request_type | The type of consent request. For emergency claims use EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST. | string (enum) | Yes | Declares the request context.
 | emergency_claim_id | The identifier of the emergency claim, as returned when the claim was created. | string | Yes | Selects the emergency shape and links the doctor's approval response back to the claim.
 | created | ISO 8601 timestamp of when the emergency claim was created. | string (date-time) | Yes | Shown to the doctor in the consent request.
 | consent_token | The token returned when the emergency claim was created. | string | Yes | Identifies the claim's authorization.
 | intervention_code | The intervention on the emergency claim. | string | Yes | Identifies the service the consent applies to.
 | identification_type | Type of doctor identifier: registration_number, National ID, Alien ID, or Refugee ID. | string (enum) | Yes | Identifies the doctor in the Health Worker Registry.
 | identification_number | The doctor's identification number, matching the identification type. | string | Yes | Identifies the doctor in the Health Worker Registry.
 | regulation_body | The doctor's regulatory body: KMPDC, COC, NCK, or PPB. | string (enum) | Yes | Identifies the doctor in the Health Worker Registry.
 | practitioner_registration_number | The doctor's registration number. | string | No | Not used to resolve the doctor in the emergency flow - the identification fields above are.
### 2.4. Expected Outcomes from this Workflow
- Success: A fresh doctor consent request is sent to the doctor via SMS.
- Failure: Missing emergency_claim_id - the system cannot classify the request as an emergency resend and rejects it.
- Failure: Invalid authorization or intervention - the consent_token or intervention_code does not match an active emergency claim owned by your facility.
- Failure: Doctor not resolvable - the identification details do not match a practitioner in the Health Worker Registry who can perform the intervention.
## 3. Critical Success Factors for Resend Doctor Consent Integration
- Always Include the Claim Identifier: Send the emergency_claim_id and created returned when the claim was created - without them the request is rejected.
- Use the Emergency Request Type, Without a Service Type: Set request_type to EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST and omit service_type entirely - sending it selects a different request shape.
- Identify the Doctor by Identification Details: Provide identification_type, identification_number, and regulation_body for the doctor already on the claim - practitioner_registration_number alone is not used in the emergency flow.
- Match the Claim: Provide the same consent_token and intervention_code as the claim.
- Mind the 24-Hour Window: Re-send promptly so doctor consent does not delay submission.
## 4. Related Resources
- Emergency Case Claims Process Overview
- Create an Emergency Case Claim
- Add a Doctor to an Emergency Case Claim
- Claims & Preauths API Reference
Last modified on September 28, 2026
