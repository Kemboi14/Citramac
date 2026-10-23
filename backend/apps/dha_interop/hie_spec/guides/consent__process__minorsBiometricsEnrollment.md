# Minors Biometrics Enrollment Process Guide
## 1. Overview: Enrolling a Minor's Fingerprints
An adult's fingerprints are already registered with SHA, so an adult can consent by matching against
them. A minor has no such prints. Before a child can consent with their own finger, that finger has to
be enrolled at the point of care.
Enrollment is what makes the Minors Biometrics Consent
flow possible: once a child is enrolled, their print can be matched to authorize a visit. A child whose
enrollment is incomplete is refused at the point of matching, so enrollment is the first thing to get
right.
Enrollment is per finger and two steps:
- Enrol the finger - a first capture that stores the print. At this point the finger is recorded but
not yet usable.
- Verify the finger - a second capture, matched against the stored print. Only once a finger is
verified does it count towards the child being enrolled and become usable for consent.
You repeat that pair for each finger the child needs, until their status reads fully_enrolled.
Both captures are asynchronous and delivered by callback, exactly like a match: you dispatch the
capture, the child places their finger, and the outcome is posted to your registered callback endpoint.
### What you need before you start
This guide assumes HealthID is installed and your scanner is working - the setup is identical to the
adult path, covered in section 2 of the Biometrics Consent guide.
You also need a registered callback endpoint for your facility; without one there is nothing to
deliver an outcome to, and a capture is refused before it starts (see below).
## 2. A Callback Endpoint Is Required
Every enrollment and verification outcome is delivered to the callback endpoint registered for your
facility - the same endpoint that already receives claim notifications. There is no result to poll for.
Because that is the only way an outcome is delivered, a capture dispatched by a facility with no
registered callback endpoint is refused up front with 422, before anything reaches the
workstation:
Code 
{
  "error": "Unprocessable Entity",
  "message": "capture_undeliverable: register an active biometric callback endpoint for this facility before dispatching a capture"
}
The remedy is to register a callback endpoint for the facility, then retry.
## 3. The Enrollment Flow
### 3.1. Step 1 - Enrol a Finger
Call POST /api/v1/biometrics/enrollments with:
 | Field | Required | Notes
 | beneficiary_code | Yes | The child's beneficiary CR code, including the dependant suffix.
 | workstation_id | Yes | From GET http://localhost:18065/status.
 | device_id | Yes | The serial number of the capture device on that workstation, from the same devices list.
 | agent_id | Yes | The biometrics agent operating the workstation.
 | position | Yes | The finger position being enrolled, 1-10.
All five are required. A request missing any of them is rejected with 400 naming the field:
Code 
{
  "error": "Bad Request",
  "message": "validation failed: position is required"
}
A valid request returns 202 Accepted with a job_id and a next_action of await_callback. The
capture has been dispatched to the workstation but has not happened yet - keep the job_id to
correlate the callback that follows.
Code 
{
  "job_id": "9f2c1d4e-6b8a-4c37-9f10-2a5b7c3d8e41",
  "status": "dispatched",
  "next_action": "await_callback"
}
If the target workstation is not live, the request fails with 503. Nothing was queued; retry once
the capture agent is back.
### 3.2. Step 2 - The Child Places Their Finger
The scanner on the target workstation wakes and waits. The child places the finger for the position you
sent. The print is captured and stored, and the outcome is posted to your callback endpoint.
### 3.3. Step 3 - Verify the Same Finger
A stored print is not yet usable - it has to be confirmed by a second capture. Call
POST /api/v1/biometrics/verifications with the same fields, for a position that has already been
enrolled. The child places the same finger again; the new capture is matched against the stored print.
The verification outcome, again by callback, tells you whether the finger was confirmed.
### 3.4. Step 4 - Repeat Until Complete
Enrollment is per finger, so repeat the enrol-then-verify pair for each finger the child needs. Track
progress with enrollment status; when it reads fully_enrolled
the child is ready to consent by fingerprint.
### Do not encode your own finger count
How many verified fingers count as complete is decided upstream and can change without a release on your
side. Do not hardcode a number - drive off enrollment_status, which is fully_enrolled only once the
requirement is met.
## 4. The Callbacks
Outcomes are posted to the endpoint registered for your facility. Enrollment and verification are their
own operations, so register for whichever you handle:
 | Operation | Entity | Action
 | Enrollment capture completed | biometric_enrollment | completed
 | Verification capture completed | biometric_verification | completed
