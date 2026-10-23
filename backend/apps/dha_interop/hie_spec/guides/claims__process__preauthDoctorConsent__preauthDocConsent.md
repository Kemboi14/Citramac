# Preauth Doctor Consent Process Overview: Facilitating Doctor Approval for Pre-Authorizations
### This Endpoint is a Resend Fallback - Not a Step in the Preauth Flow
What triggers a doctor consent request is the intervention, not the preauth type. Every intervention
carries a boolean needsDoctorAuthorization on
Intervention Coverage. Check it before you create
the preauthorization.
- needsDoctorAuthorization: true - creating the preauth with POST /api/v1/preauths
automatically sends the consent request to the doctor or doctors named on that preauth, and the preauth
waits in PENDING_DOCTOR_APPROVAL until one of them responds. You do not call
POST /api/v1/claims/doctor-consent as part of this.
- needsDoctorAuthorization: false - no consent request is sent and no approval step is required. The
doctor details still travel on the payload for accountability and medical justification, and the preauth is
submitted straight to the payer.
All surgical interventions require doctor authorization - see
Surgical Rules.
This endpoint exists only as a fallback: if the doctor reports they never received the request and needs
it delivered again, call it to trigger a fresh delivery.
## 1. Introduction: Understanding Preauth Doctor Consent
This guide covers the Doctor Consent process for pre-authorisations - specifically the fallback resend workflow triggered when a doctor needs the consent request to be re-delivered.
The Preauth Doctor Consent process, through the Doctor Consent workflow, is designed to ensure that all pre-authorisation requests submitted to the Social Health Authority (SHA) have the necessary medical approval from the attending doctor. It's about moving from a prepared pre-authorisation request to one that is officially verified by the responsible medical professional.
### 1.1. Why This Full Process Matters
The Preauth Doctor Consent process is fundamental to compliant and medically justified healthcare delivery. It is crucial because it:
- Ensures Medical Accountability: Verifies that a qualified medical professional reviews and approves the planned intervention.
- Validates Medical Necessity: Strengthens the medical justification for the pre-authorisation request, increasing the likelihood of SHA approval.
- Maintains Regulatory Compliance: Adheres to requirements that mandate doctors' consent for certain procedures and treatments.
- Prevents Claim Denials: Reduces the risk of pre-auth requests being denied due to missing or unverified medical consent.
### 1.2. Doctor Approval Status Flow
When a preauth for an intervention with needsDoctorAuthorization: true is created, it progresses through the
following statuses:
 | Status | Description
 | PENDING_DOCTOR_APPROVAL | The preauth has been created and a consent request has been sent to the doctor. Awaiting the doctor's response.
 | ACTIVE | The doctor has approved the consent request. The preauth is submitted to the payer (SHA) for review.
 | FINALISED | SHA has reviewed and approved the preauth. The service can proceed with financial coverage.
### 1.3. How the request reaches the doctor
The consent request is delivered as:
- a two-way SMS the doctor can reply to,
- a request in the Practice360 app, or
- an email.
The doctor's response is received and processed automatically, and the preauth status is updated from it.
## 2. The Full Preauth Doctor Consent Journey: Step-by-Step Doctor Approval
The complete Preauth Doctor Consent process is centred around the Doctor Consent workflow. This ensures medical approval is secured before a pre-authorisation can proceed.
### 2.1. Step 1: Doctor Consent Workflow
This foundational step involves prompting a consent request to be sent to the attending doctor on a preauth, and allowing them to approve or reject it.
This step is vital for ensuring every pre-authorisation request has explicit medical backing. Without the doctor’s consent, the preauth is incomplete and cannot be submitted to SHA.
## 3. Workflow Details: Doctor Consent
### 3.1. Workflow Description: Step-by-Step System Behavior
When a preauth request requires doctor consent, here’s what happens:
Consent Prompt Initiation
A request is triggered to send a consent prompt to the attending doctor.
Doctor and Facility Validation
- Verify that the doctor exists in the health worker registry.
- Check the facility’s registration and ability to transact.
- Confirm the doctor has a valid KMPDC license.
Consent Request Delivery
The system sends an SMS (and optionally email) to the doctor with preauth details and a consent prompt.
Doctor Response Reception
The doctor responds via SMS (typically with a code) indicating approval or rejection.
Preauth Status Update
Based on the response, the system updates the pre-authorisation request accordingly.
### 3.2. Key Validations: Our System's Essential Checks
Valid Doctor License (KMPDC)
Only doctors with a valid license can consent.
Doctor Existence in Registry
The doctor must exist and be verifiable in the national health worker registry.
Valid Facility
The facility must be registered and authorized to transact.
Consent Request Delivery
The system must successfully send the SMS/email request to the doctor.
Consent Response Handling
The system must be able to receive and process the doctor's response (typically SMS).
### 3.3. Expected Outcomes from this Workflow
Success: Doctor Consent Approved
The request is sent and the doctor approves. The preauth now includes medical consent and may proceed.
Success: Doctor Consent Rejected
The request is sent and the doctor rejects it. The preauth cannot continue and must be reviewed or cancelled.
Failure: Invalid Doctor or Facility
The doctor or facility ID is missing, unregistered, or unauthorized. The consent request is blocked until valid details are provided.
### 3.4. Workflow Data Dictionary
This endpoint accepts the resend payload (ResendPreauthDoctorRequest). It carries the details needed to identify the preauth and the doctor, so a fresh consent request can be delivered.
 | Field Name | Info | Options (if applicable) | Is required? | Type
 | consent_token | The consent token for the patient visit. |  | True | string
 | intervention_code | The intervention code the doctor consent request applies to. |  | True | string
 | service_type | The service type for the encounter. | INPATIENT, OUTPATIENT | False | string
 | request_type | The request type. Fixed value PREAUTH_DOCTOR_APPROVAL_REQUEST. | PREAUTH_DOCTOR_APPROVAL_REQUEST | True | string
 | identification_type | The type of ID being used for the doctor. | registration_number, National ID, Alien ID, Refugee ID | True | string
 | identification_number | The doctor's identification number. |  | True | string
 | regulation_body | The doctor's licensing body. | KMPDC, COC, NCK, PPB | True | string
 | practitioner_registration_number | The doctor's practitioner registration number. |  | False | string
## 4. Related Resources
- Intervention Coverage - where needsDoctorAuthorization comes from.
- Surgical Rules - the rule set that makes doctor approval mandatory for every surgical intervention.
- Normal Preauthorizations - creating the preauth that sends the first request.
- Elective Preauthorizations - the pre-visit path.
- Preauths Process Overview - how the preauth paths relate.
- Remove Preauth Doctor - changing who the request goes to.
## 5. Related Scenarios
- Scenario 3: SHIF IP FFS Elective Preauth
- Scenario 4: SHIF OP FFS Elective Preauth
Last modified on September 28, 2026
