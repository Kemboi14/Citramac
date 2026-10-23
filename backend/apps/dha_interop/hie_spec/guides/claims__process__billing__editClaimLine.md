# Edit Claim Line Workflow Guide
## Edit Claim Line Workflow: Adjusting Amount and Quantity After Resubmission
### 1. Overview
This guide explains the Edit Claim Line workflow, which allows providers to adjust the unit price and quantity of a claim line after a claim has been resubmitted and transitioned to an editable status (DRAFT_RESUBMIT). This workflow is designed to enable corrections while maintaining strict controls to prevent fraud.
1.1. What This Workflow Does
The Edit Claim Line workflow enables providers to:
- Edit Amount and Quantity: Adjust only the unit price and quantity for a specific claim line.
- Ensure Data Integrity: Restrict edits to prevent unauthorized changes to other claim details.
- Prepare for Accurate Resubmission: Make necessary corrections before the claim is resubmitted for payer review.
1.2. Why This Workflow Is Critical
- Prevents Fraud: Only amount and quantity can be changed, reducing risk of manipulation.
- Improves Accuracy: Providers can fix errors flagged by the payer or internal checks.
- Speeds Up Processing: Ensures claims are correct before final resubmission.
### 2. Workflow Details: Edit Claim Line
2.1. Workflow Description
When a provider needs to edit a claim line, the following steps occur:
- Input Reception: The provider submits a request with the claim’s consent token and the line ID to be edited.
- Validation: The system checks that the claim is in an editable status (DRAFT_RESUBMIT) and that the line exists.
- Edit Action: The provider specifies the new unit price and quantity for the claim line.
- Outcome Delivery: The system updates the claim line and returns the revised details for review.
2.2. Key Validations: System Checks
- Editable Status Required:
The claim must be in DRAFT_RESUBMIT status to allow edits.
- Valid Consent Token and Line ID:
Both must be provided and match an existing claim and line.
- Allowed Fields:
Only unit_price and quantity can be changed.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | Unique code for the claim | String | Yes | Identifies which claim to edit
 | line_id | Unique identifier for the claim line | String | Yes | Specifies which line to edit
 | unit_price | Adjusted unit price for the line | Number | Yes | New price for the claim line
 | quantity | Adjusted quantity for the line | Integer | Yes | New quantity for the claim line
2.4. Expected Outcomes from this workflow
- Successful Edit: The claim line is updated with the new amount and quantity.
- Edit Not Allowed: The claim is not in an editable status or the line does not exist.
- Input Error: Provided identifiers or values are invalid.
### Resubmission can only scale a line down
On resubmission, a line amount may only be scaled down. A PMF line total cannot exceed its
original amount. See Claim Resubmission.
### 3. How Edit Claim Line Connects to Other Workflows
- Resubmit Claim: Must be performed after the claim is transitioned to DRAFT_RESUBMIT.
- Preview & Submission: After edits, the claim can be previewed and resubmitted to the payer.
- Audit Trail: All edits are tracked for compliance and fraud prevention.
### 4. Key Success Factors for Edit Claim Line Workflow
- Use Valid Identifiers: Always provide the correct consent token and line ID.
- Edit Only Allowed Fields: Restrict changes to amount and quantity.
- Review Before Submission: Ensure all edits are accurate before resubmitting the claim.
- Maintain Compliance: Follow regulatory standards during claim editing.
Last modified on September 28, 2026
