# Minors Biometrics Consent Process Guide
## 1. Overview: Consent for a Patient Who Is a Minor
An adult patient consents with their own fingerprint, matched against their SHA-registered prints inside a capture iframe. See Biometrics Consent.
A minor cannot use that route. Their prints are not registered with SHA, so there is nothing for the iframe to match against. Historically the only option was a one-time passcode sent to a guardian's phone, which fails exactly when it is needed most - the guardian is not at the facility, has no phone with them, or has no number on file.
Minors biometrics closes that gap. The child's own fingerprint is enrolled locally and matched locally, and the HIE gateway - not the caller - records what happened. A minor therefore has two consent methods:
 | Method | When it applies
 | Minors biometrics | The child is enrolled for biometrics and the facility is enforced for biometrics. The child's own print provides consent.
 | Guardian authorization | Everything else - the child is not enrolled, the facility is not enforced for biometrics, or the child is whitelisted for OTP. A passcode goes to a related adult. See Send OTP.
The mechanism has three components:
- Hardware Server - the same Windows application used for adult biometrics, exposing a local API at http://localhost:18065. Setup is identical; see section 2 of the Biometrics Consent guide.
- Match API - POST /api/v1/biometrics/matches dispatches a capture to the workstation. The outcome is delivered to your registered callback endpoint; GET /api/v1/biometrics/matches/{match_id} exists only to reconcile a callback you believe you missed.
- Consent handoff - the resulting match_id is sent to POST /api/v1/claims/visit or POST /api/v1/claims/authorize in place of an otp or auth_guid.
## 2. Enrollment Is Checked For You
A minor can only be matched once their fingerprint enrollment is complete. The gateway checks this
before dispatching anything, so you do not have to: a subject whose enrollment is incomplete is
refused with 422 and subject_not_enrolled, and no capture is sent to the workstation.
Code 
{
  "error": "Unprocessable Entity",
  "message": "subject_not_enrolled: the subject's fingerprint enrollment is incomplete"
}
The remedy is to complete the child's fingerprint enrollment and retry - not to fall back to guardian
authorization, which on an enforced facility is unavailable to a minor who has not been OTP-whitelisted.
Enrollment is a separate flow, documented in Minors Biometrics Enrollment.
### Partial enrollment is not enough
A part-enrolled child is refused; enrollment must be complete. What counts as complete is decided
upstream, so do not encode a finger count of your own - act on the refusal.
## 3. The Minors Biometrics Flow
### 3.1. Step 1 - Request a Match
Call POST /api/v1/biometrics/matches with:
 | Field | Required | Notes
 | health_id | Yes | The child's beneficiary CR code, including the dependant suffix.
 | workstation_id | Yes | From GET http://localhost:18065/status.
 | device_id | Yes | The serial number of the capture device on that workstation, from the same devices list.
 | agent_id | Yes | The biometrics agent operating the workstation.
 | position | No | A specific finger position to match against. Omitted, any verified finger may match, which is the usual case.
All four identifiers are required. A request missing any of them is rejected with 400 naming the
field, rather than being dispatched and failing at the workstation with an opaque device error:
Code 
{
  "error": "Bad Request",
  "message": "validation failed: device_id is required"
}
The response to a valid request is 202 Accepted. The capture has been dispatched to the workstation
but has not happened yet. It carries a match_id and a next_action of await_callback - the verdict
comes to you, so there is nothing to poll.
### The CR code must match end to end
The health_id you send here and the patient_id you later send to the visit endpoint must be the same CR code. Dependants on one policy differ only by the trailing index, so a near-miss is easy - and the gateway refuses a match captured for a different subject.
If the workstation is not currently live, the request fails with 503. The workstation might be offline. This is retryable: the same request succeeds once the capture agent is back.
### 3.2. Step 2 - The Child Places Their Finger
The scanner on the target workstation wakes and waits. The child places the enrolled finger on it. The print is captured and matched against the child's enrolled templates.
The verdict is delivered to your registered callback endpoint when the capture resolves; your application does not call anything to obtain it.
### 3.3. Step 3 - Receive the Callback
A match is recorded and the verdict posted to the callback endpoint registered for your facility - the same endpoint that already receives claim notifications, so it inherits that endpoint's authentication, signing and retries.
The verdict carries the status and, on a successful match, the match_id to present as consent:
 | status | Terminal | Meaning
 | pending | No | The capture has not resolved yet. No callback has been sent.
 | matched | Yes | The print matched. The match can now authorize a visit.
 | no_match | Yes | The scanner read a print and it did not match this child.
 | failed | Yes | The attempt did not complete. error_code says why.
A callback is sent once, when the status becomes terminal.
GET /api/v1/biometrics/matches/{match_id} remains available as a reconciliation read for a callback you believe you missed. It is not the route to the result and should not be polled.
### A capture window that closes
If the capture window passes with nobody presenting a finger, the match resolves as failed with an error_code of deadline_exceeded. Treat it as "no result is coming" and request a fresh match.
The callback body
The gateway posts this to the endpoint registered for your facility under the
biometric_match entity and the completed action. The body is the notification itself, with no
enclosing envelope:
Code 
{
  "match_id": "5f8120c0-1a2b-4c3d-9e0f-000000000001",
  "status": "matched",
  "matched": true,
  "matched_at": "2026-08-04T10:15:00Z",
  "expires_at": "2026-08-04T10:25:00Z"
}
 | Field | Notes
 | match_id | Present it as consent. Only usable when status is matched.
 | status | matched, no_match or failed.
 | matched | Convenience boolean; true only when status is matched.
 | matched_at | RFC 3339 capture instant. Omitted until the match is terminal.
 | expires_at | RFC 3339. matched_at plus the freshness window. Omitted until terminal.
 | error_code | Present only when the match did not succeed, for example deadline_exceeded.
