# Billing Workflows Process Guide: Add Diagnosis Workflow
## 1. Overview: Attaching Diagnoses to Claim Interventions
This guide focuses on the Add Diagnosis workflow, which is a vital stage in the broader Billing Workflows Process. It is key in linking medical reasons (diagnoses) for services provided to the specific interventions on a patient's claim. The main role of this workflow is to accurately add a new ICD-11 diagnosis code and associate it with an existing intervention within a claim.
### 1.1. What This Workflow Does
The Add Diagnosis workflow's primary function is to append a new, valid ICD-11 diagnosis code to a specified intervention that is already part of a patient's claim. It does this by taking the patient's visit consent, the diagnosis code, and the intervention code, then performing validations to ensure the diagnosis is appropriate and compliant for that intervention.
### Claims only
This endpoint targets a claim. It does not add diagnoses to a preauthorization - those are supplied
when the preauth is created, at POST /api/v1/preauths.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Accurately attaching diagnoses to interventions is important for proper medical coding, claim justification, and financial reimbursement. This workflow is important as it brings with it the following benefits:
- Claim Acceptance: Claims are likely to be accepted if the diagnoses justify the interventions performed or are valid for the type of service.
- Improved Auditability: Correct diagnoses make it easy to have audits, and this potentially results in no penalties or repayment obligations.
- Accurate Reporting: Correct diagnosis data improves public health reporting and internal performance analysis.
- Operational Efficiency: This workflow reduces the need for manual correction of diagnosis errors or re-submission of denied claims, leading to increased efficiency.
This workflow is key to ensuring the clinical and financial validity of claims. It ensures that the medical necessity of services is clearly documented, supporting the overall integrity of the Billing Workflows Process.
### Capitation claims allow only one diagnosis
Capitation claims are limited to exactly one diagnosis per claim. All other claim types may carry
multiple diagnoses, with no limit.
### Optional doctor details can be attached here
You may supply the three optional practitioner fields (practitioner_identification_type,
practitioner_identification_number, practitioner_regulation_body) on this call. A standard claim
requires only one doctor, and it can be attached through any one of add line, add diagnosis, or
start visit - not all three. See Adding a Claim Doctor.
## 2. Workflow Details: Add Diagnosis
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to add a new diagnosis to a claim intervention is received, several processes unfold:
- Input Reception: The system first receives the consent_token for the active patient visit, the icd_code representing the diagnosis, and the intervention_code to which the diagnosis should be attached.
- Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Diagnosis and Intervention Specific Validations:
- The system checks if the provided intervention_code has a specific diagnosis block or list of accepted diagnoses.
- It verifies that the icd_code provided is an active diagnosis.
- It confirms that the icd_code adheres to the ICD-11 standard.
- If the intervention_code is associated with a 'capitation' payment model, it checks that the chosen diagnosis has a weight greater than zero.
- Diagnosis Association: If all validations pass, the system proceeds to link the new icd_code to the specified intervention_code within the patient's claim.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate "Add Diagnosis" operation:
Active Visit/Consent Validation:
The consent_token must correspond to a currently open and active visit.
Intervention-Specific Diagnosis Acceptance:
The icd_code must fall within the accepted categories or diagnosis blocks for the given intervention_code.
Diagnosis Activity Status:
The icd_code must be active.
ICD-11 Format Compliance:
The icd_code must follow the ICD-11 standard format.
Capitation Diagnosis Weight Validation:
If under capitation, the diagnosis must have a defined weight greater than zero (>0).
### 2.3. Workflow Data Dictionary (Conceptual): What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the diagnosis addition for the correct patient and visit.
 | icd_code | A valid ICD-11 code. | string | Yes | The specific diagnosis to associate with the intervention.
 | intervention_code | The intervention to attach this diagnosis to. | string | Yes | Identifies the specific service or procedure being justified.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
- Success: Diagnosis Added to Intervention – the icd_code is linked to the intervention_code, and all validations pass.
- Failure: Invalid Visit/Consent – the consent_token is invalid, expired, or the visit is closed.
- Failure: Invalid ICD Code – the icd_code is invalid, not active, or lacks capitation weight.
- Failure: Diagnosis Incompatible with Intervention – the diagnosis is not allowed for the provided intervention_code.
- Failure: Intervention Not Found – the intervention_code is not associated with the patient’s visit.
- Failure: Missing Required Data – a mandatory field (consent_token, icd_code, intervention_code) is missing or malformed.
Last modified on September 28, 2026
