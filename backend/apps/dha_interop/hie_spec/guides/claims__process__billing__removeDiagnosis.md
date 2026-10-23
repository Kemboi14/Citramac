# Billing Workflows Process Guide: Remove Diagnosis Workflow
## 1. Overview: Detaching Diagnoses from Claim Interventions
This guide focuses on the Remove Diagnosis workflow, which is a vital stage in our broader Billing Workflows Process. It is used in correcting or retracting a previously attached diagnosis code from a patient's claim. This workflow's primary role is to accurately detach an ICD-11 diagnosis code from a specific intervention within a claim.
### 1.1. What This Workflow Does
The Remove Diagnosis workflow's primary function is to remove an existing ICD-11 diagnosis code from a specified intervention that is already part of a patient's claim. It does this by taking the patient's visit context, the diagnosis code, and the intervention code, ensuring that the correct diagnosis-intervention pair is targeted for removal.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
The ability to accurately remove diagnoses is crucial for maintaining the clinical and financial integrity of a patient's claim. Several benefits arise from this:
- Claim Uniformity: Correct diagnoses on a claim align with the services provided, leading to an improved rate of acceptance from payers.
- Auditability: Removing an erroneous diagnosis on a claim leads to accurate records in case of scrutiny during audits, and this accurately represents the patient's condition.
- Accurate Reporting: Correct diagnoses can clarify and align medical data and reporting, impacting public health tracking and internal analysis.
- Patient Record Accuracy: The patient's permanent record is corrected, and this resolves any issues of incorrect information, which positively affects future care decisions.
This workflow is crucial to ensuring the accuracy of clinical coding. It ensures that the diagnoses attached to services are correct and verifiable, supporting the overall integrity of the Billing Workflows Process.
## 2. Workflow Details: Remove Diagnosis
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to remove a diagnosis from a claim intervention is made, here's the internal process that unfolds:
- Input Reception: The system first receives the consent_token for the active patient visit, the icd_code representing the diagnosis to be removed, and the intervention_code from which the diagnosis should be detached.
- Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Diagnosis-Intervention Linkage Validation: The system checks if the specified icd_code is currently linked to the provided intervention_code on the patient's claim.
- Diagnosis Detachment: If the linkage is confirmed and all validations pass, the system proceeds to detach the specified icd_code from the intervention_code within the patient's claim.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate "Remove Diagnosis" operation:
Active Visit/Consent Validation:
The consent_token must correspond to a currently open and active patient visit.
Diagnosis-Intervention Linkage Existence:
The system must confirm that the icd_code is currently linked to the specified intervention_code on the patient’s claim.
Intervention Existence:
The intervention_code must refer to a service that exists on the patient’s claim.
### 2.3. Workflow Data Dictionary: What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the diagnosis removal action for the correct patient and visit.
 | icd_code | A valid ICD-11 code. | string | Yes | The diagnosis code to be detached from the intervention.
 | intervention_code | The intervention to remove this diagnosis from. | string | Yes | Identifies the procedure or service to detach the diagnosis from.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
- Success: Diagnosis Removed from Intervention – the specified diagnosis is detached and all validations pass.
- Failure: Invalid Visit/Consent – the consent_token is invalid, expired, or the visit is closed.
- Failure: Diagnosis-Intervention Linkage Not Found – the specified icd_code is not currently linked to the given intervention_code.
- Failure: Missing Required Data – one or more required fields (consent_token, icd_code, intervention_code) are missing or malformed.
Last modified on September 28, 2026
