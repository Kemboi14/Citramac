# Minors Biometrics Enrollment Guide
A minor has no fingerprints registered with SHA, so before a child can consent with their own finger you
have to enrol that finger at the point of care. Enrollment is the setup step that makes the
minors biometrics consent flow possible: a child
who is not fully enrolled is refused when you later try to match them.
This guide walks a new integrator through enrolling a child end to end. It assumes you have already set
up HealthID and confirmed your scanner works, because that part is identical to the adult path - if
you have not, start with the Biometrics Integration Guide
and come back.
For the endpoint-by-endpoint reference, see the
Minors Biometrics Enrollment process doc. This guide
is the walkthrough.
## The shape of it
Enrollment is per finger and two steps - enrol, then verify - repeated until the child is fully
enrolled. Both steps are asynchronous: you dispatch a capture and the outcome arrives at your callback.
## Step 1 - Decide who to enrol
Enrol the children who will consent by fingerprint. The payer decides who that is, and the answer arrives
with the member's eligibility response as a biometric_status object - a child with use_sil_biometrics
set to true uses minors biometrics and needs to be enrolled. A child with it false uses guardian
authorization instead and does not need enrollment. See Send OTP.
### Register your callback endpoint first
Every enrollment and verification outcome is delivered to the endpoint registered for your facility -
the same one that receives claim notifications. It is the only delivery path, so a capture from a
facility with no registered endpoint is refused with 422 before it starts. Register one before
driving this flow.
## Step 2 - Enrol a finger
Code 
POST /api/v1/biometrics/enrollments
Send the child's CR code as beneficiary_code, the workstation_id and device_id you read from
GET http://localhost:18065/status, your agent_id, and the position (1-10) of the finger you are
enrolling.
You get 202 Accepted with a job_id and next_action: await_callback - the capture has been sent,
not performed. The scanner wakes and the child places the finger. When it resolves, the enrollment
callback arrives: the finger is now stored and shows up under non_verified. It is not usable yet.
### Use the dependant's own CR code
A child on a family policy has their own CR code, differing from a sibling's only by the trailing index.
Enrol against the exact code of the child whose finger is on the scanner - it is the same code you will
later match and authorize against.
A 503 means the workstation is not live; nothing was queued, so retry once the capture agent is
back.
## Step 3 - Verify the finger
Code 
POST /api/v1/biometrics/verifications
Send the same fields, for the position you just enrolled. The child places the same finger again, and
the new capture is matched against the stored print. The verification callback tells you what
happened:
- verified: true - the finger is confirmed. It moves from non_verified to verified and now
counts towards completion.
- status: not_verified - the capture did not match this finger. Try again; attempts_remaining
tells you how many tries are left.
- requires_reenroll: true (with status: max_attempts_exceeded) - the finger has run out of attempts and
been retired. Enrol it again from Step 2; a fresh enrollment resets it.
### Why verify at all?
The first capture only stores a print; the second proves the same finger reads consistently on this
scanner. A finger is only trusted for consent once it has been verified, which is why a freshly enrolled
finger sits in non_verified until you confirm it.
## Step 4 - Repeat until complete
Enrollment is per finger, so repeat Steps 2 and 3 for each finger the child needs. Check progress at any
time:
Code 
GET /api/v1/biometrics/enrollment-status?beneficiary_code=CR2594484249725-2
When enrollment_status reads fully_enrolled, the child is ready to consent by fingerprint - continue
with the Minors Biometrics Integration Guide.
### Do not hardcode a finger count
How many verified fingers count as complete is decided upstream and can change without a release on your
side. Do not encode a number - drive off enrollment_status. A part-enrolled child is refused at
matching, so completion matters.
Enrollment does not have to be done in one sitting. enrollment-status is how you resume: verify anything
still in non_verified, and enrol-then-verify any fingers not yet present.
## Step 5 - When it does not work
 | What you see | What it means | What to do
 | 422 on dispatch | No callback endpoint registered for the facility | Register one, then retry
 | 400 on dispatch | A required field is missing | The message names the field; supply it
 | 503 on dispatch | Workstation not live | Check HealthID on that workstation, retry
 | No callback arrives | Nobody presented a finger, or your endpoint is unreachable | Prompt the clinician; confirm the endpoint returns 2xx
 | Enrollment callback with deadline_exceeded | The capture window closed with no finger | Dispatch a fresh enrollment
 | not_verified | The finger did not match its stored print | Re-capture; watch attempts_remaining
 | requires_reenroll | The finger ran out of attempts and was retired | Enrol that finger again
## Related resources
- Minors Biometrics Enrollment - endpoint reference and callback bodies.
- Minors Biometrics Integration Guide - using an enrolled child's print as consent.
- Biometrics Integration Guide - HealthID setup and the adult flow.
- Consent Services API Reference
Last modified on September 28, 2026
