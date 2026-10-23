# Preauths Process Guide: Normal Preauths Workflow
## 1. Overview: Submitting a Standard Pre-Authorisation Request
This guide details the Normal Preauths Workflow, a core component of the broader Preauths Process. This workflow is designed to facilitate the submission of a standard, general pre-authorisation request for a single intervention or a set of related interventions that require prior approval from the Social Health Authority (SHA).
This workflow ensures that healthcare providers can formally request and obtain SHA's approval for planned services, which is essential for ensuring financial coverage and compliance.
### 1.1. What This Workflow Does
The Normal Preauths Workflow's primary function is to submit a valid general pre-authorisation request to SHA. This is done by:
Receiving Authorisation and Intervention Details: It takes a consent_token (for the patient's active visit) and the intervention_code for the specific service requiring pre-authorisation.
Gathering Clinical and Supporting Data: It collects essential clinical information, such as diagnoses, items related to the service, and attachments (if necessary), to support the medical justification for preauthorization.
Including Doctor Information: Doctor details are required in the doctors array payload for medical accountability and audit purposes. Whether those doctors are also asked to approve the request depends on the intervention, not on the preauth type: check needsDoctorAuthorization on Intervention Coverage. When it is true, creating the preauth sends the consent request to those doctors automatically and the preauth waits for their response. When it is false, no request is sent and the preauth proceeds directly to SHA review.
Validating Request Compliance: It performs a series of checks to ensure the request meets SHA's standards, including minimum data requirements and financial thresholds based on the patient's scheme (UHC, PMF).
Submitting the Preauth: Upon successful validation, the system submits the comprehensive pre-authorisation request to SHA for review.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
This workflow is vital because it is the standard mechanism for obtaining SHA's approval for a wide range of planned healthcare services. It helps in:
Ensuring Financial Coverage: It's the primary way to secure prior approval from SHA, providing financial assurance for both the patient and the healthcare facility before high-cost or specialised services are rendered.
Preventing Claim Rejections: By obtaining pre-authorisation upfront, facilities reduce the risk of claims being rejected by SHA due to a lack of prior approval, protecting their revenue.
Promoting Medical Necessity: The requirement for detailed clinical information and the doctor's consent ensures that the proposed interventions are medically justified and appropriate for the patient's condition.
Maintaining Compliance: It enforces adherence to SHA's regulations for pre-authorisation, which is crucial for the facility's operational integrity and auditability.
This workflow ensures that planned healthcare services are both medically appropriate and financially covered, streamlining the care process and protecting stakeholders.
## 2. Workflow Details: Submitting a Normal Preauth
This section details the step-by-step process for submitting a normal pre-authorisation request.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit, the intervention_code that requires pre-authorisation, an array of items related to the preauth, an array of diagnoses, an array of doctors providing consent, and optionally, attachments.
Authorisation and Visit Context Check:
The system uses the provided consent_token to validate that the patient's visit is still in an active state and that the consent is valid.
Preauth Request Validation:
The system performs comprehensive checks on the incoming data and the context of the request:
Minimum Data Requirements: This validation ensures that at least one diagnosis, at least one item, and at least one attachment (if attachments are required) are provided. Which documents are required is a property of the intervention: read requiredPreauthDocumentTypes from Intervention Coverage, and see Adding Attachments.
Doctor's License: It validates that at least one doctor provided has a valid license.
Financial limits:
- Suppose the patient is under a Universal Health Coverage (UHC) scheme. In that case, it checks that the overall bill amount for the preauth is less than the KEPH (Kenya Essential Package for Health) level tariff or the overall tariff.
- If the patient is under a Public Office Medical Fund (PMF) scheme, it checks that the overall bill amount is less than the PMF balance plus any ex-gratia amount.
Doctor Information: It verifies that at least one doctor is provided in the request for medical accountability. Whether a consent notification is then sent to that doctor depends on the intervention's needsDoctorAuthorization flag, not on the preauth being normal or elective.
Intervention Preauth Requirement: It confirms that the intervention_code requires a pre-authorisation according to SHA's rules - the needsPreauth flag on the intervention.
Submit Preauth Request to SHA:
If all validations pass, the system compiles the complete pre-authorisation request payload and submits it to SHA's preauth service.
Receive SHA Response:
The system receives and processes the response from SHA, which indicates the submission status (e.g., success, failure, pending review).
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant submission of a normal pre-authorisation request:
Active Consent/Visit State: The consent_token must be valid and correspond to an active patient visit. This ensures the preauth request is tied to an ongoing, authorised patient encounter.
At Least One Diagnosis: The request must include at least one diagnosis. This provides the medical justification for the requested interventions, an important requirement during review.
At Least One Bill Item: The request must include at least one item (bill item). This defines the specific services being requested for authorisation, necessary for financial assessment.
At Least One Attachment (if required): If the preauth type or intervention requires supporting documents, at least one attachment must be provided. This provides essential clinical evidence or justification for review.
Valid Doctor's License: At least one doctor listed in the request must have a valid license. This ensures that the requesting medical professional is duly qualified and authorised.
Financial Limits Compliance (UHC/PMF): For UHC patients, the overall bill amount must be below the defined KEPH level or overall tariff. For PMF patients, the overall bill amount must be within their PMF balance plus any ex-gratia allowance. These checks ensure the requested preauth aligns with the financial limits and policies of the patient's specific health scheme, preventing automatic rejections.
Doctor Information Provided: At least one doctor must be included in the request for medical accountability. Whether that doctor is asked to approve the request is decided by the intervention's needsDoctorAuthorization flag - see Preauth Doctor Consent.
Intervention Requires Preauth: The intervention_code for which pre-authorisation is sought must require pre-authorisation according to SHA's rules (needsPreauth). This prevents unnecessary preauth submissions for services that don't require them, streamlining the process.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Required (Input) | Purpose
 | consent_token | The consent token for the patient visit. | Yes | Authorises the preauth request for the correct patient and active visit.
 | intervention_code | The unique identifier for the intervention you want to do a preauth request. Only select an intervention whose needsPreauth flag is true on the intervention coverage response. | Yes | Specifies the particular service for which pre-authorisation is being sought.
 | items | An array of items (billable components or sub-services) included in the preauth request. | Yes | Details the specific components of the service being requested for authorisation, crucial for financial assessment.
 | diagnoses | An array of diagnoses relevant to the preauth request. | Yes | Provides the medical justification for the requested intervention, a fundamental requirement for SHA's review.
 | doctors | An array of attending doctors/clinical officers for the preauth. Where the intervention's needsDoctorAuthorization is true, these are the doctors the consent request is sent to. | Yes | Captures the medical professional(s) providing consent and oversight for the requested service.
 | attachments | An array of attachments (e.g., medical reports, lab results) supporting the request. Read the required set from the intervention's requiredPreauthDocumentTypes. | No | Provides supplementary clinical evidence or justification for SHA's review.
### 2.4. Expected Outcomes
Success: Preauth Request Submitted:
All inputs were valid, the visit was active, and the preauth request successfully passed all internal validations and was submitted to SHA. A preauth_id is returned. Here, the pre-authorisation request is now with SHA for review. The facility will await SHA's decision (approval, rejection, or request for more information). The preauth_id can be used to track its status.
Failure: Invalid Consent/Visit State:
The consent_token was invalid, expired, or the visit it references is no longer active. The preauth request cannot be submitted. The user must ensure they are using a valid token for an active visit.
Failure: Missing/Invalid Required Data:
One or more mandatory fields (diagnosis, items, intervention_code, doctors) were missing or invalid, or attachments were required but not provided. The preauth request cannot be submitted. The user needs to provide all required and valid information.
Failure: Financial Threshold Exceeded:
The overall bill amount for the preauth exceeded the permissible limits for the patient's UHC or PMF scheme. The preauth request cannot be submitted as is. The user may need to adjust the request or explore alternative funding options.
Failure: Doctor Information Missing/Invalid:
One or more doctors listed in the request were missing or invalid. The preauth request cannot be submitted. Ensure at least one valid doctor is included in the doctors array.
Failure: Intervention Does Not Require Preauth:
The intervention_code specified does not require a pre-authorisation according to SHA's rules. The preauth request cannot be submitted. This service can likely be provided without prior authorisation.
## 3. Related Resources
- Intervention Coverage - needsPreauth, needsManualPreauthApproval, needsDoctorAuthorization and requiredPreauthDocumentTypes.
- Adding Attachments - reading the required documents off the intervention.
- Preauth Doctor Consent - what happens when the intervention needs doctor authorization.
- Elective Preauthorizations - the path to use when needsManualPreauthApproval is true.
- Preauths Process Overview - choosing between the preauth paths.
- Special Benefit Rules - the day, session and global-period rules that decide whether an approved service is payable.
## 4. Related Scenarios
- Scenario 2: SHIF IP FFS Normal Preauth
- Scenario 5: SHIF OP FFS Normal Preauth
Last modified on September 28, 2026
