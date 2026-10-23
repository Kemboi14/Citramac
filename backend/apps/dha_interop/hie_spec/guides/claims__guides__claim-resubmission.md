# Claim Resubmission
When a payer returns a claim - because it was rejected, sent back, or needs clarification or additional
documents - you correct it and send it again. This is resubmission. This guide explains when a claim
is eligible, the end-to-end flow, exactly which edits are permitted (and their limits), and how
resubmission differs from recovering a claim that failed to transmit.
## When a claim can be resubmitted
Two conditions must both hold:
- Provider-side state. The claim in your system must be in one of:
SUBMITTED, DRAFT_RESUBMIT, DRAFT_RESUBMIT_DOCUMENTS.
- Payer-side (EDI) state. The claim's payer-side workflow state must be one of the states the payer
allows a claim to be pulled back from:
DRAFT_PROVIDER, CLOSED, CLARIFICATION_AFTER_AUTOMATIC_CHECKS, CLARIFICATION_AFTER_PAYER_CHECKS,
CLARIFICATION_AFTER_PAYER_REVIEW, DRAFT_PROVIDER_RESUBMITTED, REJECTED, SENT_BACK,
MISSING_DOCUMENTS, DRAFT_PROVIDER_RESUBMITTED_MISSING_DOCUMENTS, PROVIDER_RESUBMISSION_FINALISED.
If the payer-side state is not one of these, the claim cannot currently be resubmitted.
## The resubmission flow
- Trigger resubmission. Call the resubmit endpoint for the claim. The HIE re-opens the authorization
on the payer side and moves the claim to DRAFT_RESUBMIT - or to DRAFT_RESUBMIT_DOCUMENTS when the
payer returned it as MISSING_DOCUMENTS.
- Make your corrections. While the claim is in a DRAFT_RESUBMIT* state you may edit it (see below).
- Re-submit. Send the claim again through the normal submit route - Outpatient Claim
Dispatch or Inpatient Claim
Dispatch. Because the claim is in a
resubmission state, the first-time-only fields (invoice number, discharge reason, consent) are not
required again - they were captured on the original submission.
## What you can edit on resubmission
While in DRAFT_RESUBMIT / DRAFT_RESUBMIT_DOCUMENTS, the permitted corrections are:
- Add attachments - typically to satisfy a MISSING_DOCUMENTS return. See
Adding Attachments.
- Add diagnoses.
- Edit a claim line - adjust a line's unit price or quantity via
Edit Claim Line.
### Line amounts can only scale down
On resubmission a line amount may only be revised downwards. A PMF line's total cannot be edited to
exceed its original (initial) line amount - the HIE rejects the edit if the new total is higher. Scale a
line down to correct an over-bill; you cannot inflate a line during resubmission.
## Resubmission is not the same as recovering a failed transmission
A claim in FAILED_TO_SUBMIT never reached the payer - it is a transmission problem, not a payer
return. You do not use the resubmit endpoint for it. Instead you re-call the normal submit route
(Submit outpatient / Discharge inpatient) directly, and the already-captured consent and discharge fields
are not re-required. See Preview Provider Claim for
how FAILED_TO_SUBMIT is detected and recovered.
## Related resources
- Resubmit Claim
- Edit Claim Line
- Adding Attachments
- Preview Provider Claim
- Understanding Claim Statuses
Last modified on September 28, 2026
