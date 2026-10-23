# Intervention Process Guide: Retire Intervention Workflow
## Intervention Process Guide: Remove Intervention Workflow
### 1. Overview: Removing a Service from a Patient's Visit
This guide expounds on the Remove Intervention Workflow, a key step in managing healthcare services (interventions) during an active patient visit. This workflow allows healthcare providers to remove a specific service that has been previously added to a patient's visit record. This action is important in correcting errors, adapting to changes in care during the visit, and ensuring that only actually delivered services are accounted for in the final claim.
This workflow is about maintaining the accuracy and integrity of a patient's visit record by making precise adjustments to the services listed.
1.1. What This Workflow Does
The Remove Intervention Workflow's main function is to eliminate a specific service from an existing, active patient visit. It accomplishes this by:
Receiving Authorisation and Service Details: It takes a consent_token (which signifies an active, authorised patient visit) and the intervention_code for the specific service to be removed.
Validating Removal Conditions: It performs essential checks to ensure the intervention can be removed. These checks include confirming the visit's active state, and ensuring the intervention does not have associated bill items, diagnoses, or is not a 'per diem' type.
Removing the Intervention: Upon successful validation, the system removes the specified intervention from the patient's visit record.
Updating Claim Information: The removal of the intervention is subsequently reflected in the claim associated with that visit, ensuring accurate billing.
1.2. Why This Workflow Is Critical (The "Why It Matters")
This workflow is vital because it ensures the accuracy and flexibility of patient service records during an ongoing visit. Its criticality stems from:
Correcting Errors: It provides a mechanism to rectify mistakes, such as an intervention being mistakenly added to a patient's visit.
Adapting to Care Changes: During a visit, patient needs or care plans might change. This workflow allows for services that are no longer applicable or were not performed to be removed.
Ensuring Accurate Claims: By removing unnecessary or incorrect interventions, it directly contributes to generating precise claims for reimbursement, preventing over-billing or discrepancies.
Maintaining Data Integrity: It helps keep the patient's visit record clean and accurate, reflecting only the services that were genuinely provided and are relevant.
In short, this workflow ensures that the digital record of care accurately reflects the actual care delivered, enhancing data integrity and supporting precise financial processes.
### 2. Workflow Details: Removing an Intervention
This section details the step-by-step process for removing an intervention from a patient's visit.
2.1. Step-by-Step System Behavior
Input Reception: The system receives the consent_token for the patient's active visit and the intervention_code representing the service to be removed.
Authorisation and Visit Context Check: The system uses the provided consent_token to validate that the patient's visit and associated consent are still in an active state. This ensures interventions are only managed for ongoing and authorised encounters.
Intervention Removal Condition Validation: The system conducts essential checks on the intervention code and its status. It verifies that the intervention being removed has no associated bill items. Additionally, it confirms that there is no linked diagnosis for the intervention. The system also checks that the intervention is not classified as a per diem type. Finally, it validates that the intervention_code is recognised and currently active for the visit.
Remove Intervention from Visit Record: If all validations pass, the system proceeds to remove the specified intervention_code from the patient's visit record.
Claim Reflection: The removal of this intervention is automatically reflected in the claim associated with that patient visit, ensuring the claim accurately represents the services provided.
2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant removal of interventions:
Active Consent/Visit State: The visit linked to the consent_token must be in an active state, and the patient's consent must be valid. Prevents interventions from being removed from closed or unauthorised visits.
Intervention Has No Bill Item: The intervention being removed must not have any associated bill items. Prevents discrepancies where a service might be removed but has already been billed.
Intervention Has No Diagnosis: The intervention being removed must not have a diagnosis linked to it. Ensures clinical consistency, as a diagnosis usually confirms a service was rendered and necessary.
Intervention Is Not Per Diem: The intervention being removed must not be a 'per diem' intervention type. Per diem charges are often fixed daily rates and may have different removal rules.
Intervention Exists and is Active on Visit: The intervention_code must correspond to an intervention that was previously added and is currently active on the patient's visit. You can only remove an intervention that exists and is currently active.
2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Required | Purpose
 | consent_token | The authorisation token for the patient's active visit. | Yes | Authorises the action to remove an intervention from the correct patient visit.
 | intervention_code | The unique code identifies the specific healthcare service you are trying to remove. | Yes | Specifies the particular service to be removed.
2.4. Expected Outcomes
Success: Intervention Successfully Removed: All inputs are valid, consent/visit was active, and the intervention successfully passed all removal conditions and was removed from the patient's visit record. The patient's visit record is updated, and the removed service is no longer considered for billing. The system can now proceed with other visit-related actions or further intervention management.
Failure: Invalid Consent/Visit State: The consent_token was invalid, expired, or the visit it references is no longer active. The intervention cannot be removed. Ensure you are using a valid token for an active visit.
Failure: Intervention Cannot Be Removed (Validation Failed): The intervention could not be removed because it violated one or more of the predefined rules (e.g., it has a bill item, a diagnosis, or is a per diem intervention). The intervention cannot be removed under the current conditions. Needs to address the specific reason for the rejection (e.g., remove associated bill items or diagnoses first, or confirm it's not a per diem type).
Last modified on September 28, 2026