The subject, the workstation and the internal match log are deliberately not included. The callback
carries the verdict and the handle, not the evidence.
### Respond 2xx, and treat it as at-least-once
Acknowledge with a 2xx. A non-2xx is retried by the same machinery that retries claim notifications, so
your handler must be idempotent on match_id - a redelivery must not start a second visit.
### 3.4. Step 4 - Use the Match
A matched result is consent. Send its match_id where you would otherwise send an otp or auth_guid:
 | Use case | Field to include
 | Start a visit (POST /api/v1/claims/visit) | match_id instead of otp or auth_guid
 | Create a standalone authorization (POST /api/v1/claims/authorize) | match_id instead of otp
Unlike the adult path, the authorization is created already authorized. There is no PENDING step to complete, because the match was verified before the authorization existed.
### 3.5. Repeated Non-Matches
There is no cap on attempts - a child is never locked out of retrying. But a finger that repeatedly fails to match will keep failing, and on an enforced facility guardian authorization is not a fallback unless the minor has been OTP-whitelisted. So when a child cannot match, the path forward is an OTP Whitelist Request, which grants that child OTP access for the visit. Device and workstation errors are not non-matches and say nothing about the finger.
## 4. Match Status Reference
 | status | error_code | Meaning
 | pending | - | Capture dispatched, not yet resolved
 | matched | - | Print matched; usable as consent
 | no_match | - | Print read but did not match this child
 | failed | deadline_exceeded | The capture window closed with no result
 | failed | other | The attempt did not complete; error_detail carries the specifics
## 5. Why a Match Can Be Refused
A matched result is not a blank cheque. When you send a match_id, the gateway re-checks its own record of the match before authorizing anything. The refusals are ordered, and the first one that applies is returned:
 | Refusal | HTTP | Meaning and remedy
 | match_pending | 409 | The capture has not resolved. Wait for the callback; do not retry the visit yet.
 | match_not_successful | 422 | The match did not succeed. Capture again, or on repeated failure raise an OTP Whitelist Request.
 | match_already_used | 409 | An authorization was already created from this match. Each match authorizes exactly once.
 | match_expired | 422 | The match is outside its freshness window. Capture again.
 | match_subject_mismatch | 400 | The match was captured for a different patient than the one being authorized. Check the CR code, including the dependant suffix.
 | match_not_found | 404 | No such match, or it belongs to another facility.
### Single use, and time limited
A match authorizes once. The freshness window runs for 600 seconds from the moment of capture - not from when the callback reached you - so a match that sat in your queue has already spent part of its life. Present it promptly.
## 6. Troubleshooting
### Dispatch returns 503
The target workstation is not online. Confirm HealthID is running on that workstation
(GET http://localhost:18065/status) and that the workstation ID is the one you intend. Retry once it is
live; nothing was queued and nothing was consumed.
Also confirm the workstation is on the current HealthID build. A stale build is a real source of
capture failures that present as something else - a dispatch that reaches the workstation and returns
MISSING_DEVICE_ID has been traced to version skew rather than to a malformed request. The current
version and installer are published here:
Code 
GET https://api.biometrics.sha.go.ke/v1/business_partners/versions/1/latest_version/?target=HealthID
Code 
{
  "version": "1.16.0706.1021",
  "installer_url": "https://sha-sladeid-artifacts.s3.af-south-1.amazonaws.com/installers/HealthID/HealthID.exe",
  "updater_url": "https://sha-sladeid-artifacts.s3.af-south-1.amazonaws.com/installers/HealthID/HealthID-updater.exe",
  "checksum": "728D4FA82F64BAE26202C57374C9A455"
}
Compare version against the build the workstation reports and update it if they differ.
### The match stays pending
Confirm somebody is actually at the scanner. The capture only resolves when a finger is presented. If the capture window has closed, the status becomes failed with deadline_exceeded rather than staying pending forever - at that point, request a fresh match.
### Matching always returns no_match
A dispatch for a child whose enrollment is incomplete is refused up front with 422 subject_not_enrolled, so a no_match means the child is enrolled but the finger did not match. If it keeps failing, raise an OTP Whitelist Request for the child rather than retrying indefinitely.
### The visit is refused with match_already_used
Each match authorizes one visit. If your application retried a visit call, the first attempt may already have succeeded. Check for an existing authorization before capturing again.
### The visit is refused with match_subject_mismatch
The health_id on the match and the patient_id on the visit are different patients. Dependants on the same policy differ only by the trailing index of the CR code, so compare the full string.
## 7. Related Resources
- Minors Biometrics Integration Guide
- Biometrics Consent - the adult path, and Hardware Server setup
- OTP Whitelist Request - the path when a child cannot match on an enforced facility
- Send OTP - guardian authorization, for a child not eligible for biometrics
- Get Beneficiary Valid Contact - resolving the guardian's contact
- Get Authorizations
- Reject Authorization
- Start Visit Workflow Guide
- Consent Services API Reference
Last modified on September 28, 2026
