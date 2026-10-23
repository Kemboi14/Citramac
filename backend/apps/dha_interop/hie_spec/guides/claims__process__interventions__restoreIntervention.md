# Intervention Process Guide: Restore Intervention Workflow
## 1. Overview: Reinstating a Previously Removed Service to a Patient's Visit
The Restore Intervention Workflow, the final step in managing healthcare services during an active patient visit. This workflow allows healthcare providers to reinstate a specific service (intervention) that was previously removed from a patient's visit record. This functionality is crucial for correcting errors or re-including services that become relevant again during the course of care.
At its core, this workflow ensures that the patient's visit record accurately reflects all services provided, even those that were temporarily removed.
### 1.1. What This Workflow Does
The Restore Intervention Workflow's primary function is to reactivate a specific intervention that was previously removed from an existing, active patient visit. It accomplishes this by:
Receiving Authorization and Service Details: It takes a consent_token (which signifies an active, authorized patient visit) and the intervention_code for the specific service to be restored.
Validating Restoration Conditions: It performs a series of crucial checks to ensure the restoration is permissible. These validations include confirming the visit's active state, ensuring the intervention was indeed previously removed, and adhering to complex combination rules (e.g., preventing mixing of surgical/per diem, capitation/non-capitation, and inpatient/outpatient interventions). It also checks for the requirement of a diagnosis and absence of attachments.
Reinstating the Intervention: Upon successful validation, the system reactivates the specified intervention, adding it back to the patient's visit record.
Updating Claim Information: The reinstatement of the intervention is subsequently reflected in the claim associated with that visit, ensuring accurate billing.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
This workflow is absolutely vital because it provides the ability to correct records and adapt to dynamic care scenarios after an intervention has been removed. It is crucial in:
Correcting Errors: It offers a crucial mechanism to reverse mistakes, such as an intervention being inadvertently removed from a patient's visit.
Adapting to Evolving Care: Patient needs or treatment plans might shift, making a previously removed service relevant again. This workflow allows for flexible adjustments to the recorded care.
Ensuring Accurate Claims: By reinstating necessary interventions, it directly contributes to generating precise claims for reimbursement, ensuring all provided services are correctly accounted for.
Maintaining Data Integrity: It helps keep the patient's visit record comprehensive and accurate, reflecting the complete picture of services rendered throughout the encounter.
In short, this workflow ensures the digital record of care remains accurate and adaptable, supporting both clinical precision and compliant financial processes.
## 2. Workflow Details: Restoring an Intervention
This section details the step-by-step process for restoring an intervention to a patient's visit.
### 2.1. Step-by-Step System Behavior
Input Reception: The system receives the consent_token for the patient's active visit and the intervention_code representing the service to be restored.
Authorization and Visit Context Check: The system uses the provided consent_token to validate that the patient's visit and associated consent are still in an active state. This ensures interventions are only managed for ongoing and authorized encounters.
Intervention Restoration Condition Validation: The system performs crucial checks on the intervention_code and its potential impact on the existing visit.
- Surgical/Per Diem Mix: It verifies that if active interventions are surgical, a per diem intervention cannot be restored, and vice versa.
- Capitation Claim Limit: It checks that restoring a capitation intervention will not violate the "one capitation claim, per patient, per day" rule.
- Diagnosis Requirement: It ensures that the intervention being restored has a diagnosis associated with it, as required.
- No Attachments: It verifies that the intervention being restored does not have any attachments.
- Capitation Mix: It confirms that restoring a capitation intervention will not lead to mixing capitation interventions with non-capitation interventions on the same visit.
- Combination Rules: It validates that the combination of the restored intervention with any existing active interventions on the visit is as expected and allowed (e.g., you cannot mix Inpatient (IP) and Outpatient (OP) interventions).
Reactivate Intervention on Visit Record: If all validations pass, the system proceeds to reactivate the specified intervention_code on the patient's visit record, changing its status from removed back to active.
Claim Reflection: The reinstatement of this intervention is automatically reflected in the claim associated with that patient visit, ensuring the claim accurately represents all services provided.
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant restoration of interventions:
Active Consent/Visit State: The visit linked to the consent_token must be in an active state, and the patient's consent must be valid. This prevents interventions from being restored to closed or unauthorized visits.
Intervention Previously Removed: The intervention_code must correspond to an intervention that was previously removed from this specific patient's visit. This ensures you can only restore an intervention that was previously taken off the record.
Surgical/Per Diem Combination Restriction: If active interventions are surgical, a per diem intervention cannot be restored, and vice versa. This enforces specific billing and service delivery categories, preventing incompatible service types from being active concurrently.
One Capitation Claim, Per Patient, Per Day: Restoring a capitation intervention must not violate this rule. This ensures compliance with capitation billing limits and prevents over-claiming for services funded through capitation.
Requires One Diagnosis: The intervention being restored must have a diagnosis associated with it. This helps ensure clinical justification for the service is present upon restoration.
No Attachments: The intervention being restored must not have any attachments.
Capitation Interventions Cannot Mix with Non-Capitation: Restoring a capitation intervention must not lead to a mix with non-capitation interventions on the same visit. This helps maintain distinct billing and funding categories within a single visit, crucial for SHA compliance.
Intervention Combination Rules Adherence (IP/OP Mix): The combination of the restored intervention with any existing active interventions on the visit must be allowed (e.g., you cannot mix Inpatient (IP) and Outpatient (OP) interventions). It ensures data integrity and compliance with billing and service delivery guidelines.
### 2.3. Workflow Data Dictionary
 | Field Name | Description | Required | Purpose
 | consent_token | The authorization token for the patient's active visit | Yes | Authorizes the action to restore an intervention to the correct patient visit.
 | intervention_code | The unique code identifying the specific healthcare service you are trying to restore | Yes | Specifies the particular service to be reactivated on the patient's visit.
### 2.4. Expected Outcomes
Success: Intervention Successfully Restored
All inputs were valid, consent/visit was active, and the intervention successfully passed all restoration conditions and was reactivated on the patient's visit record. The patient's visit record is updated, and the restored service will now be considered for billing. The system can proceed with other visit-related actions.
Failure: Invalid Consent/Visit State
The consent_token was invalid, expired, or the visit it references is no longer active. The intervention cannot be restored. The user must ensure they are using a valid token for an active visit.
Failure: Intervention Cannot Be Restored (Validation Failed)
The intervention could not be restored because it violated one or more of the predefined rules (e.g., mixing surgical/per diem, capitation limits, missing diagnosis, or combination rules). The intervention cannot be restored under the current conditions. The user needs to address the specific reason for the rejection (e.g., adjust other interventions, provide diagnosis).
Last modified on September 28, 2026