The body is the notification itself, with no enclosing envelope. job_id is the value returned when you
dispatched the capture, so you can tie the outcome back to the request.
### 4.1. Enrollment callback
Code 
{
  "job_id": "9f2c1d4e-6b8a-4c37-9f10-2a5b7c3d8e41",
  "beneficiary_code": "CR2594484249725-2",
  "position": 3,
  "succeeded": true,
  "enrollment": {
    "verified": [1, 2],
    "non_verified": [3],
    "total": 3,
    "enrollment_status": "partially_enrolled"
  }
}
 | Field | Notes
 | succeeded | true when the print was captured and stored. false when the capture did not complete; error_code and error_detail say why.
 | enrollment | The child's enrollment inventory after this capture - the same shape returned by enrollment status. Use it to refresh your progress view. Absent if the beneficiary could not be resolved.
 | error_code / error_detail | Present only on a capture that did not complete, for example deadline_exceeded when nobody presented a finger.
A freshly enrolled finger appears under non_verified - it is stored but still needs verification.
### 4.2. Verification callback
Code 
{
  "job_id": "1b7e33aa-2c4d-4e6f-8a90-3c5d7e9f0a12",
  "beneficiary_code": "CR2594484249725-2",
  "position": 3,
  "succeeded": true,
  "verified": true,
  "status": "verified",
  "attempts_remaining": 0,
  "requires_reenroll": false,
  "enrollment": {
    "verified": [1, 2, 3],
    "non_verified": [],
    "total": 3,
    "enrollment_status": "fully_enrolled"
  }
}
 | Field | Notes
 | succeeded | true when the capture ran, whether or not the finger matched. false only when the capture itself did not complete.
 | verified | true when the print matched the enrolled one and the finger is now confirmed.
 | status | verified, not_verified (the finger did not match, try again) or max_attempts_exceeded (the finger has been retired, re-enrol it).
 | attempts_remaining | Verification attempts left on this finger. Meaningful only alongside status: not_verified; it reads 0 in every other case, including a successful verify, so 0 on its own is not a problem.
 | requires_reenroll | true only once the finger has been retired after repeated failed verifications. This, together with status: max_attempts_exceeded, is your signal to enrol the finger again.
 | message | Human-readable summary, safe to surface to an operator. Do not branch on it.
 | enrollment | The refreshed inventory, as above.
### A finger can be exhausted
A finger tolerates only a few failed verifications before it is retired. You do not have to track that
count yourself: when a finger is retired, the callback carries status: max_attempts_exceeded and
requires_reenroll: true. That - not attempts_remaining reaching 0 - is the signal to enrol the
finger again, which resets it. Until then, a not_verified result simply means capture again.
### Respond 2xx, and treat it as at-least-once
Acknowledge every callback with a 2xx. A non-2xx is retried by the same machinery that retries claim
notifications, so your handler must be idempotent on job_id.
## 5. Checking and Resuming Enrollment
Enrollment does not have to happen in one sitting. At any time, read where a child stands with:
Code 
GET /api/v1/biometrics/enrollment-status?beneficiary_code=CR2594484249725-2
Code 
{
  "verified": [1, 2],
  "non_verified": [3],
  "total": 3,
  "enrollment_status": "partially_enrolled"
}
 | Field | Meaning
 | verified | Positions that are stored and confirmed. These count towards completion and can be matched.
 | non_verified | Positions that are stored but still need a verification capture. Resume here.
 | total | Positions stored so far, verified and not.
 | enrollment_status | fully_enrolled, partially_enrolled, or empty when the child has no stored prints.
To resume a paused enrollment: verify any positions sitting in non_verified, and enrol-then-verify any
fingers not yet present, until enrollment_status is fully_enrolled.
## 6. Troubleshooting
### Dispatch returns 422
The facility has no registered callback endpoint, so no outcome could be delivered. Register one for the
facility and retry.
### Dispatch returns 503
The target workstation is not live. Confirm HealthID is running on that workstation
(GET http://localhost:18065/status) and that the workstation ID is the one you intend. Retry once it is
live; nothing was queued.
### No callback arrives
Confirm somebody presented a finger at the scanner, and that the facility's callback endpoint is
reachable and returns 2xx. If the capture window closed with nobody presenting a finger, the callback
reports the capture as not completed with an error_code of deadline_exceeded - dispatch a fresh
capture.
### Verification keeps returning not_verified
The finger is enrolled but the new capture is not matching it. Re-capture carefully. Once the finger has
been retired after repeated failures, the callback reports status: max_attempts_exceeded with
requires_reenroll: true - enrol that finger again to reset it.
### A finger will not enrol cleanly
Try a different finger position. Positions 1-10 are all eligible; a child does not need any specific
finger, only enough verified ones to reach fully_enrolled.
## 7. Related Resources
- Minors Biometrics Enrollment Integration Guide - the end-to-end walkthrough.
- Minors Biometrics Consent - using an enrolled child's print as consent for a visit.
- Biometrics Consent - the adult path, and Hardware Server setup.
- Consent Services API Reference
Last modified on September 28, 2026
