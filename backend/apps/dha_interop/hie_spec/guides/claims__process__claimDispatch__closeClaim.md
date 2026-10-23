# Close Claim Workflow Guide
## Close Claim Workflow: Terminating Claims Not Scheduled for Submission
### 1. Overview
This guide explains the Close Claim workflow, which allows providers and integrators to terminate a claim that is not scheduled for submission to the payer. If, for any reason, a provider decides not to proceed with a claim, this workflow enables them to close the claim, changing its status to CLOSED.
1.1. What This Workflow Does
The Close Claim workflow enables users to:
- Terminate Unwanted Claims: End claims that are no longer needed or were created in error.
- Change Claim Status: Update the claim’s status to CLOSED, preventing further edits or submission.
- Document Cancellation Reason: Record the reason for closing the claim for audit and compliance purposes.
1.2. Why This Workflow Is Critical
- Prevents Unnecessary Processing: Stops claims that should not be submitted, reducing clutter and confusion.
- Supports Compliance: Ensures all claim closures are documented with a reason.
- Improves Data Integrity: Keeps the claims database clean and accurate.
### 2. Workflow Details: Close Claim
2.1. Workflow Description
When a provider or integrator needs to close a claim, the following steps occur:
- Input Reception: The user submits a request with the claim’s consent token and a cancellation reason.
- Status Transition: The system updates the claim’s status to CLOSED.
- Outcome Delivery: The claim is terminated and cannot be edited or submitted to the payer.
2.2. Key Validations: System Checks
- Consent Token Must Be Provided:
The consent token uniquely identifies the claim to be closed.
- Cancellation Reason Required:
Both the type and detailed explanation of the cancellation reason must be provided.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | consent_token | Unique code for the claim | String | Yes | Identifies which claim to close
 | cancel_reason_type | Type of cancellation reason | String | Yes | Specifies the category of cancellation
 | cancel_reason_text | Detailed explanation of the cancellation | String | Yes | Documents the reason for closing the claim
Allowed Values for cancel_reason_type:
- WRONG_PATIENT
- NO_SERVICE_GIVEN
- WRONG_BENEFIT
- EXPIRED_VISIT
- EXHAUSTED_BENEFIT
- TIME_BARRED
- OTHER_REASONS
2.4. Expected Outcomes from this workflow
- Successful Closure: The claim status is updated to CLOSED and no further actions can be performed.
- Input Error: Provided identifiers or cancellation reason are invalid or missing.
### 3. How Close Claim Connects to Other Workflows
- Claim Lifecycle: Provides a way to terminate claims that are not proceeding to submission.
- Audit Trail: Ensures all closures are documented for compliance and reporting.
### 4. Key Success Factors for Close Claim Workflow
- Use Valid Consent Tokens: Always provide the correct consent token for the claim.
- Document Cancellation Clearly: Choose the appropriate cancellation reason and provide a clear explanation.
- Review Before Closure: Ensure the claim truly needs to be closed, as this action cannot be undone.
Last modified on September 28, 2026
