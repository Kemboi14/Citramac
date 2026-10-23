# Intervention Process Guide: Add New Intervention Workflow
## Intervention Process Guide: Add New Intervention Workflow
### 1. Overview: Adding a New Service to a Patient's Visit
This guide details the Add New Intervention Workflow, which is the foundational step in managing the specific healthcare services (interventions) provided to a patient during an active visit. This workflow allows healthcare providers to officially record a new service that has been rendered or is planned for a patient covered under the Social Health Authority (SHA).
It is all about ensuring that all services delivered are accurately captured against a patient's visit, which is crucial for maintaining precise patient records and for claims processing.
1.1. What This Workflow Does
The Add New Intervention Workflow's main function is to record a specific new service to an existing, active patient visit. It accomplishes this by:
- Receiving Authorization and Service Details: It takes a consent_token (which signifies an active, authorized patient visit) and the intervention_code for the specific service being added.
- Validating Service Appropriateness: It performs checks to ensure the intervention_code is valid and adheres to combination rules with other services already on the visit, e.g. preventing a mix of inpatient and outpatient services.
- Adding the Intervention: Upon successful validation, the system adds this new intervention to the patient's visit record.
- Updating Claim Information: The addition of the intervention is subsequently reflected in the claim associated with that visit, ensuring accurate billing.
1.2. Why This Workflow Is Critical (The "Why It Matters")
This workflow is vital because it represents the initial digital capture of services provided to a patient during their visit. Other reasons for having this workflow include:
- Foundation for other intervention workflows: It is a prerequisite for all other intervention management workflows (such as retiring or switching interventions), as an intervention must first be added before it can be modified.
- Ensuring Accurate Patient Records: By precisely documenting each service, we contribute to a comprehensive and accurate medical history for the patient, which is essential for continuous care and informed clinical decision-making.
- Enabling Accurate Claims: Every intervention added directly impacts the claim submitted for the visit. Accurate capture here is fundamental for correct and timely reimbursement to the healthcare provider.
- Supporting Compliance: Proper recording of interventions ensures compliance with SHA guidelines and other regulatory requirements regarding service documentation.
In short, this workflow ensures that the digital record of care accurately matches the care provided, laying the groundwork for all subsequent operational and financial processes.
## 2. Workflow Details: Adding an Intervention
This section details the step-by-step process for adding a new intervention to a patient's visit.
### 2.1. Step-by-Step System Behavior
Input Reception:
The system receives the consent_token for the patient's active visit and the intervention_code representing the new service to be added.
Authorization and Visit Context Check:
The system uses the provided consent_token to validate that the patient's visit is consented and active. This ensures that interventions are only added to ongoing and authorized encounters.
Intervention Code and Combination Validation:
The system performs checks on the intervention_code. It confirms that the intervention code is a valid service code. After this, it validates the combination of the intervention_code with any existing interventions already on the patient's visit. This includes ensuring that you cannot mix inpatient and outpatient interventions on the same visit. Specific combinations of intervention codes may also be restricted.
Add Intervention to Visit Record:
If all validations pass, the system proceeds to add the intervention_code to the active patient visit record.
Claim Reflection:
The addition of this intervention is automatically reflected in the claim associated with that patient visit, ensuring the claim accurately represents the services provided.
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant addition of interventions:
- Active Consent/Visit State: The system validates that the visit linked to the consent_token is still in an active state and that the patient's consent is valid. This prevents interventions from being added to closed or unconsented visits.
- Valid Intervention Code: The intervention_code must be a recognized and acceptable service code within the system. Ensures only legitimate services are recorded.
- Intervention Combination Rules Check: The system confirms that the new intervention_code does not violate any predefined rules regarding combinations of interventions already on the visit (e.g., no mixing of IP and OP interventions). Ensures data integrity and compliance with SHA rules.
### 2.3. Workflow Data Dictionary
This table outlines the key information used and produced by this workflow:
 | Field Name | Description | Required | Purpose
 | consent_token | The authorization token for the patient's active visit. | Yes | Authorizes the action to add an intervention to the correct patient visit.
 | intervention_code | The unique code identifies the specific healthcare service you are trying to add. | Yes | Specifies the particular service being rendered or planned for the patient.
### 2.4. Expected Outcomes
Success: Intervention Successfully Added: All inputs are valid, consent/visit was active, and the intervention_code successfully passed all combination rules and was added to the patient's visit record. Therefore patient's visit record is updated with the new service. This change will be reflected in the associated claim. The system can now proceed with other visit-related actions or add more interventions.
Failure: Invalid Consent/Visit State: The consent_token was invalid, expired, or the visit it references is no longer active. The intervention cannot be added. Ensure you are using a valid token for an active visit.
Failure: Invalid Intervention Code: The provided intervention_code is not recognised or is not a valid code. The intervention cannot be added. You need to verify and provide a correct intervention code.
Failure: Intervention Combination Violation: The intervention_code violates predefined rules when combined with other interventions already on the visit (e.g., attempting to add an Outpatient intervention to an Inpatient visit). The intervention cannot be added. Review the combination rules and ensure the service is appropriate for the current visit context.
## Related resources
- SHA Combination Rules - the combination tables this endpoint validates against.
- Special Benefit Rules - the per-package rules that gate a combination on a time window rather than on the code alone.
- Adding a package during the admission - which packages may be added to an open inpatient admission.
- Switch Intervention - use this rather than adding a second per-diem intervention.
Last modified on September 28, 2026
