# Intervention Process Guide: Switch Intervention Workflow
## 1. Overview: Changing a Service During a Patient's Visit
The Switch Intervention Workflow is a step that helps in managing healthcare services during an active patient visit. This workflow enables the replacement of an existing intervention with a different one within a patient's visit record. This helps in adapting to evolving patient needs, changes in treatment plans, or correcting previously recorded services.
This workflow ensures that the patient's visit record remains accurate and flexible, reflecting the most current and appropriate services being provided.
### 1.1. What This Workflow Does
The Switch Intervention Workflow's main function is to replace one intervention with another on an existing, active patient visit. It does this by:
Receiving Authorization and Service Details: It takes a consent_token (which signifies an active, authorized patient visit) and the existing_intervention_code to be replaced, along with the new_intervention_code to switch to.
Validating Switch Conditions: It performs a series of checks to ensure the switch is permissible. These validations include confirming the visit's active state, adhering to intervention combination rules, checking for pre-authorization requirements of the new intervention, ensuring compatible access points, and considering the presence of bill items or diagnoses for retention.
Performing the Switch: Once the validation is successful, the system replaces the existing_intervention_code with the new_intervention_code in the patient's visit record.
Managing Associated Data: It handles the retention of bill_items and diagnosis from the existing_intervention_code based on the retain_bill_items option and specific rules (e.g., when switching from per diem to surgical interventions).
Updating Claim Information: The change in interventions is subsequently reflected in the claim associated with that visit, ensuring accurate billing.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
This workflow is absolutely vital because it provides the flexibility and accuracy needed to manage dynamic patient care during a visit. It's important as it helps:
Adapting to Clinical Changes: Patient conditions can evolve, or a more suitable treatment might be identified. This workflow allows healthcare providers to quickly adjust the recorded services to match the actual care provided.
Correcting Errors: If an incorrect intervention was initially added, this workflow offers a way to rectify it by switching to the correct one without fully removing and re-adding.
Ensuring Accurate Claims: By ensuring the patient's record precisely reflects the services delivered, it directly contributes to generating accurate claims for reimbursement, preventing discrepancies and ensuring fair payment to facilities.
Maintaining Data Integrity: It helps keep the patient's visit record clean and accurate, ensuring that only the services genuinely provided are documented.
In short, this workflow ensures the digital record of care remains flexible and precise, matching the dynamic nature of patient treatment and supporting efficient, compliant financial processes.
## 2. Workflow Details: Switching an Intervention
This section details the step-by-step process for switching one intervention for another on a patient's visit.
### 2.1. Step-by-Step System Behavior
Input Reception: The system receives the consent_token for the patient's active visit, the existing_intervention_code to be replaced, the new_intervention_code to switch to, and the retain_bill_items option. Optionally, bill_from and bill_to timestamps may be provided if retain_bill_items is true.
Authorization and Visit Context Check: The system uses the provided consent_token to validate that the patient's visit and associated consent are still in an active state. This ensures interventions are only managed for ongoing and authorized encounters.
Intervention Switch Condition Validation: The system performs crucial checks on both the existing_intervention_code and the new_intervention_code, as well as their context within the visit. It checks the following:
Combination Rules: Confirms that the new_intervention_code adheres to acceptable combination rules with other interventions already on the visit (e.g., preventing mixing of Inpatient (IP) and Outpatient (OP) interventions).
Pre-Authorization Check: Verifies that the new_intervention_code does not require an elective pre-authorization from SHA.
Access Point Compatibility: Ensures that the new_intervention_code has the same access point (e.g., Inpatient, Outpatient, or both) as the existing_intervention_code.
Specific Combination Restrictions: Checks for specific rules where interventions cannot be combined (e.g., for imaging services, patients might need to be discharged before certain switches can occur).
Bill Item/Diagnosis Retention Rules: Verifies if bill_items and diagnosis can be retained based on the retain_bill_items flag and specific rules (e.g., these items can be retained unless switching from a 'per diem' intervention to a 'surgical' one).
Perform Intervention Switch: If all validations pass, the system proceeds to replace the existing_intervention_code with the new_intervention_code in the patient's visit record. This includes handling the retention or removal of associated bill items and diagnoses as per the rules.
Claim Reflection: The switch of this intervention is automatically reflected in the claim associated with that patient visit, ensuring the claim accurately represents the services provided.
### 2.2. Key Validations
These are the critical checks performed during this workflow to ensure the accurate and compliant switching of interventions:
Active Consent/Visit State: The visit linked to the consent_token must be in an active state, and the patient's consent must be valid.
Valid Existing and New Intervention Codes: Both the existing_intervention_code and new_intervention_code must be recognized and valid service codes.
Intervention Combination Rules Adherence: The combination of the new_intervention_code with other existing interventions on the visit must be allowed.
No Elective Pre-Authorization for New Intervention: The new_intervention_code must not require an elective pre-authorization from SHA.
Bill Item and Diagnosis Retention Rules: Validates whether bill_items and diagnosis can be retained based on the retain_bill_items option and specific rules.
Same Access Point: The new_intervention_code must have the same access point as the existing_intervention_code.
No Conflicting Intervention Combinations: Checks for rules where certain interventions cannot be combined.
Existing Intervention is Active on Visit: The existing_intervention_code must be currently active on the patient’s visit.
### 2.3. Workflow Data Dictionary
 | Field Name | Description | Required | Purpose
 | consent_token | The authorization token for the patient's active visit | Yes | Authorizes the action to switch interventions for the correct patient visit
 | existing_intervention_code | Unique code identifying the service to switch from | Yes | Specifies the intervention to be replaced on the patient's visit
 | new_intervention_code | Unique code identifying the service to switch to | Yes | Specifies the new intervention that will replace the existing one
 | retain_bill_items | Flag indicating whether to retain bill items | Yes | Determines if financial records from the old intervention should be retained
 | bill_from | Start date of the previous intervention (if retaining bills) | Yes/No | Specifies start date for retaining bill items
 | bill_to | End date of the previous intervention (if retaining bills) | Yes/No | Specifies end date for retaining bill items
### 2.4. Expected Outcomes
Success: Intervention Successfully Switched: All inputs were valid, consent_token was active, and existing_intervention_code was successfully replaced with new_intervention_code after validations. Associated bill items and diagnoses handled as specified. Patient record and claim updated.
Failure: Invalid Consent/Visit State: The consent_token was invalid, expired, or the visit is no longer active.
Failure: Invalid Intervention Codes: Either existing_intervention_code or new_intervention_code is not valid.
Failure: Switch Condition Violation: The switch violated one or more predefined rules (e.g., mixing IP/OP, pre-auth required, access mismatch).
Failure: Bill Item/Diagnosis Retention Conflict: Retention not possible due to conflicting rules (e.g., switching from per diem to surgical). User must adjust the retain_bill_items flag or accept that retention isn’t allowed.
Failure: Intervention Not Found or Not Active: The existing_intervention_code is not active on the patient’s visit. User needs to verify the code and status.
## Related resources
This endpoint is how the benefit rules on switching between per-diem packages are carried out, so the switch
conditions it enforces come from those rules.
- Switching between inpatient and critical care - the two-way switch, with days calculated automatically.
- Switching to critical care or palliative care - note that the palliative-care switch is documented in one direction only.
- No per-diem inside the global period - a common cause of a switch-condition violation on a surgical episode.
- Special Benefit Rules - all six rule sets.
Last modified on September 28, 2026
