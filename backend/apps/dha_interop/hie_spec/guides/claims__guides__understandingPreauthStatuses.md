# Preauthorization Lifecycle & Statuses
Managing preauthorizations requires tracking their state from initial creation through doctor approval and final payer adjudication. This guide explains the lifecycle of a preauth request.
State Machine
The preauth workflow is linear but includes specific loops for Doctor
Approval and Payer Clarifications. You must monitor the status field
to know when action is required.
## 1. Preparation Phase (Local)
These statuses occur before the preauth is successfully sent to the Payer for adjudication.
- DRAFT: The request is being created locally. You have full control to edit details, add attachments, and modify line items.
- PENDING_SUBMISSION: The preauth is fully validated and ready to be sent to the Payer switch.
- CANCELLED: The provider has decided not to proceed with the request. This is a terminal state for unsubmitted preauths.
### The Doctor Approval Loop
These are states where the doctor's approval is required. These intermediate states are only encountered when the approval request is done via the Practice360 App.
- DOCTOR_REQUEST_SENT: An approval request has been sent to the doctor.
- PENDING_DOCTOR_APPROVAL: The system is waiting for the doctor to explicitly approve or reject the request.
- DOCTOR_REQUEST_FAILED: The push notification or request to the doctor failed (e.g., connectivity issues). You may need to retry.
## 2. Submission & Active Phase
Once the preauth leaves your system, it enters the active processing state.
- ACTIVE: The preauth has been successfully submitted to the Payer. It is now under review.
- Note: This does not mean it is approved yet. It means the request is sent to the Payer.
## 3. The Clarification Loop (Action Required)
Sometimes, the Payer's automated systems will flag issues or changes needed before an actual person reviews it. In this case the preauth transitions to this state:
- CLARIFICATION_AFTER_AUTOMATIC_CHECKS: The Payer's bots have flagged missing information or data mismatches.
- Action Required: You must update the preauth (e.g., attach a missing document or fix a coding error) and re-submit. This transitions the claim back to ACTIVE.
## 4. Final Outcomes
These statuses represent the Payer's decision.
- FINALISED: Success. The Payer has reviewed the request and made a decision (Approved). You can now proceed to offer the service and link this preauth to a claim.
- REJECTED: The request was denied. The Payer will usually provide a reason in the preauthNotes.
- REJECTED_AFTER_APPROVAL: A rare state where a previously FINALISED (approved) preauth is revoked upon further audit or review.
## Visualizing the Workflow
The diagram below illustrates the valid transitions between these states.
Last modified on September 28, 2026
