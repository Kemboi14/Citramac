# Partial and Full Discharge
Discharging a patient and submitting their claim used to be a single act. A facility that still needed
time to assemble clinical documentation therefore had nowhere to put the patient: the claim could not be
submitted, so the visit could not be closed, so the patient could not leave. Partial discharge splits
the two. It takes the patient's consent and records the discharge reason straight away, then holds the
claim back so the facility can finish its paperwork and submit at its own pace.
Both halves go through the same endpoint, POST /api/v1/claims/submit. The discharge_status field
decides which half you are performing.
## The two calls
### First call: discharge_status: PARTIAL
This runs the visit-end authorisation (OTP or biometrics) exactly as an ordinary submission does, saves
the discharge reason, and returns 200. What it does not do is send the claim to SHA.
Code 
{
  "consent_token": "K5HLPJVDNV",
  "invoice_number": "OPD/1/23",
  "discharge_reason": "RECOVERED",
  "discharge_status": "PARTIAL",
  "otp": "123456"
}
The patient is now free to leave. invoice_number is still required on this call, so the facility must
know what it is billing before the patient goes, even though the claim itself is held.
### Second call: discharge_status: FULL
This submits the held claim and runs the submission validations. It needs nothing but the consent token
and the status, because consent, discharge reason and invoice number were all taken on the first call.
Code 
{
  "consent_token": "K5HLPJVDNV",
  "discharge_status": "FULL"
}
No fresh consent is taken. No OTP, no discharge reason, no invoice number.
## What the second call validates
These are the checks the first call defers. They are the reason the split exists, and they are what the
facility uses the intervening time to satisfy:
- At least one claim attachment must be present, unless the claim is a CAPITATION claim.
- A claim doctor must be assigned on HMIS claims. See Adding a Claim Doctor.
- Copay must not exceed the invoice amount.
- Invoice completeness is enforced for paperless payers.
### SHA expects the FULL call within 7 days
SHA's business rule is that a partially discharged visit must be finalised within 7 days. The API
does not currently enforce a deadline: there is no expiry check on discharge_status, and a late FULL
call is not rejected on that basis. Integrators must therefore track the window themselves and prompt
the facility, otherwise claims can sit unsubmitted indefinitely.
### The claim must still be in a draft-like state
The shortcut that lets the second call skip straight to submission only applies while the claim is in
DRAFT, DRAFT_RESUBMIT, DRAFT_RESUBMIT_DOCUMENTS or FAILED_TO_SUBMIT, and only when the claim is
not a resubmission. Outside those states the call is rejected with a "no valid active virtual claim"
error. See Understanding Claim Statuses.
## FULL is the default
Omitting discharge_status behaves exactly as it always has: the patient is discharged and the claim is
submitted to SHA in one call, with all validations applied immediately. Existing integrations need no
change. Partial discharge is opt-in, one visit at a time.
## The flow
## Related resources
- Outpatient Claim Dispatch - the full submission workflow this fits into.
- Adding Attachments - the attachment requirement the second call enforces.
- Adding a Claim Doctor - required on HMIS claims before finalising.
- Understanding Claim Statuses - the draft-like states the shortcut depends on.
- Submit a virtual claim - the API reference, including the four request variants.
Last modified on September 28, 2026
