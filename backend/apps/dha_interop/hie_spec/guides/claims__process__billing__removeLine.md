# Billing Workflows Process Guide: Remove line Workflow
## 1. Overview: Deleting Billable Items from a Claim
This guide focuses on the Remove line workflow, a crucial stage in our broader Billing Workflows Process. It is a mechanism for correcting or reversing previously added billable items on a patient's claim. The primary function of this workflow is to accurately remove an existing invoice line item from a claim.
### 1.1. What This Workflow Does
The Remove line workflow's main function is to accurately identify and delete a specific line item that has already been added to a patient's claim for an existing visit. This is done by taking unique identifiers for the claim and the line item itself, ensuring that only the intended item is removed, while also performing an important validation on the intervention's payment mechanism.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Being able to accurately remove billable items is important for maintaining the financial integrity and accuracy of a patient's claim. Having a precise and compliant line item removal process brings several benefits:
- Precise billing and patient satisfaction: Correctly billed services can be easily removed, leading to patients being charged for services they only received or that were corrected.
- Claim Accuracy: Erroneous line items on a claim are removed, and this can resolve any disputes with payers and simplify the reconciliation process.
- Audit Successes: The ability to correct billing errors post-addition can lead to compliance during audits and avoidance of potential penalties.
- Operational Efficiency: Manual or cumbersome processes for removing line items are resolved with this, hence reducing delays and decreasing administrative burden.
This workflow is key to ensuring claim accuracy and flexibility. It ensures that billing information remains truthful and adaptable to changes, supporting the overall integrity of the Billing Workflows Process.
## 2. Workflow Details: Remove line
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to remove a line item from an existing claim is received, here's the internal process that unfolds:
- Input Reception: The system first receives the consent_token for the active patient visit and the line_guid of the item to be removed.
- Visit and Consent Validation: The system immediately validates the provided consent_token to confirm that the patient's visit is still active/open and that the consent is valid.
- Line Item Identification: Using the line_guid, the system locates the specific bill item on the claim.
- Intervention Payment Mechanism Validation: The system performs a critical check: it validates that the intervention associated with the line item being removed does not have a 'per diem' payment mechanism.
- Line Item Removal: If all validations pass and the item is found, the system proceeds to remove the specified line item from the patient's claim.
### 2.2. Key Validations: Our System's Essential Checks
There are some essential checks our system performs behind the scenes to ensure a successful and accurate "Remove line" operation. Understanding these helps you provide the correct information from your end, preventing errors.
Active Visit/Consent Validation:
The consent_token provided must correspond to a patient visit that is currently open and active. This ensures billing modifications are only made on valid patient encounters.
Line Item Existence:
The line_guid must precisely identify an existing line item on the claim. This prevents accidental deletion or deletion of non-existent items.
Non-Per Diem Intervention Validation:
The intervention associated with the item must not be classified with a 'per diem' payment mechanism. Such services are billed by day and need special handling for removal.
### 2.3. Workflow Data Dictionary (Conceptual): What Information We Work With
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | The consent token for the patient visit. | string | Yes | Authorises the billing modification action for the correct patient and visit.
 | line_guid | System-generated GUID for the invoice line item. | string | Yes | Identifies the specific line item to remove.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, here's what you can expect in return:
- Success: Line Item Removed from Claim – the item is successfully removed after all validations pass.
- Failure: Invalid Visit/Consent – the consent_token is invalid, expired, or the visit is no longer active.
- Failure: Per Diem Intervention – the item is associated with a 'per diem' intervention, which cannot be removed through this workflow.
- Failure: Line Item Not Found – the provided line_guid does not match any existing line item.
- Failure: Missing Required Data – any required field (consent_token, line_guid) is missing or malformed.
Last modified on September 28, 2026
