# Minors Biometrics Integration Guide
Adult biometrics matches a patient's fingerprint against their SHA-registered prints inside a capture
iframe. A minor has no SHA-registered prints, so that route is closed to them and consent has always
fallen back to a passcode sent to a guardian's phone - which fails precisely when the guardian is not at
the facility or has no number on file.
This guide walks a new integrator through the alternative: enrolling a child locally, capturing their
print at the point of care, and turning the result into consent for a visit. It assumes you have already
set up HealthID and confirmed your scanner works, because that part is identical to the adult path -
if you have not, start with the Biometrics Integration Guide
and come back.
For the endpoint-by-endpoint reference, see the
Minors Biometrics Consent process doc. This guide is the
end-to-end walkthrough.
## The full flow at a glance
## Step 1 - Decide whether this patient needs it
Do not derive the method from the patient's age. The payer decides, and the answer arrives with the
member's eligibility response as a biometric_status object:
- use_sil_biometrics is true - the child is enrolled for minors biometrics. Use this flow.
- use_sil_biometrics is false - use guardian authorization. See Send OTP.
### Why not just check the age?
The eligibility window for minors biometrics is configuration held by the payer, not a constant in your
code. It can change without a release on your side. Reading the flag keeps your integration correct when
it does.
You do not need to check enrollment separately. The gateway checks it at dispatch and refuses a child
whose enrollment is incomplete with 422 subject_not_enrolled, before any capture reaches the
workstation. The remedy is to complete the child's fingerprint enrollment and retry - not to fall
back to guardian authorization, which on an enforced facility is itself unavailable to a minor who has not
been OTP-whitelisted.
### Enrollment must be complete, not just started
A part-enrolled child is refused. This is the same bar the provider portal applies before a clinician may
start a fingerprint visit. What counts as complete is decided upstream, so do not encode a finger count
of your own - act on the refusal. Enrollment itself is documented in Minors Biometrics Enrollment.
## Step 2 - Dispatch the capture
Code 
POST /api/v1/biometrics/matches
Send the child's CR code as health_id, plus the workstation_id and device_id you read from
GET http://localhost:18065/status, and your agent_id.
You get 202 Accepted, not a result. The capture has been sent to the workstation and has not
happened yet. Keep the match_id and the next_action block from the response.
### Use the dependant's own CR code
A child on a family policy has their own CR code, differing from a sibling's only by the trailing index.
Whatever you send as health_id here must be the identical string you later send as patient_id on the
visit - the gateway refuses a match captured for a different subject.
A 503 here means the target workstation is not live. Nothing was queued and nothing was consumed;
retry the same request once the capture agent is back.
## Step 3 - Wait for the callback
The scanner wakes and the child places their finger. The verdict is delivered to your registered
callback endpoint when the capture resolves - next_action.type on the dispatch response is
await_callback, and there is no result to poll for.
The callback tells you which of two things happened:
- matched - it carries the match_id to present at the next step.
- not matched - it carries the reason. Capture again, or on repeated failures pursue OTP whitelisting.
### Register the callback endpoint first
The verdict is delivered to the endpoint registered for your facility, the same mechanism that already
receives claim notifications, so it inherits that endpoint's authentication, signing and retries. If no
endpoint is registered for the facility, nothing is delivered and there is nothing to wait for - register
one before driving this flow.
GET /api/v1/biometrics/matches/{match_id} remains available, but as a reconciliation read for a
callback you believe you missed. It is not the route to the result and should not be called in a loop.
### Repeated non-matches
There is no cap on attempts - a child is never locked out of trying again. But a finger that repeatedly
fails to match will keep failing, and on an enforced facility guardian authorization is not a fallback
unless the minor has been OTP-whitelisted. So when a child cannot match, the path forward is an
OTP Whitelist Request, which grants that child OTP
access. Device and workstation errors are not non-matches and say nothing about the finger.
## Step 4 - Turn the match into a visit
Send the match_id where the adult flow sends auth_guid:
Code 
POST /api/v1/claims/visit
The authorization is created already authorized - there is no completion call and no PENDING state,
because the match was verified before the authorization existed.
Two properties worth designing around:
- A match authorizes once. A second attempt is refused with match_already_used. If your client
retries a failed visit call, check for an existing authorization before capturing again.
- A match is valid for 600 seconds from the capture, not from when the callback reached you. Present
it promptly; a match that sat in your queue has already spent part of its life.
If the call is refused, the reason is a machine-readable code. The full ordered list, with what to do
about each, is in
the refusal list in the process doc.
## Step 5 - When it does not work
 | What you see | What it means | What to do
 | 503 on dispatch | Workstation not live | Check HealthID on that workstation, retry
 | No callback arrives | Nobody has presented a finger, or no endpoint is registered | Prompt the clinician; confirm the facility has a registered callback endpoint
 | failed / deadline_exceeded | Capture window closed, no result | Request a fresh match
 | Repeated no_match | The finger will not match | Capture again; on persistent failure raise an OTP Whitelist Request for the child
 | match_subject_mismatch | CR codes differ between match and visit | Compare the full string, including the dependant index
## Related resources
- Minors Biometrics Consent - endpoint reference and the full refusal list.
- Biometrics Integration Guide - HealthID setup and the adult flow.
- OTP Whitelist Request - the path when a child cannot match on an enforced facility.
- Send OTP - guardian authorization, for a child not eligible for biometrics.
- Get Beneficiary Valid Contact - resolving which contact receives a guardian passcode.
- Start Visit Workflow - using consent to start a visit.
- Consent Services API Reference
Last modified on September 28, 2026
