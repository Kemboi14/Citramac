# Preauths Process Guide: Elective Preauthorization Workflow
## 1. Overview: Obtaining Prior Approval for Planned Procedures
This guide covers the Elective Preauthorization Workflow - a process for submitting pre-authorisation requests for elective (planned, non-urgent) procedures that require SHA approval before the patient's actual visit day.
Unlike standard preauths submitted on the day of a visit, elective preauths are initiated in advance. This means patient consent and authorization are obtained during a pre-visit phase, and the resulting authorization object carries the consent_token used when creating the preauth via POST /api/v1/preauths.
Related scenarios:
- Scenario 3: SHIF IP FFS Elective Preauth
- Scenario 4: SHIF OP FFS Elective Preauth
API references:
- Preauths API Reference
- Authorize API Reference
### 1.1. What This Workflow Does
Receiving Pre-Visit Authorization and Service Details: It takes a consent_token obtained from a pre-visit authorization object (created before any visit or claim exists) and the intervention_code for the specific elective service requiring pre-authorisation.
Gathering Comprehensive Clinical Data: It collects detailed medical information such as specific diagnoses, associated items (billable components), and mandatory attachments (e.g., medical reports, lab results) to provide strong medical justification.
Validating Request Compliance: It performs stringent checks to ensure the request meets SHA's criteria for elective procedures, including intervention type, facility authorisation, patient scheme, age ranges, and confirming the procedure is not emergency or urgent.
Submitting the Preauth: Upon successful validation, the system submits the elective pre-authorisation request to SHA for review.
### 1.2. Why This Workflow Is Critical
Guaranteed Financial Coverage: Secures prior approval for planned, often high-cost procedures, giving patients and facilities financial certainty before the service is rendered.
Optimised Planning and Scheduling: With pre-authorisation confirmed upfront, facilities can schedule resources and patients can prepare without uncertainty regarding payment.
Ensuring Medical Appropriateness: The requirement for detailed clinical information ensures elective procedures are medically justified and align with SHA's guidelines.
Preventing Claim Denials: Fulfilling the pre-authorisation requirement significantly reduces the risk of claims being rejected by SHA.
Maintaining Regulatory Compliance: Enforces adherence to SHA's specific regulations for elective procedures, which is critical for operational integrity and auditability.
## 2. Identifying Elective Interventions
Not all interventions require elective preauth. Before initiating this workflow, check whether the specific intervention the patient needs falls into this category.
When you call GET /api/v1/patients/benefits/interventions to look up an intervention, the response includes a flag:
Code 
{
  "code": "...",
  "name": "...",
  "comment": "...",
  "needsManualPreauthApproval": true
}
If needsManualPreauthApproval is true, the intervention requires elective preauthorization - meaning SHA must approve the procedure before the patient's visit takes place. These are planned, non-urgent procedures such as scheduled surgeries, specialist referrals, or procedures requiring pre-approval due to cost or clinical complexity.
If needsManualPreauthApproval is false or absent, the intervention follows the standard same-day preauth flow instead. Use the Normal Preauths Workflow for those cases.
## 3. Pre-Visit Consent: OTP vs Biometrics
Because elective preauths happen before the patient's actual visit, patient consent must be obtained in a pre-visit phase. This creates an authorization object in status AUTHORIZED_PENDING_VISIT, whose token becomes the consent_token for the preauth request.
The consent can be collected via OTP or biometrics.
### 3.1. OTP Flow (Pre-Visit)
Get patient contacts: Call GET /api/v1/patients/contacts. The response returns a list of contacts with masked values and an id for each entry.
Confirm contact with patient: Present the masked contacts and confirm which one the patient wants to use for OTP delivery. Note the id of the selected contact.
Send OTP: Call POST /api/v1/claims/otp, optionally passing beneficiary_contact_id (the id from step 2). If omitted, the system uses the patient's default contact.
Authorize (pre-visit): Call POST /api/v1/claims/authorize with the OTP and relevant fields. The system creates an authorization object in status AUTHORIZED_PENDING_VISIT.
Create preauth: Use the token from the authorization object as the consent_token when creating the preauth via POST /api/v1/preauths. Include all required clinical data.
Await SHA approval: The preauth is submitted for SHA review. Once SHA approves, the authorization transitions to AUTHORIZED.
On the day of the visit: Call POST /api/v1/claims/otp again to generate a fresh OTP, then call POST /api/v1/claims/visit using that OTP. No new /authorize call is needed. The system validates: same patient + same intervention + existing AUTHORIZED authorization + approved preauth, then creates the claim successfully.
The OTP sent on the day of the visit goes directly to POST /api/v1/claims/visit. The authorization created in the pre-visit phase is reused; the system links them automatically.
### 3.2. Biometrics Flow (Pre-Visit)
Authorize (pre-visit): Call POST /api/v1/claims/authorize with biometrics-specific fields (workstation ID, biometrics agent National ID, etc.). The system creates an authorization in PENDING status and returns an iframe link.
Render the iframe: Display the iframe to the patient. The patient matches their fingerprints through the biometrics agent.
On successful fingerprint match: The authorization transitions to AUTHORIZED_PENDING_VISIT.
Create preauth: Use the token from the authorization object as the consent_token when creating the preauth via POST /api/v1/preauths. Include all required clinical data.
Await SHA approval: The preauth is submitted for SHA review. Once SHA approves, the authorization transitions to AUTHORIZED.
On the day of the visit: Call POST /api/v1/claims/visit using the auth_guid (the GUID of the authorization created in the pre-visit phase). No new consent step is needed. The system validates the existing authorized preauth and creates the claim.
For biometrics, the auth_guid replaces a fresh OTP or token on visit day. Keep the authorization GUID stored against the patient's planned visit record.
## 4. Workflow Details: Submitting an Elective Preauth
### 4.1. Step-by-Step
- Verify the intervention requires elective preauth by checking needsManualPreauthApproval: true on the intervention record.
- Obtain pre-visit consent using OTP or biometrics (see Section 3).
- Collect clinical data: diagnoses, bill items, attachments (medical reports, lab results), and doctors.
- Create a preauth via POST /api/v1/preauths with:
- consent_token from the pre-visit authorization object
- intervention_code
- diagnoses, items, doctors, attachments
- expected_service_start_date (required for all elective preauths)
- Monitor preauth status as it moves through SHA review.
- On visit day, follow the OTP or biometrics visit creation steps.
### 4.2. Key Validations
Valid Pre-Visit Authorization: The consent_token must come from a pre-visit authorization object (status AUTHORIZED_PENDING_VISIT). All preauth requests must be linked to a valid, patient-consented authorization that was created in the pre-visit phase.
At Least One Diagnosis: The request must include at least one diagnosis to provide medical justification for the requested intervention.
At Least One Bill Item: The request must include at least one item (bill item) defining the specific services being requested.
At Least One Attachment (if required): If the intervention requires supporting documents, at least one attachment must be provided. Which documents are required is a property of the intervention: read requiredPreauthDocumentTypes from Intervention Coverage, and see Adding Attachments.
Valid Doctor's License: At least one doctor listed in the request must have a valid license.
Financial Limits Compliance (UHC/PMF): For UHC patients, the overall bill amount must be below the defined KEPH level or overall tariff. For PMF patients, the overall bill amount must be within their PMF balance plus any ex-gratia allowance.
Doctor Information Included: Doctor details must be provided in the doctors array for medical accountability. Where the intervention's needsDoctorAuthorization is true, these are the doctors the consent request is sent to automatically on creation - see Preauth Doctor Consent.
Intervention Requires Preauth: The intervention_code must require pre-authorisation (needsManualPreauthApproval: true) according to SHA's rules.
Expected Service Start Date: Every elective preauth request must include a planned expected start date for the procedure. This is required for scheduling, resource planning, and tracking the preauth validity period.
Not an Emergency or Urgent Case: Elective preauths are for planned procedures only. Requests flagged as emergency or urgent will be rejected.
### 4.3. Expected Outcomes
Success: Elective Preauth Request Submitted
All inputs were valid and the request passed all validations. A preauth_id is returned. Use the preauth_id to track its status through SHA review.
Failure: Invalid Pre-Visit Authorization
The consent_token was invalid, expired, or not from a pre-visit authorization object. Ensure you are using the token from an authorization created in the pre-visit phase with status AUTHORIZED_PENDING_VISIT.
Failure: Missing or Invalid Required Data
One or more mandatory fields (diagnoses, items, doctors, attachments, expected_service_start_date) were missing or invalid. Provide all required information and resubmit.
Failure: Elective Preauth Condition Violation
The request violated one or more rules for elective preauths (e.g., intervention not designated for elective, facility not authorised, patient scheme/age mismatch, or the case is flagged as emergency/urgent). Review the specific violation returned in the error response and correct before resubmitting.
## 5. An approved elective preauth expires in 7 days
Because an elective approval is obtained ahead of the visit, it can sit unused - the patient may not turn up,
or the procedure may be rescheduled. So the approval carries a clock.
### 7 days from approval, then the approval is gone
An approved preauthorization with no visit created against it within 7 days of the payer's response
expires. It is recalled from the payer and can no longer be claimed against.
The window is counted from the payer's response, not from when you created the preauth.
Two consequences to design for:
- Cancel rather than abandon. If the procedure is not going ahead inside the window, call
Cancel Preauthorization. Cancelling is explicit and
immediate; expiry is a background process, and the member's committed balance is held in the meantime.
- An expired approval cannot be reused or extended. If the patient comes in later, raise a fresh
preauthorization and obtain pre-visit consent again.
This is why the visit-day steps in Section 3 matter: creating the
visit against the existing authorization is what marks the approval as utilised.
For a worked example of the rule in a specific package, see
Approved preauths expire in 7 days
on the imaging rules page.
## 6. Related Resources
- Intervention Coverage - needsManualPreauthApproval, needsDoctorAuthorization and the required document types.
- Normal Preauthorizations - the path when needsManualPreauthApproval is false.
- Cancel Preauthorization - releasing an approval that will not be used.
- Preauth Doctor Consent - resending a doctor request that did not arrive.
- Imaging Preauthorization - a specialised elective form.
- Surgical Preauthorization - a specialised form that may be normal or elective.
- Preauths Process Overview - how the preauth paths relate.
- Special Benefit Rules - the day, session and global-period rules that decide whether an approved service is payable.
Last modified on September 28, 2026
