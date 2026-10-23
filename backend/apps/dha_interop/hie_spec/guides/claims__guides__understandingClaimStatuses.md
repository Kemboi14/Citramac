# Claim Lifecycle & Statuses
Successfully integrating with the HIE requires managing the state of your claims. A claim moves through a lifecycle from creation to payment, and understanding this flow is key to building a robust integration.
## The Double Status System
Every claim has two sets of status fields that you must monitor. It is critical to distinguish between the status of the claim in your system (Provider) versus the status in the Payer's system.
 | Perspective | Process Status Field | Validity Status Field
 | Provider Claim | workflow_state
Tracks the claim's lifecycle from your perspective (Draft → Submission_ready → Submitted). | claim_auth_status
Tracks the authorization validity of the visit itself.
 | Payer Claim | workflowState
Tracks the detailed adjudication steps inside the Payer's system. | authorisation.status
Tracks the Payer's view of the authorization.
## 1. Provider Claim Statuses
These statuses track the claim as it exists in your local system. They represent the high-level journey of a claim.
### A. Provider Workflow State (workflow_state)
We have grouped these statuses into logical phases based on the claim's journey.
Phase 1: Preparation (Local)
The claim has not yet left your system
- DRAFT: The claim is being created. You can edit lines and diagnoses.
- PENDING: Awaiting an internal action.
- SUBMISSION_READY: Validated locally and ready for dispatch.
- ON_HOLD: Paused locally for internal reasons.
- TIME_BARRED: The claim was not submitted within the allowed window (e.g., 24-hour emergency rule or 14 day window to add missing attachments).
Phase 2: Submission & Dispatch
The hand-off to the payer.
- SUBMITTED: Successfully sent to a service that will forward it to the payer's system.
- DISPATCHED: Acknowledged by the service and forwarded to the Payer.
- FAILED_TO_SUBMIT: Technical error prevented dispatch. Retry required.
Phase 3: Payer Processing & Feedback
The claim is with the Payer.
- SUBMITTED_PAYER: Received by the Payer's system.
- AUTOMATIC_CHECKS_DONE: Automated checks have completed and passed.
- DRAFT_RESUBMIT: You have pulled the claim back to fix a clarification request. It is editable. This is usually initiated when you run the resubmitClaim operation.
- DRAFT_RESUBMIT_DOCUMENTS: Specific status for uploading missing documents.
Phase 4: Final Outcomes
The end of the lifecycle.
- CLOSED: You have decided to close the claim and no longer wish to pursue it.
### Important Note on Financial Outcomes
The Provider Claim object does not track feedback from the Payer (payment or rejection statuses like PAID or REJECTED). To determine the financial outcome of a claim, you must check the Payer Claim  by querying the getPayerClaim endpoint.
Provider Claim Workflow State Diagram
### B. Provider Authorization Status (claim_auth_status)
This tracks the clinical validity of the visit.
 | Status | Meaning
 | PENDING | Authorization requested but not yet granted.
 | AUTHORIZED | Standard Status. The visit is valid, and patient has consented to it; you can add interventions and billing lines.
 | SUBMITTED_CLAIM | The claim associated with this authorization has been submitted to the payer.
 | AUTHORIZED_PENDING_VISIT | Used for Elective Preauths. The pre-auth is approved, but the patient has not arrived yet.
 | AUTHORIZED_MULTISESSION | Valid for a series of related visits (e.g., dialysis or chemotherapy series). You can create multiple visits from this auth. Only valid for Multisession preauths.
 | EMERGENCY_AUTHORIZED | Validated emergency case claim. Only valid for claims of service type EMERGENCY.
 | REJECTED | Authorization request denied.
 | EXPIRED | Authorization validity period has passed.
 | CLOSED | Visit finalized.
## 2. Payer Claim Statuses
These statuses appear in the Payer Claim object. They offer an insight into the review process inside the Payer's system and provide feedback for any issues raised with regards to the claim.
### Important Note
You can only check claims from the Payer's perspective after submission. These statuses are not applicable to claims in your local system.
### A. Payer Workflow State (workflowState)
Receipt & Validation
The entry point into the Payer's world.
- DRAFT_PROVIDER: The claim has been submitted and is now being processed for payer review.
- SUBMITTED_PROVIDER: Acknowledges receipt from the provider and passes some checks including if it has a diagnosis, an attachment and an invoice line.
- AUTOMATIC_CHECKS_DONE: Passed automated rules engine and validations checks.
- SUBMITTED_PAYER: Logged in Payer's core system. This signifies successful handoff to the payer
Adjudication & Review Queues
Various levels of human and system reviews.
- IN_REVIEW: General review queue.
- CLINICAL_REVIEW: Under review by clinical experts.
- MEDICAL_REVIEW: Under review by medical doctors.
- UNDER_COMMITTEE_REVIEW: High-level committee review.
- SENT_TO_SURVEILLANCE: Flagged for fraud check.
- MANUAL_REVIEW: Reviewed manually by someone from the payer and has passed.
Clarification & Returns
The "Ping Pong" states where the claim is sent back to you. This is where the clarification loop resides
- CLARIFICATION_AFTER_AUTOMATIC_CHECKS: Automated checks and validations have flagged an issue.
- SENT_BACK: Returned to provider for general corrections.
- MISSING_DOCUMENTS: Specific flag for missing attachments.
- DRAFT_PROVIDER_RESUBMITTED: Payer acknowledges your resubmission.
- DRAFT_PROVIDER_RESUBMITTED_MISSING_DOCUMENTS: Payer acknowledges missing document upload.
- RESUBMITTED_MISSING_DOCUMENTS: Docs received, processing resumed.
Payment & Finalization
The final disposition.
- SENT_FOR_PAYMENT_PROCESSING: Approved and queued for finance. In unique occasions, this claim may still be returned to a SENT_BACK status if the claim looks fraudulent.
- APPROVED: Final approval granted.
- PAID: Payment executed.
- REJECTED: Denied by the payer.
- APPEALED: Under appeal review.
- TIME_BARRED: Expired.
### B. Payer Authorization Status (authorisation.status)
- SUBMITTED_CLAIM: Authorization linked to a submitted claim.
- AUTHORIZED: Valid authorization on file.
- EXPIRED: Authorization validity period has lapsed.
- CLOSED: Authorization has been closed after claim finalization.
Last modified on September 28, 2026
