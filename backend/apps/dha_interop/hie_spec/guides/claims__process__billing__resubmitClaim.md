# Resubmit Claim Workflow Guide
## Resubmit Claim Workflow: Transitioning Claims for Editing After Payer Review
### 1. Overview
This guide explains the Resubmit Claim workflow, which allows providers to transition a claim to a status that permits editing after it has been reviewed by the payer. When a claim is sent back by the payer for clarifications or changes, this workflow enables the provider to update claim line details and resubmit for further review.
1.1. What This Workflow Does
The Resubmit Claim workflow enables providers to:
- Transition Claim Status: Change the claim’s status to DRAFT_RESUBMIT, allowing edits.
- Edit Claim Lines: Update details such as unit price, quantity, diagnoses, and attachments.
- Address Payer Feedback: Make necessary corrections based on payer comments or rejection reasons.
- Prepare for Resubmission: Ensure the claim is complete and accurate before sending it back to the payer.
1.2. Why This Workflow Is Critical
- Improves Claim Accuracy: Providers can correct errors and add missing information.
- Speeds Up Resolution: Facilitates quick turnaround for claims needing clarification.
- Enhances Collaboration: Supports communication between providers and payers for efficient claim processing.
### 2. Workflow Details: Resubmit Claim
2.1. Workflow Description
When a provider needs to resubmit a claim, the following steps occur:
- Input Reception: The provider submits a request with the claim’s consent token and relevant identifiers.
- Status Transition: The system updates the claim’s status to DRAFT_RESUBMIT, unlocking it for edits.
- Claim Editing: The provider can now modify claim line items, diagnoses, and attachments as needed.
- Outcome Delivery: Once edits are complete, the claim can be resubmitted for payer review.
2.2. Key Validations: System Checks
Consent Token Must Be Provided:
The consent token uniquely identifies the claim to be transitioned.
Facility Identifiers:
Facility ID and type may be required for multi-facility providers.
Required Fields:
All mandatory claim fields must be present for successful transition.
Allowed Statuses:
Both the provider-side and payer-side states must permit resubmission.
Provider-side (the claim in your system) must be one of: SUBMITTED, DRAFT_RESUBMIT,
DRAFT_RESUBMIT_DOCUMENTS.
Payer-side (EDI) state must be one of: DRAFT_PROVIDER, CLOSED,
CLARIFICATION_AFTER_AUTOMATIC_CHECKS, CLARIFICATION_AFTER_PAYER_CHECKS,
CLARIFICATION_AFTER_PAYER_REVIEW, DRAFT_PROVIDER_RESUBMITTED, REJECTED, SENT_BACK,
MISSING_DOCUMENTS, DRAFT_PROVIDER_RESUBMITTED_MISSING_DOCUMENTS,
PROVIDER_RESUBMISSION_FINALISED.
### Resubmission can only scale a line down
The only line-item modification allowed on resubmission is scaling the amount downward. A PMF line
cannot exceed its original amount. See Edit Claim Line and
Claim Resubmission.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | Unique code for the claim | String | Yes | Identifies which claim to transition
 | facility_id | Facility identifier | String | No | Optional; derived by the server when omitted
 | facility_id_type | Type of facility identifier | String | No | Optional; derived by the server when omitted
### 3. How Resubmit Claim Connects to Other Workflows
- Claim Editing: Unlocks claim lines for editing, allowing updates to billing, diagnoses, and attachments.
- Preview & Submission: After edits, the claim can be previewed and resubmitted to the payer.
- Payer Collaboration: Supports iterative review and correction cycles between provider and payer.
### 4. Key Success Factors for Resubmit Claim Workflow
- Use Valid Consent Tokens: Always provide the correct consent token for the claim.
- Review Payer Feedback: Address all comments and requested changes before resubmitting.
- Edit Carefully: Ensure all claim line details are accurate and complete.
- Follow Compliance: Maintain regulatory standards during claim editing and resubmission.
Last modified on September 28, 2026
